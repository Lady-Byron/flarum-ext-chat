// js/src/forum/components/ChatAvatar.js
import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import classList from 'flarum/common/utils/classList';
import avatar from 'flarum/common/helpers/avatar';

export default class ChatAvatar extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.model = this.attrs.model;
  }

  // 取得一对一会话中的“对方”用户
  peerUser() {
    const users = (this.model.users && this.model.users()) || [];
    const meId =
      app.session.user && app.session.user.id ? String(app.session.user.id()) : null;

    return users.find((u) => String(u?.id?.()) !== meId) || users[0];
  }

  componentAvatarPM() {
    const peer = this.peerUser();
    const url = peer && peer.avatarUrl && peer.avatarUrl();

    // 有头像：用核心 avatar()（不要加 image 类）
    if (peer && url) {
      return avatar(peer, { className: 'Avatar avatar' });
    }

    // 无头像：显示首字母（不走 .image，避免被样式/装饰隐藏文字）
    const letter = (
      this.firstLetter(peer?.displayName?.() || this.model.title?.() || '') || ''
    ).toUpperCase();

    return <div className="Avatar avatar">{letter}</div>;
  }

  componentAvatarChannel() {
    const url = this.model.avatarUrl && this.model.avatarUrl();

    return (
      <div
        className={classList({ Avatar: true, avatar: true, image: !!url })}
        style={{
          backgroundColor: this.model.color && this.model.color(),
          color: this.model.textColor && this.model.textColor(),
          backgroundImage: url ? `url(${url})` : undefined,
          backgroundSize: url ? 'cover' : undefined,
          backgroundPosition: url ? 'center' : undefined,
          backgroundRepeat: url ? 'no-repeat' : undefined,
        }}
      >
        {this.model.icon && this.model.icon() ? (
          <i className={this.model.icon()}></i>
        ) : url ? null : (
          (this.firstLetter((this.model.title && this.model.title()) || '') || '').toUpperCase()
        )}
      </div>
    );
  }

  view() {
    // type==1: 频道；其他是私聊
    return (this.model.type && this.model.type()) == 1
      ? this.componentAvatarChannel()
      : this.componentAvatarPM();
  }

  firstLetter(str) {
    if (!str) return '';
    for (let i = 0; i < str.length; i++) {
      if (this.isLetter(str[i])) return str[i];
    }
    return str[0] || '';
  }

  isLetter(c) {
    return c && c.toLowerCase() !== c.toUpperCase();
  }
}

