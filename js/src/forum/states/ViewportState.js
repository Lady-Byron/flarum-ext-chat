// js/src/forum/states/ViewportState.js
// 关掉“输入实时预览”：输入区仅维护文本；发送时创建一次性消息模型并提交。
// - messageSend(): 不再走 writingPreview 分支；直接创建 chatmessages 记录、乐观插入并保存
// - messageEdit(): 移除与预览相关的守护
// - [FIX] 发送 405：创建模型时显式写入 chat_id，并保证 model.chat() 在 save 前可用（apiEndpoint 命中 POST /chatmessages/{chatId}）
// - [FIX] this.model 未初始化：在 constructor 保存传入的 model，并在发送/重发时用当前会话兜底
// - [FIX] 输入框清空：inputClear() 使用空串并同步清空本地草稿，直接写入 DOM value
// 其余逻辑保持不变（草稿存取 / 粘底滚动由 ChatViewport 承担）

// 不改后端：创建消息一律 POST /chatmessages，并在 data.attributes.chat_id 中传会话 ID。

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

    // 编辑模式
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

    // 取当前会话
    const chatModel = this.model || app.chat.getCurrentChat();
    if (!chatModel || !chatModel.id?.()) {
      console.warn('[neon-chat] No active chat model when sending message.');
      return;
    }

    // 创建“乐观消息”并提交（创建：POST /chatmessages）
    const model = app.store.createRecord('chatmessages');
    model.pushData({
      type: 'chatmessages',
      attributes: { message: trimmed, created_at: new Date() },
      relationships: {
        user: { data: Model.getIdentifier(app.session.user) },
        chat: { data: Model.getIdentifier(chatModel) },
      },
    });

    // 老逻辑兼容：render 用
    model.content = trimmed;

    // 临时 key（等待后端回写 id）
    model.tempKey = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 关键：后端从 body 取 chat_id
    model.pushAttributes({ chat_id: chatModel.id?.() });

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
    // 兜底：离线消息重发时确保 chat_id 可用（创建端点依赖它）
    const chatModel = this.model || app.chat.getCurrentChat();
    if (chatModel && !model.data?.attributes?.chat_id) {
      model.pushAttributes({ chat_id: chatModel.id?.() });
    }
    this.messagePost(model);
  }

  messagePost(model) {
    this.loadingSend = true;
    m.redraw();
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
