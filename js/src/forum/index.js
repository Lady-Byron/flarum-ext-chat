import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import Application from 'flarum/common/Application';

import ChatFrame from './components/ChatFrame';

import Chat from './models/Chat';
import Message from './models/Message';
import User from 'flarum/common/models/User';
import Model from 'flarum/common/Model';
import ChatState from './states/ChatState';
// import addChatPage from './addChatPage'; // 若未来需要独立路由入口可开启

// 挂载容器
const chatRoot = document.createElement('div');
chatRoot.setAttribute('id', 'chat');
document.body.append(chatRoot);

app.initializers.add('xelson-chat', () => {
  // 仅在论坛端启用且有权限时挂载
  if (!app.forum) return;

  // 屏蔽“Pusher or Websockets”缺失提示（只屏蔽这条，其他警告照常）
  const rawShow = app.alerts.show.bind(app.alerts);
  app.alerts.show = (attrs, content, ...rest) => {
    const msg =
      typeof content === 'string'
        ? content
        : (content && content.toString ? content.toString() : '');
    if (msg && msg.includes('Pusher or Websockets')) return;
    return rawShow(attrs, content, ...rest);
  };

  // 注册模型
  app.store.models.chats = Chat;
  app.store.models.chatmessages = Message;

  // 为 User 补充 chat_pivot 读取器（保持与后端 pivot 格式一致）
  function pivot(name, id, attr, transform) {
    pivot.hasOne = function (name, id, attr) {
      return function () {
        const rel =
          this.data.attributes[name] &&
          this.data.attributes[name][id] &&
          this.data.attributes[name][id][attr];
        if (rel) return app.store.getById(rel.data.type, rel.data.id);
      };
    };
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
        role: pivot('chat_pivot', chat_id, 'role').bind(this),
        removed_by: pivot('chat_pivot', chat_id, 'removed_by').bind(this),
        readed_at: pivot('chat_pivot', chat_id, 'readed_at', Model.transformDate).bind(this),
        removed_at: pivot('chat_pivot', chat_id, 'removed_at', Model.transformDate).bind(this),
        joined_at: pivot('chat_pivot', chat_id, 'joined_at', Model.transformDate).bind(this),
      };
    },
  });

  // 在应用挂载时初始化 ChatState 与界面
  extend(Application.prototype, 'mount', function () {
    if (!app.forum.attribute('xelson-chat.permissions.enabled')) return;

    app.chat = new ChatState();
    m.mount(document.getElementById('chat'), ChatFrame);

    // 浏览器通知权限
    if ('Notification' in window && app.chat.getFrameState('notify')) {
      Notification.requestPermission();
    }

    // 路线 B：仅此处订阅一次 Realtime 事件，并统一转交给 ChatState
    if (app.realtime && typeof app.realtime.on === 'function') {
      app.realtime.on('neonchat.events', (payload) => {
        try {
          if (app.chat && typeof app.chat.handleSocketEvent === 'function') {
            app.chat.handleSocketEvent(payload);
          }
        } catch (e) {
          // 不要阻断其他事件
          // eslint-disable-next-line no-console
          console.warn('[xelson-chat] handleSocketEvent failed:', e);
        }
      });
    }

    // 首次拉取会话列表
    app.chat.apiFetchChats();
  });

  // 如需在首页添加「聊天」按钮，可启用
  // addChatPage();
});

