// js/src/forum/components/ChatAvatar.js
// 无头像 => 内联圆形(独立类 .chat-avatar)，不依赖任何样式表
// 有头像 => 用核心 avatar()（允许装饰插件接管）

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import classList from 'flarum/common/utils/classList';
import avatar from 'flarum/common/helpers/avatar';

export default class ChatAvatar extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.model = this.attrs.model;
  }

  // —— 生成柔和底色 + 读色对比（前景恒白也可，把 fg 改成 '#fff' 即可）——
  hashColors(str = '') {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    h = Math.abs(h) % 360;
    const s = 46, l = 66;
    const bg = `hsl(${h}, ${s}%, ${l}%)`;
    const fg = '#fff'; // 固定白字
    return { bg, fg };
  }

  // 一对一会话中的“对方”用户
  peerUser() {
    const users = (this.model.users && this.model.users()) || [];
    const meId = app.session.user?.id ? String(app.session.user.id()) : null;
    return users.find((u) => String(u?.id?.()) !== meId) || users[0];
  }

  // —— 私聊头像 —— //
  componentAvatarPM() {
    const peer = this.peerUser();

    // 用“原始 attributes”判断是否真的上传了头像，避免被其他扩展改写的 getter 误导
    const raw = peer?.attribute ? peer.attribute('avatarUrl') : null;
    const hasUploadedAvatar = typeof raw === 'string' && raw.length > 0;

    if (peer && hasUploadedAvatar) {
      // 有头像：核心 avatar()，让装饰插件接管
      return avatar(peer, { className: 'Avatar avatar' });
    }

    // 无头像：内联圆形 + 白色字母（不使用 .Avatar，避免被接管）
    const name = peer?.displayName?.() || this.model.title?.() || '';
    const letter = (this.firstLetter(name) || '').toUpperCase();
    const { bg, fg } = this.hashColors(name);

    return (
      <div
        className="chat-avatar no-photo"
        title={name}
        style={{
          // 尺寸与圆角（独立于外部 CSS）
          width: '55px',
          minWidth: '55px',
          height: '55px',
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',

          // 字体
          fontSize: '28px',
          fontWeight: 600,
          textAlign: 'center',

          // 颜色（固定白字）
          background: bg,
          color: fg,

          // 防止任何背景图/蒙层覆盖
          backgroundImage: 'none',
        }}
      >
        {letter}
      </div>
    );
  }

  // —— 频道头像（维持原逻辑） —— //
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
