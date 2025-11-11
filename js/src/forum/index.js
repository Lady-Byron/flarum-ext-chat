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

// ---- 小工具：安全读取 forum attribute ----
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

  // 拉一次会话列表（后端会按可见性/降敏返回）
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

/** 连接 Realtime（Pusher/Channels 兼容接口；使用 Realtime 提供的鉴权端点） */
function connectRealtimeOnce() {
  if (app.__realtimeClient) return app.__realtimeClient;

  const key = getAttr('websocket.key');
  const host = getAttr('websocket.host');
  const port = getAttr('websocket.port');
  const secure = !!getAttr('websocket.secure');

  // forum 数据未注入时，不连接
  if (!key || !host || !port) return null;

  const client = new window.Pusher(key, {
    wsHost: host,
    wsPort: Number(port),
    wssPort: Number(port),
    forceTLS: secure,
    enabledTransports: ['ws', 'wss'],
    disableStats: true,
    // pusher-js v8 配置：改用 Realtime 的鉴权接口
    channelAuthorization: {
      endpoint: '/api/websocket/auth',
      transport: 'ajax',
      headers: {}, // 同域请求会自动带 cookie 会话
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

/** 订阅需要的频道并绑定事件处理（仅私有频道；不再订阅 public） */
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

  // 登录用户的私有频道：private-user=<id>
  const uid = app.session?.user?.id?.();
  if (uid) {
    const userChanName = `private-user=${uid}`;
    const chan = client.channel(userChanName) || client.subscribe(userChanName);
    chan.bind('neonchat.events', handler);
  }
}

/** ---------- Flarum 初始化 ---------- */
app.initializers.add('xelson-chat', () => {
  // 模型注册
  app.store.models.chats = Chat;
  app.store.models.chatmessages = Message;

  // User.chat_pivot(chatId) 读取器（兼容旧代码）
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

  // 首次挂载与订阅
  mountFloatingChat();
  bindRealtimeHandlers();

  // ForumApplication.mount 时再确保一次（forum attrs 就绪）
  extend(ForumApplication.prototype, 'mount', function () {
    mountFloatingChat();
    bindRealtimeHandlers();
  });

  // 路由入口（可选的全屏聊天页）
  addChatPage();
});
