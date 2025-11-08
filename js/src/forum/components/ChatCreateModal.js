// js/src/forum/components/ChatCreateModal.js

import app from 'flarum/forum/app';
import Button from 'flarum/common/components/Button';
import classList from 'flarum/common/utils/classList';

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
    const selected = (this.getSelectedUsers() || []).filter(Boolean);

    // 单聊优先：尝试复用/复归
    if (!this.isChannel && selected.length === 1) {
      const otherUser = selected[0];

      const existingActive = app.chat.findExistingPMChat(app.session.user, otherUser);
      if (existingActive) {
        app.chat.onChatChanged(existingActive);
        this.hide();
        m.redraw();
        return;
      }

      const existingLeft = app.chat.findAnyPMChatIncludingLeft(app.session.user, otherUser);
      if (existingLeft && existingLeft.removed_at && existingLeft.removed_at()) {
        this.rejoinExistingChat(existingLeft);
        return;
      }
    }

    this.createNewChat(selected);
  }

  // ✅ 复归：只发 attributes.users.added = [id]；不要 relationships
  rejoinExistingChat(existingChat) {
    const meId = app.session.user?.id?.();
    if (!meId) return;

    existingChat
      .save({ users: { added: [meId] } })
      .then(() => {
        app.chat.addChat(existingChat);
        app.chat.onChatChanged(existingChat);
        app.alerts.show({ type: 'success' }, app.translator.trans('xelson-chat.forum.chat.rejoin.success'));
        m.redraw();
      })
      .catch((error) => {
        console.error('Error rejoining chat:', error);
        const item = app.chat.getChats().find((c) => c.id && c.id() === existingChat.id());
        if (item) {
          app.chat.onChatChanged(item);
          app.alerts.show({ type: 'success' }, app.translator.trans('xelson-chat.forum.chat.rejoin.opened'));
        } else {
          app.alerts.show({ type: 'error' }, app.translator.trans('xelson-chat.forum.chat.rejoin.failed'));
        }
        m.redraw();
      });

    this.hide();
  }

  // ✅ 新建：发 attributes.isChannel（布尔）+ attributes.users（id 数组，私聊/群聊时）
  createNewChat(passedSelected) {
    const rawTitle = (this.getInput().title() || '').trim();
    const rawIcon  = (this.getInput().icon()  || '').trim();
    const rawColor = (this.getInput().color() || '').trim();

    const title = rawTitle.length ? rawTitle : undefined;
    const icon  = rawIcon.length  ? rawIcon  : undefined;
    const color = rawColor.length ? rawColor : undefined;

    const selected = (passedSelected ?? this.getSelectedUsers() ?? []).filter(Boolean);
    const userIds = Array.from(
      new Set(
        [...selected, app.session.user]
          .map((u) => (u ? (typeof u.id === 'function' ? u.id() : u.id) : null))
          .filter((id) => id != null)
      )
    );

    // 👇 关键差异：用 isChannel，而不是 type
    const payload = { isChannel: !!this.isChannel };
    if (title !== undefined) payload.title = title;
    if (icon  !== undefined) payload.icon  = icon;
    if (color !== undefined) payload.color = color;

    // 私聊/群聊需要把参与者放到 attributes.users（id 数组）
    if (!payload.isChannel && userIds.length) {
      payload.users = userIds;
    }

    app.store
      .createRecord('chats')
      .save(payload)
      .then((model) => {
        app.chat.addChat(model);
        app.chat.onChatChanged(model);
        m.redraw();
      })
      .catch((error) => {
        console.error('Error creating chat:', error);
        app.alerts.show(
          { type: 'error' },
          app.translator.trans('xelson-chat.forum.chat.create.' + (error?.response?.errors?.[0]?.code === 'chat_exists' ? 'exists' : 'failed'))
        );
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
        a: (
          <a href="https://fontawesome.com/icons?m=free" tabIndex="-1" target="_blank" rel="noopener">
            Font Awesome
          </a>
        ),
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
    const selected = (this.getSelectedUsers() || []).filter(Boolean);
    if (selected.length > 1 && !(this.getInput().title() || '').length) return false;
    if (!selected.length) return false;
    if (this.alertText()) return false;
    return true;
  }

  isCanCreateChannel() {
    return (this.getInput().title() || '').length > 0;
  }

  content() {
    return (
      <div className="Modal-body">
        <div className="Form-group InputTitle">
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
            {app.translator.trans(
              'xelson-chat.forum.chat.list.add_modal.create.' + (this.isChannel ? 'channel' : 'chat')
            )}
          </Button>
        </div>
      </div>
    );
  }
}
