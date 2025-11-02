// js/src/forum/components/ChatModal.js
// [FIX] 1.8 路径 & 导入 app；独立 neonchat 搜索状态，避免污染全站搜索
// [FIX] 若 app.search 尚未初始化则创建空对象，避免直接写入抛错
// [CHANGED] 关闭时使用 delete 清理 neonchat 状态

import app from 'flarum/forum/app';
import Modal from 'flarum/common/components/Modal';
import Stream from 'flarum/common/utils/Stream';
import classList from 'flarum/common/utils/classList';
import highlight from 'flarum/common/helpers/highlight';

import ChatSearchUser from './ChatSearchUser';
import { fa5IconsList } from '../resources';

export default class ChatModal extends Modal {
  oninit(vnode) {
    super.oninit(vnode);

    this.model = this.attrs.model;

    // [FIX] 确保 app.search 存在
    if (!app.search) app.search = {};

    // 独立的 Chat 搜索状态，避免影响全站搜索
    app.search.neonchat = {
      usersSelected: [],
      _value: Stream(''),
      getValue() {
        return this._value();
      },
      setValue(v) {
        this._value(String(v ?? ''));
      },
      getInitialSearch() {
        return '';
      },
    };
    this.usersSelected = app.search.neonchat.usersSelected;

    app.chat.saveFrameState('beingShown', false);

    this.input = {
      title: Stream(''),
      color: Stream(''),
      icon: Stream(''),
      iconState: {
        matches: [],
        lastInput: null,
      },
    };

    // 初始化焦点状态
    this.inputIconHasFocus = false;
  }

  hide() {
    super.hide();
    app.chat.saveFrameState('beingShown', true);
  }

  onremove(vnode) {
    super.onremove(vnode);
    // [CHANGED] 更干净的清理
    if (app.search && 'neonchat' in app.search) delete app.search.neonchat;
  }

  getInput() {
    return this.input;
  }

  setSelectedUsers(users) {
    app.search.neonchat.usersSelected = users;
    this.usersSelected = app.search.neonchat.usersSelected;
  }

  getSelectedUsers() {
    return this.usersSelected;
  }

  className() {
    return 'ChatModal Modal--small';
  }

  isChatExists() {
    return (
      this.getSelectedUsers().length === 1 &&
      app.chat.isExistsPMChat(app.session.user, this.getSelectedUsers()[0])
    );
  }

  alertText() {
    if (this.isChatExists())
      return app.translator.trans('xelson-chat.forum.chat.list.add_modal.alerts.exists');

    return null;
  }

  componentAlert() {
    return !this.alertText() ? null : <div className="Alert">{this.alertText()}</div>;
  }

  componentFormUsersSelect(label = 'xelson-chat.forum.chat.list.add_modal.form.users') {
    return [<label>{app.translator.trans(label)}</label>, this.componentUsersSelect()];
  }

  userMentionContent(user) {
    return '@' + user.displayName();
  }

  userMentionClassname(user) {
    return 'deletable';
  }

  userMentionOnClick(event, user) {
    return this.getSelectedUsers().splice(this.getSelectedUsers().indexOf(user), 1);
  }

  componentUsersMentions() {
    return (
      <div className="UsersTags">
        {this.getSelectedUsers().map((u) => (
          <div
            key={u.id ? u.id() : Math.random()}
            className={classList(['UserMention', this.userMentionClassname(u)])}
            onclick={this.userMentionOnClick.bind(this, null, u)}
          >
            {this.userMentionContent(u)}
          </div>
        ))}
      </div>
    );
  }

  componentUsersSelect() {
    return [
      this.componentAlert(),
      this.componentUsersMentions(),
      <div className="UsersSearch">
        {/* 改为使用独立的 neonchat state */}
        <ChatSearchUser state={app.search.neonchat} />
      </div>,
    ];
  }

  componentFormIcon(options) {
    return [
      options.title ? <label>{options.title}</label> : null,
      <div className="IconSearch">
        {options.desc ? <label>{options.desc}</label> : null}
        <div className="Icon-Input IconSearchResult">
          <input
            className="FormControl"
            type="text"
            bidi={options.stream}
            placeholder={options.placeholder}
            onupdate={this.formInputOnUpdate.bind(this)}
            onfocus={() => (this.inputIconHasFocus = true)}
            onclick={() => (this.inputIconHasFocus = true)}
            onkeypress={(e) => (this.inputIconHasFocus = !(e.keyCode == 13))}
          />
          <icon
            className="Chat-FullColor"
            style={{ color: this.input.color(), backgroundColor: this.input.color() }}
          >
            <i className={this.input.icon()?.length ? this.input.icon() : 'fas fa-bolt'} />
          </icon>
          {this.inputIconHasFocus ? this.dropdownIconMatches(this.input.icon()) : null}
        </div>
      </div>,
    ];
  }

  componentFormColor(options) {
    return [
      options.title ? <label>{options.title}</label> : null,
      <div>
        {options.desc ? <label>{options.desc}</label> : null}
        <div className="Color-Input">
          <input
            className="FormControl"
            type="text"
            bidi={options.stream}
            placeholder={options.placeholder}
            onupdate={this.formInputOnUpdate.bind(this)}
          />
          <color
            className="Chat-FullColor"
            style={{ color: this.input.color(), backgroundColor: this.input.color() }}
          />
        </div>
      </div>,
    ];
  }

  dropdownIconMatches(search) {
    const inputIcon = this.input.icon();
    const iconState = this.input.iconState;

    if (inputIcon !== iconState.lastInput) {
      iconState.matches = fa5IconsList.filter((icon) => icon.includes(inputIcon));
      if (iconState.matches.length > 5)
        iconState.matches = iconState.matches.sort(() => 0.5 - Math.random());

      iconState.lastInput = inputIcon;
    }

    return inputIcon.length &&
      iconState.matches.length > 0 &&
      !(iconState.matches.length == 1 && iconState.matches[0] === inputIcon) ? (
      <ul className="Dropdown-menu Dropdown--Icons Search-results">
        <li className="Dropdown-header">Font Awesome 5</li>
        {iconState.matches.slice(-5).map((icon) => (
          <li
            key={icon}
            className="IconSearchResult"
            onclick={() => this.input.icon(icon)}
          >
            <icon className="Chat-FullColor">
              <i className={icon}></i>
            </icon>
            <span>{highlight(icon, inputIcon)}</span>
          </li>
        ))}
      </ul>
    ) : null;
  }

  formInputOnUpdate() {
    // 安全使用 jQuery（首选 this.$，兜底 window.$）
    const jq = this.$ ? this.$('.Chat-FullColor') : (window.$ && window.$('.Chat-FullColor'));
    if (jq) jq.css({ color: this.input.color(), backgroundColor: this.input.color() });
  }

  componentFormInput(options) {
    return [
      options.title ? <label>{options.title}</label> : null,
      <div>
        {options.desc ? <label>{options.desc}</label> : null}
        <input
          className="FormControl"
          type="text"
          bidi={options.stream}
          placeholder={options.placeholder}
        />
      </div>,
    ];
  }
}
