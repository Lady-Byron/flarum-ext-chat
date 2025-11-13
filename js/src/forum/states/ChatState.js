// js/src/forum/states/ChatState.js
//
// === 改动汇总（保留你现有改动 A–J）===
// [CHANGED] A. handleSocketEvent：所有“是否本人”的判断一律按 id() 比较，更稳
// [CHANGED] B. chat.edit -> roles_updated_for：翻译占位仅传字符串，避免 [object Object]
// [CHANGED] C. setRelationship：从模型/文档读取 type；兜底 'chatmessages'
// [CHANGED] D. getUnreadedTotal：用 Number()+Math.max() 防 32 位溢出
// [CHANGED] E. pushOne：已是 Model 直接返回；否则按 JSON:API 推入
// [CHANGED] F. throttle 正确用法：throttle(delay, fn) 并立即调用返回函数
// [CHANGED] G. PM 会话匹配一律按 user.id 比较
// [CHANGED] H. addChat 去重：按 id 去重
// [CHANGED] I. loadingQueries 的键统一字符串化
// [CHANGED] J. deleteChat 按 id 过滤
//
// === 本次新增（关键修复）===
// [ADDED] apiFetchChats：拉取会话列表；无论成功失败都关闭 chatsLoading；按 id 去重并恢复上次选中
// [FIX]   renderChatMessage 的“提及修复”改为原生 <a> 替换，避免在 Mithril 子树内再次 m.render 造成 NotFoundError
//         且修正 @ 链接：优先 data-id → username → 当前会话参与者 → 全局已加载用户，生成正确的 /u/<username>

import app from 'flarum/forum/app';
import Model from 'flarum/common/Model';
import Stream from 'flarum/common/utils/Stream';
import { throttle } from 'flarum/common/utils/throttleDebounce';

import * as resources from '../resources';
import ViewportState from './ViewportState';

const refAudio = new Audio();
refAudio.src = resources.base64AudioNotificationRef;
refAudio.volume = 0.5;

const audio = new Audio();
audio.src = resources.base64AudioNotification;
audio.volume = 0.5;

export default class ChatState {
  constructor() {

    // [MENTION] 每会话的本地 @ 计数（前端内存，不序列化）
    this.atCounters = {};

    this.q = Stream('');

    // +++ 新增：UI 过滤器状态 +++
    this.filterMode = Stream('ALL'); // 'ALL', 'PM', 'GROUP', 'PUBLIC'
    this.adminView = Stream(false); // 仅管理员可见

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

    /** @type {Record<number|string, ViewportState>} */
    this.viewportStates = {};
  }

  /* --------------------------------
   *  实用方法
   * -------------------------------- */

  // 若是 Model 实例直接返回；否则按 JSON:API 文档推入
  // eslint-disable-next-line class-methods-use-this
  pushOne(resourceOrDoc) {
    if (!resourceOrDoc) return null;
    if (resourceOrDoc instanceof Model) return resourceOrDoc; // [CHANGED] E
    if (resourceOrDoc.data || resourceOrDoc.included) {
      return app.store.pushPayload(resourceOrDoc);
    }
    // 单资源 → 包装成 document
    return app.store.pushPayload({ data: resourceOrDoc });
  }

  // 通用关系设置：从“模型实例/文档对象”读取 type，兜底 'chatmessages'
  // eslint-disable-next-line class-methods-use-this
  setRelationship(model, relName, relatedModel) {
    if (!model || !relatedModel) return;

    const id =
      (typeof relatedModel.id === 'function' ? relatedModel.id() : relatedModel.id) ??
      relatedModel?.data?.id ??
      null;

    let type = null;
    if (relatedModel instanceof Model) {
      type = relatedModel?.data?.type || null;
    } else if (relatedModel?.data?.type) {
      type = relatedModel.data.type;
    } else if (relatedModel?.type && relatedModel?.id) {
      type = relatedModel.type;
    }
    if (!type) type = 'chatmessages'; // [CHANGED] C

    if (!id) return;

    model.pushData({
      relationships: {
        [relName]: { data: { type, id } },
      },
    });
  }

