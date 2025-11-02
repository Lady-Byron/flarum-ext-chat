// js/src/forum/components/ChatPreview.js

// [FIX] 1.8 路径 & 导入 app
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

    this.subtree = new SubtreeRetainer(
      () => this.model.freshness,
      () => app.chat.getCurrentChat(),
      // Reactive attrs
      () => this.model.isNeedToFlash
    );
  }

  onbeforeupdate(vnode) {
    super.onbeforeupdate(vnode);
    this.model = this.attrs.model;

    return this.subtree.needsRebuild();
  }

  view() {
    const cur = app.chat.getCurrentChat();
    const isActive = cur && cur.id && this.model.id && cur.id() === this.model.id(); // [CHANGED] 按 id 比较

    return (
      <div style={{ position: 'relative' }}>
        <div className={classList({ 'panel-preview': true, active: !!isActive })}>
          {this.componentPreview()}
        </div>
        {this.model.unreaded() ? <div className="unreaded">{this.model.unreaded()}</div> : null}
      </div>
    );
  }

  oncreate(vnode) {
    super.oncreate(vnode);
    if (this.model.isNeedToFlash) {
      const jq = this.$ ? this.$(vnode.dom) : (window.$ && window.$(vnode.dom)); // [FIX]
      if (jq) app.chat.flashItem(jq);
      this.model.isNeedToFlash = false;
    }
  }

  onupdate(vnode) {
    super.onupdate(vnode);
    if (this.model.isNeedToFlash) {
      const jq = this.$ ? this.$(vnode.dom) : (window.$ && window.$(vnode.dom)); // [FIX]
      if (jq) app.chat.flashItem(jq);
      this.model.isNeedToFlash = false;
    }
  }

  componentMessageTime() {
    const lastMessage = this.model.last_message();
    const time = lastMessage.created_at(); // [CHANGED] 已是 Date
    if (Date.now() - time.getTime() < 60 * 60 * 12 * 1000) {
      const nl = (n) => (n < 10 ? '0' : '') + n;
      return nl(time.getHours()) + ':' + nl(time.getMinutes());
    }
    return humanTime(lastMessage.created_at());
  }

  componentPreview() {
    return [
      <ChatAvatar model={this.model} />,
      <div className="previewBody"> {/* [FIX] class -> className */}
        <div className="title" title={this.model.title()}>
          {this.model.icon() ? (
            <i className={this.model.icon()} style={{ color: this.model.color() }}></i>
          ) : null}
          {this.model.title()}
        </div>
        {this.model.last_message() ? this.componentTextPreview() : this.componentTextEmpty()}
      </div>,
      this.model.last_message() ? (
        <div
          className="timestamp"
          title={extractText(fullTime(this.model.last_message().created_at()))} // [FIX]
        >
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
          <span className="media">
            {app.translator.trans('xelson-chat.forum.chat.message.type.event')}
          </span>
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
        title={
          lastMessage.is_censored()
            ? app.translator.trans('xelson-chat.forum.chat.message.censored')
            : null
        }
      >
        <span className="sender">{senderName}</span>
        <span className={formatResult.type}>{formatResult.text}</span>
      </div>
    );
  }

  componentTextEmpty() {
    return (
      <div className="message">
        <span className="empty">
          {app.translator.trans('xelson-chat.forum.chat.list.preview.empty')}
        </span>
      </div>
    );
  }
}
