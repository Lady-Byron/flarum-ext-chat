import Message from '../models/Message';

import Model from 'flarum/common/Model';
import Stream from 'flarum/common/utils/Stream';
import Link from 'flarum/common/components/Link';

import * as resources from '../resources';
import ViewportState from './ViewportState';
import { throttle } from 'flarum/common/utils/throttleDebounce';

var refAudio = new Audio();
refAudio.src = resources.base64AudioNotificationRef;
refAudio.volume = 0.5;

var audio = new Audio();
audio.src = resources.base64AudioNotification;
audio.volume = 0.5;

export default class ChatState {
  constructor() {
    this.q = Stream('');
    this.chats = [];
    this.chatmessages = [];

    this.chatsLoading = true;
    this.curChat = null;
    this.totalHiddenCount = 0;

    let neonchatState = JSON.parse(localStorage.getItem('neonchat')) ?? {};

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

    this.viewportStates = {};

    // ---- 重要：彻底移除旧 pusher 依赖（不再 this.listenSocketChannels） ----
    // Realtime 事件入口由 index.js 调用 this.onRealtime(...)
  }

  // —— 新增：统一接收 Realtime 事件入口（index.js 会调用）——
  onRealtime(event, payload) {
    // 当前后端仍为聚合封包 neonchat.events（PushChatEvents）
    if (event === 'neonchat.events') {
      this.handleSocketEvent(payload);
      return;
    }
    // 未来若细分为 neon-chat.*，可在这里分发
    // if (event === 'neon-chat.message.created') { ... }
  }

  getViewportState(model) {
    return this.viewportStates[model.id()];
  }

  // 旧的 pusher 渠道监听已不再使用，但保留 handleSocketEvent 以兼容后端 payload
  // listenSocketChannels(socket) { ... } // 已弃用

  handleSocketEvent(r) {
    let message = r.response.message;
    if (message) message = app.store.pushPayload(message);

    let chat = r.response.chat;
    if (chat) chat = app.store.pushPayload(chat);

    // Workaround for blocking events from a chat we leaved
    if (message && message.chat().type() == 1 && message.chat().removed_at()) return;

    switch (r.event.id) {
      case 'message.post': {
        if (!app.session.user || message.user() != app.session.user) {
          this.insertChatMessage(message, true);
          m.redraw();
        }
        break;
      }
      case 'message.edit': {
        let actions = message.data.attributes.actions;
        if (app.session.user && actions.invoker == app.session.user.id()) return;

        if (actions.msg !== undefined) {
          if (!app.session.user || message.user() != app.session.user) this.editChatMessage(message, false, actions.msg);
        } else if (actions.hide !== undefined) {
          if (!app.session.user || actions.invoker != app.session.user.id())
            actions.hide ? this.hideChatMessage(message, false, message.deleted_by()) : this.restoreChatMessage(message, false);
        }
        break;
      }
      case 'message.delete': {
        if (!app.session.user || message.deleted_by() != app.session.user) this.deleteChatMessage(message, false, message.deleted_by());

        break;
      }
      case 'chat.create': {
        if (!app.session.user || chat.creator() != app.session.user) {
          this.addChat(chat, true);
          m.redraw();
        }
        break;
      }
      case 'chat.edit': {
        this.editChat(chat, true);
        let range = r.response.eventmsg_range;
        if (range.length) this.apiFetchChatMessages(chat, range, { notify: true, withFlash: true, disableLoader: true });

        if (app.session.user && r.response.roles_updated_for && r.response.roles_updated_for.includes(app.session.user.id())) {
          let role = app.session.user.chat_pivot(chat.id()).role();
          switch (role) {
            case 0: {
              app.alerts.show(
                { type: 'error' },
                app.translator.trans('xelson-chat.forum.chat.edit_modal.moderator.lost', { chatname: <b>{chat.title()}</b> })
              );
              break;
            }
            case 1: {
              app.alerts.show(
                { type: 'success' },
                app.translator.trans('xelson-chat.forum.chat.edit_modal.moderator.got', { chatname: <b>{chat.title()}</b> })
              );
              break;
            }
          }
        }

        m.redraw();

        break;
      }
      case 'chat.delete': {
        if (!app.session.user || chat.creator() != app.session.user) {
          this.deleteChat(chat);
          m.redraw();
        }
        break;
      }
    }
  }

