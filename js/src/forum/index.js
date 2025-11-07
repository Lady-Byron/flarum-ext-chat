// js/src/forum/index.js
// [FIX] 订阅时机：仅使用 app.pusher.then(...)，把绑定放到 ForumApplication.mount 之后，并做轻量重试
// [FIX] 谁创建 #chat，谁负责安排一次挂载（queueMicrotask/setTimeout），避免竞态
// [KEEP] 模型注册 / 路由入口 / 告警屏蔽 保持不变
// [NOTE] 若后端 pivot 字段是 read_at，这里在 User.chat_pivot 里同时提供 readed_at()/read_at() 两个同义方法

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

/** ---------- 挂载 ChatFrame（幂等） ---------- */
function mountFloatingChat() {
  const root = document.getElementById('chat');
  if (!root || root.__mounted) return;

  if (!app.chat) app.chat = new ChatState();

  // 使用全局 m（Flarum 注入），避免对 'mithril' 包依赖导致的构建错误
  // eslint-disable-next-line no-undef
  m.mount(root, ChatFrame);
  root.__mounted = true;

  // 可选：若用户已开启通知开关，尝试请求权限（建议仍在用户交互处请求）
  try {
    if ('Notification' in window && app.chat.getFrameState && app.chat.getFrameState('notify')) {
      Notification.requestPermission?.();
    }
  } catch (_) {}

  // 拉取会话列表（内部处理异常与权限）
  try {
    app.chat.apiFetchChats?.();
  } catch (_) {}
}

/** ---------- 创建 #chat（不依赖 Flarum 钩子） ---------- */
function ensureChatRoot() {
  const append = () => {
    let el = document.getElementById('chat');
    if (!el) {
      el = document.createElement('div');
      el.id = 'chat';
      document.body.append(el);
    }
    // 节点创建后异步挂载；若已挂载会被 __mounted 拦住
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

// 顶层先尽力创建（若 body 未就绪，DOMContentLoaded 会补一次并触发挂载）
ensureChatRoot();

/** ---------- 幂等绑定 Pusher/Realtime ---------- */
function bindPusherRealtime() {
  if (app.__neonPusherBound) return;

  // Realtime 以 Pusher 兼容层注入：app.pusher 是一个 Promise
  if (!app.pusher || typeof app.pusher.then !== 'function') return;

  app.pusher.then((pusher) => {
    if (!pusher || app.__neonPusherBound) return;
    const channels = pusher.channels || {};

    const handler = (payload) => {
      try {
        if (app.chat && typeof app.chat.handleSocketEvent === 'function') {
          app.chat.handleSocketEvent(payload);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[neonchat] handleSocketEvent failed:', e);
      }
    };

    // Blomstra Realtime 的 Pusher 兼容：公共(main) + 当前用户(user) 两个频道
    if (channels.main && typeof channels.main.bind === 'function') {
      channels.main.bind('neonchat.events', handler);
    }
    if (channels.user && typeof channels.user.bind === 'function') {
      channels.user.bind('neonchat.events', handler);
    }

    app.__neonPusherBound = true;
    // 可选调试：
    // console.log('[neonchat] bound to pusher channels', !!channels.main, !!channels.user);
  });
}

/** ---------- 核心初始化 ---------- */
app.initializers.add('xelson-chat:boot', () => {
  // 屏蔽“Pusher or Websockets”提示（不影响其它 alert）
  const rawShow = app.alerts.show.bind(app.alerts);
  app.alerts.show = (attrs, content, ...rest) => {
    const text = typeof content === 'string' ? content : (content && content.toString ? content.toString() : '');
    if (text && text.includes('Pusher or Websockets')) return;
    return rawShow(attrs, content, ...rest);
  };

  // 模型注册
  app.store.models.chats = Chat;
  app.store.models.chatmessages = Message;

  // User.chat_pivot(chatId) 读取器（兼容 readed_at / read_at）
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
        read_at:    pivot('chat_pivot', chat_id, 'read_at',   Model.transformDate).bind(this), // 兼容别名
        removed_at: pivot('chat_pivot', chat_id, 'removed_at', Model.transformDate).bind(this),
        joined_at:  pivot('chat_pivot', chat_id, 'joined_at',  Model.transformDate).bind(this),
      };
    },
  });

  // 立即尝试一次 UI 挂载 & 订阅（若此刻还不可用，会在 mount 后重试）
  mountFloatingChat();
  bindPusherRealtime();

  // 补挂到 ForumApplication.mount（更晚、更可靠）+ 轻量重试
  extend(ForumApplication.prototype, 'mount', function () {
    mountFloatingChat();
    bindPusherRealtime();

    // 轻量重试：最多 5 次，每 400ms 尝试一次，避免加载顺序竞态
    if (!app.__neonBindRetryCount) app.__neonBindRetryCount = 0;
    const retry = () => {
      if (app.__neonPusherBound || app.__neonBindRetryCount > 5) return;
      app.__neonBindRetryCount++;
      bindPusherRealtime();
      if (!app.__neonPusherBound) setTimeout(retry, 400);
    };
    setTimeout(retry, 400);
  });

  // 路由入口（方案 B）
  addChatPage();
});
