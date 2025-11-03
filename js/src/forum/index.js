import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import ForumApplication from 'flarum/forum/ForumApplication';

import ChatFrame from './components/ChatFrame';

import Chat from './models/Chat';
import Message from './models/Message';
import User from 'flarum/common/models/User';
import Model from 'flarum/common/Model';
import ChatState from './states/ChatState';
import addChatPage from './addChatPage'; // 保留以添加移动端导航入口
import ChatPage from './components/ChatPage'; // [NEW] 用于无条件注册路由

// [NEW][SAFE] 独立的“只注册路由”的初始化器：不依赖 app.forum，不受权限影响
app.initializers.add('xelson-chat:routes', () => {
  try {
    // idempotent：重复赋值无副作用
    app.routes.chat = { path: '/chat', component: ChatPage };
    // 可选：开发期自检标记
    // console.info('[xelson-chat] route registered -> /chat');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[xelson-chat] route register failed:', e);
  }
});

// [CHANGED] 幂等创建容器（避免重复挂载）
function ensureChatRoot() {
  let el = document.getElementById('chat');
  if (!el) {
    el = document.createElement('div');
    el.setAttribute('id', 'chat');
    document.body.append(el);
  }
  return el;
}

// [CHANGED] 业务初始化与浮窗挂载，单独一个 initializer；去掉“if (!app.forum) return”
app.initializers.add('xelson-chat:boot', () => {
  // [HARDEN] 极端情况下 app.forum 尚未就绪，延一帧再跑；保证不丢执行
  if (!app.forum) {
    requestAnimationFrame(() => app.initializers.get('xelson-chat:boot')?.());
    return;
  }

  // [CHANGED] 屏蔽“Pusher or Websockets”唯一那条提示，其它保持
  const rawShow = app.alerts.show.bind(app.alerts);
  app.alerts.show = (attrs, content, ...rest) => {
    const msg =
      typeof content === 'string'
        ? content
        : (content && content.toString ? content.toString() : '');
    if (msg && msg.includes('Pusher or Websockets')) return;
    return rawShow(attrs, content, ...rest);
  };

  // [CHANGED] 注册模型
  app.store.models.chats = Chat;
  app.store.models.chatmessages = Message;

  // ------- User.chat_pivot(chatId) 读取器 -------
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

  // [CHANGED] 扩展 ForumApplication 挂载周期（更稳妥）
  extend(ForumApplication.prototype, 'mount', function () {
    // 路由已在 `xelson-chat:routes` 注册，不受下列权限影响
    // 这里仅控制“是否浮窗挂载”
    if (!app.forum.attribute('xelson-chat.permissions.enabled')) return;

    // 防止重复 mount
    if (app.__neonMounted) return;
    app.__neonMounted = true;

    const root = ensureChatRoot();

    app.chat = new ChatState();
    m.mount(root, ChatFrame);

    if ('Notification' in window && app.chat.getFrameState('notify')) {
      Notification.requestPermission();
    }

    // [CHANGED] 幂等绑定 Realtime 事件，统一路由给 ChatState
    if (app.realtime && typeof app.realtime.on === 'function' && !app.__neonRealtimeBound) {
      app.__neonRealtimeBound = true; // 防重复绑定
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

    app.chat.apiFetchChats();
  });

  // 保留“移动端 IndexPage 里的入口按钮”
  addChatPage();
});

