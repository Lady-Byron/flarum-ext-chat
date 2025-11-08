// js/src/forum/components/ChatHeader.js
// 修复：标题只渲染纯文本；在本地插槽 .chat-icon-slot 中渲染图标，杜绝跨根 DOM 复用
// [CHANGED] migrate imports; [FIX] onmousedown conditional

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import ItemList from 'flarum/common/utils/ItemList';
import ChatEditModal from './ChatEditModal';

export default class ChatHeader extends Component {
  view() {
    const attrs = {};
    if (this.attrs.ondragstart) attrs.ondragstart = this.attrs.ondragstart;
    if (this.attrs.onmousedown) attrs.onmousedown = this.attrs.onmousedown; // [FIX]

    const chat = app.chat.getCurrentChat();

    return (
      <div className="ChatHeader" {...attrs}>
        {this.attrs.showChatListStream ? (
          <div
            className="icon"
            onclick={(e) => {
              this.attrs.showChatListStream(!this.attrs.showChatListStream());
              e.stopPropagation();
            }}
          >
            <i className="fas fa-list" />
          </div>
        ) : null}

        {this.componentToChatListButton()}

        <h2
          className="chat-title"
          oncreate={this.afterTitleMount.bind(this)}
          onupdate={this.afterTitleUpdate.bind(this)}
        >
          {/* 本地插槽：只往这里插入图标，禁止跨组件挪 DOM */}
          <span className="chat-icon-slot"></span>
          <span className="chat-title-text">{this.safeTitleText(chat)}</span>
        </h2>

        <div className="window-buttons">{this.windowButtonItems().toArray()}</div>
      </div>
    );
  }

  // —— 只返回字符串，避免把 ChatList 中的 vnode/DOM 复用到 Header ——
  safeTitleText(chat) {
    if (!chat) return app.translator.trans('xelson-chat.forum.toolbar.title');

    const raw = chat.title?.();
    if (typeof raw === 'string' && raw.trim().length) return raw.trim();

    // PM：用对方昵称作为后备标题
    try {
      if (chat.type?.() === 0) {
        const users = chat.users?.() || [];
        const meId = app.session.user?.id?.();
        const other = users.find((u) => u?.id?.() && String(u.id()) !== String(meId));
        const name =
          (other && (other.displayName?.() || other.username?.() || '')) || '';
        return name || app.translator.trans('xelson-chat.forum.chat.untitled_pm');
      }
    } catch (_) {}

    // 频道：后备文案
    return app.translator.trans('xelson-chat.forum.chat.untitled_channel');
  }

  // —— 只在本地插槽渲染图标，不跨根 insertBefore ——
  afterTitleMount(vnode) {
    this.renderIconIntoSlot(vnode.dom);
  }
  afterTitleUpdate(vnode) {
    this.renderIconIntoSlot(vnode.dom);
  }
  renderIconIntoSlot(h2) {
    if (!h2) return;
    const slot = h2.querySelector('.chat-icon-slot');
    if (!slot) return;

    // 清空旧图标
    while (slot.firstChild) slot.removeChild(slot.firstChild);

    const chat = app.chat.getCurrentChat();
    if (!chat) return;

    const iconCls = chat.icon?.() || '';
    if (!iconCls) return;

    const i = document.createElement('i');
    i.className = iconCls;

    const color = chat.color?.() || '';
    if (color) i.style.color = color;
    i.style.marginRight = '6px';

    slot.appendChild(i);
  }

  windowButtonItems() {
    const items = new ItemList();

    if (app.chat.getCurrentChat() && app.session.user) {
      items.add(
        'settings',
        <div
          className="icon"
          data-title={app.translator.trans('xelson-chat.forum.toolbar.chat.settings')}
          onclick={() => app.modal.show(ChatEditModal, { model: app.chat.getCurrentChat() })}
        >
          <i className="fas fa-cog" />
        </div>,
        100
      );
    }

    items.add(
      'sound',
      <div
        className="icon"
        onclick={this.toggleSound.bind(this)}
        data-title={app.translator.trans(
          'xelson-chat.forum.toolbar.' +
            (app.chat.getFrameState('isMuted') ? 'enable_sounds' : 'disable_sounds')
        )}
      >
        <i className={app.chat.getFrameState('isMuted') ? 'fas fa-volume-mute' : 'fas fa-volume-up'} />
      </div>
    );

    items.add(
      'notifications',
      <div
        className="icon"
        onclick={this.toggleNotifications.bind(this)}
        data-title={app.translator.trans(
          'xelson-chat.forum.toolbar.' +
            (app.chat.getFrameState('notify') ? 'disable_notifications' : 'enable_notifications')
        )}
      >
        <i className={app.chat.getFrameState('notify') ? 'fas fa-bell' : 'fas fa-bell-slash'} />
      </div>
    );

    if (this.attrs.inFrame) {
      items.add(
        'minimize',
        <div
          className="icon"
          onclick={this.toggleChat.bind(this)}
          data-title={app.translator.trans(
            'xelson-chat.forum.toolbar.' +
              (app.chat.getFrameState('beingShown') ? 'minimize' : 'maximize')
          )}
        >
          <i className={app.chat.getFrameState('beingShown') ? 'fas fa-window-minimize' : 'fas fa-window-maximize'} />
        </div>
      );
    }

    return items;
  }

  componentToChatListButton() {
    const totalUnreaded = app.chat.getUnreadedTotal();
    return (
      <div className="icon toggle-chat" onclick={this.toggleChatsList.bind(this)}>
        {totalUnreaded ? <div className="unreaded">{totalUnreaded}</div> : null}
        <i className="fas fa-chevron-left" />
      </div>
    );
  }

  toggleChatsList(e) {
    app.chat.toggleChatsList();
    e.preventDefault();
    e.stopPropagation();
  }

  toggleChat(e) {
    app.chat.toggleChat();
    e.preventDefault();
    e.stopPropagation();
  }

  toggleSound(e) {
    app.chat.toggleSound();
    e.preventDefault();
    e.stopPropagation();
  }

  toggleNotifications(e) {
    app.chat.toggleNotifications();
    e.preventDefault();
    e.stopPropagation();
  }
}
