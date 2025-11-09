// js/src/forum/components/ChatAvatar.js
// [FIX] 私聊头像：严格按 id 字符串比较，选出“对方用户”
// [FALLBACK] 取不到时回退到 last/first_message 的作者；再不行用占位
// [CHANNEL] 频道头像：显示配置的 icon(+color)，无 icon 时用标题首字

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import Avatar from 'flarum/common/components/Avatar';

export default class ChatAvatar extends Component {
  view() {
    const chat = this.attrs.model;
    const isPM = app.chat.isChatPM(chat);

    return (
      <div className="avatar">
        {isPM ? this.renderPmAvatar(chat) : this.renderChannelAvatar(chat)}
      </div>
    );
  }

  // —— PM：选“对方用户”并渲染 —— //
  renderPmAvatar(chat) {
    const other = this.getOtherUser(chat);
    if (other) return <Avatar user={other} />;
    // 占位
    return <span className="Avatar Avatar--fallback">?</span>;
  }

  getOtherUser(chat) {
    const meId = String(app.session.user?.id?.() ?? '');
    const users = chat.users?.() || [];

    // 优先：成员列表里找“不是我且未被移除”的那个
    let other =
      users.find((u) => {
        if (!u) return false;
        const uid = String(u.id?.() ?? '');
        if (!uid || uid === meId) return false;
        const pvt = u.chat_pivot?.(chat.id?.());
        return !(pvt && pvt.removed_at?.());
      }) || null;

    // 回退：最近/最早消息作者里找“不是我”的
    if (!other) {
      const cands = [chat.last_message?.()?.user?.(), chat.first_message?.()?.user?.()].filter(Boolean);
      other = cands.find((u) => String(u.id?.() ?? '') !== meId) || null;
    }

    // 再回退：成员列表里随便找一个不是我的（极端情况）
    if (!other) {
      other = users.find((u) => String(u?.id?.() ?? '') !== meId) || null;
    }

    return other || null;
  }

  // —— 频道头像：icon(+color)；无 icon 用标题首字 —— //
  renderChannelAvatar(chat) {
    const iconCls = chat.icon?.() || '';
    const color = chat.color?.() || '';
    const title = chat.title?.() || '';

    if (iconCls) {
      return (
        <span className="Avatar Avatar--fallback ChatAvatar--channel" oncreate={(v) => this.mountIcon(v.dom, iconCls, color)} />
      );
    }

    const letter = (title.trim()[0] || '#').toUpperCase();
    return <span className="Avatar Avatar--fallback">{letter}</span>;
  }

  mountIcon(dom, iconCls, color) {
    // 清空旧内容，插入 <i class="...">
    while (dom.firstChild) dom.removeChild(dom.firstChild);
    const i = document.createElement('i');
    i.className = iconCls;
    if (color) i.style.color = color;
    dom.appendChild(i);
  }
}

