// js/src/forum/components/ChatPreview.js

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import classList from 'flarum/common/utils/classList';
import humanTime from 'flarum/common/helpers/humanTime';
import extractText from 'flarum/common/utils/extractText';
import fullTime from 'flarum/common/helpers/fullTime';
import SubtreeRetainer from 'flarum/common/utils/SubtreeRetainer';

import ChatAvatar from './ChatAvatar';

export default class ChatPreview extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.model = this.attrs.model;

    // [CHANGED] 监听未读 & 本地 @ 计数，保证角标变化触发重绘
    this.subtree = new SubtreeRetainer(
      () => this.model.freshness,
      () => app.chat.getCurrentChat(),
      () => this.model.isNeedToFlash,
      () => this.model.unreaded?.(),
      () => app.chat.getAtUnread(this.model) // [MENTION] 新增依赖
    );
  }

  onbeforeupdate(vnode) {
    super.onbeforeupdate(vnode);
    this.model = this.attrs.model;
    return this.subtree.needsRebuild();
  }

  view() {
    const cur = app.chat.getCurrentChat();
    const isActive = cur && cur.id && this.model.id && cur.id() === this.model.id(); // [CHANGED]

    // 角标优先级：DM 数字 > 非 DM 的 @ > 非 DM 的星标
    const isDM    = app.chat.isChatPM(this.model);
    const unread  = Number(this.model.unreaded?.() || 0);
    const atCount = app.chat.getAtUnread(this.model);

    const showNumber = isDM && unread > 0;
    const showAt     = !isDM && atCount > 0;
    const showStar   = !isDM && unread > 0 && !showAt;

    return (
      <div style={{ position: 'relative' }}>
        <div className={classList({ 'panel-preview': true, active: !!isActive })}>
          {this.componentPreview()}
        </div>

        {showNumber ? <div className="unreaded">{unread}</div> : null}
        {showAt ? (
          <div className="unreaded unreaded--mention"><i className="fas fa-at" /></div>
        ) : null}
        {showStar ? (
          <div className="unreaded unreaded--icon"><i className="fas fa-star" /></div>
        ) : null}
      </div>
    );
  }

  oncreate(vnode) {
    super.oncreate(vnode);
    if (this.model.isNeedToFlash) {
      const jq = this.$ ? this.$(vnode.dom) : (window.$ && window.$(vnode.dom));
      if (jq) app.chat.flashItem(jq);
      this.model.isNeedToFlash = false;
    }
  }

  onupdate(vnode) {
    super.onupdate(vnode);
    if (this.model.isNeedToFlash) {
      const jq = this.$ ? this.$(vnode.dom) : (window.$ && window.$(vnode.dom));
      if (jq) app.chat.flashItem(jq);
      this.model.isNeedToFlash = false;
    }
  }

  componentMessageTime() {
    const lastMessage = this.model.last_message();
    const time = lastMessage.created_at();
    if (Date.now() - time.getTime() < 12 * 60 * 60 * 1000) {
      const nl = (n) => (n < 10 ? '0' : '') + n;
      return nl(time.getHours()) + ':' + nl(time.getMinutes());
    }
    return humanTime(lastMessage.created_at());
  }

  componentPreview() {
    return [
      <ChatAvatar model={this.model} />,
      <div className="previewBody">
        <div className="title" title={this.model.title()}>
          {this.model.icon() ? <i className={this.model.icon()} style={{ color: this.model.color() }}></i> : null}
          {this.model.title()}
        </div>
        {this.model.last_message() ? this.componentTextPreview() : this.componentTextEmpty()}
      </div>,
      this.model.last_message() ? (
        <div className="timestamp" title={extractText(fullTime(this.model.last_message().created_at()))}>
          {(this.humanTime = this.componentMessageTime())}
        </div>
      ) : null,
    ];
  }

  formatTextPreview(text) {
    let type;
    if (text.startsWith('```')) {
      text = app.translator.trans('xelson-chat.forum.chat.message.type.code');
      type = 'media';
    } else if (text.startsWith('http://') || text.startsWith('https://')) {
      text = app.translator.trans('xelson-chat.forum.chat.message.type.url');
      type = 'media';
    }
    return { text, type };
  }

  componentTextPreview() {
    const lastMessage = this.model.last_message();
    if (lastMessage.type() != 0) {
      return (
        <div className="message">
          <span className="media">{app.translator.trans('xelson-chat.forum.chat.message.type.event')}</span>
        </div>
      );
    }

    const formatResult = this.formatTextPreview(lastMessage.message());
    const users = this.model.users() || [];
    const sender = lastMessage.user();

    let senderName = '';
    if (app.session.user && sender) {
      const meId = app.session.user.id?.();
      const senderId = sender.id?.();
      if (String(meId) === String(senderId)) {
        senderName = `${app.translator.trans('xelson-chat.forum.chat.message.you')}: `;
      } else if (users.length > 2 || this.model.type()) {
        senderName = sender.displayName() + ': ';
      }
    }

    return (
      <div
        className={classList({ message: true, censored: lastMessage.is_censored() })}
        title={lastMessage.is_censored() ? app.translator.trans('xelson-chat.forum.chat.message.censored') : null}
      >
        <span className="sender">{senderName}</span>
        <span className={formatResult.type}>{formatResult.text}</span>
      </div>
    );
  }

  componentTextEmpty() {
    return (
      <div className="message">
        <span className="empty">{app.translator.trans('xelson-chat.forum.chat.list.preview.empty')}</span>
      </div>
    );
  }
}
