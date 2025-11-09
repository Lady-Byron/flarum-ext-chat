// js/src/forum/components/ChatAvatar.js
import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import classList from 'flarum/common/utils/classList';

export default class ChatAvatar extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.model = this.attrs.model;
  }

  // —— 私聊头像：从成员里找“对方用户”并使用其 avatarUrl —— //
  componentAvatarPM() {
    const chat = this.model;

    const other = this.getOtherUser(chat);
    const avatar = other && other.avatarUrl ? other.avatarUrl() : null;

    // PM 不使用频道 color/icon；避免把频道样式误用到私聊
    return (
      <div
        className={classList({ avatar: true, image: !!avatar })}
        style={{
          backgroundImage: avatar ? `url(${avatar})` : undefined,
        }}
        title={other ? (other.displayName?.() || other.username?.() || '') : ''}
      >
        {avatar
          ? null
          : (this.firstLetter((other && (other.displayName?.() || other.username?.() || '')) || '') || '').toUpperCase()}
      </div>
    );
  }

  // 找到“对方用户”（排除自己；优先当前成员，其次消息作者兜底）
  getOtherUser(chat) {
    const meId = String(app.session.user?.id?.() ?? '');
    const users = (chat.users && chat.users()) || [];

    // ① 成员列表里找既不是我、也未被移除的人
    let other =
      users.find((u) => {
        if (!u) return false;
        const uid = String(u.id?.() ?? '');
        if (!uid || uid === meId) return false;
        const pvt = u.chat_pivot && chat.id && u.chat_pivot(chat.id());
        return !(pvt && pvt.removed_at && pvt.removed_at());
      }) || null;

    // ② 兜底：用最近或最早消息作者中“不是我”的那个
    if (!other) {
      const lm = chat.last_message && chat.last_message();
      const fm = chat.first_message && chat.first_message();
      const cands = [lm && lm.user && lm.user(), fm && fm.user && fm.user()].filter(Boolean);
      other = cands.find((u) => String(u.id?.() ?? '') !== meId) || null;
    }

    // ③ 再兜底：成员里任意一个不是我的
    if (!other) {
      other = users.find((u) => String(u?.id?.() ?? '') !== meId) || null;
    }

    return other || null;
  }

  // —— 频道头像：沿用原逻辑（icon+color；无 icon 用标题首字母） —— //
  componentAvatarChannel() {
    const avatar = this.model.avatarUrl && this.model.avatarUrl();
    return (
      <div
        className="avatar"
        style={{
          backgroundColor: this.model.color && this.model.color(),
          color: this.model.textColor && this.model.textColor(),
          backgroundImage: avatar ? `url(${avatar})` : undefined,
        }}
      >
        {this.model.icon && this.model.icon() ? (
          <i className={this.model.icon()}></i>
        ) : avatar ? null : (
          (this.firstLetter((this.model.title && this.model.title()) || '') || '').toUpperCase()
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
    for (let i = 0; i < str.length; i++) {
      if (this.isLetter(str[i])) return str[i];
    }
    return str[0] || '';
  }

  isLetter(c) {
    return c && c.toLowerCase() != c.toUpperCase();
  }
}
