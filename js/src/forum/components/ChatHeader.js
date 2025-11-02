// js/src/forum/components/ChatHeader.js
// [CHANGED] migrate imports; [FIX] onmousedown conditional

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import Link from 'flarum/common/components/Link';
import ItemList from 'flarum/common/utils/ItemList';

import ChatEditModal from './ChatEditModal';

export default class ChatHeader extends Component {
  view() {
    const attrs = {};
    if (this.attrs.ondragstart) attrs.ondragstart = this.attrs.ondragstart;
    if (this.attrs.onmousedown) attrs.onmousedown = this.attrs.onmousedown; // [FIX]

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
        ) : (
          ''
        )}

        {this.componentToChatListButton()}

        <h2>
          {app.chat.getCurrentChat()
            ? [
                app.chat.getCurrentChat().icon() ? (
                  <i
                    className={app.chat.getCurrentChat().icon()}
                    style={{ color: app.chat.getCurrentChat().color(), marginRight: '3px' }}
                  />
                ) : null,
                app.chat.getCurrentChat().title(),
              ]
            : app.translator.trans('xelson-chat.forum.toolbar.title')}
        </h2>

        <div className="window-buttons">{this.windowButtonItems().toArray()}</div>
      </div>
    );
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
          'xelson-chat.forum.toolbar.' + (app.chat.getFrameState('isMuted') ? 'enable_sounds' : 'disable_sounds')
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
          'xelson-chat.forum.toolbar.' + (app.chat.getFrameState('notify') ? 'disable_notifications' : 'enable_notifications')
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
            'xelson-chat.forum.toolbar.' + (app.chat.getFrameState('beingShown') ? 'minimize' : 'maximize')
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
