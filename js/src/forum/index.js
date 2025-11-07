// js/src/forum/index.js
// [FIX] 解决挂载时机：谁创建 #chat，谁负责安排一次挂载（microtask/timeout）
// [KEEP] 模型注册 / 路由入口 / 仅使用 Pusher 兼容接口订阅（Blomstra Realtime 官方路径）
// [NOTE] 如后端实际字段是 read_at，这里额外提供 read_at() 作为别名（与 readed_at 并存）

import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import ForumApplication from 'flarum/forum/ForumApplication';

import ChatFrame from './components/ChatFrame';

import Chat from './models/Chat';
import Message from './models/Message';
import User from 'flarum/common/models/User';
import Model from 'flarum/common/Model';
import ChatState from './states/ChatState';
import addChatPage from './addChatPage'; // 独立路由入口（方案 B）

/** ---------- 辅助：实际挂载 ChatFrame（幂等） ---------- */
function mountFloatingChat() {
  const root = document.getElementById('chat');
  if (!root || root.__mounted) return;

  if (!app.chat) app.chat = new ChatState();

  // 依赖全局 m（Flarum 打包已注入），避免显式 import 'mithril'
  // eslint-disable-next-line no-undef
  m.mount(root, ChatFrame);
  root.__mounted = true;

  try {
    if ('Notification' in window && app.chat.getFrameState && app.chat.getFrameState('notify')) {
      Notification.requestPermission?.();
    }
  } catch (_) {}

  try {
    app.chat.apiFetchChats?.();
  } catch (_) {}
}

/** ---------- 顶层：幂等创建 #chat（不依赖任何 Flarum 钩子） ---------- */
function ensureChatRoot() {
  const append = () => {
    let el = document.getElementById('chat');
    if (!el) {
      el = document.createElement('div');
      el.id = 'chat';
      document.body.append(el);
    }
    if (typeof queueMicrotask === 'function') queueMicrotask(mountFloatingChat);
    else setTimeout(mountFloatingChat, 0);
    return el;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', append, { once: true });
    return null;
  }
  return append();
}

// 顶层先尽力创建
ensureChatRoot();

/** ---------- 核心初始化 ---------- */
app.initializers.add('xelson-chat:boot', () => {
  // 屏蔽 “Pusher or Websockets” 提示（尽量不影响其它 alert）
  const rawShow = app.alerts.show.bind(app.alerts);
  app.alerts.show = (attrs, content, ...rest) => {
    const text =
      typeof content === 'string'
        ? content
        : content && content.toString
        ? content.toString()
        : '';
    if (text && text.includes('Pusher or Websockets')) return;
    return rawShow(attrs, content, ...rest);
  };

  // 模型注册
  app.store.models.chats = Chat;
  app.store.models.chatmessages = Message;

  // User.chat_pivot(chatId) 读取器
  function pivot(name, id, attr, transform) {
    return function () {
      const bucket = this.data?.attributes?.[name];
      const val = bucket && bucket[id] && bucket[id][attr];
      return transform ? transform(val) : val;
    };
  }

  Object.assign(User.prototype, {
    chat_pivot(chat_id) {
      return {
        role:       pivot('chat_pivot', chat_id, 'role').bind(this),
        removed_by: pivot('chat_pivot', chat_id, 'removed_by').bind(this),
        readed_at:  pivot('chat_pivot', chat_id, 'readed_at', Model.transformDate).bind(this),
        read_at:    pivot('chat_pivot', chat_id, 'read_at',   Model.transformDate).bind(this),
        removed_at: pivot('chat_pivot', chat_id, 'removed_at', Model.transformDate).bind(this),
        joined_at:  pivot('chat_pivot', chat_id, 'joined_at',  Model.transformDate).bind(this),
      };
    },
  });

  // 立即尝试挂载一次（避免错过 ForumApplication.mount 时机）
  mountFloatingChat();

  // 补挂到 mount（双保险）
  extend(ForumApplication.prototype, 'mount', function () {
    mountFloatingChat();
  });

  // ---- 仅使用 Pusher 兼容接口（Blomstra Realtime 官方路径）----
  if (!app.__neonPusherBound && app.pusher) {
    app.__neonPusherBound = true;
    app.pusher.then((socket) => {
      const handler = (payload) => {
        try {
          app.chat?.handleSocketEvent?.(payload);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[xelson-chat] handleSocketEvent failed:', e);
        }
      };

      // 调试开关：看到 true 说明前端已绑定 pusher
      // eslint-disable-next-line no-console
      console.log('[neonchat] pusher bound', !!socket);

      // 全站公共事件（含公开频道）
      if (socket.channels?.main?.bind) socket.channels.main.bind('neonchat.events', handler);
      // 登录用户的私有事件（私聊、仅本人可见等）
      if (socket.channels?.user?.bind) socket.channels.user.bind('neonchat.events', handler);
    });
  }

  // 路由入口（方案 B）
  addChatPage();
});
