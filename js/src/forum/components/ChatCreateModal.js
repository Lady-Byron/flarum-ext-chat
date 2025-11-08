// js/src/forum/components/ChatCreateModal.js
// 修复要点：
// - 新建：发送 { type, users: number[], title?/icon?/color? }，不用 relationships
// - 复归：只发 { users: { added: [id] } }，不用 relationships
// - 过滤空字符串（icon/color 为空就不发）
// - 其它逻辑保持不变

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

    // 单聊优先：若只选 1 个用户，尝试复用/复归
    if (!this.isChannel && selected.length === 1) {
      const otherUser = selected[0];

      // 已有活跃 PM -> 直接打开
      const active = app.chat.findExistingPMChat(app.session.user, otherUser);
      if (active) {
        app.chat.onChatChanged(active);
        this.hide();
        m.redraw();
        return;
      }

      // 复归自己离开的 PM
      const left = app.chat.findAnyPMChatIncludingLeft(app.session.user, otherUser);
      if (left && left.removed_at && left.removed_at()) {
        this.rejoinExistingChat(left);
        return;
      }
    }

    // 多人或无历史 → 新建
    this.createNewChat(selected);
  }

  // 复归既有 PM：只把自己（id）加入，后端不需要 relationships
  rejoinExistingChat(existingChat) {
    const meId = app.session.user?.id?.();
    if (!meId) return;

    existingChat
      .save({
        users: { added: [meId] }, // ✅ 只发 id
      })
      .then(() => {
        app.chat.addChat(existingChat);
        app.chat.onChatChanged(existingChat);
        app.alerts.show(
          { type: 'success' },
          app.translator.trans('xelson-chat.forum.chat.rejoin.success')
        );
        m.redraw();
      })
      .catch((error) => {
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

  // 新建：后端更稳妥的是 { type, users: [id, ...], title?/icon?/color? }
  createNewChat(passedSelected) {
    const rawTitle = (this.getInput().title() || '').trim();
    const rawIcon  = (this.getInput().icon()  || '').trim();
    const rawColor = (this.getInput().color() || '').trim();

    // 过滤空字段：为空就不发，避免校验失败
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

    const payload = {
      type: this.isChannel ? 1 : 0, // 频道=1，私聊=0
    };
    if (title !== undefined) payload.title = title;
    if (icon  !== undefined) payload.icon  = icon;
    if (color !== undefined) payload.color = color;

    // 私聊/多人会话需要明确参与用户；频道通常后端有自己的可见性逻辑
    if (!this.isChannel && userIds.length) {
      payload.users = userIds; // ✅ 只发 id 数组
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
        const code =
          (error?.response?.errors?.[0]?.code) || '';
        if (code === 'chat_exists') {
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

