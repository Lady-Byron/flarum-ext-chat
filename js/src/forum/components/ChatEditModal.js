// js/src/forum/components/ChatEditModal.js
// [FIXES SUMMARY]
// - 成员“下拉菜单全体同时展开” -> 仅当前这一条展开：
//   1) 在 oncreate 中注册捕获级 click 监听，只接管 `.Button--mention-edit`，
//      只切换“最近的 .Dropdown”，并关闭同一 Modal 里的其它已打开下拉；
//   2) 在 Dropdown 根上阻止冒泡，避免外层误触发。
// - 其它你已有的 1.8 兼容与空值守护保持不变。

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
    this.getInput().icon = Stream(this.model.icon());

    this.deleteChatTitleInput = Stream('');
    this.deleteState = 0;

    const chatId = this.model.id();

    // 仅把“有 pivot 且未 removed”的用户视为当前成员
    const alive = (u) => {
      const p = u && u.chat_pivot && u.chat_pivot(chatId);
      return !!(p && !p.removed_at?.());
    };

    this.initialUsers = (this.model.users() || []).filter(alive);
    this.setSelectedUsers((this.model.users() || []).filter(alive));
    this.edited = {};

    // 我是否已加入：pivot 存在 且 未 removed
    const me = app.session.user;
    const mePivot = me && me.chat_pivot ? me.chat_pivot(chatId) : null;
    this.isLocalLeaved = !(mePivot && !mePivot.removed_at?.());

    this.isLocalModerator = this.isModer(me);
  }

  oncreate(vnode) {
    super.oncreate(vnode);

    // === 修复：拦截成员下拉按钮，只切换“当前这一条” ===
    this.__dropdownFixHandler = (e) => {
      const btn = e.target && e.target.closest('.Button--mention-edit');
      if (!btn || !btn.isConnected) return;

      // 仅当前这一条
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();

      const modal = btn.closest('.Modal') || document;
      const currentDropdown = btn.closest('.Dropdown');

      // 关闭同一 Modal 内其它已打开的下拉
      modal.querySelectorAll('.Dropdown.open').forEach((d) => {
        if (d !== currentDropdown) d.classList.remove('open');
      });

      // 切换“当前这一条”
      if (currentDropdown) currentDropdown.classList.toggle('open');
    };

    // 捕获阶段抢先处理，避免外层监听误触发
    document.addEventListener('click', this.__dropdownFixHandler, true);
  }

  onremove() {
    // 卸载监听，防止内存泄漏
    if (this.__dropdownFixHandler) {
      document.removeEventListener('click', this.__dropdownFixHandler, true);
      this.__dropdownFixHandler = null;
    }
    super.onremove();
  }

  // 工具：列表里是否有同 id 用户
  listHasUserById(list, user) {
    if (!user) return false;
    const id = user.id?.();
    return (list || []).some((u) => u && u.id && u.id() === id);
  }

  title() {
    return app.translator.trans('xelson-chat.forum.chat.edit_modal.title');
  }

  onsubmit() {
    const byId = (arr) =>
      arr.map((mdl) => (mdl ? Model.getIdentifier(mdl) : null)).filter(Boolean);

    const added = byId(
      this.getSelectedUsers().filter((u) => !this.listHasUserById(this.initialUsers, u))
    );
    const removed = byId(
      this.initialUsers.filter((u) => !this.listHasUserById(this.getSelectedUsers(), u))
    );
    const edited = Object.keys(this.edited).map(
      (k) => (this.edited[k] = { id: k, ...this.edited[k] })
    );

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

  // 取某用户在本会话中的“基准角色”（无 pivot => 0）
  roleOf(user) {
    if (!user) return 0;
    const override = this.edited[user.id?.()]?.role;
    if (typeof override === 'number') return override;

    const p = user.chat_pivot && user.chat_pivot(this.model.id?.());
    return p && p.role ? p.role() || 0 : 0;
  }

  isModer(user) {
    if (!user) return false;
    if (this.roleOf(user) > 0) return true;
    return this.isCreator(user);
  }

  isCreator(user) {
    const p = user && user.chat_pivot && user.chat_pivot(this.model.id?.());
    // 2 = 创建者；若无 pivot，退回到是否站点管理员
    return (
      (p && p.role && p.role() == 2) ||
      (!this.model.creator?.() &&
        user.groups?.() &&
        user.groups().some((g) => g.id?.() == Group.ADMINISTRATOR_ID))
    );
  }

  userMentionClassname(user) {
    return classList({
      editable: true,
      moder: this.isModer(user),
      creator: this.isCreator(user),
    });
  }

  userMentionDropdownOnclick(user, button) {
    switch (button) {
      case 'moder': {
        if (this.isModer(user)) this.edited[user.id?.()] = { role: 0 };
        else this.edited[user.id?.()] = { role: 1 };
        break;
      }
      case 'kick': {
        const idx = this.getSelectedUsers().findIndex(
          (u) => u && u.id && u.id() === user.id?.()
        );
        if (idx >= 0) this.getSelectedUsers().splice(idx, 1);
        break;
      }
    }
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
        // 阻止事件冒泡，避免外层监听误触发
        onclick={(e) => e.stopPropagation()}
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
    // 包一层容器，未来若需要“点整块可开”时，可在此容器上精确定向
    return (
      <span className="UserMentionItem">
        {'@' + user.displayName()}
        {this.isLocalModerator && !app.chat.isChatPM(this.model)
          ? this.componentUserMentionDropdown(user)
          : null}
      </span>
    );
  }

  // 若外部仍有“整块点击打开下拉”的历史代码，请确保它调用的是本方法，
  // 且仅作用于当前这一条（此处已经避免全局触发）。
  userMentionOnClick(user, e) {
    e.stopPropagation();
    const root = e.currentTarget || e.target.closest('.UserMentionItem') || e.target;
    const btn = root && root.querySelector('.Button--mention-edit');
    if (!btn) return;

    const modal = btn.closest('.Modal') || document;
    const currentDropdown = btn.closest('.Dropdown');

    modal.querySelectorAll('.Dropdown.open').forEach((d) => {
      if (d !== currentDropdown) d.classList.remove('open');
    });
    if (currentDropdown) currentDropdown.classList.toggle('open');
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
    return [<label><h2>{this.model.title()}</h2></label>, this.componentUsersMentions()];
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
          this.componentFormUsersSelect(
            'xelson-chat.forum.chat.edit_modal.form.users.edit'
          ),
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
    if (this.model.type?.()) return this.componentFormChannel();
    if (app.chat.isChatPM(this.model)) return this.componentFormPM();
    return this.componentFormChat();
  }

  componentFormButtons() {
    const buttons = [];

    if (this.isLocalModerator && !app.chat.isChatPM(this.model)) {
      buttons.push(
        <Button
          className="Button Button--primary Button--block ButtonSave"
          onclick={this.onsubmit.bind(this)}
          disabled={this.model.type?.() ? !this.isCanEditChannel() : !this.isCanEditChat()}
        >
          {app.translator.trans('xelson-chat.forum.chat.edit_modal.save_button')}
        </Button>
      );
    }

    // ✅ 根据 isLocalLeaved 决定是“加入”还是“退出”
    buttons.push(
      <Button
        className="Button Button--primary Button--block ButtonLeave"
        onclick={this.onleave.bind(this)}
      >
        {app.translator.trans(
          `xelson-chat.forum.chat.edit_modal.form.${this.isLocalLeaved ? 'return' : 'leave'}`
        )}
      </Button>
    );

    if (!app.chat.isChatPM(this.model) && app.chat.getPermissions().create.channel) {
      buttons.push(this.componentDeleteChat());
    }

    return buttons;
  }

  onleave() {
    const me = app.session.user;
    if (!me) return;

    if (!this.isLocalLeaved) {
      // 已加入 -> 退出
      this.model
        .save({
          users: { removed: [Model.getIdentifier(me)] },
          relationships: { users: this.getSelectedUsers() },
        })
        .then(() => m.redraw());
    } else {
      // 未加入 -> 加入
      this.getSelectedUsers().push(me);
      this.model
        .save({
          users: { added: [Model.getIdentifier(me)] },
          relationships: { users: this.getSelectedUsers() },
        })
        .then(() => m.redraw());
    }
    this.hide();
  }

  isCanEditChannel() {
    return this.getInput().title()?.length;
  }
  isCanEditChat() {
    return !this.alertText();
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
