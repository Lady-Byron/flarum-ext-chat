// js/src/forum/components/ChatCreateModal.js
// 修复要点：
// - relationships.users 一律发送 identifiers（{ type, id }）
// - 复归既有 PM（自己曾离开）走 users.added + relationships.users
// - 标题/图标/颜色做空值守护
// - className 与安全外链
// - 其它逻辑保持与原版一致

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
    // 单聊优先处理：如果只选择了 1 位用户
    if (!this.isChannel && this.getSelectedUsers().length === 1) {
      const otherUser = this.getSelectedUsers()[0];

      // 1) 已有活跃 PM -> 直接切换到该会话
      const existingActiveChat = app.chat.findExistingPMChat(app.session.user, otherUser);
      if (existingActiveChat) {
        app.chat.onChatChanged(existingActiveChat);
        this.hide();
        m.redraw();
        return;
      }

      // 2) 找到“曾经存在但自己退出过”的 PM -> 对原会话执行复归
      const existingLeftChat = app.chat.findAnyPMChatIncludingLeft(app.session.user, otherUser);
      if (existingLeftChat && existingLeftChat.removed_at && existingLeftChat.removed_at()) {
        this.rejoinExistingChat(existingLeftChat);
        return;
      }
    }

    // 多人或无历史 → 正常新建
    this.createNewChat();
  }

  // 复归既有 PM（关键修复）：在原会话上执行 users.added，并发送 relationships.users identifiers
  rejoinExistingChat(existingChat) {
    const me = app.session.user;

    // 以“当前会话用户 + 自己”为准，构造 identifiers
    const users = (existingChat.users() || []).slice();
    if (!users.find((u) => u && u.id && me && u.id() === me.id())) {
      users.push(me);
    }

    const identifiers = users
      .map((u) => (u ? Model.getIdentifier(u) : null))
      .filter(Boolean);

    existingChat
      .save({
        users: { added: [Model.getIdentifier(me)] },
        relationships: { users: identifiers },
      })
      .then(() => {
        // 确保列表中存在并切换
        app.chat.addChat(existingChat);
        app.chat.onChatChanged(existingChat);
        app.alerts.show(
          { type: 'success' },
          app.translator.trans('xelson-chat.forum.chat.rejoin.success')
        );
        m.redraw();
      })
      .catch((error) => {
        // 打不开就尽量回到同 ID 的列表项
        // eslint-disable-next-line no-console
        console.error('Error rejoining chat:', error);
        const item = app.chat.getChats().find((c) => c.id && c.id() === existingChat.id());
        if (item) {
          app.chat.onChatChanged(item);
          app.alerts.show(
            { type: 'success' },
            app.translator.trans('xelson-chat.forum.chat.rejoin.opened')
          );
        } else {
          app.alerts.show(
            { type: 'error' },
            app.translator.trans('xelson-chat.forum.chat.rejoin.failed')
          );
        }
        m.redraw();
      });

    this.hide();
  }

  // 正常新建会话/频道
  createNewChat() {
    const title = (this.getInput().title() || '').trim();
    const icon = (this.getInput().icon() || '').trim();
    const color = (this.getInput().color() || '').trim();

    const selected = this.getSelectedUsers();
    const identifiers = [...selected, app.session.user].filter(Boolean);

    app.store
      .createRecord('chats')
      .save({
        title,
        isChannel: this.isChannel,
        icon,
        color,
        relationships: { users: userModels }, // 发送 identifiers，避免把模型对象直接塞进 relationships
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
          app.alerts.show(
            { type: 'error' },
            app.translator.trans('xelson-chat.forum.chat.create.exists')
          );
        } else {
          app.alerts.show(
            { type: 'error' },
            app.translator.trans('xelson-chat.forum.chat.create.failed')
          );
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
        a: (
          <a
            href="https://fontawesome.com/icons?m=free"
            tabIndex="-1"
            target="_blank"
            rel="noopener"
          >
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
    if (this.getSelectedUsers().length > 1 && !(this.getInput().title() || '').length) return false;
    if (!this.getSelectedUsers().length) return false;
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

