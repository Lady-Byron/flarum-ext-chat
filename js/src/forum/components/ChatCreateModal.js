// js/src/forum/components/ChatCreateModal.js
// 修复要点：
// - 复归已有 PM：PATCH 仅发 attributes.users.added=[id]（纯 id）
// - 新建：POST 使用 JSON:API relationships.users.data 传 {type:'users',id:'...'}
// - 其它逻辑保持原样，错误提示更清晰

import app from 'flarum/forum/app';
import Button from 'flarum/common/components/Button';
import classList from 'flarum/common/utils/classList';
import Model from 'flarum/common/Model';

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

    // 单聊优先：命中已有或已离开的 PM
    if (!this.isChannel && selected.length === 1) {
      const otherUser = selected[0];

      const existingActiveChat = app.chat.findExistingPMChat(app.session.user, otherUser);
      if (existingActiveChat) {
        app.chat.onChatChanged(existingActiveChat);
        this.hide();
        m.redraw();
        return;
      }

      const existingLeftChat = app.chat.findAnyPMChatIncludingLeft(app.session.user, otherUser);
      if (existingLeftChat && existingLeftChat.removed_at && existingLeftChat.removed_at()) {
        this.rejoinExistingChat(existingLeftChat);
        return;
      }
    }

    // 正常新建
    this.createNewChat(selected);
  }

  // 复归已有 PM —— 只发纯 id
  rejoinExistingChat(existingChat) {
    const meId = app.session.user?.id?.();
    if (!meId) return;

    existingChat
      .save({ users: { added: [meId] } }) // ✅ 纯 id
      .then(() => {
        app.chat.addChat(existingChat);
        app.chat.onChatChanged(existingChat);
        app.alerts.show({ type: 'success' }, app.translator.trans('xelson-chat.forum.chat.rejoin.success'));
        m.redraw();
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
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

  // 新建聊天/频道
  createNewChat(passedSelected) {
    const title = (this.getInput().title() || '').trim();
    const icon  = (this.getInput().icon()  || '').trim();
    const color = (this.getInput().color() || '').trim();

    const selected = (passedSelected ?? this.getSelectedUsers() ?? []).filter(Boolean);

    const payload = {
      type: 'chats',
      attributes: {
        type: this.isChannel ? 1 : 0,
        title,
        icon,
        color,
      },
    };

    // 私聊/群聊：用 JSON:API relationships 传参与者
    if (!this.isChannel) {
      const ids = [...selected, app.session.user].filter(Boolean).map((u) => Model.getIdentifier(u));
      payload.relationships = { users: { data: ids } };
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
        // eslint-disable-next-line no-console
        console.error('Error creating chat:', error);
        const msg =
          error?.status === 400
            ? app.translator.trans('xelson-chat.forum.chat.create.exists')
            : app.translator.trans('xelson-chat.forum.chat.create.failed');
        app.alerts.show({ type: 'error' }, msg);
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
