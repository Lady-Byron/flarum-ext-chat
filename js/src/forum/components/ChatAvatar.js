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

  // 取得一对一会话中的“对方”用户（与消息区一致）
  peerUser() {
    const users = (this.model.users && this.model.users()) || [];
    const meId =
      app.session.user && app.session.user.id ? String(app.session.user.id()) : null;

    // 返回第一个不是自己的用户；若只有自己则退回 users[0]
    return users.find((u) => String(u?.id?.()) !== meId) || users[0];
  }

  componentAvatarPM() {
    const peer = this.peerUser();

    // 使用 Flarum 核心 avatar()，与对话区 DOM 结构一致，避免与头像装饰插件冲突
    if (peer) {
      // 叠加原有样式类，保持尺寸/圆角一致
      return avatar(peer, { className: 'Avatar avatar image' });
    }

    // 兜底：未能拿到对方用户时，回退到首字母
    const letter = (this.firstLetter((this.model.title && this.model.title()) || '') || '')
      .toUpperCase();
    return <div className="Avatar avatar image">{letter}</div>;
  }

  componentAvatarChannel() {
    const url = this.model.avatarUrl && this.model.avatarUrl();

    return (
      <div
        className={classList({ avatar: true, image: !!url })}
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
    // type==1: 频道，其余为私聊
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