  getFrameState(key) {
    return this.frameState[key];
  }

  saveFrameState(key, value) {
    let neonchatState = JSON.parse(localStorage.getItem('neonchat')) ?? {};
    neonchatState[key] = value;
    localStorage.setItem('neonchat', JSON.stringify(neonchatState));

    this.frameState[key] = value;
  }

  getPermissions() {
    return this.permissions;
  }

  getChats() {
    return this.chats.filter((chat) => (this.q() && chat.matches(this.q().toLowerCase())) || (!this.q() && !chat.removed_at()));
  }

  getChatsSortedByLastUpdate() {
    return this.getChats().sort((a, b) => {
      if (b.last_message() && a.last_message()) {
        return b.last_message()?.created_at() - a.last_message()?.created_at();
      }
      return 0;
    });
  }

  getUnreadedTotal() {
    return (
      !this.getChats().length ||
      this.getChats()
        .map((m) => m.unreaded())
        .reduce((a, b) => a + b)
    );
  }

  addChat(model, outside = false) {
    this.chats.push(model);

    this.viewportStates[model.id()] = new ViewportState({ model });

    if (model.id() == this.getFrameState('selectedChat')) this.onChatChanged(model);
    if (outside) model.isNeedToFlash = true;
  }

  editChat(model, outside = false) {
    if (outside) model.isNeedToFlash = true;
  }

  apiReadChat(chat, message) {
    if (this.readingTimeout) clearTimeout(this.readingTimeout);

    let timestamp;
    if (message instanceof Date) timestamp = message.toISOString();
    else if (message instanceof Message) timestamp = message.created_at().toISOString();

    this.readingTimeout = setTimeout(() => chat.save({ actions: { reading: timestamp } }), 1000);
  }

  deleteChat(model) {
    this.chats = this.chats.filter((mdl) => mdl != model);
    if (this.getCurrentChat() == model) this.setCurrentChat(null);
  }

  isChatPM(model) {
    return model.type() == 0 && model.users().length <= 2;
  }

  isExistsPMChat(user1, user2) {
    return this.getChats().some((model) => {
      let users = model.users();
      return model.type() === 0 && users.length === 2 && users.some((model) => model == user1) && users.some((model) => model == user2);
    });
  }

  findExistingPMChat(user1, user2) {
    return this.getChats().find((model) => {
      let users = model.users();
      return model.type() === 0 && users.length === 2 && users.some((model) => model == user1) && users.some((model) => model == user2);
    });
  }

  findAnyPMChatIncludingLeft(user1, user2) {
    // Search in all chats including ones we've left (removed_at is set)
    return this.chats.find((model) => {
      let users = model.users();
      return model.type() === 0 && users.length === 2 && users.some((model) => model == user1) && users.some((model) => model == user2);
    });
  }

  onChatChanged(model) {
    if (model == this.getCurrentChat()) return;

    this.setCurrentChat(model);
    try {
      m.redraw.sync();
    } catch (e) {
      console.warn('ChatState onChatChanged redraw error:', e);
      m.redraw();
    }
  }

  comporatorAscButZerosDesc(a, b) {
    return a == 0 ? 1 : b == 0 ? -1 : a - b;
  }

  getChatMessages(filter) {
    let list = this.chatmessages.sort((a, b) => this.comporatorAscButZerosDesc(a.id(), b.id()));
    return filter ? list.filter(filter) : list;
  }

