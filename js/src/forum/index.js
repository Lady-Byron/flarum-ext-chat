// js/src/forum/index.js
import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import Application from 'flarum/common/Application';

import ChatFrame from './components/ChatFrame';

import Chat from './models/Chat';
import Message from './models/Message';
import User from 'flarum/common/models/User';
import Model from 'flarum/common/Model';
import ChatState from './states/ChatState';
import addChatPage from './addChatPage';

function ensureChatContainer() {
  let el = document.getElementById('chat');
  if (!el) {
    el = document.createElement('div');
    el.setAttribute('id', 'chat');
    document.body.appendChild(el);
  }
  return el;
}

// —— User <-> Chat 关联字段的读取工具（与后端 JSON:API 对应）——
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

app.initializers.add('xelson-chat', () => {
  // 1) 注册模型
  app.store.models.chats = Chat;
  app.store.models.chatmessages = Message;

  // 2) 注册前端路由与移动端入口按钮
  addChatPage();

  // 3) 应用挂载时：构建状态、挂载聊天框、接线 realtime、拉取会话
  extend(Application.prototype, 'mount', function () {
    // 权限开关：后端 extend.php 会把权限吐给 forum attributes
    if (!app.forum.attribute('xelson-chat.permissions.enabled')) return;

    ensureChatContainer();

    // 初始化状态单例
    app.chat = new ChatState();

    // 挂载 UI
    try {
      m.mount(document.getElementById('chat'), ChatFrame);
    } catch (e) {
      // 保护性兜底，避免某些页面还没 ready
      requestAnimationFrame(() => m.mount(document.getElementById('chat'), ChatFrame));
    }

    // 浏览器通知授权（用户可在 UI 里开关）
    if ('Notification' in window && app.chat.getFrameState('notify')) {
      Notification.requestPermission();
    }

    // —— 仅接入 blomstra/realtime；不再触碰 app.pusher —— //
    // 后端我们仍触发的是单一事件总线：`neonchat.events`
    if (app.realtime && typeof app.realtime.on === 'function') {
      app.realtime.on('neonchat.events', (payload) => app.chat.onRealtime('neonchat.events', payload));

      // 预留：若未来切换为“细分事件名”（neon-chat.*），在后端一起改时仅需解除注释
      /*
      [
        'neon-chat.message.created',
        'neon-chat.message.updated',
        'neon-chat.message.deleted',
        'neon-chat.chat.created',
        'neon-chat.chat.edited',
        'neon-chat.chat.deleted',
      ].forEach((ev) => app.realtime.on(ev, (data) => app.chat.onRealtime(ev, data)));
      */
    }

    // 拉取会话列表
    app.chat.apiFetchChats();
  });
});
