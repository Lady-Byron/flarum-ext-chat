// js/src/forum/components/ChatInput.js
// [CHANGED] 去掉 <textarea> 的 onupdate（避免与 onkeyup 的节流保存叠加）
// [FIX] line-height 解析失败兜底（当主题设置为 normal 时避免 NaN）
// 其余：沿用你现有 1.8 兼容改造（统一导入/节流/预览 JSON:API 关系）

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import Button from 'flarum/common/components/Button';
import ChatEditModal from './ChatEditModal';
import { throttle } from 'flarum/common/utils/throttleDebounce';
import Model from 'flarum/common/Model';

export default class ChatInput extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.model = this.attrs.model;
    this.state = this.attrs.state;

    app.chat.input = this;
    this.messageCharLimit = app.forum.attribute('xelson-chat.settings.charlimit') ?? 512;

    // 只创建一次的节流实例
    this._saveDraftThrottled = throttle(300, (text) => {
      this.state.setChatStorageValue('draft', text);
    });

    this.updatePlaceholder();
  }

  oncreate(vnode) {
    super.oncreate(vnode);

    const inputState = this.state.input;
    const input = this.$('#chat-input')[0];

    // [FIX] line-height 兜底，避免主题把行高设为 normal 导致 NaN
    const lh = parseInt(window.getComputedStyle(input).getPropertyValue('line-height'), 10);
    input.lineHeight = Number.isFinite(lh) && lh > 0 ? lh : 20;

    inputState.element = input;

    if (inputState.content() && inputState.content().length) {
      this.inputProcess({ target: input });
    }
    this.updateLimit();
  }

  onbeforeupdate(vnode, old) {
    super.onbeforeupdate(vnode, old);
    if (this.model !== this.attrs.model) {
      this.model = this.attrs.model;
      this.state = this.attrs.state;
    }
    this.updatePlaceholder();
  }

  updatePlaceholder() {
    if (!app.session.user) {
      this.inputPlaceholder = app.translator.trans('xelson-chat.forum.errors.unauthenticated');
    } else if (!app.chat.getPermissions().post) {
      this.inputPlaceholder = app.translator.trans('xelson-chat.forum.errors.chatdenied');
    } else if (this.model?.removed_at?.()) {
      this.inputPlaceholder = app.translator.trans('xelson-chat.forum.errors.removed');
    } else {
      this.inputPlaceholder = app.translator.trans('xelson-chat.forum.chat.placeholder');
    }
  }

  isPhone() {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(max-width: 768px)').matches
    );
  }

  view() {
    const removedBy = this.model?.removed_by?.();
    const meId = app.session.user?.id?.();
    const iLeftByMe = removedBy != null && String(removedBy) === String(meId);

    return (
      <div className="ChatInput input-wrapper">
        <textarea
          id="chat-input"
          maxlength={this.messageCharLimit}
          disabled={!app.chat.getPermissions().post || this.model?.removed_at?.()}
          placeholder={this.inputPlaceholder}
          onkeypress={this.inputPressEnter.bind(this)}
          oninput={this.inputProcess.bind(this)}
          onpaste={this.inputProcess.bind(this)}
          onkeyup={this.inputSaveDraft.bind(this)}
          rows={this.state.input.rows}
          value={this.state.input.content()}
          // [CHANGED] 移除 onupdate，避免与 onkeyup 的节流保存叠加
        />

        {this.state.messageEditing ? (
          <div className="icon edit" onclick={this.state.messageEditEnd.bind(this.state)}>
            <i className="fas fa-times" />
          </div>
        ) : null}

        {this.model?.removed_at?.() && iLeftByMe ? (
          <Button
            className="Button Button--primary ButtonRejoin"
            onclick={() => app.modal.show(ChatEditModal, { model: this.model })}
          >
            {app.translator.trans('xelson-chat.forum.chat.rejoin')}
          </Button>
        ) : (
          [
            <div className="icon send" onclick={this.inputPressButton.bind(this)}>
              <i className="fas fa-angle-double-right" />
            </div>,
            <div id="chat-limiter"></div>,
          ]
        )}
      </div>
    );
  }

  updateLimit() {
    const limiter = this.element.querySelector('#chat-limiter');
    if (!limiter) return;
    const charsTyped = this.messageCharLimit - (this.state.input.messageLength || 0);
    limiter.innerText = charsTyped + '/' + this.messageCharLimit;
    limiter.className = charsTyped < 100 ? 'reaching-limit' : '';
  }

  saveDraft(text = this.state.input.content()) {
    if (this.state.input.lastDraft === text) return;
    this._saveDraftThrottled(text);
    this.state.input.lastDraft = text;
  }

  inputSaveDraft(e) {
    if (e) e.redraw = false;
    const input = e.target;
    this.saveDraft((input.value || '').trim());
  }

  resizeInput() {
    const input = this.state.getChatInput();
    input.rows = 1;

    const maxRows = this.isPhone() ? 2 : 5;
    this.state.input.rows = Math.min(input.scrollHeight / input.lineHeight, maxRows);
    input.rows = this.state.input.rows;
  }

  inputProcess(e) {
    if (e) e.redraw = false;

    const input = e.target;
    this.state.input.content(input.value);
    const inputValue = (input.value || '').trim();
    this.state.input.messageLength = inputValue.length;
    this.updateLimit();

    this.resizeInput();

    if (this.state.input.messageLength) {
      if (!this.state.input.writingPreview && !this.state.messageEditing) this.inputPreviewStart(inputValue);
    } else {
      if (this.state.input.writingPreview && !inputValue.length) this.inputPreviewEnd();
    }

    if (this.state.messageEditing) this.state.messageEditing.content = inputValue;
    else if (this.state.input.writingPreview) this.state.input.previewModel.content = inputValue;

    if (this.attrs.oninput) this.attrs.oninput(e);
  }

  inputPressEnter(e) {
    e.redraw = false;
    if (e.key === 'Enter' && !e.shiftKey) {
      this.state.messageSend();
      return false;
    }
    return true;
  }

  inputPressButton() {
    this.state.messageSend();
  }

  inputPreviewStart(content) {
    if (!this.state.input.writingPreview) {
      this.state.input.writingPreview = true;

      this.state.input.previewModel = app.store.createRecord('chatmessages');
      // 预览消息用 JSON:API 资源标识符保证关系正常工作
      this.state.input.previewModel.pushData({
        id: 0,
        type: 'chatmessages',
        attributes: { message: ' ', created_at: 0 },
        relationships: {
          user: { data: Model.getIdentifier(app.session.user) },
          chat: { data: Model.getIdentifier(this.model) },
        },
      });

      Object.assign(this.state.input.previewModel, {
        isEditing: true,
        isNeedToFlash: true,
        content,
      });
    } else {
      this.state.input.previewModel.isNeedToFlash = true;
    }

    m.redraw();
  }

  inputPreviewEnd() {
    this.state.input.writingPreview = false;
    m.redraw();
  }
}
