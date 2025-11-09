// js/src/forum/components/ChatAvatar.js
// 无头像 => 专用 .chat-avatar（不走 .Avatar，避免被装饰插件接管）
// 有头像 => 核心 avatar()（允许装饰）

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import classList from 'flarum/common/utils/classList';
import avatar from 'flarum/common/helpers/avatar';

export default class ChatAvatar extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.model = this.attrs.model;
  }

  // 字符串 → 柔和 HSL 背景 + 可读前景
  hashColors(str = '') {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    h = Math.abs(h) % 360;
    const s = 46, l = 66;
    const bg = `hsl(${h}, ${s}%, ${l}%)`;

    // 估算明度选前景
    const S = s / 100, L = l / 100;
    const C = (1 - Math.abs(2 * L - 1)) * S;
    const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = L - C / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60)       { r = C; g = X; b = 0; }
    else if (h < 120) { r = X; g = C; b = 0; }
    else if (h < 180) { r = 0; g = C; b = X; }
    else if (h < 240) { r = 0; g = X; b = C; }
    else if (h < 300) { r = X; g = 0; b = C; }
    else              { r = C; g = 0; b = X; }
    r = Math.round((r + m) * 255);
    g = Math.round((g + m) * 255);
    b = Math.round((b + m) * 255);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    const fg = yiq >= 150 ? '#1f2328' : '#fff';
    return { bg, fg };
  }

  // 取得一对一会话中的“对方”用户
  peerUser() {
    const users = (this.model.users && this.model.users()) || [];
    const meId = app.session.user?.id ? String(app.session.user.id()) : null;
    return users.find((u) => String(u?.id?.()) !== meId) || users[0];
  }

  componentAvatarPM() {
    const peer = this.peerUser();
    // 读取后端下发的原始 attributes，避免被插件覆写的 getter 干扰
    const raw = peer?.attribute ? peer.attribute('avatarUrl') : null;
    const hasUploadedAvatar = typeof raw === 'string' && raw.length > 0;
    const url = hasUploadedAvatar ? raw : null;

    // 有头像：用核心 avatar()（允许装饰）
    if (peer && hasUploadedAvatar) {
      return avatar(peer, { className: 'Avatar avatar' });
    }

    // 无头像：专用 .chat-avatar，避免被装饰接管
    const name = peer?.displayName?.() || this.model.title?.() || '';
    const letter = (this.firstLetter(name) || '').toUpperCase();
    const { bg, fg } = this.hashColors(name);

    return (
      <div
        className="chat-avatar no-photo"
        style={{
          '--chat-no-photo-bg': bg,
          '--chat-no-photo-fg': fg,
          background: bg,
          color: fg,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title={name}
      >
        {letter}
      </div>
    );
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
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        title={this.model.title?.()}
      >
        {this.model.icon && this.model.icon() ? (
          <i className={this.model.icon()}></i>
        ) : url ? null : (
          (this.firstLetter(this.model.title?.() || '') || '').toUpperCase()
        )}
      </div>
    );
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
  isLetter(c) {
    return c && c.toLowerCase() !== c.toUpperCase();
  }
}
