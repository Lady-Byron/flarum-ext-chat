// js/src/forum/components/ChatEditModal.js
// [FIX] 频道 (type=1) 不发送 users.added；“加入聊天”对频道为 no-op
// [FIX] 初始化 isLocalLeaved 时排除频道；按钮文案/逻辑随之调整
// [FIX] 保存/离开前用最新 chat 模型，避免 data.id 与 URL 不一致
// [FIX] 比较一律按 id；class -> className 保持一致

import app from 'flarum/forum/app';
import Button from 'flarum/common/components/Button';
import Dropdown from 'flarum/common/components/Dropdown';
import classList from 'flarum/common/utils/classList';
import Model from 'flarum/common/Model';
import Group from 'flarum/common/models/Group';
import Stream from 'flarum/common/utils/Stream';

import ChatModal from './ChatModal';

export default class ChatEditModal extends ChatModal {
  oninit(vnode) {
    super.oninit(vnode);

    this.getInput().title = Stream(this.model.title());
    this.getInput().color = Stream(this.model.color());
    this.getInput().icon  = Stream(this.model.icon());

    this.deleteChatTitleInput = Stream('');
    this.deleteState = 0;

    const chatId = this.model.id();
    const alive  = (u) => !u.chat_pivot(chatId).removed_at();

    this.initialUsers = (this.model.users() || []).filter(alive);
    this.setSelectedUsers((this.model.users() || []).filter(alive));
    this.edited = {};

    this.isLocalModerator = this.isModer(app.session.user);
    // ✅ 频道永远不需要“加入”，因此不标记为已离开
    this.isLocalLeaved = !this.isChannel() && !this.listHasUserById(this.initialUsers, app.session.user);
  }

  // —— 工具 —— //
  isChannel() {
    return this.model?.type?.() === 1;
  }

  freshChat() {
    const id = this.model?.id?.();
    return id ? app.store.getById('chats', String(id)) || this.model : this.model;
  }

  listHasUserById(list, user) {
    if (!user) return false;
    const id = user.id();
    return (list || []).some((u) => u && u.id && u.id() === id);
  }

  title() {
    return app.translator.trans('xelson-chat.forum.chat.edit_modal.title');
  }

  onsubmit() {
    const byId = (arr) => arr.map((mdl) => (mdl ? Model.getIdentifier(mdl) : null)).filter(Boolean);

    const added   = byId(this.getSelectedUsers().filter((mdl) => !this.listHasUserById(this.initialUsers, mdl)));
    const removed = byId(this.initialUsers.filter((mdl) => !this.listHasUserById(this.getSelectedUsers(), mdl)));
    const edited  = Object.keys(this.edited).map((k) => (this.edited[k] = { id: k, ...this.edited[k] }));

    this.freshChat().save({
      title: this.getInput().title(),
      color: this.getInput().color(),
      icon:  this.getInput().icon(),
      users: { added, removed, edited },
      relationships: { users: this.getSelectedUsers() },
    });

    this.hide();
  }

  alertText() {
    return null;
  }

  isModer(user) {
    if (!user) return false;
    if ((this.edited[user.id()]?.role ?? user.chat_pivot(this.model.id()).role()) > 0) return true;
    if (this.isCreator(user)) return true;
    return false;
  }

  isCreator(user) {
    return (
      user.chat_pivot(this.model.id()).role() == 2 ||
      (!this.model.creator() &&
        user.groups() &&
        user.groups().some((g) => g.id() == Group.ADMINISTRATOR_ID))
    );
  }

  userMentionClassname(user) {
    return classList({ editable: true, moder: this.isModer(user), creator: this.isCreator(user) });
  }

  userMentionDropdownOnclick(user, button) {
    switch (button) {
      case 'moder': {
        if (this.isModer(user)) this.edited[user.id()] = { role: 0 };
        else this.edited[user.id()] = { role: 1 };
        break;
      }
      case 'kick': {
        const idx = this.getSelectedUsers().findIndex((u) => u && u.id && u.id() === user.id());
        if (idx >= 0) this.getSelectedUsers().splice(idx, 1);
        break;
      }
    }
  }

  roleOf(user) {
    if (!user) return 0;
    const override = this.edited[user.id()]?.role;
    if (typeof override === 'number') return override;
    return user.chat_pivot(this.model.id()).role() ?? 0;
  }

  componentUserMentionDropdown(user) {
    const me = app.session.user;
    const myRole = this.roleOf(me);
    const targetRole = this.roleOf(user);

    const meId   = me && me.id && me.id();
    const userId = user && user.id && user.id();
    const isSelf = String(userId) === String(meId);

    return (
      <Dropdown
        buttonClassName="Button Button--icon Button--flat Button--mention-edit"
        menuClassName="Dropdown-menu--top Dropdown-menu--bottom Dropdown-menu--left Dropdown-menu--right"
        icon="fas fa-chevron-down"
      >
        <Button
          icon={this.isModer(user) ? 'fas fa-times' : 'fas fa-users-cog'}
          onclick={this.userMentionDropdownOnclick.bind(this, user, 'moder')}
          disabled={isSelf || !this.isCreator(me) || this.isCreator(user)}
        >
          {app.translator.trans('xelson-chat.forum.chat.moder')}
        </Button>
        <Button
          icon="fas fa-trash-alt"
          onclick={this.userMentionDropdownOnclick.bind(this, user, 'kick')}
          disabled={!isSelf && targetRole >= myRole}
        >
          {app.translator.trans(`xelson-chat.forum.chat.${isSelf ? 'leave' : 'kick'}`)}
        </Button>
      </Dropdown>
    );
  }

