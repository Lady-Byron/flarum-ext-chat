// js/src/forum/index.js
import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import ForumApplication from 'flarum/forum/ForumApplication';

import ChatFrame from './components/ChatFrame';

import Chat from './models/Chat';
import Message from './models/Message';
import User from 'flarum/common/models/User';
import Model from 'flarum/common/Model';
import ChatState from './states/ChatState';
import addChatPage from './addChatPage';

// ---- 轻量工具 ----
const getAttr = (name, fallback = undefined) =>
  app.forum && typeof app.forum.attribute === 'function'
    ? app.forum.attribute(name) ?? fallback
    : fallback;

/** 幂等挂载浮窗 Chat */
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
  } catch {}
  app.chat.apiFetchChats?.();
}

/** 保证 #chat 根节点存在 */
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
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', append, { once: true });
  } else {
    append();
  }
}

// 顶层先创建节点，避免错过 mount 时机
ensureChatRoot();

/** 连接 Realtime（Pusher/Channels 兼容接口） */
function connectRealtimeOnce() {
  if (app.__realtimeClient) return app.__realtimeClient;

  // 这些字段来自 Realtime 的前端配置（或 config.php 的 websocket.js-client-*）
  const key = getAttr('websocket.key');
  const host = getAttr('websocket.host');
  const port = getAttr('websocket.port');
  const secure = !!getAttr('websocket.secure');

  // 容错：forum 数据未注入时停止（等待下次 mount 再试）
  if (!key || !host || !port) return null;

  // 注意：Realtime 前端仍走 Pusher Channels 协议；我们用 pusher-js v8 风格的 config
  // 关键：改鉴权端点到 Realtime 的 API，而非 /pusher/auth
  const client = new window.Pusher(key, {
    wsHost: host,
    wsPort: Number(port),
    wssPort: Number(port),
    forceTLS: secure,
    enabledTransports: ['ws', 'wss'],
    disableStats: true,
    channelAuthorization: {
      endpoint: '/api/websocket/auth',
      transport: 'ajax',
      headers: {}, // 同域默认带上 cookie 会话
    },
    userAuthentication: {
      endpoint: '/api/websocket/user-auth',
      transport: 'ajax',
      headers: {},
    },
  });

  client.connection.bind('state_change', (s) => {
    // eslint-disable-next-line no-console
    console.log('[realtime] state:', s.previous, '=>', s.current);
  });

  app.__realtimeClient = client;
  return client;
}

/** 订阅我们需要的频道并绑定事件处理 */
function bindRealtimeHandlers() {
  const client = connectRealtimeOnce();
  if (!client) return;

  const handler = (payload) => {
    try {
      app.chat?.handleSocketEvent?.(payload);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[neonchat] handleSocketEvent failed:', e);
    }
  };

  // 公共频道：名称为 public（Realtime 默认）
  const publicChan = client.channel('public') || client.subscribe('public');
  publicChan.bind('neonchat.events', handler);

  // 登录用户的私有频道：private-user=<id>
  const uid = app.session?.user?.id?.();
  if (uid) {
    const userChanName = `private-user=${uid}`;
    const userChan = client.channel(userChanName) || client.subscribe(userChanName);
    userChan.bind('neonchat.events', handler);
  }
}

/** ---------- Flarum 初始化 ---------- */
app.initializers.add('xelson-chat:realtime-only', () => {
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

  // 第一次挂载与连接
  mountFloatingChat();
  bindRealtimeHandlers();

  // 再挂到 ForumApplication.mount（双保险，确保 forum 数据就绪时再连一次）
  extend(ForumApplication.prototype, 'mount', function () {
    mountFloatingChat();
    bindRealtimeHandlers();
  });

  // 路由入口（可选）
  addChatPage();
});

/* ================================
 *  NEON CHAT DEBUG PROBE（可开关）
 *  开启：localStorage.setItem('neonchat.debug','1')
 *  关闭：localStorage.removeItem('neonchat.debug')
 * ================================ */
