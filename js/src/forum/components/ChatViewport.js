// [GATE] 必须点击加入才能看：频道且未加入 -> 不渲染消息与滚动逻辑，只显示加入按钮
// 其余保留你现有 1.8 修复

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import Button from 'flarum/common/components/Button';

import ChatInput from './ChatInput';
import ChatMessage from './ChatMessage';
import ChatEventMessage from './ChatEventMessage';
import ChatWelcome from './ChatWelcome';
import Message from '../models/Message';
import timedRedraw from '../utils/timedRedraw';
import ChatPage from './ChatPage';
import ChatEditModal from './ChatEditModal';

export default class ChatViewport extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.model = this.attrs.chatModel;
    if (this.model) this.state = app.chat.getViewportState(this.model);
  }

  oncreate(vnode) {
    super.oncreate(vnode);
    this.loadChat();
  }

  onupdate(vnode) {
    super.onupdate(vnode);
    const model = vnode.attrs.chatModel;

    if (model !== this.model) {
      this.model = model;
      if (this.model) {
        this.state = app.chat.getViewportState(this.model);
        this.loadChat();
      }
      const jq = this.$ ? this.$('.wrapper') : (window.$ && window.$('.wrapper'));
      if (jq) app.chat.flashItem(jq);
    }
  }

  /* ---------------- GATE helpers ---------------- */
  isChannel(model = this.model) {
    return !!model && model.type?.() === 1;
  }
  isJoined(model = this.model) {
    // 频道外一律视为“已加入”（不拦）
    if (!this.isChannel(model)) return true;
    const me = app.session.user;
    if (!me) return false;
    const pivot = me.chat_pivot && me.chat_pivot(model.id?.());
    return !!(pivot && !pivot.removed_at?.());
  }
  openJoinModal() {
    app.modal.show(ChatEditModal, { model: this.model });
  }

  /* ---------------------------------------------- */

  loadChat() {
    if (!this.state) return;

    // 未加入频道：不加载消息、不定位滚动
    if (this.isChannel() && !this.isJoined()) {
      this.state.messagesFetched = false;
      return;
    }

    const oldScroll = Number(this.state.scroll.oldScroll || 0);
    this.reloadMessages();
    m.redraw();

    if (this._loadTimer) clearTimeout(this._loadTimer);
    this._loadTimer = setTimeout(() => {
      const chatWrapper = this.getChatWrapper();
      if (
        chatWrapper &&
        Number.isFinite(chatWrapper.scrollHeight) &&
        Number.isFinite(chatWrapper.clientHeight)
      ) {
        const nextTop = Math.max(0, chatWrapper.scrollHeight - chatWrapper.clientHeight - oldScroll);
        chatWrapper.scrollTop = nextTop;
      }
    }, 200);
  }

  view() {
    if (this.model) {
      const gated = this.isChannel() && !this.isJoined();

      return (
        <div className={'ChatViewport' + (gated ? ' ChatViewport--gated' : '')}>
          <div
            className="wrapper"
            oncreate={this.wrapperOnCreate.bind(this)}
            onbeforeupdate={this.wrapperOnBeforeUpdate.bind(this)}
            onupdate={this.wrapperOnUpdate.bind(this)}
            onremove={this.wrapperOnRemove.bind(this)}
          >
            {/* 未加入：不渲染任何消息/loader */}
            {!gated ? this.componentLoader(this.state?.loading) : null}
            {!gated
              ? this.componentsChatMessages(this.model).concat(
                  this.state.input.writingPreview ? this.componentChatMessage(this.state.input.previewModel) : []
                )
              : null}
          </div>

          {/* 未加入：用加入按钮替换输入区 */}
          {gated ? (
            <div className="ChatGate">
              <p style="margin:8px 0 12px;opacity:.75;">
                {app.translator.trans('xelson-chat.forum.chat.join_gate.notice')}
              </p>
              <Button className="Button Button--primary ButtonJoin" onclick={this.openJoinModal.bind(this)}>
                {app.translator.trans('xelson-chat.forum.chat.join')}
              </Button>
            </div>
          ) : (
            <ChatInput
              state={this.state}
              model={this.model}
              oninput={() => {
                if (this.nearBottom() && !this.state.messageEditing) {
                  this.scrollToBottom();
                }
              }}
            />
          )}

          {!gated && this.isFastScrollAvailable() ? this.componentScroller() : null}
        </div>
      );
    }

    return (
      <div className="ChatViewport">
        <ChatWelcome />
      </div>
    );
  }

  componentChatMessage(model) {
    return model.type()
      ? <ChatEventMessage key={model.id()} model={model} />
      : <ChatMessage key={model.id()} model={model} />;
  }

  componentsChatMessages(chat) {
    // 未加入频道：直接返回空列表（即使 store 里已有缓存也不显示）
    if (this.isChannel(chat) && !this.isJoined(chat)) return [];
    const chatId = String(chat?.id?.() ?? '');
    return app.chat
      .getChatMessages((mdl) => String(mdl.chat()?.id?.() ?? '') === chatId)
      .map((model) => this.componentChatMessage(model));
  }

  componentScroller() {
    return (
      <div className="scroller" onclick={this.fastScroll.bind(this)}>
        <i className="fas fa-angle-down"></i>
      </div>
    );
  }

  componentLoader(watch) {
    return watch ? (
      <msgloader className="message-wrapper--loading">
        <LoadingIndicator className="loading-old Button-icon" />
      </msgloader>
    ) : null;
  }

  isPhone() {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(max-width: 768px)').matches
    );
  }

  getChatWrapper() {
    if (this.isPhone() && app.current.matches?.(ChatPage)) {
      return document.documentElement;
    }
    if (this.wrapperEl) return this.wrapperEl;
    const wrapper = this.element?.querySelector?.('.wrapper')
      || document.querySelector('.ChatViewport .wrapper');
    return wrapper || null;
  }

  isFastScrollAvailable() {
    if (!this.state || !this.model) return false;
    // 未加入也不显示快捷滚动
    if (this.isChannel() && !this.isJoined()) return false;

    const chatWrapper = this.getChatWrapper();
    if (!chatWrapper) return false;

    return (
      (this.state.newPushedPosts ||
        this.model.unreaded() >= 30 ||
        (chatWrapper.scrollHeight > 2000 &&
          chatWrapper.scrollTop < chatWrapper.scrollHeight - 2000)) &&
      !this.nearBottom()
    );
  }

  fastScroll(e) {
    if (!this.model) return;
    if (this.model.unreaded() >= 30) this.fastMessagesFetch(e);
    else {
      const chatWrapper = this.getChatWrapper();
      if (chatWrapper) {
        chatWrapper.scrollTop = Math.max(
          chatWrapper.scrollTop,
          chatWrapper.scrollHeight - 3000
        );
        this.scrollToBottom();
      }
    }
  }

  fastMessagesFetch(e) {
    // 未加入：不取历史
    if (this.isChannel() && !this.isJoined()) return;

    e.redraw = false;
    app.chat.chatmessages = [];

    app.chat.apiFetchChatMessages(this.model).then(() => {
      this.scrollToBottom();
      timedRedraw(300);

      this.model.pushAttributes({ unreaded: 0 });
      const message = app.chat
        .getChatMessages((mdl) => String(mdl.chat()?.id?.() ?? '') === String(this.model?.id?.() ?? ''))
        .slice(-1)[0];
      app.chat.apiReadChat(this.model, message);
    });
  }

  wrapperOnCreate(vnode) {
    super.oncreate(vnode);
    this.wrapperEl = vnode.dom;
    this.wrapperOnUpdate(vnode);

    const target = app.current.matches?.(ChatPage) ? window : this.wrapperEl;
    this.boundScrollTarget = target;
    this.boundScrollListener = this.wrapperOnScroll.bind(this);
    target.addEventListener('scroll', this.boundScrollListener, { passive: true });
  }

  wrapperOnBeforeUpdate(vnode, vnodeNew) {
    try {
      super.onbeforeupdate(vnode, vnodeNew);
      if (
        !this.state ||
        !this.state.scroll?.autoScroll ||
        !this.nearBottom() ||
        !this.state.newPushedPosts
      ) {
        return;
      }
      this.scrollAfterUpdate = true;
    } catch (e) {
      console.warn('ChatViewport wrapperOnBeforeUpdate error:', e);
    }
  }

  wrapperOnUpdate(vnode) {
    try {
      super.onupdate(vnode);
      const el = this.getChatWrapper();
      if (!el) return;

      // 未加入：不做任何滚动处理
      if (this.isChannel() && !this.isJoined()) return;

      if (this.model && this.state && this.state.scroll.autoScroll) {
        if (this.autoScrollTimeout) clearTimeout(this.autoScrollTimeout);
        this.autoScrollTimeout = setTimeout(this.scrollToBottom.bind(this, true), 100);
      }
      if (el.scrollTop <= 0) el.scrollTop = 1;
      this.checkUnreaded();

      if (this.scrollAfterUpdate) {
        this.scrollAfterUpdate = false;
        this.scrollToBottom();
      }
    } catch (e) {
      console.warn('ChatViewport wrapperOnUpdate error:', e);
    }
  }

  wrapperOnRemove(vnode) {
    try {
      super.onremove(vnode);
      if (this._loadTimer) { clearTimeout(this._loadTimer); this._loadTimer = null; }
      if (this.boundScrollListener && this.boundScrollTarget) {
        this.boundScrollTarget.removeEventListener('scroll', this.boundScrollListener);
        this.boundScrollListener = null;
        this.boundScrollTarget = null;
      }
    } catch (e) {
      console.warn('ChatViewport wrapperOnRemove error:', e);
    }
  }

  wrapperOnScroll(e) {
    // 未加入：直接忽略滚动
    if (this.isChannel() && !this.isJoined()) return;

    const el = app.current.matches?.(ChatPage) ? document.documentElement : e.currentTarget;
    const state = this.state;
    if (!el || !state) return;

    state.scroll.oldScroll = el.scrollHeight - el.clientHeight - el.scrollTop;

    this.checkUnreaded();

    if (this.lastFastScrollStatus != this.isFastScrollAvailable()) {
      this.lastFastScrollStatus = this.isFastScrollAvailable();
      m.redraw();
    }

    const currentHeight = el.scrollHeight;

    if (this.atBottom()) {
      state.newPushedPosts = false;
    }

    if (state.scroll.autoScroll || state.loading || this.scrolling) return;

    if (!state.messageEditing && el.scrollTop >= 0) {
      if (el.scrollTop <= 500) {
        const topMessage = app.chat
          .getChatMessages((model) => String(model.chat()?.id?.() ?? '') === String(this.model?.id?.() ?? ''))[0];
        if (topMessage && topMessage != this.model.first_message()) {
          app.chat.apiFetchChatMessages(this.model, topMessage.created_at().toISOString());
        }
      } else if (el.scrollTop + el.clientHeight >= currentHeight - 500) {
        const bottomMessage = app.chat
          .getChatMessages((model) => String(model.chat()?.id?.() ?? '') === String(this.model?.id?.() ?? ''))
          .slice(-1)[0];
        if (bottomMessage && bottomMessage != this.model.last_message()) {
          app.chat.apiFetchChatMessages(this.model, bottomMessage.created_at().toISOString());
        }
      }
    }
  }

  checkUnreaded() {
    // 未加入：没有已读上报
    if (this.isChannel() && !this.isJoined()) return;

    const wrapper = this.getChatWrapper();
    if (wrapper && this.model && this.model.unreaded() && app.chat.chatIsShown()) {
      const list = app.chat.getChatMessages(
        (mdl) =>
          String(mdl.chat()?.id?.() ?? '') === String(this.model?.id?.() ?? '') &&
          mdl.created_at() >= this.model.readed_at() &&
          !mdl.isReaded
      );

      for (const message of list) {
        const scope = this.element || document;
        const msg = scope.querySelector(`.message-wrapper[data-id="${message.id()}"]`);
        if (!msg) continue;

        const msgTop = msg.getBoundingClientRect().top;
        const wrapRectTop = wrapper.getBoundingClientRect().top;
        const visibleBottom = wrapRectTop + wrapper.clientHeight;

        if (msgTop <= visibleBottom) {
          message.isReaded = true;

          if (this.state.scroll.autoScroll && app.chat.getCurrentChat() == this.model) {
            app.chat.apiReadChat(this.model, new Date());
            this.model.pushAttributes({ unreaded: 0 });
          } else {
            app.chat.apiReadChat(this.model, message);
            this.model.pushAttributes({ unreaded: this.model.unreaded() - 1 });
          }

          m.redraw();
        }
      }
    }
  }

  scrollToAnchor(anchor) {
    let element;
    if (anchor instanceof Message) {
      const jq = this.$ ? this.$(`.message-wrapper[data-id="${anchor.id()}"]`) : null;
      element = jq ? jq[0] : document.querySelector(`.message-wrapper[data-id="${anchor.id()}"]`);
    } else {
      element = anchor;
    }

    const chatWrapper = this.getChatWrapper();
    if (!chatWrapper || !element) return setTimeout(() => this.scrollToAnchor(anchor), 100);

    const elRect  = element.getBoundingClientRect();
    const ctRect  = chatWrapper.getBoundingClientRect();
    const targetTop = Math.max((elRect.top - ctRect.top) + chatWrapper.scrollTop - element.clientHeight, 0);

    const jq = window.$ && window.$(chatWrapper);
    if (jq && jq.stop && jq.animate) {
      jq.stop().animate({ scrollTop: targetTop }, 500);
    } else {
      chatWrapper.scrollTo({ top: targetTop, behavior: 'smooth' });
    }
  }

  scrollToBottom(force = false) {
    // 未加入：不滚动
    if (this.isChannel() && !this.isJoined()) return;

    this.scrolling = true;
    const chatWrapper = this.getChatWrapper();
    if (chatWrapper) {
      const notAtBottom = !force && this.atBottom();
      let fewMessages = false;
      if (app.current.matches?.(ChatPage)) {
        const wrapper = this.wrapperEl || document.querySelector('.ChatViewport .wrapper');
        fewMessages = wrapper && wrapper.scrollHeight + 200 < document.documentElement.clientHeight;
      }
      if (notAtBottom || fewMessages) return;

      const time = this.pixelsFromBottom() < 80 ? 0 : 250;

      const jq = window.$ && window.$(chatWrapper);
      if (jq && jq.stop && jq.animate) {
        jq
          .stop()
          .animate({ scrollTop: chatWrapper.scrollHeight }, time, 'swing', () => {
            if (this.state) {
              this.state.scroll.autoScroll = false;
            }
            this.scrolling = false;
          });
      } else {
        chatWrapper.scrollTo({ top: chatWrapper.scrollHeight, behavior: time ? 'smooth' : 'auto' });
        if (this.state) this.state.scroll.autoScroll = false;
        this.scrolling = false;
      }
    }
  }

  reloadMessages() {
    // 未加入频道：不取消息
    if (this.isChannel() && !this.isJoined()) return;

    if (!this.state.messagesFetched) {
      let query;
      if (this.model.unreaded()) {
        query = this.model.readed_at()?.toISOString() ?? new Date(0).toISOString();
        this.state.scroll.autoScroll = false;
      }

      app.chat.apiFetchChatMessages(this.model, query).then(() => {
        if (this.model.unreaded()) {
          const anchor = app.chat.getChatMessages(
            (mdl) =>
              String(mdl.chat()?.id?.() ?? '') === String(this.model?.id?.() ?? '') &&
              mdl.created_at() > this.model.readed_at()
          )[0];
          this.scrollToAnchor(anchor);
        } else this.state.scroll.autoScroll = true;

        m.redraw();
      });

      this.state.messagesFetched = true;
    }
  }

  nearBottom() {
    try {
      return this.pixelsFromBottom() <= 500;
    } catch {
      return false;
    }
  }

  atBottom() {
    try {
      return this.pixelsFromBottom() <= 5;
    } catch {
      return false;
    }
  }

  pixelsFromBottom() {
    const element = this.getChatWrapper();
    if (
      !element ||
      element.scrollHeight === undefined ||
      element.scrollTop === undefined ||
      element.clientHeight === undefined
    ) {
      return 0;
    }
    return Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight);
  }
}