  userMentionContent(user) {
    return [
      '@' + user.displayName(),
      this.isLocalModerator && !app.chat.isChatPM(this.model)
        ? this.componentUserMentionDropdown(user)
        : null,
    ];
  }

  userMentionOnClick(user, e) {
    this.$(e.target).find('.Dropdown').trigger('shown.bs.dropdown');
  }

  componentFormInputIcon() {
    return this.componentFormIcon({
      title: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.icon.label'),
      desc: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.icon.validator', {
        a: (
          <a
            href="https://fontawesome.com/icons?m=free"
            tabIndex="-1"
            target="_blank"
            rel="noopener"
          />
        ),
      }),
      stream: this.getInput().icon,
      placeholder: 'fas fa-bolt',
    });
  }

  componentFormInputTitle() {
    return this.componentFormInput({
      title: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.title.label'),
      desc: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.title.validator'),
      stream: this.getInput().title,
      placeholder: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.title.label'),
    });
  }

  componentFormInputColor() {
    return this.componentFormColor({
      title: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.color.label'),
      desc: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.color.validator'),
      stream: this.getInput().color,
      placeholder: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.color.label'),
    });
  }

  componentChatInfo() {
    return [
      <label>
        <h2>{this.model.title()}</h2>
      </label>,
      this.componentUsersMentions(),
    ];
  }

  componentFormPM() {
    return this.componentChatInfo();
  }

  componentFormChannel() {
    return this.isLocalModerator
      ? [
          this.componentFormInputTitle(),
          this.componentFormInputColor(),
          this.componentFormInputIcon(),
          this.componentFormUsersSelect('xelson-chat.forum.chat.edit_modal.form.users.edit'),
        ]
      : this.componentChatInfo();
  }

  componentFormChat() {
    return this.isLocalModerator
      ? [
          this.componentFormInputTitle(),
          this.componentFormInputColor(),
          this.componentFormInputIcon(),
          this.componentFormUsersSelect(),
        ]
      : this.componentChatInfo();
  }

  componentForm() {
    if (this.model.type()) return this.componentFormChannel();
    if (app.chat.isChatPM(this.model)) return this.componentFormPM();
    return this.componentFormChat();
  }

  componentFormButtons() {
    const buttons = [];

    if (this.isLocalModerator && !app.chat.isChatPM(this.model))
      buttons.push(
        <Button
          className="Button Button--primary Button--block ButtonSave"
          onclick={this.onsubmit.bind(this)}
          disabled={this.model.type() ? !this.isCanEditChannel() : !this.isCanEditChat()}
        >
          {app.translator.trans('xelson-chat.forum.chat.edit_modal.save_button')}
        </Button>
      );

    // ✅ 对频道：只显示“退出聊天”；对私聊/群聊：未离开显示“退出”，已离开显示“加入”
    const joinMode = !this.isChannel() && this.isLocalLeaved;

    buttons.push(
      <Button
        className="Button Button--primary Button--block ButtonLeave"
        onclick={this.onleave.bind(this)}
      >
        {app.translator.trans(
          `xelson-chat.forum.chat.edit_modal.form.${joinMode ? 'return' : 'leave'}`
        )}
      </Button>
    );

    if (!app.chat.isChatPM(this.model) && app.chat.getPermissions().create.channel)
      buttons.push(this.componentDeleteChat());

    return buttons;
  }

  onleave() {
    const chat = this.freshChat();
    const me   = app.session.user;

    if (!this.isLocalLeaved) {
      // 离开（频道/私聊/群聊均可）
      chat
        .save({
          users: { removed: [Model.getIdentifier(me)] },
        })
        .then(() => m.redraw());
      this.hide();
      return;
    }

    // 需要“加入”的情况：仅对私聊/群聊；频道不需要显式加入，直接关闭
    if (this.isChannel()) {
      app.chat.addChat(chat);
      app.chat.onChatChanged(chat);
      this.hide();
      return;
    }

    // 私聊/群聊加入
    this.getSelectedUsers().push(me);
    chat
      .save({
        users: { added: [Model.getIdentifier(me)] },
        relationships: { users: this.getSelectedUsers() },
      })
      .then(() => m.redraw());
    this.hide();
  }

  isCanEditChannel() {
    return this.getInput().title().length;
  }

  isCanEditChat() {
    if (this.alertText()) return false;
    return true;
  }

  componentDeleteChat() {
    return [
      this.deleteState == 1
        ? [
            <br />,
            this.componentFormInput({
              title: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.delete.title'),
              desc: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.delete.desc'),
              placeholder: app.translator.trans(
                'xelson-chat.forum.chat.edit_modal.form.delete.placeholder'
              ),
              stream: this.deleteChatTitleInput,
            }),
          ]
        : null,
      <Button
        className="Button Button--primary Button--block ButtonDelete"
        onclick={this.ondelete.bind(this)}
        disabled={this.deleteState == 1 && !this.isValidTitleCopy()}
      >
        {app.translator.trans('xelson-chat.forum.chat.edit_modal.form.delete.button')}
      </Button>,
    ];
  }

  isValidTitleCopy() {
    return this.deleteChatTitleInput() == this.model.title();
  }

  ondelete() {
    switch (this.deleteState) {
      case 0:
        this.deleteState = 1;
        break;
      case 1:
        if (this.isValidTitleCopy()) {
          app.chat.deleteChat(this.model);
          this.model.delete();
          this.hide();
        }
        break;
    }
  }

  content() {
    return (
      <div className="Modal-body">
        <div className="Form-group InputTitle">
          {this.componentForm()}
          <div className="ButtonsPadding"></div>
          {this.componentFormButtons()}
        </div>
      </div>
    );
  }
}
