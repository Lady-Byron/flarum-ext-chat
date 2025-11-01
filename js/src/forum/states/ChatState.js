// js/src/forum/states/ChatState.js

import app from 'flarum/forum/app';
import Model from 'flarum/common/Model';
import Stream from 'flarum/common/utils/Stream';
import Link from 'flarum/common/components/Link';
import { throttle } from 'flarum/common/utils/throttleDebounce';

import * as resources from '../resources';
import ViewportState from './ViewportState';

// 参考：事件负载契约
// payload = {
//   event: { id: 'message.post'|'message.edit'|'message.delete'|'chat.create'|'chat.edit'|'chat.delete', chat_id },
//   response: {
//     message?: <JSON:API resource or document>,
//     chat?: <JSON:API resource or document>,
//     actions?: { msg?: string, hide?: boolean, invoker?: number },        // [CHANGED] 可选：从 response 读取
//     eventmsg_range?: number[],
//     roles_updated_for?: number[]
//   }
// }

const refAudio = new Audio();
refAudio.src = resources.base64AudioNotificationRef;
refAudio.volume = 0.5;

const audio = new Audio();
audio.src = resources.base64AudioNotification;
audio.volume = 0.5;

export default class ChatState {
  constructor() {
    this.q = Stream('');

    /** @type {import('../models/Chat').default[]} */
    this.chats = [];
    /** @type {import('../models/Message').default[]} */
    this.chatmessages = [];

    this.chatsLoading = true;
    this.curChat = null;
    this.totalHiddenCount = 0;

    const neonchatState = safeJsonGet(localStorage.getItem('neonchat')) || {};
    this.frameState = {
      beingShown: neonchatState.beingShown ?? app.forum.attribute('xelson-chat.settings.display.minimize'),
      beingShownChatsList: neonchatState.beingShownChatsList ?? 0,
      isMuted: neonchatState.isMuted ?? false,
      notify: neonchatState.notify ?? false,
      transform: neonchatState.transform ?? { x: 0, y: 400 },
      isActive: true,
      selectedChat: neonchatState.selectedChat ?? 0,
    };

    this.permissions = {
      post: app.forum.attribute('xelson-chat.permissions.chat'),
      edit: app.forum.attribute('xelson-chat.permissions.edit'),
      delete: app.forum.attribute('xelson-chat.permissions.delete'),
      create: {
        channel: app.forum.attribute('xelson-chat.permissions.create.channel'),
        chat: app.forum.attribute('xelson-chat.permissions.create'),
      },
      moderate: {
        delete: app.forum.attribute('xelson-chat.permissions.moderate.delete'),
        vision: app.forum.attribute('xelson-chat.permissions.moderate.vision'),
      },
    };

    /** @type {Record<number, ViewportState>} */
    this.viewportStates = {};
  }

  /* --------------------------------
   *  实用方法
   * -------------------------------- */

  // [CHANGED] 安全 JSON 解析
  // eslint-disable-next-line class-methods-use-this
  pushOne(resourceOrDoc) {
    if (!resourceOrDoc) return null;
    if (resourceOrDoc.data || resourceOrDoc.included) {
      return app.store.pushPayload(resourceOrDoc);
    }
    // 单资源 → 包装成 document
    return app.store.pushPayload({ data: resourceOrDoc });
  }

  // [CHANGED] 设置关系（JSON:API 形状）
  // eslint-disable-next-line class-methods-use-this
  setRelationship(model, relName, relatedModel) {
    if (!model || !relatedModel) return;
    const type = relatedModel?.data?.type || relatedModel?.data?.type || relatedModel?.data?.type || relatedModel?.data?.type || relatedModel?.data?.type || relatedModel?.data?.type; // 确保不被摇树
    const safeType = relatedModel?.data?.type || 'chatmessages';
    const id = relatedModel.id?.() || relatedModel.id;
    if (!id) return;
    model.pushData({
      relationships: {
        [relName]: { data: { type: safeType, id } },
      },
    });
  }

  // [CHANGED] 取/建视口状态
  getViewportState(model) {
    const id = model?.id?.();
    if (!id) return null;
    if (!this.viewportStates[id]) {
      this.viewportStates[id] = new ViewportState({ model });
    }
    return this.viewportStates[id];
  }

