// js/src/forum/components/ChatEditModal.js
// [CHANGED] Import paths -> flarum/common/*
// [CHANGED] “在初始用户中/已离开”与 PM 成员判断：统一按 id 比较，避免对象引用误判
// [CHANGED] 踢人按钮 disabled 判定：改为 targetRole >= myRole 的数值比较，权限语义准确

import Button from 'flarum/common/components/Button';         // [CHANGED]
import Dropdown from 'flarum/common/components/Dropdown';     // [CHANGED]
import classList from 'flarum/common/utils/classList';        // [CHANGED]
import Model from 'flarum/common/Model';                      // [CHANGED]
import Group from 'flarum/common/models/Group';               // [CHANGED]
import Stream from 'flarum/common/utils/Stream';              // [CHANGED]

import ChatModal from './ChatModal';

export default class ChatEditModal extends ChatModal {
  oninit(vnode) {
    super.oninit(vnode);

    this.getInput().title = Stream(this.model.title());
    this.getInput().color = Stream(this.model.color());
    this.getInput().icon = Stream(this.model.icon());

    this.deleteChatTitleInput = Stream('');
    this.deleteState = 0;

    const chatId = this.model.id();
    const alive = (u) => !u.chat_pivot(chatId).removed_at();

    this.initialUsers = (this.model.users() || []).filter(alive);
    this.setSelectedUsers((this.model.users() || []).filter(alive));
    this.edited = {};

    this.isLocalModerator = this.isModer(app.session.user);
    this.isLocalLeaved = !this.listHasUserById(this.initialUsers, app.session.user);     // [CHANGED]
  }

  // [CHANGED] helper：按 id 判断某列表是否包含 user
  listHasUserById(list, user) {
    if (!user) return false;
    const meId = user.id();
    return (list || []).some((u) => u && u.id && u.id() === meId);
  }

  title() {
    return app.translator.trans('xelson-chat.forum.chat.edit_modal.title');
  }

  onsubmit() {
    const byId = (arr) => arr.map((mdl) => (mdl ? Model.getIdentifier(mdl) : null)).filter(Boolean);

    const added = byId(this.getSelectedUsers().filter((mdl) => !this.listHasUserById(this.initialUsers, mdl)));     // [CHANGED]
    const removed = byId(this.initialUsers.filter((mdl) => !this.listHasUserById(this.getSelectedUsers(), mdl)));   // [CHANGED]
    const edited = Object.keys(this.edited).map((k) => (this.edited[k] = { id: k, ...this.edited[k] }));

    this.model.save({
      title: this.getInput().title(),
      color: this.getInput().color(),
      icon: this.getInput().icon(),
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
      (!this.model.creator() && user.groups() && user.groups().some((g) => g.id() == Group.ADMINISTRATOR_ID))
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
        const idx = this.getSelectedUsers().findIndex((u) => u && u.id && u.id() === user.id()); // [CHANGED]
        if (idx >= 0) this.getSelectedUsers().splice(idx, 1);
        break;
      }
    }
  }

  // [CHANGED] 计算数值角色（0/1/2），考虑 edited 覆盖
  roleOf(user) {
    if (!user) return 0;
    const override = this.edited[user.id()]?.role;
    if (typeof override === 'number') return override;
    return user.chat_pivot(this.model.id()).role() ?? 0;
  }

  componentUserMentionDropdown(user) {
    const me = app.session.user;
    const myRole = this.roleOf(me);                // [CHANGED]
    const targetRole = this.roleOf(user);          // [CHANGED]

    return (
      <Dropdown
        buttonClassName="Button Button--icon Button--flat Button--mention-edit"
        menuClassName="Dropdown-menu--top Dropdown-menu--bottom Dropdown-menu--left Dropdown-menu--right"
        icon="fas fa-chevron-down"
      >
        <Button
          icon={this.isModer(user) ? 'fas fa-times' : 'fas fa-users-cog'}
          onclick={this.userMentionDropdownOnclick.bind(this, user, 'moder')}
          disabled={user == me || !this.isCreator(me) || this.isCreator(user)}
        >
          {app.translator.trans('xelson-chat.forum.chat.moder')}
        </Button>
        <Button
          icon="fas fa-trash-alt"
          onclick={this.userMentionDropdownOnclick.bind(this, user, 'kick')}
          disabled={user != me && targetRole >= myRole}   // [CHANGED] 权限逻辑：目标 ≥ 自己时禁用
        >
          {app.translator.trans(`xelson-chat.forum.chat.${user == me ? 'leave' : 'kick'}`)}
        </Button>
      </Dropdown>
    );
  }

  userMentionContent(user) {
    return ['@' + user.displayName(), this.isLocalModerator && !app.chat.isChatPM(this.model) ? this.componentUserMentionDropdown(user) : null];
  }

  userMentionOnClick(user, e) {
    this.$(e.target).find('.Dropdown').trigger('shown.bs.dropdown');
  }

  componentFormInputIcon() {
    return this.componentFormIcon({
      title: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.icon.label'),
      desc: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.icon.validator', {
        a: <a href="https://fontawesome.com/icons?m=free" tabIndex="-1" target="_blank" rel="noopener" />,  // [CHANGED]
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
      ? [this.componentFormInputTitle(), this.componentFormInputColor(), this.componentFormInputIcon(), this.componentFormUsersSelect()]
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

    // 退出 / 返回
    const removedBy = this.model.removed_by && this.model.removed_by();                 // [CHANGED]
    const meId = app.session.user && app.session.user.id && app.session.user.id();
    buttons.push(
      <Button
        className="Button Button--primary Button--block ButtonLeave"
        onclick={this.onleave.bind(this)}
        disabled={!!removedBy && String(removedBy) !== String(meId)}                    // [CHANGED]
      >
        {app.translator.trans(`xelson-chat.forum.chat.edit_modal.form.${this.isLocalLeaved ? 'return' : 'leave'}`)}
      </Button>
    );

    if (!app.chat.isChatPM(this.model) && app.chat.getPermissions().create.channel) buttons.push(this.componentDeleteChat());

    return buttons;
  }

  onleave() {
    if (!this.isLocalLeaved) {
      this.model
        .save({
          users: { removed: [Model.getIdentifier(app.session.user)] },
          relationships: { users: this.getSelectedUsers() },
        })
        .then(() => m.redraw());
    } else {
      this.getSelectedUsers().push(app.session.user);
      this.model
        .save({
          users: { added: [Model.getIdentifier(app.session.user)] },
          relationships: { users: this.getSelectedUsers() },
        })
        .then(() => m.redraw());
    }
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
            <br></br>,
            this.componentFormInput({
              title: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.delete.title'),
              desc: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.delete.desc'),
              placeholder: app.translator.trans('xelson-chat.forum.chat.edit_modal.form.delete.placeholder'),
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
        <div class="Form-group InputTitle">
          {this.componentForm()}
          <div className="ButtonsPadding"></div>
          {this.componentFormButtons()}
        </div>
      </div>
    );
  }
}
