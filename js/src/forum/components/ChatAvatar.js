// js/src/forum/components/ChatAvatar.js
import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import classList from 'flarum/common/utils/classList';

export default class ChatAvatar extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.model = this.attrs.model;
  }

  // 稳定哈希色（柔和 HSL）+ 固定白字
  hashBg(str = '') {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    h = Math.abs(h) % 360;
    return { bg: `hsl(${h}, 46%, 66%)`, fg: '#fff' };
  }

  // 一对一里的“对方”
  peerUser() {
    const users = (this.model.users && this.model.users()) || [];
    const meId = app.session.user?.id ? String(app.session.user.id()) : null;
    return users.find((u) => String(u?.id?.()) !== meId) || users[0];
  }

  // 复用同一渲染：与频道一致的小写 .avatar 结构
  renderAvatar({ url, letter, title }) {
    return (
      <div
        className={classList({ avatar: true, image: !!url })}
        title={title}
        style={{
          // 有图：背景图；无图：不设置 backgroundImage
          backgroundImage: url ? `url(${url})` : undefined,
          backgroundSize: url ? 'cover' : undefined,
          backgroundPosition: url ? 'center' : undefined,
          backgroundRepeat: url ? 'no-repeat' : undefined,
        }}
      >
        {url ? null : letter}
      </div>
    );
  }

  // 私聊
  componentAvatarPM() {
    const peer = this.peerUser();

    // 用原始 attributes 判断是否真的有上传头像（避免被别的扩展改写 getter）
    const raw = peer?.attribute ? peer.attribute('avatarUrl') : null;
    const hasAvatar = typeof raw === 'string' && raw.length > 0;

    if (hasAvatar) {
      return this.renderAvatar({ url: raw, title: peer?.displayName?.() });
    }

    const name = peer?.displayName?.() || this.model.title?.() || '';
    const letter = (this.firstLetter(name) || '').toUpperCase();
    const { bg, fg } = this.hashBg(name);

    // 无头像：仅传入变量，几何样式完全走你的 .avatar 规则（看起来最“原生”）
    return (
      <div
        className="avatar"
        title={name}
        style={{ '--chat-no-photo-bg': bg, '--chat-no-photo-fg': fg }}
      >
        {letter}
      </div>
    );
  }

  // 频道
  componentAvatarChannel() {
    const url = this.model.avatarUrl && this.model.avatarUrl();
    const title = this.model.title?.() || '';

    if (url) return this.renderAvatar({ url, title });

    const letter = (this.firstLetter(title) || '').toUpperCase();
    return this.renderAvatar({ url: null, letter, title });
  }

  view() {
    return (this.model.type && this.model.type()) == 1
      ? this.componentAvatarChannel()
      : this.componentAvatarPM();
  }

  firstLetter(str) {
    if (!str) return '';
    for (let i = 0; i < str.length; i++) if (this.isLetter(str[i])) return str[i];
    return str[0] || '';
  }
  isLetter(c) { return c && c.toLowerCase() !== c.toUpperCase(); }
}
