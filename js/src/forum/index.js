// js/src/forum/index.js
// [FIX] 解决挂载时机：谁创建 #chat，谁负责触发一次挂载（queueMicrotask/setTimeout）
// [ENH] 显式导入 mithril，避免对全局 m 的隐式依赖
// [KEEP] 模型注册 / Realtime 绑定 / 路由入口维持不变（幂等）
// [NOTE] 如后端实际字段是 read_at，这里额外提供 read_at() 作为别名

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

  // 始终准备 ChatState；是否显示由组件/权限自行判断
  if (!app.chat) app.chat = new ChatState();

  m.mount(root, ChatFrame);
  root.__mounted = true;

  // 可选：请求通知授权（仍建议在用户交互时再请求以提高通过率）
  try {
    if ('Notification' in window && app.chat.getFrameState && app.chat.getFrameState('notify')) {
      Notification.requestPermission?.();
    }
  } catch (_) {}

  // 拉取会话列表（内部自带异常与权限兜底）
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
    // 关键：节点准备好后，安排一次异步挂载（如果已挂载会被 __mounted 拦住）
    if (typeof queueMicrotask === 'function') queueMicrotask(mountFloatingChat);
    else setTimeout(mountFloatingChat, 0);
    return el;
  };

  if (document.readyState === 'loading') {
    // 文档未就绪，等 DOMContentLoaded 再创建并触发挂载
    document.addEventListener('DOMContentLoaded', append, { once: true });
    return null;
  }
  return append();
}

// 顶层先尽力创建（若 body 未就绪，DOMContentLoaded 会补一次且触发挂载）
ensureChatRoot();

/** ---------- 核心初始化 ---------- */
app.initializers.add('xelson-chat:boot', () => {
  // 屏蔽 “Pusher or Websockets” 提示（尽量不影响其它 alert）
  const rawShow = app.alerts.show.bind(app.alerts);
  app.alerts.show = (attrs, content, ...rest) => {
    const text = (typeof content === 'string')
      ? content
      : (content && content.toString ? content.toString() : '');
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
        // 如果后端是 read_at，这里也提供同名方法（作为兼容）
        readed_at:  pivot('chat_pivot', chat_id, 'readed_at', Model.transformDate).bind(this),
        read_at:    pivot('chat_pivot', chat_id, 'read_at',   Model.transformDate).bind(this),
        removed_at: pivot('chat_pivot', chat_id, 'removed_at', Model.transformDate).bind(this),
        joined_at:  pivot('chat_pivot', chat_id, 'joined_at',  Model.transformDate).bind(this),
      };
    },
  });

  // 立即尝试挂载一次（避免错过 ForumApplication.mount 时机）
  mountFloatingChat();

  // 补挂到 mount（正常只触发一次，作为双保险）
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