  apiFetchChatMessages(model, query, options = {}) {
    let viewport = this.getViewportState(model);
    let self = this;

    if (viewport.loading || viewport.loadingQueries[query]) return;

    viewport.loading = true;
    viewport.loadingQueries[query] = true;

    return app.store.find('chatmessages', { chat_id: model.id(), query }).then((r) => {
      if (r.length) {
        r.map((model) => {
          if (options.withFlash) model.isNeedToFlash = true;
          self.insertChatMessage(model);
        });
        if (options.notify) this.messageNotify(r[0]);

        viewport.loading = false;
        viewport.loadingQueries[query] = false;

        m.redraw();
      }
    });
  }

  isChatMessageExists(model) {
    return this.chatmessages.find((e) => e.id() == model.id());
  }

  insertEventChatMessage(model, data, notify = false) {
    model.pushAttributes({ message: JSON.stringify(data) });
    // 修复：缺少 this. 导致运行期报错
    this.insertChatMessage(model, notify);
  }

  insertChatMessage(model, notify = false) {
    if (this.isChatMessageExists(model)) return null;

    this.chatmessages.push(model);
    if (notify) {
      this.messageNotify(model);
      model.isNeedToFlash = true;

      let chatModel = model.chat();
      chatModel.isNeedToFlash = true;
      chatModel.pushAttributes({ unreaded: chatModel.unreaded() + 1 });
    }

    let list = this.getChatMessages((mdl) => mdl.chat() == model.chat());
    if ((notify || model.chat().removed_at()) && model.id() && list[list.length - 1] == model) {
      model.chat().pushData({ relationships: { last_message: model } });
      this.getViewportState(model.chat()).newPushedPosts = true;
    }
  }

  renderChatMessage(model, content) {
    let element =
      model instanceof Model
        ? document.querySelector(`.NeonChatFrame .message-wrapper[data-id="${model.id()}"] .message`)
        : model;

    if (element) {
      try {
        s9e.TextFormatter.preview(content, element);

        // Post-process to constrain video widths and handle audio files
        setTimeout(() => {
          const videos = element.querySelectorAll('video');
          videos.forEach((video) => {
            video.style.maxWidth = '290px';
            video.style.width = '290px';
            video.style.height = 'auto';
            video.style.display = 'block';
            video.style.boxSizing = 'border-box';
            video.style.borderRadius = '8px';
          });

          // Handle MP3 and other audio URLs
          this.handleAudioEmbeds(element, content);
        }, 10); // Small delay to ensure DOM is updated
      } catch (e) {
        console.warn('TextFormatter preview error:', e);
        // Fallback to setting innerHTML
        element.innerHTML = content;
        // Still try to handle audio embeds in fallback mode
        setTimeout(() => {
          this.handleAudioEmbeds(element, content);
        }, 10);
      }

      // Workaround for user mentions that doesn't works properly
      $(element)
        .find('.UserMention.UserMention--deleted')
        .each(function () {
          let user = app.store.getBy('users', 'username', this.innerText.substring(1));
          if (this && user) {
            this.classList.remove('UserMention--deleted');
            try {
              m.render(this, <Link href={app.route.user(user)}>{this.innerText}</Link>);
            } catch (e) {
              console.warn('UserMention render error:', e);
            }
          }
        });

      throttle(100, () => {
        $('.NeonChatFrame script').each(function () {
          if (!self.executedScripts) self.executedScripts = {};
          let scriptURL = $(this).attr('src');
          if (!self.executedScripts[scriptURL]) {
            var scriptTag = document.createElement('script');
            scriptTag.src = scriptURL;
            document.head.appendChild(scriptTag);

            self.executedScripts[scriptURL] = true;
          }
        });
      })();
    }
  }

  handleAudioEmbeds(element, content) {
    // Audio file extensions to detect
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];

    // Find all links in the element
    const links = element.querySelectorAll('a');

