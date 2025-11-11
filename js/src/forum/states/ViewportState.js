// js/src/forum/states/ViewportState.js
// 只保留与“发送/编辑/重发”有关的改动：
// - 新建消息 => POST /chatmessages（集合端点），body.data.attributes 里必须有 chat_id
// - 仍为 UI 提供 relationships.chat/user，兼容已有渲染
// - 不额外触发单条 GET 拉取（避免触发 FetchMessageController）

import app from 'flarum/forum/app';
import Stream from 'flarum/common/utils/Stream';
import Model from 'flarum/common/Model';

export default class ViewportState {
  loadingSend = false;

  scroll = { autoScroll: true, oldScroll: 0 };
  loading = false;
  loadingQueries = {};

  input = {
    messageLength: 0,
    rows: 1,
    content: Stream(),
  };

  messagesFetched = false;

  constructor(params) {
    this.model = params?.model || null;

    if (params?.model) {
      this.initChatStorage(params.model);
      this.input.content(this.getChatStorageValue('draft'));
    }
  }

  chatStorage = { key: null, draft: null };

  initChatStorage(model) {
    if (!model || !model.id) return;

    this.chatStorage.key = `neonchat.viewport${model.id()}`;
    try {
      const parsed = JSON.parse(localStorage.getItem(this.chatStorage.key));
      if (parsed) this.chatStorage.draft = parsed.draft ?? '';
    } catch (e) {
      console.warn('Error parsing chat storage:', e);
      this.chatStorage.draft = '';
    }
  }

  getChatStorageValue(key) {
    return this.chatStorage[key];
  }

  setChatStorageValue(key, value) {
    if (!this.chatStorage.key) return;

    try {
      const cached = JSON.parse(localStorage.getItem(this.chatStorage.key)) ?? {};
      cached[key] = value;
      localStorage.setItem(this.chatStorage.key, JSON.stringify(cached));
      this.chatStorage[key] = value;
    } catch (e) {
      console.warn('Error setting chat storage value:', e);
    }
  }

  onChatMessageClicked(eventName, model) {
    switch (eventName) {
      case 'dropdownEditStart':
        this.messageEdit(model, true);
        break;
      case 'dropdownResend':
        this.messageResend(model);
        break;
      case 'insertMention':
        this.insertMention(model);
        break;
      default:
        break;
    }
  }

  getChatInput() {
    const el =
      document.querySelector('.NeonChatFrame #chat-input') ||
      document.querySelector('.ChatViewport #chat-input') ||
      document.getElementById('chat-input');

    if (!el) {
      console.warn('Chat input element not found');
      return null;
    }
    return el;
  }

  messageSend() {
    const text = this.input.content();
    const trimmed = (text || '').trim();
    if (!trimmed || this.loadingSend) return;

    // 编辑已存在消息
    if (this.messageEditing) {
      const model = this.messageEditing;
      if ((model.content || '').trim() !== (model.oldContent || '').trim()) {
        model.oldContent = model.content;
        app.chat.editChatMessage(model, true, model.content);
      }
      this.messageEditEnd();
      this.inputClear();
      return;
    }

    // 目标会话
    const chatModel = this.model || app.chat.getCurrentChat();
    if (!chatModel || !chatModel.id?.()) {
      console.warn('[neon-chat] No active chat model when sending message.');
      return;
    }

    // 新建消息模型（集合端点 + attributes.chat_id）
    const model = app.store.createRecord('chatmessages');
    model.pushData({
      type: 'chatmessages',
      attributes: {
        message: trimmed,
        created_at: new Date(),
        // 关键：后端 PostMessageHandler 读取 attributes.chat_id
        chat_id: chatModel.id?.(),
      },
      // 关系仍然提供给前端 UI 使用；不依赖后端读取
      relationships: {
        user: { data: Model.getIdentifier(app.session.user) },
        chat: { data: Model.getIdentifier(chatModel) },
      },
    });

    // 兼容旧逻辑
    model.content = trimmed;
    model.tempKey = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 不再强制写入 pushAttributes(chat_id) 或改 endpoint；
    // endpoint 由 Message.apiEndpoint() 决定 => /chatmessages

    app.chat.insertChatMessage(model); // 乐观回显
    this.messagePost(model);           // 异步保存
    this.inputClear();
  }

  messageEdit(model) {
    if (this.messageEditing) this.messageEditEnd();

    model.isEditing = true;
    model.oldContent = model.message();

    this.messageEditing = model;

    const inputElement = this.getChatInput();
    if (inputElement) {
      this.input.content(model.oldContent);
      inputElement.value = this.input.content();
      inputElement.focus();
      if (app.chat.input?.resizeInput) app.chat.input.resizeInput();
    }

    m.redraw();
  }

  messageEditEnd() {
    const message = this.messageEditing;
    if (message) {
      message.isEditing = false;
      message.content = message.oldContent;
      this.inputClear();
      m.redraw();
      this.messageEditing = null;
    }
  }

  messageResend(model) {
    // 重发时若需要，也把 chat_id 补到 attributes（集合端点仍可接受）
    const chatModel = this.model || app.chat.getCurrentChat();
    if (chatModel && !model.data?.attributes?.chat_id) {
      model.pushData({
        attributes: {
          chat_id: chatModel.id?.(),
        },
      });
    }
    this.messagePost(model);
  }

  messagePost(model) {
    this.loadingSend = true;
    m.redraw();

    // 这里沿用你现有的 app.chat.postChatMessage(model)
    // 要点：不要在成功回调里再以 id 去 GET 单条
    return app.chat.postChatMessage(model).then(
      () => {
        this.loadingSend = false;
        m.redraw();
      },
      () => {
        this.loadingSend = false;
        m.redraw();
      }
    );
  }

  inputClear() {
    this.input.messageLength = 0;
    this.input.rows = 1;
    this.input.content('');
    this.setChatStorageValue('draft', '');
    this.input.lastDraft = '';

    const el = this.getChatInput();
    if (el) {
      el.value = '';
      el.rows = this.input.rows;
    }
    m.redraw();
  }

  insertMention(model) {
    const user = model.user();
    if (!app.session.user) return;

    this.input.content((this.input.content() || '') + ` @${user.username()} `);

    const input = this.getChatInput();
    if (input) input.focus();
  }
}