  /* --------------------------------
   *  统一实时事件分发入口
   * -------------------------------- */
  handleSocketEvent(packet) {
    if (!packet || !packet.event || !packet.event.id) return;

    let message = this.pushOne(packet.response?.message);  // [CHANGED]
    let chat = this.pushOne(packet.response?.chat);        // [CHANGED]

    // 兼容 actions 来源：优先从 response.actions 取，否则尝试 message.attributes.actions
    // [CHANGED]
    const actions =
      packet.response?.actions ||
      (packet.response?.message &&
        (packet.response.message.data?.attributes?.actions ||
          packet.response.message?.attributes?.actions)) ||
      {};

    // 过滤：对已离开的公开频道（type=1）不弹
    if (message && message.chat?.() && message.chat().type?.() === 1 && message.chat().removed_at?.()) {
      return;
    }

    switch (packet.event.id) {
      case 'message.post': {
        if (!app.session.user || message.user?.() !== app.session.user) {
          this.insertChatMessage(message, true);
          m.redraw();
        }
        break;
      }

      case 'message.edit': {
        const invoker = actions.invoker;
        if (app.session.user && invoker === app.session.user.id?.()) break;

        if (Object.prototype.hasOwnProperty.call(actions, 'msg')) {
          if (!app.session.user || message.user?.() !== app.session.user) {
            this.editChatMessage(message, false, actions.msg);
          }
        } else if (Object.prototype.hasOwnProperty.call(actions, 'hide')) {
          if (!app.session.user || invoker !== app.session.user.id?.()) {
            actions.hide
              ? this.hideChatMessage(message, false, message.deleted_by?.())
              : this.restoreChatMessage(message, false);
          }
        }
        break;
      }

      case 'message.delete': {
        if (!app.session.user || message.deleted_by?.() !== app.session.user) {
          this.deleteChatMessage(message, false, message.deleted_by?.());
        }
        break;
      }

      case 'chat.create': {
        if (!app.session.user || chat.creator?.() !== app.session.user) {
          this.addChat(chat, true);
          m.redraw();
        }
        break;
      }

      case 'chat.edit': {
        this.editChat(chat, true);

        const range = packet.response?.eventmsg_range || [];
        if (range.length) {
          this.apiFetchChatMessages(chat, range, {
            notify: true,
            withFlash: true,
            disableLoader: true,
          });
        }

        const updated = packet.response?.roles_updated_for || [];
        if (app.session.user && updated.includes(app.session.user.id?.())) {
          const role = app.session.user.chat_pivot(chat.id?.()).role?.();
          const name = chat.title?.() || '';
          if (role === 0) {
            app.alerts.show({ type: 'error' }, app.translator.trans('xelson-chat.forum.chat.edit_modal.moderator.lost', { chatname: <b>{name}</b> }));
          } else if (role === 1) {
            app.alerts.show({ type: 'success' }, app.translator.trans('xelson-chat.forum.chat.edit_modal.moderator.got', { chatname: <b>{name}</b> }));
          }
        }

        m.redraw();
        break;
      }

      case 'chat.delete': {
        if (!app.session.user || chat.creator?.() !== app.session.user) {
          this.deleteChat(chat);
          m.redraw();
        }
        break;
      }
    }
  }

  /* --------------------------------
   *  状态/持久化
   * -------------------------------- */
  getFrameState(key) {
    return this.frameState[key];
  }

  saveFrameState(key, value) {
    const neonchatState = safeJsonGet(localStorage.getItem('neonchat')) || {};
    neonchatState[key] = value;
    localStorage.setItem('neonchat', JSON.stringify(neonchatState));
    this.frameState[key] = value;
  }

  getPermissions() {
    return this.permissions;
  }

  /* --------------------------------
   *  会话集合/排序/检索
   * -------------------------------- */
  getChats() {
    const needle = (this.q() || '').toLowerCase();
    return this.chats.filter((chat) => (needle && chat.matches(needle)) || (!needle && !chat.removed_at?.()));
  }

  getChatsSortedByLastUpdate() {
    // [CHANGED] 按最后消息时间排序；缺失时置后
    return this.getChats().slice().sort((a, b) => {
      const la = a.last_message?.()?.created_at?.()?.getTime?.() || 0;
      const lb = b.last_message?.()?.created_at?.()?.getTime?.() || 0;
      return lb - la;
    });
  }

