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

  // —— 小工具：把 User 模型数组 → 资源标识符数组 [{type:'users', id:'…'}]
  toIdentifiers(models) {
    return (models || [])
      .filter(Boolean)
      .map((u) => Model.getIdentifier(u));
  }

  // —— 小工具：取已选用户（去空）
  selectedUsers() {
    return (this.getSelectedUsers() || []).filter(Boolean);
  }

  // —— 复归已存在的 PM（自己曾退出）
  rejoinExistingChat(existingChat) {
    const me = app.session.user;
    const meId = me?.id?.();
    if (!meId) return;

    existingChat.save({
      attributes: {
        users: { added: [String(meId)] } // 纯 id 字符串数组
      }
    }).then(() => {
      app.chat.addChat(existingChat);
      app.chat.onChatChanged(existingChat);
      app.alerts.show({ type: 'success' },
        app.translator.trans('xelson-chat.forum.chat.rejoin.success')
      );
      m.redraw();
    }).catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Error rejoining chat:', error);
      const item = app.chat.getChats().find((c) => c?.id?.() === existingChat.id?.());
      if (item) {
        app.chat.onChatChanged(item);
        app.alerts.show({ type: 'success' },
          app.translator.trans('xelson-chat.forum.chat.rejoin.opened')
        );
      } else {
        app.alerts.show({ type: 'error' },
          app.translator.trans('xelson-chat.forum.chat.rejoin.failed')
        );
      }
      m.redraw();
    });

    this.hide();
  }

  onsubmit() {
    const selected = this.selectedUsers();

    // 单人选择 → PM 快捷路径（先找是否已有/是否我曾退出）
    if (!this.isChannel && selected.length === 1) {
      const otherUser = selected[0];

      const activePM = app.chat.findExistingPMChat(app.session.user, otherUser);
      if (activePM) {
        app.chat.onChatChanged(activePM);
        this.hide();
        m.redraw();
        return;
      }

      const leftPM = app.chat.findAnyPMChatIncludingLeft(app.session.user, otherUser);
      if (leftPM && leftPM.removed_at && leftPM.removed_at()) {
        this.rejoinExistingChat(leftPM);
        return;
      }
    }

    this.createNewChat(selected);
  }

  // —— 真正“新建”路径（POST /api/chats）
  createNewChat(passedSelected) {
    const title = (this.getInput().title() || '').trim();
    const icon  = (this.getInput().icon()  || '').trim();
    const color = (this.getInput().color() || '').trim();

    const selected = (passedSelected || this.selectedUsers());
    const me = app.session.user;
    const participants = (!this.isChannel ? [...selected, me].filter(Boolean) : []);

    // 组装 JSON:API data
    const data = {
      type: 'chats',
      attributes: {
        type: this.isChannel ? 1 : 0,   // 0=私聊/群聊, 1=频道
        title,
        icon,
        color
      }
    };

    // 私聊/群聊必须携带 relationships.users.data；频道不要带 users
    if (!this.isChannel) {
      data.relationships = {
        users: {
          data: this.toIdentifiers(participants)
        }
      };
    }

    const body = { data };
    // 仅调试：确认你真正发出去的 JSON
    console.debug('[neon] create payload', body);

    app.store
      .createRecord('chats')
      .save(body) // 直接传 JSON:API data；Flarum Model 会原样打包
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
          app.alerts.show({ type: 'error' },
            app.translator.trans('xelson-chat.forum.chat.create.exists')
          );
        } else {
          app.alerts.show({ type: 'error' },
            app.translator.trans('xelson-chat.forum.chat.create.failed')
          );
        }
      });

    this.hide();
  }

  // —— UI 下面维持不变 —— //
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