  // 取/建视口状态
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

    const message = this.pushOne(packet.response?.message);
    const chat = this.pushOne(packet.response?.chat);

    // 统一用 id 值比较“是否本人”
    const meId = app.session.user?.id?.(); // [CHANGED] A

    const actions =
      packet.response?.actions ||
      (packet.response?.message &&
        (packet.response.message.data?.attributes?.actions ||
          packet.response.message?.attributes?.actions)) ||
      {};

    // 屏蔽：对已离开的公开频道（type=1）不弹
    if (message && message.chat?.() && message.chat().type?.() === 1 && message.chat().removed_at?.()) {
      return;
    }

    switch (packet.event.id) {
      case 'message.post': {
        const authorId = message?.user?.()?.id?.(); // [CHANGED] A
        if (!meId || authorId !== meId) {
          this.insertChatMessage(message, true);
          m.redraw();
        }
        break;
      }

      case 'message.edit': {
        const invoker = actions.invoker;
        if (meId && invoker === meId) break; // [CHANGED] A

        if (Object.prototype.hasOwnProperty.call(actions, 'msg')) {
          const authorId = message?.user?.()?.id?.(); // [CHANGED] A
          if (!meId || authorId !== meId) {
            this.editChatMessage(message, false, actions.msg);
          }
        } else if (Object.prototype.hasOwnProperty.call(actions, 'hide')) {
          if (!meId || invoker !== meId) {
            actions.hide
              ? this.hideChatMessage(message, false, message.deleted_by?.())
              : this.restoreChatMessage(message, false);
          }
        }
        break;
      }

      case 'message.delete': {
        const deletedById = message?.deleted_by?.()?.id?.(); // [CHANGED] A
        if (!meId || deletedById !== meId) {
          this.deleteChatMessage(message, false, message.deleted_by?.());
        }
        break;
      }

      case 'chat.create': {
        const creatorId = chat?.creator?.()?.id?.(); // [CHANGED] A
        if (!meId || creatorId !== meId) {
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
        if (meId && updated.includes(meId)) {
          const role = app.session.user.chat_pivot(chat.id?.()).role?.();
          const name = chat.title?.() || '';
          // 仅传字符串占位，避免 [object Object] // [CHANGED] B
          if (role === 0) {
            app.alerts.show(
              { type: 'error' },
              app.translator.trans('xelson-chat.forum.chat.edit_modal.moderator.lost', { chatname: name })
            );
          } else if (role === 1) {
            app.alerts.show(
              { type: 'success' },
              app.translator.trans('xelson-chat.forum.chat.edit_modal.moderator.got', { chatname: name })
            );
          }
        }

        m.redraw();
        break;
      }

      case 'chat.delete': {
        this.deleteChat(chat); // [CHANGED] J
        m.redraw();
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
    // ！！！ 关键修改 ！！！
    // 搜索 (this.q) 和可见性 (isMember/isPublic) 过滤
    // 已经全部移交(move)到 `ChatList.js` (批次三) 的 `content()` 方法中。
    //
    // `getChats()` 和 `getChatsSortedByLastUpdate()` 现在
    // 必须返回从后端获取的“全量宽容列表”，
    // 以便 ChatList.js 可以对其执行“搜索复归”和“UI过滤”。

    // 旧逻辑: (旧逻辑同时处理搜索和过滤，已废弃)
    // const needle = (this.q() || '').toLowerCase();
    // return this.chats.filter((chat) => (needle && chat.matches(needle)) || (!needle && !chat.removed_at?.()));
    
    // 新逻辑：
    return this.chats;
  }

  getChatsSortedByLastUpdate() {
    return this.getChats()
      .slice()
      .sort((a, b) => {
        const la = a.last_message?.()?.created_at?.()?.getTime?.() || 0;
        const lb = b.last_message?.()?.created_at?.()?.getTime?.() || 0;
        return lb - la;
      });
  }

  getUnreadedTotal() {
    const list = this.getChats().filter((c) => this.isChatPM(c));   // ★ 只统计 DM
    if (!list.length) return 0;
    return list
      .map((m) => Math.max(Number(m.unreaded?.() || 0), 0))        // [CHANGED] D
      .reduce((a, b) => a + b, 0);
  }

  addChat(model, outside = false) {
    if (!model) return;
    // [CHANGED] H：按 id 去重
    const id = model.id?.();
    if (id && this.chats.some((c) => c?.id?.() === id)) {
      if (outside) model.isNeedToFlash = true;
      return;
    }

    this.chats.push(model);
    this.viewportStates[id] = new ViewportState({ model });

    if (id == this.getFrameState('selectedChat')) this.onChatChanged(model);
    if (outside) model.isNeedToFlash = true;
  }

  editChat(model, outside = false) {
    if (model && outside) model.isNeedToFlash = true;
  }

  deleteChat(model) {
    const id = model?.id?.();
    this.chats = this.chats.filter((m) => m?.id?.() !== id); // [CHANGED] J
    if (this.getCurrentChat()?.id?.() === id) this.setCurrentChat(null);
  }

  isChatPM(model) {
    return model?.type?.() === 0 && model.users?.()?.length <= 2;
  }

  // [CHANGED] G：全部按 id 比较
  isExistsPMChat(user1, user2) {
    const id1 = typeof user1?.id === 'function' ? user1.id() : user1?.id;
    const id2 = typeof user2?.id === 'function' ? user2.id() : user2?.id;
    return this.getChats().some((model) => {
      const us = model.users?.() || [];
      return model.type?.() === 0 && us.length === 2 && us.some((u) => u?.id?.() === id1) && us.some((u) => u?.id?.() === id2);
    });
  }

  // [CHANGED] G：按 id 比较
  findExistingPMChat(user1, user2) {
    const id1 = typeof user1?.id === 'function' ? user1.id() : user1?.id;
    const id2 = typeof user2?.id === 'function' ? user2.id() : user2?.id;
    return this.getChats().find((model) => {
      const us = model.users?.() || [];
      return model.type?.() === 0 && us.length === 2 && us.some((u) => u?.id?.() === id1) && us.some((u) => u?.id?.() === id2);
    });
  }

  // [CHANGED] G：按 id 比较（包含已离开）
  findAnyPMChatIncludingLeft(user1, user2) {
    const id1 = typeof user1?.id === 'function' ? user1.id() : user1?.id;
    const id2 = typeof user2?.id === 'function' ? user2.id() : user2?.id;
    return this.chats.find((model) => {
      const us = model.users?.() || [];
      return model.type?.() === 0 && us.length === 2 && us.some((u) => u?.id?.() === id1) && us.some((u) => u?.id?.() === id2);
    });
  }

  onChatChanged(model) {
    if (model === this.getCurrentChat()) return;
    this.setCurrentChat(model);

    // [MENTION] 进入会话视为已关注到 @ 提醒 → 本地清零
    if (model) this.clearAtUnread(model);
    
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


  // [MENTION] 取/增/清 指定会话的 @ 未读
  getAtUnread(chat) {
    const id = chat?.id?.();
    return id ? (this.atCounters[id] || 0) : 0;
  }

  incAtUnread(chat) {
    const id = chat?.id?.();
    if (!id) return;
    this.atCounters[id] = (this.atCounters[id] || 0) + 1;
  }

  clearAtUnread(chat) {
    const id = chat?.id?.();
    if (!id) return;
    this.atCounters[id] = 0;
  }

  /* --------------------------------
   *  消息集合 & 排序
   * -------------------------------- */
  getChatMessages(filter) {
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
        // [MENTION] 若这条新消息 @ 了“我”，为该会话的本地 @ 计数 +1
        if (this.messageIsMention(model)) this.incAtUnread(chatModel);
        
        chatModel.isNeedToFlash = true;
        const current = parseInt(chatModel.unreaded?.() ?? 0, 10) || 0;
        chatModel.pushAttributes({ unreaded: current + 1 });
      }
    }

    const chatModel = model.chat?.();
    if (!chatModel) return;

    const list = this.getChatMessages((m) => m.chat?.() == chatModel);
    if (model.id?.() && list[list.length - 1] === model) {
      this.setRelationship(chatModel, 'last_message', model); // 维护 last_message
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
        // @ts-ignore
        window.s9e.TextFormatter.preview(content, el);
      } else {
        el.innerHTML = content;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('TextFormatter preview error:', e);
      el.innerHTML = content;
    }

    // DOM 后处理放入异步，避免与 Mithril 同帧竞争
    setTimeout(() => {
      if (!el.isConnected) return;

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

      // 提及修复（deleted mention -> 原生 <a>，并修正不完整 href/错误 slug）
      if (window.$) {
        const $scope = window.$(el);
        const base = app.forum.attribute('baseUrl') || '';
        const msgModel = modelOrElement instanceof Model ? modelOrElement : null;
        const chatModel = msgModel?.chat?.();

        const eqi = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();

        // 把“名字/显示名”解析成 user：优先 data-id → username → 当前会话参与者 → 全局已加载用户
        const resolveUser = (elNode, nameCandidate) => {
          if (!nameCandidate) return null;

          const dataId = elNode.getAttribute('data-id') || elNode.getAttribute('data-user-id');
          let u = dataId ? app.store.getById('users', String(dataId)) : null;
          if (u) return u;

          u = app.store.getBy('users', 'username', nameCandidate);
          if (u) return u;

          const participants = chatModel?.users?.() || [];
          u = participants.find((x) => eqi(x.displayName?.(), nameCandidate) || eqi(x.username?.(), nameCandidate));
          if (u) return u;

          const all = app.store.all('users') || [];
          u = all.find((x) => eqi(x.displayName?.(), nameCandidate) || eqi(x.username?.(), nameCandidate));
          return u || null;
        };

        // 1) 把 deleted mention（通常是 span）替换为真正的 <a>
        $scope.find('.UserMention.UserMention--deleted').each(function () {
          const nameCandidate = (this.getAttribute('data-username') || this.textContent || '')
            .replace(/^@/, '')
            .trim();
          if (!nameCandidate) return;

          const user = resolveUser(this, nameCandidate);

          const a = document.createElement('a');
          a.className = 'UserMention';
          a.textContent = '@' + (user?.username?.() || nameCandidate);
          // 优先严格路由；否则回退 /u/<nameCandidate>（URI 编码）
          a.href = user ? app.route.user(user) : base + '/u/' + encodeURIComponent(nameCandidate);
          const title = this.getAttribute('title');
          if (title) a.setAttribute('title', title);
          this.replaceWith(a);
        });

        // 2) 修复已是 <a> 的 mention：缺 slug 或 slug 与用户名（或模型）不一致
        $scope.find('a.UserMention').each(function () {
          const href = this.getAttribute('href') || '';

          // 优先 data-username；无则回退文本
          const dataUsername = (this.getAttribute('data-username') || '').trim();
          const textUsername = (this.textContent || '').replace(/^@/, '').trim();
          const nameCandidate = dataUsername || textUsername;

          const user = resolveUser(this, nameCandidate);
          const canonicalSlug =
            (user && (user.slug?.() || user.username?.())) ||
            nameCandidate ||
            '';
          if (!canonicalSlug) return;

          // 从现有 href 里提取 slug
          const m = href.match(/\/u\/([^/?#]+)/);
          const currentSlug = m ? decodeURIComponent(m[1]) : '';

          // 条件：缺少 slug 或与 canonical 不一致 → 修复
          if (!currentSlug || !eqi(currentSlug, canonicalSlug)) {
            const fixed = user ? app.route.user(user) : base + '/u/' + encodeURIComponent(canonicalSlug);
            this.setAttribute('href', fixed);
          }
        });
      }

      // 安全加载 message 内脚本（按 url 去重，不重复注入）
      const self = this;
      throttle(100, () => {
        if (!window.$) return;
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
    }, 10);
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
   *  拉取会话列表（关键修复）
   * -------------------------------- */
  apiFetchChats(options = {}) {
    // 已在加载且不是强制，就直接返回当前列表
    if (this._fetchingChats && !options.force) return this._fetchingChats;

    this.chatsLoading = true;
    this._fetchingChats = app.store
      .find('chats', options.params || {})
      .then((records) => {
        const list = Array.isArray(records) ? records : records ? [records] : [];

        // 重建列表并按 id 去重
        this.chats = [];
        this.viewportStates = {};
        const seen = new Set();

        list.forEach((chat) => {
          const id = chat?.id?.();
          if (id == null || seen.has(id)) return;
          seen.add(id);
          this.addChat(chat); // 内部会建 viewportState，且命中 selectedChat 会自动 onChatChanged
        });

        // 若本地有“上次选中的会话”，但刚才没命中，则尽量恢复一次
        const selectedId = this.getFrameState('selectedChat');
        if (selectedId && !this.getCurrentChat()) {
          const sel = this.chats.find((c) => String(c?.id?.()) === String(selectedId));
          if (sel) this.onChatChanged(sel);
        }

        return this.chats;
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[neon-chat] apiFetchChats error:', e);
        this.saveFrameState('failed', true);
        return [];
      })
      .finally(() => {
        this.chatsLoading = false; // 关键：关闭 loading，避免无限转圈
        this._fetchingChats = null;
        m.redraw();
      });

    return this._fetchingChats;
  }

  /* --------------------------------
   *  阅读回执 / 拉取消息
   * -------------------------------- */
  apiReadChat(chat, messageOrDate) {
    if (this.readingTimeout) clearTimeout(this.readingTimeout);

    let timestamp;
    if (messageOrDate instanceof Date) timestamp = messageOrDate.toISOString();
    else if (messageOrDate && messageOrDate.created_at?.()) timestamp = messageOrDate.created_at().toISOString();

    if (!timestamp) return;

    this.readingTimeout = setTimeout(() => {
      chat.save({ actions: { reading: timestamp } });

      this.clearAtUnread(chat); // [MENTION] 上报已读后清空本地 @
    }, 1000);
  }

  apiFetchChatMessages(model, query, options = {}) {
    const viewport = this.getViewportState(model);
    if (!viewport) return;

    // [CHANGED] I：规范化 loadingQueries 键
    const key = Array.isArray(query) ? JSON.stringify(query) : String(query ?? '');

    if (viewport.loading || viewport.loadingQueries[key]) return;

    viewport.loading = true;
    viewport.loadingQueries[key] = true;

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
        viewport.loading = false;
        viewport.loadingQueries[key] = false;
        m.redraw();
      });
  }

  apiJoinChat(chatModel) {
    const me = app.session.user;
    if (!me || !chatModel || !chatModel.id()) return Promise.reject();

    // 错误根源: model.save() 错误地发送了 POST。
    // 解决方案: 我们使用 app.request() 来强制发送 PATCH，
    //         并手动构建一个 *完全* 模仿 Flarum model.save() 行为的 payload。
    //         这个 payload 结构与您在 ChatCreateModal.js 中用于“复归”的
    //         工作代码 100% 匹配。

    // 1. 构建 'attributes'
    // (EditChatHandler 期望 'attributes.users.added')
    const attributes = {
        users: {
            added: [{ type: 'users', id: me.id() }]
        }
    };
    
    // 2. 构建 'relationships' (Flarum/JSON:API 标准)
    // (这是 model.save() 会自动提取的部分)
    const relationships = {
        users: {
            data: (chatModel.users() || []).map(Model.getIdentifier)
        }
    };

    // 3. 我们使用 app.request 强制发送 PATCH
    return app.request({
      method: 'PATCH', // 可能被降格为 POST，但有 Override 也没问题
      url: `${app.forum.attribute('apiUrl')}/chats/${chatModel.id()}`,
      headers: {
        'Content-Type': 'application/vnd.api+json',
        'Accept': 'application/vnd.api+json',
        'X-CSRF-Token': app.session.csrfToken,
        'X-HTTP-Method-Override': 'PATCH',   // 显式加，确保路由命中
      },
      body: {
        data: {
          type: 'chats',
          id: chatModel.id(),
          attributes: { users: { added: [Model.getIdentifier(app.session.user)] } },
          relationships: {
            users: { data: (chatModel.users() || []).map(Model.getIdentifier) },
          },
        },
      },
    }).then((json) => app.store.pushPayload(json));

    

  /* --------------------------------
   *  发送 / 编辑 / 隐藏 / 删除
   * -------------------------------- */
  onChatMessageClicked(eventName, model) {
    if (!model || !app.session.user) return;

    const meId = app.session.user.id?.();
    const chat = model.chat?.();
    if (!chat) return;

    const perms = this.getPermissions();
    const authorId = model.user?.()?.id?.();
    const canSelfDelete = perms.delete && authorId && String(authorId) === String(meId);
    const isLocalModer = !!chat.role?.(); // 本地管理员（在该会话中的权限角色）
    const deletedById = model.deleted_by?.()?.id?.();
    const canRestore = perms.moderate?.delete || (deletedById && String(deletedById) === String(meId));

    switch (eventName) {
      case 'dropdownHide': {
        if (canSelfDelete || isLocalModer) this.hideChatMessage(model, true);
        break;
      }
      case 'dropdownRestore': {
        if (canRestore) this.restoreChatMessage(model, true);
        break;
      }
      case 'dropdownDelete': {
        if (perms.delete && (isLocalModer || model.deleted_by?.() || this.totalHidden() >= 3)) {
          this.deleteChatMessage(model, true);
        }
        break;
      }
      default:
        break;
    }
  }

  postChatMessage(model) {
    if (!model) return Promise.resolve();

    const text = (model.content ?? model.message?.() ?? '').toString();
    return model.save({ message: text, created_at: new Date(), chat_id: model.chat?.().id?.() }).then(
      (r) => {
        if (r?.data) {
          model.pushData(r.data);
        }
        model.exists = true;

        model.isTimedOut = false;
        model.isNeedToFlash = true;
        model.isEditing = false;

        const chatModel = model.chat?.();
        if (chatModel) {
          this.setRelationship(chatModel, 'last_message', model);
          const vp = this.getViewportState(chatModel);
          if (vp) vp.newPushedPosts = true;
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

    if (!model.deleted_by?.()) {
      model.pushData({
        relationships: { deleted_by: { data: user ? { type: 'users', id: user.id?.() } : null } },
      });
    }

    const chatModel = model.chat?.();
    if (chatModel) {
      const list = this.getChatMessages((m) => m.chat?.() == chatModel && !m.isDeletedForever);
      if (list.length) {
        this.setRelationship(chatModel, 'last_message', list[list.length - 1]);
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
    model.pushData({
      relationships: { deleted_by: { data: user ? { type: 'users', id: user.id?.() } : null } },
    });
    if (sync)
      model.save({
        actions: { hide: true },
        relationships: { deleted_by: { data: { type: 'users', id: app.session.user.id?.() } } },
      });

    this.totalHiddenCount++;
    m.redraw();
  }

  restoreChatMessage(model, sync = false) {
    if (!model) return;

    if (!this.isChatMessageExists(model)) {
      this.insertChatMessage(model);
      model.isNeedToFlash = true;
    } else {
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
    const mine = app.session.user && model.user?.()?.id?.() == app.session.user.id?.();
    if (!mine) this.notifyTry(model);
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

// 安全 JSON 解析
function safeJsonGet(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('JSON parse failed:', e);
    return null;
  }
}