  getUnreadedTotal() {
    // [CHANGED] 空数组返回 0；并对每项做函数存在性守护
    const list = this.getChats();
    if (!list.length) return 0;
    return list.map((m) => (m.unreaded?.() | 0)).reduce((a, b) => a + b, 0);
  }

  addChat(model, outside = false) {
    if (!model) return;
    this.chats.push(model);
    this.viewportStates[model.id?.()] = new ViewportState({ model });

    if (model.id?.() == this.getFrameState('selectedChat')) this.onChatChanged(model);
    if (outside) model.isNeedToFlash = true;
  }

  editChat(model, outside = false) {
    if (model && outside) model.isNeedToFlash = true;
  }

  deleteChat(model) {
    this.chats = this.chats.filter((m) => m !== model);
    if (this.getCurrentChat() === model) this.setCurrentChat(null);
  }

  isChatPM(model) {
    return model?.type?.() === 0 && model.users?.()?.length <= 2;
  }

  isExistsPMChat(user1, user2) {
    return this.getChats().some((model) => {
      const us = model.users?.() || [];
      return model.type?.() === 0 && us.length === 2 && us.some((m) => m == user1) && us.some((m) => m == user2);
    });
  }

  findExistingPMChat(user1, user2) {
    return this.getChats().find((model) => {
      const us = model.users?.() || [];
      return model.type?.() === 0 && us.length === 2 && us.some((m) => m == user1) && us.some((m) => m == user2);
    });
  }

  findAnyPMChatIncludingLeft(user1, user2) {
    return this.chats.find((model) => {
      const us = model.users?.() || [];
      return model.type?.() === 0 && us.length === 2 && us.some((m) => m == user1) && us.some((m) => m == user2);
    });
  }

  onChatChanged(model) {
    if (model === this.getCurrentChat()) return;
    this.setCurrentChat(model);
    try {
      m.redraw.sync();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('ChatState onChatChanged redraw error:', e);
      m.redraw();
    }
  }

  setCurrentChat(model) {
    this.curChat = model;
    this.saveFrameState('selectedChat', model ? model.id?.() : null);
  }

  getCurrentChat() {
    return this.curChat;
  }

  /* --------------------------------
   *  消息集合 & 排序
   * -------------------------------- */
  getChatMessages(filter) {
    // [CHANGED] 用 created_at 升序；无时间戳则置后（按 id 兜底）
    const list = this.chatmessages.slice().sort((a, b) => {
      const ta = a.created_at?.()?.getTime?.() || 0;
      const tb = b.created_at?.()?.getTime?.() || 0;
      if (ta !== tb) return ta - tb;
      const ia = parseInt(a.id?.() || 0, 10) || 0;
      const ib = parseInt(b.id?.() || 0, 10) || 0;
      return ia - ib;
    });
    return filter ? list.filter(filter) : list;
  }

  isChatMessageExists(model) {
    const id = model?.id?.();
    return !!this.chatmessages.find((e) => e.id?.() == id);
  }

  insertEventChatMessage(model, data, notify = false) {
    if (!model) return;
    model.pushAttributes({ message: JSON.stringify(data) });
    this.insertChatMessage(model, notify);
  }

  insertChatMessage(model, notify = false) {
    if (!model || this.isChatMessageExists(model)) return null;

    this.chatmessages.push(model);

    if (notify) {
      this.messageNotify(model);
      model.isNeedToFlash = true;

      const chatModel = model.chat?.();
      if (chatModel) {
        chatModel.isNeedToFlash = true;
        const current = parseInt(chatModel.unreaded?.() ?? 0, 10) || 0; // [CHANGED]
        chatModel.pushAttributes({ unreaded: current + 1 });
      }
    }

    const chatModel = model.chat?.();
    if (!chatModel) return;

    const list = this.getChatMessages((m) => m.chat?.() == chatModel);
    if ((notify || chatModel.removed_at?.()) && model.id?.() && list[list.length - 1] === model) {
      this.setRelationship(chatModel, 'last_message', model); // [CHANGED]
      const vp = this.getViewportState(chatModel);
      if (vp) vp.newPushedPosts = true;
    }
  }