    links.forEach((link) => {
      const href = link.href;
      if (!href) return;

      // Check if this link points to an audio file
      const isAudioFile = audioExtensions.some((ext) => href.toLowerCase().includes(ext.toLowerCase()));

      if (isAudioFile) {
        // Check if we already embedded this audio file
        if (link.nextElementSibling && link.nextElementSibling.tagName === 'AUDIO') {
          return;
        }

        // Create audio element
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'metadata';
        audio.style.maxWidth = '290px';
        audio.style.width = '100%';
        audio.style.height = '40px';
        audio.style.minHeight = '40px';
        audio.style.display = 'block';
        audio.style.marginTop = '8px';
        audio.style.marginBottom = '8px';
        audio.style.borderRadius = '8px';
        audio.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
        audio.style.border = '1px solid rgba(255, 255, 255, 0.3)';
        audio.style.outline = 'none';

        // Set the source
        audio.src = href;

        // Insert the audio element after the link
        link.parentNode.insertBefore(audio, link.nextSibling);

        // Optionally hide the original link or modify its text
        link.style.display = 'block';
        link.style.marginBottom = '4px';
        link.style.fontSize = '0.9em';
        link.style.opacity = '0.7';
      }
    });

    // Also handle plain text URLs that might not be converted to links yet
    const textContent = element.textContent || element.innerText;
    if (textContent) {
      const urlPattern = /https?:\/\/[^\s]+/g;
      const urls = textContent.match(urlPattern);

      if (urls) {
        urls.forEach((url) => {
          const isAudioFile = audioExtensions.some((ext) => url.toLowerCase().includes(ext.toLowerCase()));

          if (isAudioFile) {
            // Check if this URL is already embedded
            const existingAudios = element.querySelectorAll('audio');
            let alreadyEmbedded = false;

            existingAudios.forEach((audio) => {
              if (audio.src === url) {
                alreadyEmbedded = true;
              }
            });

            if (!alreadyEmbedded) {
              // Create audio element for plain text URL
              const audio = document.createElement('audio');
              audio.controls = true;
              audio.preload = 'metadata';
              audio.style.maxWidth = '290px';
              audio.style.width = '100%';
              audio.style.height = '40px';
              audio.style.minHeight = '40px';
              audio.style.display = 'block';
              audio.style.marginTop = '8px';
              audio.style.marginBottom = '8px';
              audio.style.borderRadius = '8px';
              audio.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
              audio.style.border = '1px solid rgba(255, 255, 255, 0.3)';
              audio.style.outline = 'none';
              audio.src = url;

              // Add a label for the audio
              const label = document.createElement('div');
              label.style.fontSize = '0.8em';
              label.style.opacity = '0.7';
              label.style.marginBottom = '4px';
              label.textContent = '🎵 Audio: ' + url.split('/').pop();

              element.appendChild(label);
              element.appendChild(audio);
            }
          }
        });
      }
    }
  }

  onChatMessageClicked(eventName, model) {
    switch (eventName) {
      case 'dropdownHide': {
        this.hideChatMessage(model, true);
        break;
      }
      case 'dropdownRestore': {
        this.restoreChatMessage(model, true);
        break;
      }
      case 'dropdownDelete': {
        this.deleteChatMessage(model, true);
        break;
      }
    }
  }

  postChatMessage(model) {
    return model
      .save({ message: model.content, created_at: new Date(), chat_id: model.chat().id() })
      .then(
        (r) => {
          // another ugly workaround. I can't even imagine why pushPayload (pushObject) fails
          model.pushData(r.data);
          model.exists = true;

          model.isTimedOut = false;
          model.isNeedToFlash = true;
          model.isEditing = false;
          model.chat().pushData({ relationships: { last_message: model } });
        },
        (r) => {
          model.isTimedOut = true;
        }
      );
  }

  editChatMessage(model, sync = false, content) {
    model.content = content;
    model.isNeedToFlash = true;
    model.pushAttributes({ message: content, edited_at: new Date() });
    if (sync) model.save({ actions: { msg: content }, edited_at: new Date(), message: content });

    m.redraw();
  }

  deleteChatMessage(model, sync = false, user = app.session.user) {
    model.isDeletedForever = true;
    if (!model.deleted_by()) model.pushData({ relationships: { deleted_by: user } });
    let list = this.getChatMessages((mdl) => mdl.chat() == model.chat() && !mdl.isDeletedForever);
    if (list.length) model.chat().pushData({ relationships: { last_message: list[list.length - 1] } });

    this.chatmessages = this.chatmessages.filter((mdl) => mdl != model);
    if (sync) model.delete();

    m.redraw();
  }

  totalHidden() {
    return this.totalHiddenCount;
  }

  hideChatMessage(model, sync = false, user = app.session.user) {
    model.pushData({ relationships: { deleted_by: user } });
    if (sync) model.save({ actions: { hide: true }, relationships: { deleted_by: app.session.user } });

    this.totalHiddenCount++;
    m.redraw();
  }

  restoreChatMessage(model, sync = false) {
    if (!this.isChatMessageExists(model)) {
      this.insertChatMessage(model);
      model.isNeedToFlash = true;
    } else {
      model.pushAttributes({ deleted_by: 0 });
      model.isNeedToFlash = true;
      delete model.data.relationships.deleted_by;
    }
    if (sync) model.save({ actions: { hide: false }, deleted_by: 0 });

    m.redraw();
  }

  setCurrentChat(model) {
    this.curChat = model;
    this.saveFrameState('selectedChat', model ? model.id() : null);
  }

  getCurrentChat() {
    return this.curChat;
  }

  apiFetchChats() {
    return app.store.find('chats').then((chats) => {
      chats.map((model) => this.addChat(model));
      this.chatsLoading = false;
      m.redraw();
    });
  }

  messageNotify(model) {
    if (!app.session.user || model.user().id() != app.session.user.id()) this.notifyTry(model);
  }

  notifyTry(model) {
    if (!('Notification' in window)) return;

    if (this.messageIsMention(model)) this.notifySend(model);
    this.notifySound(model);
  }

  messageIsMention(model) {
    return app.session.user && model.message().indexOf('@' + app.session.user.username()) >= 0;
  }

  notifySend(model) {
    let avatar = model.user().avatarUrl();
    if (!avatar) avatar = resources.base64PlaceholderAvatarImage;

    if (this.getFrameState('notify') && document.hidden)
      new Notification(model.chat().title(), {
        body: `${model.user().username()}: ${model.message()}`,
        icon: avatar,
        silent: true,
        timestamp: new Date(),
      });
  }

  toggleChatsList() {
    var chatLists = this.getChatsListPanel();
    var showing = true;

    if (chatLists.classList.contains('toggled')) {
      chatLists.classList.remove('toggled');
      showing = false;
    } else chatLists.classList.add('toggled');

    this.saveFrameState('beingShownChatsList', showing);
  }

  chatIsShown() {
    return this.getFrameState('beingShown');
  }

  toggleChat(e) {
    this.saveFrameState('beingShown', !this.getFrameState('beingShown'));
  }

  toggleSound(e) {
    this.saveFrameState('isMuted', !this.getFrameState('isMuted'));
  }

  toggleNotifications(e) {
    let notify = this.getFrameState('notify');
    this.saveFrameState('notify', !notify);
    if ('Notification' in window && notify) Notification.requestPermission();
  }

  getChatsListPanel() {
    return document.querySelector('.ChatList');
  }

  getChatsList() {
    return document.querySelector('.ChatList .list');
  }

  notifySound(model) {
    if (!this.getFrameState('isMuted')) {
      let sound = this.messageIsMention(model) ? refAudio : audio;
      sound.currentTime = 0;
      sound.play();
    }
  }

  /**
   * https://github.com/flarum/core/blob/7e74f5a03c7f206014f3f091968625fc0bf29094/js/src/forum/components/PostStream.js#L579
   *
   * 'Flash' the given post, drawing the user's attention to it.
   *
   * @param {jQuery} $item
   */
  flashItem($item) {
    $item.addClass('flash').one('animationend webkitAnimationEnd', () => $item.removeClass('flash'));
  }
}
