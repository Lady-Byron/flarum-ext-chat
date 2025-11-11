// js/src/forum/components/ChatEditModal.js
// 修正要点：
// 1) 成员“下拉只开当前一条”不再阻断 Dropdown 自己的点击逻辑：
//    - 捕获阶段仅关闭其它已开的下拉，不阻止事件传播；让当前 Dropdown 正常处理“打开/关闭”
// 2) isModer / isCreator 在“我已退出”时一律判定为 false，避免已退成员还能看到管理按钮
// 3) onsubmit 的 relationships.users 改为 JSON:API 资源标识符数组，避免前端 store 差异
// 4) 其它 1.8 兼容与空值守护保持不变

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

    // —— 修复“只开当前一条”：捕获阶段仅关闭其它 open，下拉本身的开关交给 Dropdown 组件处理 ——
    this.__dropdownFixHandler = (e) => {
      const btn = e.target && e.target.closest('.Button--mention-edit');
      if (!btn || !btn.isConnected) return;

      const modal = btn.closest('.Modal') || document;
      const currentDropdown = btn.closest('.Dropdown');

      // 关闭同一 Modal 内其它已打开的下拉
      modal.querySelectorAll('.Dropdown.open').forEach((d) => {
        if (d !== currentDropdown) d.classList.remove('open');
      });

      // 不调用 preventDefault / stopPropagation：
      // 让 Dropdown 内部的点击逻辑正常运行，从而正确维护其内部状态
    };

    document.addEventListener('click', this.__dropdownFixHandler, true);
  }

  onremove() {
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
      // 🔧 关系用 JSON:API 标识符，避免不同 Store 实现的兼容性问题
      relationships: { users: { data: byId(this.getSelectedUsers()) } },
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
    // 🚫 我已退出时不具备本地管理身份
    if (this.isLocalLeaved) return false;
    if (this.roleOf(user) > 0) return true;
    return this.isCreator(user);
  }

  isCreator(user) {
    if (!user) return false;
    const p = user && user.chat_pivot && user.chat_pivot(this.model.id?.());
    // 🚫 退出后不能再作为“创建者”获得前端管理权限
    if (p && p.removed_at?.()) return false;

    // 2 = 创建者；若模型没有记录 creator，则站点管理员视为具备
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
        // 仍然阻止冒泡，避免外层误触发，但不影响我们在 document 捕获阶段做的“关闭其它下拉”
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
    return (
      <span className="UserMentionItem">
        {'@' + user.displayName()}
        {this.isLocalModerator && !app.chat.isChatPM(this.model)
          ? this.componentUserMentionDropdown(user)
          : null}
      </span>
    );
  }

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
          relationships: { users: { data: this.getSelectedUsers().map(Model.getIdentifier) } },
        })
        .then(() => m.redraw());
    } else {
      // 未加入 -> 加入
      if (!this.listHasUserById(this.getSelectedUsers(), me)) {
        this.getSelectedUsers().push(me);
      }
      this.model
        .save({
          users: { added: [Model.getIdentifier(me)] },
          relationships: { users: { data: this.getSelectedUsers().map(Model.getIdentifier) } },
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
