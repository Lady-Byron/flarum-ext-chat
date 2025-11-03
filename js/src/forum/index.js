// js/src/forum/index.js
// [FIX] 根因是挂载时机：mount 可能在我们打补丁前已执行完，导致 #chat 从未创建/挂载
// [CHANGED] 顶层幂等创建 #chat；initializer 内“立即挂载一次” + 挂 mount 钩子双保险
// [KEEP] 模型注册/Realtime 绑定/权限由 ChatState & 组件内部处理，不在这里早退

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

// ---------- 顶层：幂等创建 #chat（不依赖任何钩子） ----------
function ensureChatRoot() {
  const append = () => {
    let el = document.getElementById('chat');
    if (!el) {
      el = document.createElement('div');
      el.id = 'chat';
      document.body.append(el);
    }
    return el;
  };

  if (document.readyState === 'loading') {
    // 文档未就绪时，延迟到 DOMContentLoaded
    document.addEventListener('DOMContentLoaded', append, { once: true });
    return null;
  }
  return append();
}

// 先尽力创建（若此刻 body 未就绪，DOMContentLoaded 会再补一次）
ensureChatRoot();

// ---------- 辅助：实际挂载 ChatFrame（幂等） ----------
function mountFloatingChat() {
  const root = document.getElementById('chat');
  if (!root || root.__mounted) return;

  // 始终准备好 ChatState；权限/显示由内部自己判定
  if (!app.chat) app.chat = new ChatState();

  m.mount(root, ChatFrame);
  root.__mounted = true;

  // 可选：通知授权
  if ('Notification' in window && app.chat.getFrameState('notify')) {
    Notification.requestPermission();
  }

  // 拉取会话列表（内部做权限/异常兜底）
  app.chat.apiFetchChats();
}

// ---------- 核心初始化 ----------
app.initializers.add('xelson-chat:boot', () => {
  // [KEEP] 屏蔽“Pusher or Websockets”那条提示，其它保持
  const rawShow = app.alerts.show.bind(app.alerts);
  app.alerts.show = (attrs, content, ...rest) => {
    const msg = typeof content === 'string' ? content : (content && content.toString ? content.toString() : '');
    if (msg && msg.includes('Pusher or Websockets')) return;
    return rawShow(attrs, content, ...rest);
  };

  // 模型注册
  app.store.models.chats = Chat;
  app.store.models.chatmessages = Message;

  // ------- User.chat_pivot(chatId) 读取器（保持你现在实现） -------
  function pivot(name, id, attr, transform) {
    return function () {
      const val =
        this.data.attributes[name] &&
        this.data.attributes[name][id] &&
        this.data.attributes[name][id][attr];
      return transform ? transform(val) : val;
    };
  }

  Object.assign(User.prototype, {
    chat_pivot(chat_id) {
      return {
        role:       pivot('chat_pivot', chat_id, 'role').bind(this),
        removed_by: pivot('chat_pivot', chat_id, 'removed_by').bind(this),
        readed_at:  pivot('chat_pivot', chat_id, 'readed_at',  Model.transformDate).bind(this),
        removed_at: pivot('chat_pivot', chat_id, 'removed_at', Model.transformDate).bind(this),
        joined_at:  pivot('chat_pivot', chat_id, 'joined_at',  Model.transformDate).bind(this),
      };
    },
  });

  // —— 立即尝试挂载一次（避免错过 ForumApplication.mount 时机）——
  mountFloatingChat();

  // —— 也补挂到 mount（正常情况下只会触发一次；这里是双保险）——
  extend(ForumApplication.prototype, 'mount', function () {
    mountFloatingChat();
  });

  // Realtime 绑定（幂等）
  if (app.realtime && typeof app.realtime.on === 'function' && !app.__neonRealtimeBound) {
    app.__neonRealtimeBound = true;
    app.realtime.on('neonchat.events', (payload) => {
      try {
        if (app.chat && typeof app.chat.handleSocketEvent === 'function') {
          app.chat.handleSocketEvent(payload);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[xelson-chat] handleSocketEvent failed:', e);
      }
    });
  }

  // 路由入口（方案 B）
  addChatPage();
});