  /* --------------------------------
   *  渲染增强（视频限宽 / 音频直链 / 提及修复）
   * -------------------------------- */
  renderChatMessage(modelOrElement, content) {
    const el =
      modelOrElement instanceof Model
        ? document.querySelector(`.NeonChatFrame .message-wrapper[data-id="${modelOrElement.id?.()}"] .message`)
        : modelOrElement;

    if (!el) return;

    try {
      // 由 flarum/s9e 渲染 BBCode/Markdown
      // @ts-ignore
      if (window.s9e?.TextFormatter?.preview) {
        // [CHANGED] 容错
        // @ts-ignore
        window.s9e.TextFormatter.preview(content, el);
      } else {
        el.innerHTML = content;
      }

      // 轻延迟确保 DOM ready
      setTimeout(() => {
        // 限宽 <video>
        el.querySelectorAll('video').forEach((v) => {
          v.style.maxWidth = '290px';
          v.style.width = '290px';
          v.style.height = 'auto';
          v.style.display = 'block';
          v.style.boxSizing = 'border-box';
          v.style.borderRadius = '8px';
        });

        // 处理音频直链
        this.handleAudioEmbeds(el, content);
      }, 10);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('TextFormatter preview error:', e);
      el.innerHTML = content;
      setTimeout(() => this.handleAudioEmbeds(el, content), 10);
    }

    // 提及修复（deleted mention -> link）
    if (window.$) {
      // [CHANGED] jQuery 为可选依赖
      window
        .$(
          el
        )
        .find('.UserMention.UserMention--deleted')
        .each(function () {
          const username = this.innerText?.substring(1);
          if (!username) return;

          const user = app.store.getBy('users', 'username', username);
          if (this && user) {
            this.classList.remove('UserMention--deleted');
            try {
              m.render(this, <Link href={app.route.user(user)}>{this.innerText}</Link>);
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('UserMention render error:', e);
            }
          }
        });
    }

    // 安全加载 message 内脚本（按 url 去重，不重复注入）
    const self = this;
    throttle(100, () => {
      if (!window.$) return; // [CHANGED]
      window.$('.NeonChatFrame script').each(function () {
        self.executedScripts = self.executedScripts || {};
        const scriptURL = window.$(this).attr('src');
        if (scriptURL && !self.executedScripts[scriptURL]) {
          const s = document.createElement('script');
          s.src = scriptURL;
          document.head.appendChild(s);
          self.executedScripts[scriptURL] = true;
        }
      });
    })();
  }

  handleAudioEmbeds(element, content) {
    const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];

    // 已有超链接
    element.querySelectorAll('a').forEach((link) => {
      const href = link.href;
      if (!href) return;
      const isAudio = audioExts.some((ext) => href.toLowerCase().includes(ext));
      if (!isAudio) return;

      if (link.nextElementSibling && link.nextElementSibling.tagName === 'AUDIO') return;

      const audioEl = document.createElement('audio');
      audioEl.controls = true;
      audioEl.preload = 'metadata';
      audioEl.style.maxWidth = '290px';
      audioEl.style.width = '100%';
      audioEl.style.height = '40px';
      audioEl.style.minHeight = '40px';
      audioEl.style.display = 'block';
      audioEl.style.marginTop = '8px';
      audioEl.style.marginBottom = '8px';
      audioEl.style.borderRadius = '8px';
      audioEl.style.backgroundColor = 'rgba(255,255,255,0.15)';
      audioEl.style.border = '1px solid rgba(255,255,255,0.3)';
      audioEl.style.outline = 'none';
      audioEl.src = href;

      link.style.display = 'block';
      link.style.marginBottom = '4px';
      link.style.fontSize = '0.9em';
      link.style.opacity = '0.7';

      link.parentNode.insertBefore(audioEl, link.nextSibling);
    });

    // 纯文本 URL（兜底）
    const textContent = element.textContent || element.innerText || '';
    const urlPattern = /https?:\/\/[^\s]+/g;
    const urls = textContent.match(urlPattern);
    if (!urls) return;

