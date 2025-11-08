// js/src/forum/index.js
// 只对接 Blomstra Realtime（Pusher 协议），完全移除对 app.pusher 的依赖。
// - 读取 websocket.key/host/port/secure，直接 new Pusher 连 Realtime 守护进程
// - 订阅 'public'（映射为 main）与 'private-user=<id>'（映射为 user）
// - 在两个频道上监听 'neonchat.events' 并转交给 app.chat.handleSocketEvent

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
import addChatPage from './addChatPage'; // 独立路由入口（可选）

/* ---------- 工具：幂等创建并挂载浮动 Chat UI ---------- */
function mountFloatingChat() {
  const root = document.getElementById('chat');
  if (!root || root.__mounted) return;

  if (!app.chat) app.chat = new ChatState();

  // eslint-disable-next-line no-undef
  m.mount(root, ChatFrame);
  root.__mounted = true;

  try {
    if ('Notification' in window && app.chat.getFrameState?.('notify')) {
      Notification.requestPermission?.();
    }
  } catch (_) {}

  try {
    app.chat.apiFetchChats?.();
  } catch (_) {}
}

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

// 顶层尽力创建一次
ensureChatRoot();

/* ---------- 安全读取 forum 属性（app.forum 未就绪时从 app.data 兜底） ---------- */
function forumAttr(name) {
  if (app.forum && typeof app.forum.attribute === 'function') {
    const v = app.forum.attribute(name);
    if (v !== undefined) return v;
  }
  if (app.data) {
    if (app.data.forum?.attributes && name in app.data.forum.attributes) {
      return app.data.forum.attributes[name];
    }
    if (app.data.attributes && name in app.data.attributes) {
      return app.data.attributes[name];
    }
  }
  return null;
}

/* ---------- Realtime 直连（无 app.pusher） ---------- */
const Realtime = (() => {
  let pusher = null;
  const channels = { main: null, user: null };
  const bound = new Set(); // 记录已绑定事件的频道，避免重复绑定

  function readCfg() {
    return {
      key: forumAttr('websocket.key'),
      host: forumAttr('websocket.host'),
      port: forumAttr('websocket.port'),
      secure: !!forumAttr('websocket.secure'),
    };
  }

  function getPusherCtor() {
    // 优先使用页面全局（Realtime 通常注入）。如果你改为依赖 npm 包，可改成 import Pusher from 'pusher-js'
    return (window && window.Pusher) || null;
  }

  function ensureConnection() {
    if (pusher) return pusher;

    const { key, host, port, secure } = readCfg();
    const PusherCtor = getPusherCtor();

    if (!PusherCtor || !key || !host) {
      console.error('[realtime] Pusher unavailable or websocket.* missing', { hasCtor: !!PusherCtor, key, host });
      return null;
    }

    pusher = new PusherCtor(key, {
      wsHost: host,
      wsPort: port,
      wssPort: port,
      forceTLS: secure,
      enabledTransports: ['ws', 'wss'],
    });

    pusher.connection.bind('state_change', (s) => {
      // eslint-disable-next-line no-console
      console.debug('[realtime] state:', s.previous, '=>', s.current);
    });

    // 订阅公共频道 => main
    channels.main = pusher.subscribe('public');

    return pusher;
  }

  function bindHandlerToChannel(ch) {
    if (!ch || bound.has(ch)) return;
    const handler = (payload) => {
      try {
        app.chat?.handleSocketEvent?.(payload);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[realtime] handleSocketEvent failed:', e);
      }
    };
    ch.bind('neonchat.events', handler);
    bound.add(ch);
  }

  function bindUserChannel() {
    if (!ensureConnection()) return;
    const uid = app.session?.user?.id?.();
    if (!uid) return;

    const name = `private-user=${uid}`;
    if (channels.user?.name === name) return;

    // 退订旧用户频道
    if (channels.user) {
      try {
        pusher.unsubscribe(channels.user.name);
      } catch (_) {}
      bound.delete(channels.user);
      channels.user = null;
    }

    channels.user = pusher.subscribe(name);
    bindHandlerToChannel(channels.user);
  }

  function unbindUserChannel() {
    if (!pusher || !channels.user) return;
    try {
      pusher.unsubscribe(channels.user.name);
    } catch (_) {}
    bound.delete(channels.user);
    channels.user = null;
  }

  function ensureHandlers() {
    if (!ensureConnection()) return;
    bindHandlerToChannel(channels.main);
    bindUserChannel();
  }

  return {
    ensureConnection,
    ensureHandlers,
    bindUserChannel,
    unbindUserChannel,
    channels,
    get pusher() {
      return pusher;
    },
  };
})();

/* ---------- 核心初始化 ---------- */
app.initializers.add('xelson-chat:boot', () => {
  // 屏蔽“需要 Pusher 或 Websockets”的旧提示
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

  // User.chat_pivot(chatId) 读取器（兼容 read_at / readed_at）
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

  // 先尝试挂一次 UI
  mountFloatingChat();

  // 在 Forum 挂载完成后，初始化 Realtime 并绑定事件
  extend(ForumApplication.prototype, 'mount', function () {
    mountFloatingChat();
    Realtime.ensureHandlers();
  });

  // 登录/登出时切换私有频道
  extend(Session.prototype, 'login', function (promise) {
    promise?.then?.(() => Realtime.bindUserChannel());
    return promise;
  });
  extend(Session.prototype, 'logout', function (promise) {
    Realtime.unbindUserChannel();
    return promise;
  });

  // 可选的独立路由入口
  addChatPage();
});
