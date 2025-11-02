// js/src/forum/components/ChatFrame.js
import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import ChatHeader from './ChatHeader';
import ChatList from './ChatList';
import ChatPage from './ChatPage';
import ChatViewport from './ChatViewport';

export default class ChatFrame extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this._boundDown = this.chatMoveListener.bind(this, 'mousedown');
    this._boundUp = this.chatMoveListener.bind(this, 'mouseup');
    document.addEventListener('mousedown', this._boundDown);
    document.addEventListener('mouseup', this._boundUp);
  }

  oncreate(vnode) {
    super.oncreate(vnode);
    // 显式兜底保存根元素引用
    this.element = vnode.dom;
  }

  onremove(vnode) {
    super.onremove(vnode);
    document.removeEventListener('mousedown', this._boundDown);
    document.removeEventListener('mouseup', this._boundUp);
    if (this.mouseMoveEvent) {
      document.removeEventListener('mousemove', this.mouseMoveEvent);
      this.mouseMoveEvent = null;
    }
    document.body.classList.remove('moving');
  }

  isPhone() {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(max-width: 768px)').matches
    );
  }

  calcHeight() {
    if (!app.chat) return '30px';
    if (!app.chat.getFrameState('beingShown')) return '30px';

    if (!this.isPhone()) {
      const transform = app.chat.getFrameState('transform');
      return (transform && transform.y ? transform.y : 400) + 'px';
    }
    return '70vh';
  }

  view() {
    if (app.current?.matches?.(ChatPage)) return;
    if (!app.chat) return null;

    const transform = app.chat.getFrameState('transform') || { x: 0, y: 400 };
    const style = { right: transform.x + 'px', height: this.calcHeight() };

    return (
      <div className={'NeonChatFrame ' + (app.chat.getFrameState('beingShown') ? '' : 'hidden')} style={style}>
        {/* [FIX] tabIndex -> tabindex */}
        <div tabindex="0" className="frame" id="chat-frame">
          <ChatList />
          <div id="chat-panel">
            <ChatHeader
              ondragstart={() => false}
              onmousedown={this.chatHeaderOnMouseDown.bind(this)}
              inFrame={true}
            />
            {app.chat.chatsLoading ? (
              <LoadingIndicator />
            ) : (
              <ChatViewport chatModel={app.chat.getCurrentChat()} />
            )}
          </div>
        </div>
        {this.componentButtonFixedMaximize()}
      </div>
    );
  }

  componentButtonFixedMaximize() {
    if (!app.chat) return null;
    const totalUnreaded = app.chat.getUnreadedTotal();

    return (
      <div className="button-fixed-maximize" onclick={this.toggleChat.bind(this)}>
        {totalUnreaded ? <div className="unreaded">{totalUnreaded}</div> : null}
        <i className="fas fa-comments" />
      </div>
    );
  }

  toggleChat() {
    app.chat && app.chat.toggleChat();
  }

  chatHeaderOnMouseDown(e) {
    if (e.button !== 0) return;

    // [FIX] 非标 e.path → 标准 closest()
    const target = e.target;
    if (target && target instanceof Element && target.closest('.icon')) return;

    if (this.chatMoveStart(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  chatMoveListener(event, e) {
    if (event === 'mouseup' && this.chatMoving) this.chatMoveEnd(e);
  }

  chatMoveStart(e) {
    if (!app.chat.getFrameState('beingShown')) return false;
    this.chatMoving = true;
    this.mouseMoveEvent = this.chatMoveProcess.bind(this);
    this.moveLast = { x: e.clientX, y: e.clientY };

    document.addEventListener('mousemove', this.mouseMoveEvent);
    document.body.classList.add('moving');
    return true;
  }

  chatMoveEnd() {
    this.chatMoving = false;
    if (this.mouseMoveEvent) {
      document.removeEventListener('mousemove', this.mouseMoveEvent);
      this.mouseMoveEvent = null;
    }
    document.body.classList.remove('moving');

    if (!app.current?.matches?.(ChatPage) && this.element) {
      const cs = window.getComputedStyle(this.element);
      const rightFromComputed = parseInt(cs.right, 10);
      const rightFromInline = parseInt(this.element.style.right, 10);
      const heightFromOffset = this.element.offsetHeight;
      const heightFromComputed = parseInt(cs.height, 10);

      const x = Number.isFinite(rightFromComputed)
        ? rightFromComputed
        : (Number.isFinite(rightFromInline) ? rightFromInline : 0);

      let y = Number.isFinite(heightFromOffset) && heightFromOffset > 0
        ? heightFromOffset
        : (Number.isFinite(heightFromComputed) ? heightFromComputed : 400);

      y = Math.max(200, Math.min(y, window.innerHeight - 60));

      app.chat.saveFrameState('transform', { x: Math.max(0, x), y });
    }
  }

  chatMoveProcess(e) {
    if (!this.element) return;

    const move = { x: e.clientX - this.moveLast.x, y: e.clientY - this.moveLast.y };
    const currentRight = parseInt(this.element.style.right, 10) || 0;
    const nextPos = { x: currentRight - move.x, y: this.element.offsetHeight - move.y };

    const chatElement = this.element.querySelector('#chat-frame');
    if (!chatElement) return;

    if (
      (nextPos.x < window.innerWidth - chatElement.offsetWidth && move.x < 0) ||
      (nextPos.x > 0 && move.x > 0)
    ) {
      this.element.style.right = nextPos.x + 'px';
    }

    const chatHeader = this.element.querySelector('.ChatHeader');
    if (chatHeader && chatHeader.clientHeight < nextPos.y && nextPos.y < window.innerHeight - 100) {
      this.element.style.height = nextPos.y + 'px';
    }

    this.moveLast = { x: e.clientX, y: e.clientY };
  }
}