    urls.forEach((url) => {
      const isAudio = audioExts.some((ext) => url.toLowerCase().includes(ext));
      if (!isAudio) return;

      const exists = Array.from(element.querySelectorAll('audio')).some((a) => a.src === url);
      if (exists) return;

      const label = document.createElement('div');
      label.style.fontSize = '0.8em';
      label.style.opacity = '0.7';
      label.style.marginBottom = '4px';
      label.textContent = '🎵 Audio: ' + (url.split('/').pop() || url);

      const audioEl = document.createElement('audio');
      audioEl.controls = true;
      audioEl.preload = 'metadata';
      audioEl.style.maxWidth = '290px';
      audioEl.style.width = '100%';
      audioEl.style.height = '40px';
      audioEl.style.minHeight = '40px';
      audioEl.style.display = 'block';
      audioEl.style.marginTop = '8px';
      audioEl.style.marginBottom = '8px';
      audioEl.style.borderRadius = '8px';
      audioEl.style.backgroundColor = 'rgba(255,255,255,0.15)';
      audioEl.style.border = '1px solid rgba(255,255,255,0.3)';
      audioEl.style.outline = 'none';
      audioEl.src = url;

      element.appendChild(label);
      element.appendChild(audioEl);
    });
  }

  /* --------------------------------
   *  阅读回执 / 拉取
   * -------------------------------- */
  apiReadChat(chat, messageOrDate) {
    if (this.readingTimeout) clearTimeout(this.readingTimeout);

    let timestamp;
    if (messageOrDate instanceof Date) timestamp = messageOrDate.toISOString();
    else if (messageOrDate && messageOrDate.created_at?.()) timestamp = messageOrDate.created_at().toISOString();

    if (!timestamp) return; // [CHANGED] 无时间戳不发

    this.readingTimeout = setTimeout(() => {
      chat.save({ actions: { reading: timestamp } });
    }, 1000);
  }

  apiFetchChatMessages(model, query, options = {}) {
    const viewport = this.getViewportState(model);
    if (!viewport) return;
    if (viewport.loading || viewport.loadingQueries[query]) return;

    viewport.loading = true;
    viewport.loadingQueries[query] = true;

    return app.store
      .find('chatmessages', { chat_id: model.id?.(), query })
      .then((records) => {
        if (records?.length) {
          records.forEach((m) => {
            if (options.withFlash) m.isNeedToFlash = true;
            this.insertChatMessage(m);
          });
          if (options.notify) this.messageNotify(records[0]);
        }
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('apiFetchChatMessages error:', e);
      })
      .finally(() => {
        // [CHANGED] 无论结果如何都清锁
        viewport.loading = false;
        viewport.loadingQueries[query] = false;
        m.redraw();
      });
  }

  /* --------------------------------
   *  发送 / 编辑 / 隐藏 / 删除
   * -------------------------------- */

  // 说明：这里保持使用 model.save()，以便与你后端/适配层的非常规路由解耦。
  // 若需命中 “POST /chatmessages/{id}”，可在 Message 模型覆写 apiEndpoint() 或在 API 封装层处理。
  postChatMessage(model) {
    if (!model) return Promise.resolve();

    return model.save({ message: model.content, created_at: new Date(), chat_id: model.chat?.().id?.() }).then(
      (r) => {
        if (r?.data) {
          // [CHANGED] pushPayload 返回的 data 写回本地 model，修复偶发“未落库”闪断
          model.pushData(r.data);
        }
        model.exists = true;

        model.isTimedOut = false;
        model.isNeedToFlash = true;
        model.isEditing = false;

        const chatModel = model.chat?.();
        if (chatModel) {
          this.setRelationship(chatModel, 'last_message', model); // [CHANGED]
        }
      },
      () => {
        model.isTimedOut = true;
      }
    );
  }

  editChatMessage(model, sync = false, content) {
    if (!model) return;
    model.content = content;
    model.isNeedToFlash = true;
    model.pushAttributes({ message: content, edited_at: new Date() });
    if (sync) model.save({ actions: { msg: content }, edited_at: new Date(), message: content });
    m.redraw();
  }

  deleteChatMessage(model, sync = false, user = app.session.user) {
    if (!model) return;
    model.isDeletedForever = true;

    // [CHANGED] 以关系形状写回 deleted_by
    if (!model.deleted_by?.()) {
      model.pushData({
        relationships: { deleted_by: { data: user ? { type: 'users', id: user.id?.() } : null } },
      });
    }

    // 维护 last_message
    const chatModel = model.chat?.();
    if (chatModel) {
      const list = this.getChatMessages((m) => m.chat?.() == chatModel && !m.isDeletedForever);
      if (list.length) {
        this.setRelationship(chatModel, 'last_message', list[list.length - 1]); // [CHANGED]
      }
    }

    this.chatmessages = this.chatmessages.filter((m) => m !== model);
    if (sync) model.delete();

    m.redraw();
  }

  totalHidden() {
    return this.totalHiddenCount;
  }

  hideChatMessage(model, sync = false, user = app.session.user) {
    if (!model) return;
    // [CHANGED] 关系形状
    model.pushData({
      relationships: { deleted_by: { data: user ? { type: 'users', id: user.id?.() } : null } },
    });
    if (sync) model.save({ actions: { hide: true }, relationships: { deleted_by: { data: { type: 'users', id: app.session.user.id?.() } } } });

    this.totalHiddenCount++;
    m.redraw();
  }

  restoreChatMessage(model, sync = false) {
    if (!model) return;

    if (!this.isChatMessageExists(model)) {
      this.insertChatMessage(model);
      model.isNeedToFlash = true;
    } else {
      // [CHANGED] 清空 deleted_by 关系
      model.pushData({ relationships: { deleted_by: { data: null } } });
      model.isNeedToFlash = true;
    }
    if (sync) model.save({ actions: { hide: false }, relationships: { deleted_by: { data: null } } });

    m.redraw();
  }

  /* --------------------------------
   *  通知
   * -------------------------------- */
  messageNotify(model) {
    if (!app.session.user || model.user?.().id?.() != app.session.user.id?.()) this.notifyTry(model);
  }

  notifyTry(model) {
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    if (this.messageIsMention(model)) this.notifySend(model);
    this.notifySound(model);
  }

  messageIsMention(model) {
    const me = app.session.user;
    if (!me) return false;
    const uname = me.username?.();
    return !!(uname && model.message?.()?.indexOf('@' + uname) >= 0);
  }

  notifySend(model) {
    let avatar = model.user?.().avatarUrl?.();
    if (!avatar) avatar = resources.base64PlaceholderAvatarImage;

    if (this.getFrameState('notify') && document.hidden) {
      new Notification(model.chat?.().title?.() || '', {
        body: `${model.user?.().username?.() || ''}: ${model.message?.() || ''}`,
        icon: avatar,
        silent: true,
        timestamp: new Date(),
      });
    }
  }

  notifySound(model) {
    if (this.getFrameState('isMuted')) return;
    const sound = this.messageIsMention(model) ? refAudio : audio;
    sound.currentTime = 0;
    sound.play().catch(() => {});
  }

  /* --------------------------------
   *  UI 开关/面板
   * -------------------------------- */
  getChatsListPanel() {
    return document.querySelector('.ChatList');
  }

  getChatsList() {
    return document.querySelector('.ChatList .list');
  }

  toggleChatsList() {
    const panel = this.getChatsListPanel();
    if (!panel) return;

    let showing = true;
    if (panel.classList.contains('toggled')) {
      panel.classList.remove('toggled');
      showing = false;
    } else {
      panel.classList.add('toggled');
    }
    this.saveFrameState('beingShownChatsList', showing);
  }

  chatIsShown() {
    return this.getFrameState('beingShown');
  }

  toggleChat() {
    this.saveFrameState('beingShown', !this.getFrameState('beingShown'));
  }

  toggleSound() {
    this.saveFrameState('isMuted', !this.getFrameState('isMuted'));
  }

  toggleNotifications() {
    const notify = this.getFrameState('notify');
    this.saveFrameState('notify', !notify);
    if (!notify && 'Notification' in window) Notification.requestPermission();
  }

  /* --------------------------------
   *  高亮动画
   * -------------------------------- */
  /**
   * 参考 core PostStream.js 的 flash 实现
   * @param {jQuery} $item
   */
  flashItem($item) {
    if (!$item) return;
    $item.addClass('flash').one('animationend webkitAnimationEnd', () => $item.removeClass('flash'));
  }
}

/* -------------------------
 *  小工具（文件内私有）
 * ------------------------- */

// [CHANGED] 安全 JSON 解析
function safeJsonGet(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('JSON parse failed:', e);
    return null;
  }
}
