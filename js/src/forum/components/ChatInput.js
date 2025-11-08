// [GATE] 必须点击加入才能发：频道且未加入 -> 用“加入聊天”按钮替换 textarea
// 其它维持你现有改动

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

    this._saveDraftThrottled = throttle(300, (text) => {
      this.state.setChatStorageValue('draft', text);
    });

    this.updatePlaceholder();
  }

  /* --------------- GATE helpers --------------- */
  isChannel(model = this.model) {
    return !!model && model.type?.() === 1;
  }
  isJoined(model = this.model) {
    if (!this.isChannel(model)) return true;
    const me = app.session.user;
    if (!me) return false;
    const pivot = me.chat_pivot && me.chat_pivot(model.id?.());
    return !!(pivot && !pivot.removed_at?.());
  }
  openJoinModal() {
    app.modal.show(ChatEditModal, { model: this.model });
  }
  /* -------------------------------------------- */

  oncreate(vnode) {
    super.oncreate(vnode);

    const inputState = this.state.input;
    const input = this.$('#chat-input')[0];
    if (!input) return; // 未加入时没有 textarea

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
    } else if (this.isChannel() && !this.isJoined()) {
      this.inputPlaceholder = app.translator.trans('xelson-chat.forum.chat.join_gate.notice');
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
    // 频道且未加入：只显示“加入聊天”按钮
    if (this.isChannel() && !this.isJoined()) {
      return (
        <div className="ChatInput input-wrapper">
          <Button className="Button Button--primary ButtonJoin" onclick={this.openJoinModal.bind(this)}>
            {app.translator.trans('xelson-chat.forum.chat.join')}
          </Button>
        </div>
      );
    }

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
      // 额外防护：未加入时绝不发送（正常情况下不会出现，因为上面已替换成按钮）
      if (this.isChannel() && !this.isJoined()) return false;
      this.state.messageSend();
      return false;
    }
    return true;
  }

  inputPressButton() {
    // 额外防护
    if (this.isChannel() && !this.isJoined()) return;
    this.state.messageSend();
  }

  inputPreviewStart(content) {
    if (!this.state.input.writingPreview) {
      this.state.input.writingPreview = true;

      this.state.input.previewModel = app.store.createRecord('chatmessages');
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
