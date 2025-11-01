// js/src/forum/components/ChatCreateModal.js
// [CHANGED] Import paths -> flarum/common/*
// [CHANGED] <a target="blank"> -> target="_blank" + rel="noopener"

import Button from 'flarum/common/components/Button';          // [CHANGED]
import classList from 'flarum/common/utils/classList';         // [CHANGED]
import Stream from 'flarum/common/utils/Stream';               // [CHANGED]

import ChatSearchUser from './ChatSearchUser';
import ChatModal from './ChatModal';

export default class ChatCreateModal extends ChatModal {
  oninit(vnode) {
    super.oninit(vnode);
    this.isChannel = false;
  }

  title() {
    return app.translator.trans('xelson-chat.forum.chat.list.add_modal.title');
  }

  onsubmit() {
    if (!this.isChannel && this.getSelectedUsers().length === 1) {
      const otherUser = this.getSelectedUsers()[0];

      const existingActiveChat = app.chat.findExistingPMChat(app.session.user, otherUser);
      if (existingActiveChat) {
        app.chat.onChatChanged(existingActiveChat);
        this.hide();
        m.redraw();
        return;
      }

      const existingLeftChat = app.chat.findAnyPMChatIncludingLeft(app.session.user, otherUser);
      if (existingLeftChat && existingLeftChat.removed_at && existingLeftChat.removed_at()) {
        this.rejoinExistingChat(existingLeftChat, otherUser);
        return;
      }
    }

    this.createNewChat();
  }

  rejoinExistingChat(existingChat, otherUser) {
    app.store
      .createRecord('chats')
      .save({
        title: '',
        isChannel: false,
        icon: '',
        color: '',
        relationships: { users: [otherUser, app.session.user] },
      })
      .then((model) => {
        app.chat.addChat(model);
        app.chat.onChatChanged(model);
        app.alerts.show({ type: 'success' }, app.translator.trans('xelson-chat.forum.chat.rejoin.success')); // [CHANGED] i18n-friendly
        m.redraw();
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Error rejoining chat:', error);
        const chatInList = app.chat.getChats().find((c) => c.id && c.id() === (existingChat.id && existingChat.id()));
        if (chatInList) {
          app.chat.onChatChanged(chatInList);
          app.alerts.show({ type: 'success' }, app.translator.trans('xelson-chat.forum.chat.rejoin.opened'));
        } else {
          app.alerts.show({ type: 'error' }, app.translator.trans('xelson-chat.forum.chat.rejoin.failed'));
        }
        m.redraw();
      });
    this.hide();
  }

  createNewChat() {
    app.store
      .createRecord('chats')
      .save({
        title: this.getInput().title(),
        isChannel: this.isChannel,
        icon: this.getInput().icon(),
        color: this.getInput().color(),
        relationships: { users: [...this.getSelectedUsers(), app.session.user] },
      })
      .then((model) => {
        app.chat.addChat(model);
        app.chat.onChatChanged(model);
        m.redraw();
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Error creating chat:', error);
        if (error && error.status === 400) {
          app.alerts.show({ type: 'error' }, app.translator.trans('xelson-chat.forum.chat.create.exists'));
        } else {
          app.alerts.show({ type: 'error' }, app.translator.trans('xelson-chat.forum.chat.create.failed'));
        }
      });
    this.hide();
  }

  componentFormInputColor() {
    return this.componentFormColor({
      title: app.translator.trans('xelson-chat.forum.chat.list.add_modal.form.color.label'),
      desc: app.translator.trans('xelson-chat.forum.chat.list.add_modal.form.color.validator'),
      stream: this.getInput().color,
      placeholder: app.translator.trans('xelson-chat.forum.chat.list.add_modal.form.color.label'),
    });
  }

  componentFormInputIcon() {
    return this.componentFormIcon({
      title: app.translator.trans('xelson-chat.forum.chat.list.add_modal.form.icon.label'),
      desc: app.translator.trans('xelson-chat.forum.chat.list.add_modal.form.icon.validator', {
        a: <a href="https://fontawesome.com/icons?m=free" tabIndex="-1" target="_blank" rel="noopener" />, // [CHANGED]
      }),
      stream: this.getInput().icon,
      placeholder: 'fas fa-bolt',
    });
  }

  componentFormChat() {
    return [
      this.usersSelected.length > 1
        ? [
            this.componentFormInput({
              title: app.translator.trans('xelson-chat.forum.chat.list.add_modal.form.title.chat'),
              desc: app.translator.trans('xelson-chat.forum.chat.list.add_modal.form.title.validator'),
              stream: this.getInput().title,
              placeholder: app.translator.trans('xelson-chat.forum.chat.list.add_modal.form.title.chat'),
            }),
            this.componentFormInputColor(),
            this.componentFormInputIcon(),
          ]
        : null,
      this.componentFormUsersSelect(),
    ];
  }

  componentFormChannel() {
    return [
      this.componentFormInput({
        title: app.translator.trans('xelson-chat.forum.chat.list.add_modal.form.title.channel'),
        desc: app.translator.trans('xelson-chat.forum.chat.list.add_modal.form.title.validator'),
        stream: this.getInput().title,
        placeholder: app.translator.trans('xelson-chat.forum.chat.list.add_modal.form.title.channel'),
      }),
      this.componentFormInputColor(),
      this.componentFormInputIcon(),
    ];
  }

  isCanCreateChat() {
    if (this.getSelectedUsers().length > 1 && !this.getInput().title().length) return false;
    if (!this.getSelectedUsers().length) return false;
    if (this.alertText()) return false;
    return true;
  }

  isCanCreateChannel() {
    return this.getInput().title().length;
  }

  content() {
    return (
      <div className="Modal-body">
        <div class="Form-group InputTitle">
          {app.chat.getPermissions().create.channel ? (
            <div className="ChatType">
              <div
                className={classList({ 'Tab Tab--left': true, 'Tab--active': !this.isChannel })}
                onclick={(() => (this.isChannel = false)).bind(this)}
              >
                {app.translator.trans('xelson-chat.forum.chat.list.add_modal.chat')}
              </div>
              <div
                className={classList({ 'Tab Tab--right': true, 'Tab--active': this.isChannel })}
                onclick={(() => (this.isChannel = true)).bind(this)}
              >
                {app.translator.trans('xelson-chat.forum.chat.list.add_modal.channel')}
              </div>
            </div>
          ) : null}
          {this.isChannel ? this.componentFormChannel() : this.componentFormChat()}
          <div className="ButtonsPadding"></div>
          <Button
            className="Button Button--primary Button--block"
            disabled={this.isChannel ? !this.isCanCreateChannel() : !this.isCanCreateChat()}
            onclick={this.onsubmit.bind(this)}
          >
            {app.translator.trans('xelson-chat.forum.chat.list.add_modal.create.' + (this.isChannel ? 'channel' : 'chat'))}
          </Button>
        </div>
      </div>
    );
  }
}
