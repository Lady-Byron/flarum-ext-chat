// js/src/forum/components/ChatMessage.js
// [FIX] 让 .actualMessage 成为“空容器”，其 children 只由 renderChatMessage 管理，避免与 Mithril VDOM 冲突
// [FIX] 使用 this.$（或 window.$ 兜底）代替裸 $，避免第三方覆盖全局 $ 时闪烁失败
// [CHANGED] 去掉 100ms 轮询，改为 oncreate 首次渲染 + onupdate 驱动
// [CHANGED] 新增左右排布：给每条消息添加 mine/others 标记（自己在右，其他人在左）
// [KEEP] 其余保持你现有的 1.8 兼容改造（id 比较/空值守护/导入路径）

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import avatar from 'flarum/common/helpers/avatar';
import username from 'flarum/common/helpers/username';
import fullTime from 'flarum/common/helpers/fullTime';
import classList from 'flarum/common/utils/classList';
import humanTime from 'flarum/common/helpers/humanTime';
import extractText from 'flarum/common/utils/extractText';
import ItemList from 'flarum/common/utils/ItemList';
import SubtreeRetainer from 'flarum/common/utils/SubtreeRetainer';

import Dropdown from 'flarum/common/components/Dropdown';
import Button from 'flarum/common/components/Button';
import Separator from 'flarum/common/components/Separator';
import Link from 'flarum/common/components/Link';

export default class ChatMessage extends Component {
  oninit(vnode) {
    super.oninit(vnode);

    this.labels = [];
    this.model = this.attrs.model;
    if (!this.model.content) this.model.content = this.model.message();

    this.initLabels();

    this.subtree = new SubtreeRetainer(
      () => this.model.freshness,
      () => this.model.user?.()?.freshness,
      () => app.chat.getCurrentChat(),
      // reactive attrs
      () => this.model.content,
      () => this.model.isDeletedForever,
      () => this.model.isTimedOut,
      () => this.model.isEditing,
      () => this.model.isNeedToFlash
    );
  }

  // [ADDED] 是否“我自己”的消息（用于左右排布）
  isMine() {
    const meId = app.session.user?.id?.();
    const authorId = this.model.user?.()?.id?.();
    return meId && authorId && String(meId) === String(authorId);
  }

  modelEvent(name) {
    const viewportState = app.chat.getViewportState(this.model.chat());
    viewportState?.onChatMessageClicked?.(name, this.model);
    app.chat.onChatMessageClicked(name, this.model);
  }

  onbeforeupdate(vnode) {
    super.onbeforeupdate(vnode);
    this.model = this.attrs.model;
    return this.subtree.needsRebuild();
  }

