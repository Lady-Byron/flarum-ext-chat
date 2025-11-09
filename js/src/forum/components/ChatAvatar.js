// js/src/forum/components/ChatAvatar.js
// 私聊：有头像 => 用核心 avatar()；无头像 => 用“用户名哈希 → 柔和 HSL 底色 + 首字母”
// 频道：保持原行为（有自定义图标/颜色/背景图）

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import classList from 'flarum/common/utils/classList';
import avatar from 'flarum/common/helpers/avatar';

export default class ChatAvatar extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.model = this.attrs.model;
  }

  // —— 小工具：由字符串生成稳定的柔和底色，并给出可读的前景色 ——
  // 思路：31 进制滚动哈希 → H(色相)；固定 S/L，保证柔和；HSL→RGB 估算亮度挑前景
  hashColors(str = '') {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    h = Math.abs(h) % 360;

    const s = 46; // 45~55% 看起来较柔和
    const l = 66; // 60~70% 较浅方便叠字
    const bg = `hsl(${h}, ${s}%, ${l}%)`;

    // HSL → RGB（0~255）
    const rgb = (() => {
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
      return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
      };
    })();

    // YIQ 明度估计，阈值 ~ 150
    const yiq = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
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
    const url = peer?.avatarUrl?.();

    // 有头像：用核心 avatar()（不要附加 .image，避免把无头像当作图像样式处理）
    if (peer && url) {
      return avatar(peer, { className: 'Avatar avatar' });
    }

    // 无头像：首字母 + 哈希底色
    const name = peer?.displayName?.() || this.model.title?.() || '';
    const letter = (this.firstLetter(name) || '').toUpperCase();
    const { bg, fg } = this.hashColors(name);

    return (
      <div
        className="Avatar avatar"
        style={{
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
    // type==1: 频道；其余：私聊
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