app.initializers.add('xelson-chat:debug-probe', () => {
  if (localStorage.getItem('neonchat.debug') !== '1') return;
  if (window.__NEON_PROBE_INSTALLED__) return;
  window.__NEON_PROBE_INSTALLED__ = true;

  const neonPath = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const bits = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && bits.length < 8) {
      const id = cur.id ? `#${cur.id}` : '';
      const cls = (cur.className || '')
        .toString()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((c) => `.${c}`)
        .join('');
      const tag = cur.tagName ? cur.tagName.toLowerCase() : 'node';
      bits.unshift(`${tag}${id}${cls}`);
      cur = cur.parentElement;
    }
    return bits.join(' > ');
  };

  const inChat = (node) => {
    try {
      return !!(node && node.nodeType === 1 && node.closest('.NeonChatFrame'));
    } catch { return false; }
  };

  const nearMessage = (node) => {
    try {
      return node && node.nodeType === 1 ? node.closest('.message-wrapper') : null;
    } catch { return null; }
  };

  const info = (node) => {
    if (!node || node.nodeType !== 1) return { path: String(node), dataset: {}, html: '' };
    return {
      path: neonPath(node),
      dataset: { ...(node.dataset || {}) },
      html: node.outerHTML ? node.outerHTML.slice(0, 200) + '…' : '',
    };
  };

  const paint = (el, color) => {
    try {
      if (el && el.style) {
        el.__oldOutline = el.style.outline;
        el.style.outline = `2px solid ${color}`;
        setTimeout(() => { try { el.style.outline = el.__oldOutline || ''; } catch {} }, 2000);
      }
    } catch {}
  };

  const wrap = (proto, name, handler) => {
    const orig = proto[name];
    if (typeof orig !== 'function') return;
    Object.defineProperty(proto, name, {
      configurable: true,
      value: function (...args) {
        try {
          return handler.call(this, orig, ...args);
        } catch (e) {
          throw e;
        }
      },
    });
  };

  const logMismatch = ({ method, parent, newNode, refNode }) => {
    const msgWrap = nearMessage(refNode) || nearMessage(newNode) || nearMessage(parent);
    const group = `[NEON PROBE] ${method} ref not a child of parent`;
    console.groupCollapsed(group);
    console.log('Parent :', info(parent));
    console.log('Ref    :', info(refNode));
    console.log('New    :', info(newNode));
    if (msgWrap) console.log('Nearest .message-wrapper :', info(msgWrap));
    console.log('Stack  :', new Error().stack);
    console.groupEnd(group);
    paint(parent, '#ff4444'); paint(refNode, '#ffaa00'); paint(newNode, '#44aaff');
    // eslint-disable-next-line no-debugger
    debugger;
  };

  const guard = (parent, newNode, refNode) =>
    inChat(parent) || inChat(newNode) || inChat(refNode);

  // DOM 操作探针（只在聊天区域生效）
  wrap(Node.prototype, 'insertBefore', function (orig, newNode, refNode) {
    if (guard(this, newNode, refNode) && refNode && refNode.parentNode !== this) {
      logMismatch({ method: 'insertBefore', parent: this, newNode, refNode });
    }
    return orig.call(this, newNode, refNode);
  });

  wrap(Node.prototype, 'replaceChild', function (orig, newNode, oldNode) {
    if (guard(this, newNode, oldNode) && oldNode && oldNode.parentNode !== this) {
      logMismatch({ method: 'replaceChild', parent: this, newNode, refNode: oldNode });
    }
    return orig.call(this, newNode, oldNode);
  });

  wrap(Node.prototype, 'removeChild', function (orig, child) {
    if (guard(this, child, null) && child && child.parentNode !== this) {
      logMismatch({ method: 'removeChild', parent: this, newNode: child, refNode: null });
    }
    return orig.call(this, child);
  });

  wrap(Node.prototype, 'appendChild', function (orig, child) {
    if (guard(this, child, null)) {
      const owner = nearMessage(child) || child;
      console.log('[NEON PROBE] appendChild', { into: info(this), child: info(child), owner: info(owner) });
    }
    return orig.call(this, child);
  });

  // mount 提示，帮助确认装载点与组件
  const rawMount = m.mount;
  // eslint-disable-next-line no-undef
  m.mount = function (root, comp) {
    if (inChat(root)) {
      console.log('[NEON PROBE] m.mount on chat root', { root: info(root), comp });
    }
    return rawMount.apply(this, arguments);
  };

  console.info('[NEON PROBE] installed. Enable via localStorage.setItem("neonchat.debug","1")');
});
