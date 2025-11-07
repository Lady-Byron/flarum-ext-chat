// js/src/forum/components/ChatCreateModal.js
// 修复要点：
// - relationships.users 直接传“模型实例数组”（Flarum 1.x 推荐写法）
// - 复归既有 PM（自己曾离开）走 users.added + relationships.users
// - 新建使用 type: 0(私聊)/1(频道)，而不是 isChannel
// - 标题/图标/颜色做空值守护；所有用户数组均 filter(Boolean)
// - 其它逻辑保持与原版一致

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
    // 统一取“已选用户”并清理空位
    const selected = (this.getSelectedUsers() || []).filter(Boolean);

    // 单聊优先处理：如果只选择了 1 位用户
    if (!this.isChannel && selected.length === 1) {
      const otherUser = selected[0];

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
    this.createNewChat(selected);
  }

  // 复归既有 PM（关键修复）：在原会话上执行 users.added，并发送 relationships.users（模型实例）
  rejoinExistingChat(existingChat) {
    const me = app.session.user;

    // 以“当前会话用户 + 自己”为准
    const users = (existingChat.users() || []).slice();
    if (!users.find((u) => u && u.id && me && u.id() === me.id())) {
      users.push(me);
    }

    const userModels = users.filter(Boolean);

    existingChat
      .save({
        users: { added: [me] },                    // ✅ 复归把自己加入
        relationships: { users: userModels },      // ✅ 直接传模型实例数组
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
  createNewChat(passedSelected) {
    const title = (this.getInput().title() || '').trim();
    const icon  = (this.getInput().icon()  || '').trim();
    const color = (this.getInput().color() || '').trim();

    // 统一取“已选用户”并清理空位（优先复用传入）
    const selected = (passedSelected ?? this.getSelectedUsers() ?? []).filter(Boolean);

    // 构造“将参与的用户”：已选 + 自己
    const userModels = [...selected, app.session.user].filter(Boolean);

    // 按 Flarum 习惯使用 type: 0(私聊)/1(频道)
    const payload = { title, type: this.isChannel ? 1 : 0, icon, color };

    // 仅在“私聊/多人聊天”且确实有用户时才附加 users 关系；
    // 频道通常由后端自动附加可见用户，避免多传
    if (!this.isChannel && userModels.length) {
      payload.relationships = { users: userModels }; // ✅ 直接传模型实例数组
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
