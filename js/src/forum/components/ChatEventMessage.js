// js/src/forum/components/ChatEventMessage.js
// [CHANGED] Import paths -> flarum/common/*

import app from 'flarum/forum/app';
import ChatMessage from './ChatMessage';
import Link from 'flarum/common/components/Link';             // [CHANGED]
import extractText from 'flarum/common/utils/extractText';    // [CHANGED]
import humanTime from 'flarum/common/helpers/humanTime';      // [CHANGED]
import fullTime from 'flarum/common/helpers/fullTime';        // [CHANGED]

export default class ChatEventMessage extends ChatMessage {
  oninit(vnode) {
    super.oninit(vnode);

    const raw = this.model.message && this.model.message();
    if (raw && raw.split('').every((c) => c === '*')) this.parsedContent = { id: 'chatCensored' };
    else this.parsedContent = raw ? JSON.parse(raw) : { id: 'chatCensored' };
  }

  componentUserMention(user) {
    return (
      <Link href={app.route.user(user)}>
        <span className="UserMention">{user.displayName()}</span>
      </Link>
    );
  }

  componentUserMentionsByIds(ids) {
    return (ids || []).map((id) => this.componentUserMention(app.store.getById('users', id)));
  }

  componentEventText() {
    switch (this.parsedContent.id) {
      case 'chatCensored': {
        return (
          <div className="censored" title={app.translator.trans('xelson-chat.forum.chat.message.censored')}>
            {this.model.message && this.model.message()}
          </div>
        );
      }
      case 'chatCreated': {
        if (!this.model.chat || !this.model.chat()) return;

        if (this.model.chat().type() == 1) {
          return app.translator.trans(`xelson-chat.forum.chat.message.events.channel.created`, {
            creatorname: this.componentUserMention(this.model.user()),
            chatname: <b className="chat-title">{this.model.chat().title()}</b>,
          });
        } else {
          if (this.model.chat().type() == 0 && this.model.chat().users().length <= 2) {
            return app.translator.trans(`xelson-chat.forum.chat.message.events.pm.created`, {
              creatorname: this.componentUserMention(this.model.chat().creator()),
              username: (this.parsedContent.users || []).length
                ? this.componentUserMention(app.store.getById('users', this.parsedContent.users[0]))
                : null,
            });
          }

          return app.translator.trans(`xelson-chat.forum.chat.message.events.chat.created`, {
            creatorname: this.componentUserMention(this.model.user()),
            chatname: <b className="chat-title">{this.model.chat().title()}</b>,
            usernames: this.componentUserMentionsByIds(this.parsedContent.users || []),
            username: (this.parsedContent.users || []).length
              ? this.componentUserMention(app.store.getById('users', this.parsedContent.users[0]))
              : null,
          });
        }
      }
      case 'chatEdited': {
        let componentOld, componentNew;
        switch (this.parsedContent.column) {
          case 'title':
            componentOld = <b className="chat-title">{this.parsedContent.old}</b>;
            componentNew = <b className="chat-title">{this.parsedContent.new}</b>;
            break;

          case 'color':
            componentOld = <i className="fas fa-circle" style={{ color: this.parsedContent.old }}></i>;
            componentNew = <i className="fas fa-circle" style={{ color: this.parsedContent.new }}></i>;
            break;

          case 'icon':
            componentOld = this.parsedContent.old ? <i className={this.parsedContent.old}></i> : <b>[nothing]</b>;
            componentNew = <i className={this.parsedContent.new}></i>;
            break;
        }

        return app.translator.trans(`xelson-chat.forum.chat.message.events.${this.parsedContent.column}.edited`, {
          editorname: this.componentUserMention(this.model.user()),
          old: componentOld,
          new: componentNew,
        });
      }
      case 'chatAddRemoveUser': {
        const add = this.parsedContent.add || [];
        const remove = this.parsedContent.remove || [];
        if (add.length && remove.length) {
          return app.translator.trans('xelson-chat.forum.chat.message.events.users.invited_kicked', {
            editorname: this.componentUserMention(this.model.user()),
            invitednames: this.componentUserMentionsByIds(add),
            kickednames: this.componentUserMentionsByIds(remove),
          });
        } else if (add.length) {
          if (String(add[0]) == String(this.model.user().id())) {
            return app.translator.trans('xelson-chat.forum.chat.message.events.self.entered', {
              username: this.componentUserMention(this.model.user()),
            });
          } else {
            return app.translator.trans('xelson-chat.forum.chat.message.events.users.invited', {
              editorname: this.componentUserMention(this.model.user()),
              usernames: this.componentUserMentionsByIds(add),
            });
          }
        } else if (remove.length) {
          if (String(remove[0]) == String(this.model.user().id())) {
            return app.translator.trans('xelson-chat.forum.chat.message.events.self.leaved', {
              username: this.componentUserMention(this.model.user()),
            });
          } else {
            return app.translator.trans('xelson-chat.forum.chat.message.events.users.kicked', {
              editorname: this.componentUserMention(this.model.user()),
              usernames: this.componentUserMentionsByIds(remove),
            });
          }
        }
      }
    }
  }

  content() {
    return (
      <div className="event">
        {this.componentEventText()}
        <a className="timestamp" title={extractText(fullTime(this.model.created_at()))}>
          {(this.humanTime = humanTime(this.model.created_at()))}
        </a>
      </div>
    );
  }
}
