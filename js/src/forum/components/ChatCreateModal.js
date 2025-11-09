// js/src/forum/components/ChatCreateModal.js
//
// [FIX] rejoinExistingChat：加入已退出的私聊时，后端 EditChatHandler 期待 JSON:API 资源标识对象。
//       之前发送的是纯字符串 ID，后端在 `$u['type']` 处对字符串取下标导致 500。
//       现改为使用 Model.getIdentifier(me) 生成 { type:'users', id:'...' }，并附带 relationships.users（更稳）。
//
// 其他说明（保持原有注释不变）：
// - 单聊优先复用/复归；否则按频道/群聊/单聊创建逻辑创建新会话。
// - 新建会话时避免再嵌套 attributes:{...}，直接传顶层属性与 relationships。
// - Flarum 1.8 路径已统一。

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

  // 复归：只发 users.added = [meIdentifier]
  // [FIX] 必须发送 JSON:API 资源标识对象，而不是纯字符串 ID；可选地附带 relationships.users
  rejoinExistingChat(existingChat) {
    const me = app.session.user;
    if (!me) return;

    existingChat
      .save({
        users: { added: [Model.getIdentifier(me)] },            // 关键：{ type:'users', id:'...' }
        relationships: { users: existingChat.users() || [] },   // 可选但更稳：与 EditModal 行为对齐
      })
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

  // 新建：正确打包 save(...) 的数据（不再嵌套 attributes:{}）
  createNewChat(passedSelected) {
    const meId = String(app.session.user?.id?.() ?? '');
    const rawTitle = (this.getInput().title() || '').trim();
    const rawIcon  = (this.getInput().icon()  || '').trim();
    const rawColor = (this.getInput().color() || '').trim();

    const selected = (passedSelected ?? this.getSelectedUsers() ?? []).filter(Boolean);

    // 过滤掉自己，仅保留对方（/对方们）的 User Model
    const selectedModels = selected.filter((u) => String(u?.id?.()) !== meId);

    // —— 标题策略 ——
    // 频道：必须有标题
    // 多人群聊：必须有标题
    // 一对一私聊：若未填标题，自动用对方用户名
    let title = rawTitle;
    if (this.isChannel) {
      if (!title.length) {
        app.alerts.show({ type: 'error' }, app.translator.trans('xelson-chat.forum.chat.list.add_modal.form.title.validator'));
        return;
      }
    } else {
      if (selectedModels.length === 0) {
        app.alerts.show({ type: 'error' }, app.translator.trans('xelson-chat.forum.chat.create.failed'));
        return;
      }
      if (selectedModels.length > 1 && !title.length) {
        app.alerts.show({ type: 'error' }, app.translator.trans('xelson-chat.forum.chat.list.add_modal.form.title.validator'));
        return;
      }
      if (selectedModels.length === 1 && !title.length) {
        const other = selectedModels[0];
        title = (other?.username?.() || '').trim();
      }
    }

    // 直接传属性键（不要再包 attributes:{}）
    /** @type {any} */
    const saveData = {
      isChannel: !!this.isChannel,
    };
    if (title && title.length) saveData.title = title;
    if (rawIcon.length)        saveData.icon  = rawIcon;
    if (rawColor.length)       saveData.color = rawColor;

    // relationships：直接传 User Model 数组，Flarum 会自动序列化为 JSON:API
    if (!saveData.isChannel && selectedModels.length) {
      saveData.relationships = {
        users: selectedModels,
      };
    }

    app.store
      .createRecord('chats')
      .save(saveData)
      .then((model) => {
        app.chat.addChat(model);
        app.chat.onChatChanged(model);
        m.redraw();
      })
      .catch((error) => {
        console.error('Error creating chat:', error);
        const code = error?.response?.errors?.[0]?.code;
        app.alerts.show(
          { type: 'error' },
          app.translator.trans('xelson-chat.forum.chat.create.' + (code === 'chat_exists' ? 'exists' : 'failed'))
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
    if (selected.length > 1 && !(this.getInput().title() || '').length) return false; // 多人群聊必须有标题
    if (!selected.length) return false; // 至少选择 1 人（单聊可无手输标题）
    if (this.alertText()) return false;
    return true;
  }

  isCanCreateChannel() {
    return (this.getInput().title() || '').length > 0; // 频道必须有标题
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
