// js/src/forum/components/ChatCreateModal.js
// 关键：不要手包 {data:…}；把普通对象交给 Model.save() 让 Flarum 自行序列化
// 兼容：创建 PM/群聊 同时发送 relationships.users.data 与 attributes.users(id数组)
// 频道创建不带 relationships.users

import app from 'flarum/forum/app';
import Button from 'flarum/common/components/Button';
import classList from 'flarum/common/utils/classList';
import Model from 'flarum/common/Model';
import ChatModal from './ChatModal';

export default class ChatCreateModal extends ChatModal {
  oninit(vnode) {
    super.oninit(vnode);
    this.isChannel = false; // false=私聊/群聊, true=频道
  }

  title() {
    return app.translator.trans('xelson-chat.forum.chat.list.add_modal.title');
  }

  // 工具：User 模型数组 -> 资源标识符数组 [{type:'users', id:'…'}]
  toIdentifiers(models) {
    return (models || []).filter(Boolean).map((u) => Model.getIdentifier(u));
  }
  // 工具：User 模型数组 -> 纯 id 字符串数组 ['1','2']
  toIdArray(models) {
    return (models || [])
      .filter(Boolean)
      .map((u) => (typeof u.id === 'function' ? String(u.id()) : String(u.id)));
  }
  selectedUsers() {
    return (this.getSelectedUsers() || []).filter(Boolean);
  }

  // 复归“我曾退出的 PM” -> PATCH /api/chats/{id}
  rejoinExistingChat(existingChat) {
    const meId = app.session.user?.id?.();
    if (!meId) return;
    // 放在 attributes.users.added（= save({ users:{added:[id]} })）
    existingChat
      .save({ users: { added: [String(meId)] } })
      .then(() => {
        app.chat.addChat(existingChat);
        app.chat.onChatChanged(existingChat);
        app.alerts.show({ type: 'success' }, app.translator.trans('xelson-chat.forum.chat.rejoin.success'));
        m.redraw();
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Error rejoining chat:', error);
        const item = app.chat.getChats().find((c) => c?.id?.() === existingChat.id?.());
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

  onsubmit() {
    const selected = this.selectedUsers();

    // 单人 PM 快捷：已有/复归
    if (!this.isChannel && selected.length === 1) {
      const other = selected[0];
      const activePM = app.chat.findExistingPMChat(app.session.user, other);
      if (activePM) {
        app.chat.onChatChanged(activePM);
        this.hide();
        m.redraw();
        return;
      }
      const leftPM = app.chat.findAnyPMChatIncludingLeft(app.session.user, other);
      if (leftPM && leftPM.removed_at && leftPM.removed_at()) {
        this.rejoinExistingChat(leftPM);
        return;
      }
    }

    this.createNewChat(selected);
  }

  // 真正创建 -> POST /api/chats
  createNewChat(passedSelected) {
    const title = (this.getInput().title() || '').trim();
    const icon  = (this.getInput().icon()  || '').trim();
    const color = (this.getInput().color() || '').trim();

    const selected = (passedSelected || this.selectedUsers());
    const me = app.session.user;
    const participants = (!this.isChannel ? [...selected, me].filter(Boolean) : []);

    // —— 传给 save() 的“普通对象”（Flarum 会自动包 JSON:API）——
    const attrs = {
      // 双轨兼容：部分后端读 type(0/1)，部分读 isChannel(true/false)
      type: this.isChannel ? 1 : 0,
      isChannel: !!this.isChannel,
      title,
      icon,
      color,
    };

    const payload = { ...attrs };

    if (!this.isChannel) {
      // relationships.users.data：标准 JSON:API 关系
      payload.relationships = {
        users: { data: this.toIdentifiers(participants) },
      };
      // 兼容兜底：attributes.users（纯 id 数组）
      payload.users = this.toIdArray(participants);
    }

    // 调试：看“传入 save() 的对象”（不是最终 JSON:API；最终会被 Flarum 包装）
    console.debug('[neon] chats.save attrs', payload);

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
        const status = error?.status;
        if (status === 400) {
          app.alerts.show({ type: 'error' }, app.translator.trans('xelson-chat.forum.chat.create.exists'));
        } else {
          app.alerts.show({ type: 'error' }, app.translator.trans('xelson-chat.forum.chat.create.failed'));
        }
      });

    this.hide();
  }

  // —— UI 维持不变 —— //
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
    const selected = this.selectedUsers();
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
