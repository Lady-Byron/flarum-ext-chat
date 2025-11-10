// js/src/forum/components/ChatAvatar.js
import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import classList from 'flarum/common/utils/classList';

export default class ChatAvatar extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.model = this.attrs.model;
  }

  // —— 工具：柔和哈希底色（无头像 PM 用），字色固定白 ——
  hashBg(str = '') {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    h = Math.abs(h) % 360;
    return { bg: `hsl(${h}, 46%, 66%)`, fg: '#fff' };
  }

  // —— 一对一里的“对方” ——
  peerUser() {
    const users = (this.model.users && this.model.users()) || [];
    const meId = app.session.user?.id ? String(app.session.user.id()) : null;
    return users.find((u) => String(u?.id?.()) !== meId) || users[0];
  }

  // —— 统一的小写 .avatar 渲染（与频道一致的 DOM） ——
  renderAvatarDiv({ title, url, bgColor, fgColor, letter, iconClass }) {
    return (
      <div
        className={classList({ avatar: true, image: !!url })}
        title={title}
        style={{
          // 背景色/文字色优先：频道/群聊可直设 color/textColor
          backgroundColor: bgColor,
          color: fgColor,
          // 有背景图时作为真正头像
          backgroundImage: url ? `url(${url})` : undefined,
          backgroundSize: url ? 'cover' : undefined,
          backgroundPosition: url ? 'center' : undefined,
          backgroundRepeat: url ? 'no-repeat' : undefined,
          // 无图 PM 的字色用变量传给你的 CSS（可不需要，但保留兼容）
          ...(letter
            ? { '--chat-no-photo-bg': bgColor, '--chat-no-photo-fg': fgColor }
            : null),
        }}
      >
        {iconClass ? <i className={iconClass}></i> : url ? null : letter}
      </div>
    );
  }

  // —— PM：只有两人聊天。判定用核心状态方法，而不是 type —— 
  componentAvatarPM() {
    const peer = this.peerUser();
    const raw = peer?.attribute ? peer.attribute('avatarUrl') : null;
    const hasAvatar = typeof raw === 'string' && raw.length > 0;

    if (hasAvatar) {
      return this.renderAvatarDiv({
        title: peer?.displayName?.(),
        url: raw,
      });
    }

    const name = peer?.displayName?.() || this.model.title?.() || '';
    const letter = (this.firstLetter(name) || '').toUpperCase();
    const { bg, fg } = this.hashBg(name);

    // 无头像 PM：首字母 + 哈希底色（不走 .Avatar，不会被装饰接管）
    return this.renderAvatarDiv({
      title: name,
      url: null,
      bgColor: bg,
      fgColor: fg,
      letter,
    });
  }

  // —— 频道：model.type()==1 —— 保留 icon/color/textColor/avatarUrl 的原生行为
  componentAvatarChannel() {
    const url = this.model.avatarUrl?.();
    const title = this.model.title?.() || '';
    const iconClass = this.model.icon?.();
    const bg = this.model.color?.();
    const fg = this.model.textColor?.();

    return this.renderAvatarDiv({
      title,
      url: url || null,
      bgColor: bg,
      fgColor: fg,
      letter: url || iconClass ? null : (this.firstLetter(title) || '').toUpperCase(),
      iconClass: url ? null : iconClass,
    });
  }

  // —— 群聊：既不是 PM，也不是频道 —— 走与频道相同的外观（支持 icon/color）
  componentAvatarGroup() {
    const url = this.model.avatarUrl?.();
    const title = this.model.title?.() || '';
    const iconClass = this.model.icon?.();
    const bg = this.model.color?.();
    const fg = this.model.textColor?.();

    return this.renderAvatarDiv({
      title,
      url: url || null,
      bgColor: bg,
      fgColor: fg,
      letter: url || iconClass ? null : (this.firstLetter(title) || '').toUpperCase(),
      iconClass: url ? null : iconClass,
    });
  }

  view() {
    // 使用 ChatState 的 PM 判定（通常是“非频道且 users==2”）
    const isChannel = !!(this.model.type && this.model.type());
    const isPM = app.chat && app.chat.isChatPM ? app.chat.isChatPM(this.model) : false;

    if (isChannel) return this.componentAvatarChannel();
    if (isPM)      return this.componentAvatarPM();
    return this.componentAvatarGroup();
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
