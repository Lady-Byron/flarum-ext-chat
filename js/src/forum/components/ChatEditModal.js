// js/src/forum/components/ChatEditModal.js
// 修复要点：
// - 加入/退出/保存成员变更：attributes.users.* 一律用“纯 id”数组；不再同时提交 relationships.users
// - 角色编辑 payload 仅 {id, role}
// - 各处比较统一按 id()；class -> className；导入路径适配 1.8

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
    const alive = (u) => !u.chat_pivot(chatId).removed_at();

    this.initialUsers = (this.model.users() || []).filter(alive);
    this.setSelectedUsers((this.model.users() || []).filter(alive));
    this.edited = {}; // { [userId]: { role: 0|1 } }

    this.isLocalModerator = this.isModer(app.session.user);
    this.isLocalLeaved = !this.listHasUserById(this.initialUsers, app.session.user);
  }

  listHasUserById(list, user) {
    if (!user) return false;
    const id = user.id();
    return (list || []).some((u) => u && u.id && u.id() === id);
  }

  title() {
    return app.translator.trans('xelson-chat.forum.chat.edit_modal.title');
  }

  // ===== 提交保存：只发 attributes.users（纯 id） =====
  onsubmit() {
    const idOf = (u) => (u && (typeof u.id === 'function' ? u.id() : u.id)) || null;
    const uniq = (arr) => Array.from(new Set(arr));

    const added = uniq(
      this.getSelectedUsers()
        .filter((u) => !this.listHasUserById(this.initialUsers, u))
        .map(idOf)
        .filter(Boolean)
    );

    const removed = uniq(
      this.initialUsers
        .filter((u) => !this.listHasUserById(this.getSelectedUsers(), u))
        .map(idOf)
        .filter(Boolean)
    );

    const edited = Object.keys(this.edited).map((k) => ({ id: k, ...this.edited[k] }));

    this.model.save({
      title: this.getInput().title(),
      color: this.getInput().color(),
      icon:  this.getInput().icon(),
      users: { added, removed, edited }   // ✅ 纯 id；不传 relationships.users
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

    const meId = me && me.id && me.id();
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

    const removedBy = this.model.removed_by && this.model.removed_by();
    const meId = app.session.user && app.session.user.id && app.session.user.id();

    buttons.push(
      <Button
        className="Button Button--primary Button--block ButtonLeave"
        onclick={this.onleave.bind(this)}
        disabled={!!removedBy && String(removedBy) !== String(meId)}
      >
        {app.translator.trans(
          `xelson-chat.forum.chat.edit_modal.form.${this.isLocalLeaved ? 'return' : 'leave'}`
        )}
      </Button>
    );

    if (!app.chat.isChatPM(this.model) && app.chat.getPermissions().create.channel)
      buttons.push(this.componentDeleteChat());

    return buttons;
  }

  // ===== 加入/退出：只发 attributes.users（纯 id） =====
  onleave() {
    const meId = app.session.user?.id?.();
    if (!meId) return;

    if (!this.isLocalLeaved) {
      // 退出
      this.model
        .save({ users: { removed: [meId] } })
        .then(() => m.redraw());
    } else {
      // 重新加入
      this.getSelectedUsers().push(app.session.user);
      this.model
        .save({ users: { added: [meId] } })
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
