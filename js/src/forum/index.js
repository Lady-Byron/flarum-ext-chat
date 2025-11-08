// js/src/forum/index.js
// [FIX] 对接 Blomstra Realtime：主动 new Pusher 并桥接为 app.pusher.then(...)
// [KEEP] 模型注册 / 路由入口 / 仅使用 Pusher 兼容接口订阅
// [NOTE] 如后端实际字段是 read_at，这里额外提供 read_at() 作为别名（与 readed_at 并存）

import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import ForumApplication from 'flarum/forum/ForumApplication';
import Session from 'flarum/common/Session';

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

  // 依赖全局 m（Flarum 打包已注入）
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

/** ---------- Realtime 桥接：new Pusher 并映射为 app.pusher.then(...) ---------- */
const realtimeBridge = (() => {
  let pusher = null;
  let channels = { main: null, user: null };

  function readRealtimeAttrs() {
    return {
      key: app.forum.attribute('websocket.key'),
      host: app.forum.attribute('websocket.host'),
      port: app.forum.attribute('websocket.port'),
      secure: !!app.forum.attribute('websocket.secure'),
    };
  }

  function ensurePusher() {
    if (pusher) return pusher;

    const { key, host, port, secure } = readRealtimeAttrs();
    const PusherCtor = (window && window.Pusher) || null;

    if (!PusherCtor || !key || !host) return null;

    pusher = new PusherCtor(key, {
      wsHost: host,
      wsPort: port,
      wssPort: port,
      forceTLS: secure,
      enabledTransports: ['ws', 'wss'],
    });

    // 调试：可看到连接状态
    pusher.connection.bind('state_change', (s) => {
      // eslint-disable-next-line no-console
      console.debug('[realtime-bridge] state:', s.previous, '=>', s.current);
    });

    // 公共频道映射为 main
    channels.main = pusher.subscribe('public');

    return pusher;
  }

  function bindUserChannel() {
    if (!ensurePusher()) return;
    const uid = app.session?.user?.id?.();
    if (!uid) return;

    const chName = `private-user=${uid}`;
    if (channels.user && channels.user.name === chName) return; // 已经是当前用户

    // 若之前有别的用户频道，先退订
    if (channels.user && channels.user.unsubscribe) {
      try {
        pusher.unsubscribe(channels.user.name);
      } catch (_) {}
    }

    channels.user = pusher.subscribe(chName);
  }

  function unbindUserChannel() {
    if (!pusher || !channels.user) return;
    try {
      pusher.unsubscribe(channels.user.name);
    } catch (_) {}
    channels.user = null;
  }

  // 对外暴露：返回一个与 flarum/pusher 兼容的 Promise
  function getPusherPromise() {
    if (!ensurePusher()) return null;

    // 初次尝试绑定用户频道
    bindUserChannel();

    // 结构与旧代码期望一致：{ channels: { main, user } }
    return Promise.resolve({ channels });
  }

  return { ensurePusher, bindUserChannel, unbindUserChannel, getPusherPromise, channels: () => channels };
})();

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

  // ---- Realtime 对接：若没有 flarum/pusher 的 app.pusher，则桥接一个 Promise ----
  if (!app.pusher) {
    const p = realtimeBridge.getPusherPromise();
    if (p) app.pusher = p;
  }

  // ---- 仅使用 Pusher 兼容接口（保持原有写法）----
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

      // 调试：看到 true 说明前端已绑定 pusher
      // eslint-disable-next-line no-console
      console.log('[neonchat] pusher bound', !!socket);

      // 全站公共事件（含公开频道）
      if (socket.channels?.main?.bind) socket.channels.main.bind('neonchat.events', handler);
      // 登录用户的私有事件（私聊、仅本人可见等）
      if (socket.channels?.user?.bind) socket.channels.user.bind('neonchat.events', handler);
    });
  }

  // —— 登录/登出后，自动重绑私有频道 —— //
  extend(Session.prototype, 'login', function (promise) {
    // 登录成功后绑定用户频道
    promise?.then?.(() => realtimeBridge.bindUserChannel());
    return promise;
  });
  extend(Session.prototype, 'logout', function (promise) {
    // 登出后退订用户频道
    realtimeBridge.unbindUserChannel();
    return promise;
  });

  // 路由入口（方案 B）
  addChatPage();
});
