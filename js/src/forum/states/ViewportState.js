import Stream from 'flarum/common/utils/Stream';

export default class ViewportState {
  loadingSend = false;

  scroll = {
    autoScroll: true,
    oldScroll: 0,
  };

  loading = false;
  loadingQueries = {};

  input = {
    messageLength: 0,
    rows: 1,
    content: Stream(),
  };

  messagesFetched = false;

  constructor(params) {
    if (params.model) {
      this.initChatStorage(params.model);
      this.input.content(this.getChatStorageValue('draft'));
    }
  }

  chatStorage = {
    key: null,
    draft: null,
  };

  initChatStorage(model) {
    if (!model || !model.id) return;

    this.chatStorage.key = `neonchat.viewport${model.id()}`;
    try {
      const parsed = JSON.parse(localStorage.getItem(this.chatStorage.key));
      if (parsed) this.chatStorage.draft = parsed.draft ?? '';
    } catch (e) {
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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
    }
  }

  getChatInput() {
    const input = document.querySelector('.NeonChatFrame #chat-input');
    if (!input) {
      // eslint-disable-next-line no-console
      console.warn('Chat input element not found');
      return null;
    }
    return input;
  }

  messageSend() {
    const text = this.input.content();

    if (text && text.trim().length > 0 && !this.loadingSend) {
      if (this.input.writingPreview) {
        this.input.writingPreview = false;

        this.messagePost(this.input.previewModel);
        app.chat.insertChatMessage(Object.assign(this.input.previewModel, {}));

        this.inputClear();
      } else if (this.messageEditing) {
        const model = this.messageEditing;
        if (model.content.trim() !== model.oldContent.trim()) {
          model.oldContent = model.content;
          app.chat.editChatMessage(model, true, model.content);
        }
        this.messageEditEnd();
        this.inputClear();
      }
    }
  }

  messageEdit(model) {
    if (this.input.writingPreview) this.input.instance.inputPreviewEnd();
    if (this.messageEditing) this.messageEditEnd();

    model.isEditing = true;
    model.oldContent = model.message();

    this.messageEditing = model;

    const inputElement = this.getChatInput();
    if (inputElement) {
      inputElement.value = this.input.content(model.oldContent);
      inputElement.focus();
      if (app.chat.input && app.chat.input.resizeInput) {
        app.chat.input.resizeInput();
      }
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
    this.input.content(null);
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