  content() {
    // [CHANGED] 外层增加 message-row + mine/others，用于左右排布
    return (
      <div className={'message-row ' + (this.isMine() ? 'mine' : 'others')}>
        {this.model.user() ? (
          <Link className="avatar-wrapper" href={app.route.user(this.model.user())}>
            <span>{avatar(this.model.user(), { className: 'avatar' })}</span>
          </Link>
        ) : (
          <div className="avatar-wrapper">
            <span>{avatar(this.model.user(), { className: 'avatar' })}</span>
          </div>
        )}

        <div className="message-block">
          <div className="toolbar">
            <a className="name" onclick={this.modelEvent.bind(this, 'insertMention')}>
              {extractText(username(this.model.user())) + ': '}
            </a>

            <div className="labels">
              {this.labels.map((label) => (label.condition() ? label.component() : null))}
            </div>

            <div className="right">
              {this.model.id()
                ? [
                    this.model.isDeletedForever ? null : this.editDropDown(),
                    <a className="timestamp" title={extractText(fullTime(this.model.created_at()))}>
                      {(this.humanTime = humanTime(this.model.created_at()))}
                    </a>,
                  ]
                : this.model.isTimedOut
                ? this.editDropDownTimedOut()
                : null}
            </div>
          </div>

          <div className="message">
            {this.model.is_censored() ? (
              <div
                className="censored actualMessage"
                title={app.translator.trans('xelson-chat.forum.chat.message.censored')}
              >
                {this.model.content}
              </div>
            ) : (
              // ⚠️ 核心点：不要在 VDOM 中给 actualMessage 放文本子节点
              <div
                className="actualMessage"
                oncreate={this.onContentWrapperCreated.bind(this)}
                onupdate={this.onContentWrapperUpdated.bind(this)}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  view() {
    return (
      <div
        className={classList({
          'message-wrapper': true,
          hidden: this.model.deleted_by(),
          editing: this.model.isEditing,
          deleted: !this.isVisible(),
        })}
        data-id={this.model.id?.()}
      >
        {this.model ? this.content() : null}
      </div>
    );
  }

  initLabels() {
    this.labelBind(
      () => this.model.edited_at(),
      () => (
        <div
          className="icon"
          title={extractText(
            app.translator.trans('core.forum.post.edited_tooltip', {
              user: this.model.user(),
              ago: humanTime(this.model.edited_at()),
            })
          )}
        >
          <i className="fas fa-pencil-alt" />
        </div>
      )
    );

    this.labelBind(
      () => this.model.deleted_by(),
      () => (
        <div className="icon">
          <i className="fas fa-trash-alt" />{' '}
          <span>
            {`(${app.translator.trans('xelson-chat.forum.chat.message.deleted' + (this.model.isDeletedForever ? '_forever' : ''))} `}
            {username(this.model.deleted_by())}
            {')'}
          </span>
        </div>
      )
    );

    this.labelBind(
      () => this.model.isTimedOut,
      () => (
        <div className="icon" style="color: #ff4063">
          <i className="fas fa-exclamation-circle" />
        </div>
      )
    );
  }

  labelBind(condition, component) {
    this.labels.push({ condition, component });
  }

  editDropDown() {
    const items = new ItemList();
    const meId = app.session.user?.id?.();
    const authorId = this.model.user?.()?.id?.();

    if (app.chat.getPermissions().edit && authorId && String(authorId) === String(meId)) {
      items.add(
        'dropdownEditStart',
        <Button
          onclick={this.modelEvent.bind(this, 'dropdownEditStart')}
          icon="fas fa-pencil-alt"
          disabled={this.model.deleted_by() || this.model.isEditing}
        >
          {app.translator.trans('core.forum.post_controls.edit_button')}
        </Button>
      );
    }

    items.add('separator', <Separator />);

    const canSelfDelete = app.chat.getPermissions().delete && authorId && String(authorId) === String(meId);

    if (this.model.chat().role() || canSelfDelete) {
      if (this.model.deleted_by()) {
        const deletedById = this.model.deleted_by()?.id?.();
        const disabled = !app.chat.getPermissions().moderate.delete && String(deletedById) !== String(meId);

        items.add(
          'dropdownRestore',
          <Button
            onclick={this.modelEvent.bind(this, 'dropdownRestore')}
            icon="fas fa-reply"
            disabled={disabled}
          >
            {app.translator.trans('core.forum.post_controls.restore_button')}
          </Button>
        );
      } else {
        items.add(
          'dropdownHide',
          <Button onclick={this.modelEvent.bind(this, 'dropdownHide')} icon="fas fa-trash-alt" disabled={this.model.isEditing}>
            {app.translator.trans('core.forum.post_controls.delete_button')}
          </Button>
        );
      }
    }

    if (this.model.chat().role() && (this.model.deleted_by() || app.chat.totalHidden() >= 3)) {
      items.add(
        'dropdownDelete',
        <Button
          onclick={this.modelEvent.bind(this, 'dropdownDelete')}
          icon="fas fa-trash-alt"
          disabled={!app.chat.getPermissions().delete}
        >
          {app.translator.trans('core.forum.post_controls.delete_forever_button')}
        </Button>
      );
    }

    return Object.keys(items.items).length <= 1 ? null : (
      <div className="edit">
        <Dropdown
          buttonClassName="Button Button--icon Button--flat"
          menuClassName="Dropdown-menu Dropdown-menu--top Dropdown-menu--bottom Dropdown-menu--left Dropdown-menu--right"
          icon="fas fa-ellipsis-h"
        >
          {items.toArray()}
        </Dropdown>
      </div>
    );
  }

  editDropDownTimedOut() {
    return (
      <div className="edit">
        <Dropdown
          buttonClassName="Button Button--icon Button--flat"
          menuClassName="Dropdown-menu--top Dropdown-menu--bottom Dropdown-menu--left Dropdown-menu--right"
          icon="fas fa-ellipsis-h"
        >
          <Button onclick={this.modelEvent.bind(this, 'dropdownDelete')} icon="fas fa-trash-alt">
            {app.translator.trans('xelson-chat.forum.chat.message.actions.hide')}
          </Button>
          <Button onclick={this.modelEvent.bind(this, 'dropdownResend')} icon="fas fa-reply">
            {app.translator.trans('xelson-chat.forum.chat.message.actions.resend')}
          </Button>
        </Dropdown>
      </div>
    );
  }

  oncreate(vnode) {
    super.oncreate(vnode);
    this.messageWrapper = vnode.dom;
    // 首次渲染一次
    this.renderMessage();
  }

  onremove(vnode) {
    super.onremove(vnode);
  }

  onContentWrapperCreated(vnode) {
    super.oncreate(vnode);
    this.contentEl = vnode.dom; // 记住 .actualMessage 节点
    this.renderMessage();
  }

  onContentWrapperUpdated(vnode) {
    super.onupdate(vnode);
    this.contentEl = vnode.dom;
    this.renderMessage();
  }

  renderMessage() {
    // 闪烁
    if (this.model.isNeedToFlash && (this.$ || window.$)) {
      const jq = this.$ ? this.$(this.messageWrapper) : window.$(this.messageWrapper);
      app.chat.flashItem(jq);
      this.model.isNeedToFlash = false;
    }

    // 把“元素本身”交给 ChatState，避免它去全局 query 误选父容器
    if (!this.contentEl || !this.contentEl.isConnected) return;

    if (this.model.content !== this.oldContent) {
      this.oldContent = this.model.content;
      app.chat.renderChatMessage(this.contentEl, this.model.content);
    }
  }

  isVisible() {
    if (this.model.chat() != app.chat.getCurrentChat()) return false;
    if (this.model.isDeletedForever) return false;

    const deletedBy = this.model.deleted_by();
    const meId = app.session.user?.id?.();

    if (deletedBy && !(this.model.chat().role() || (deletedBy?.id?.() && String(deletedBy.id()) === String(meId)))) {
      return false;
    }
    return true;
  }
}
