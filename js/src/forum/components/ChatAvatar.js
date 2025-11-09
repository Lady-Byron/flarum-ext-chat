// js/src/forum/components/ChatAvatar.js
import Component from 'flarum/common/Component';
import classList from 'flarum/common/utils/classList';

export default class ChatAvatar extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.model = this.attrs.model;
  }

  componentAvatarPM() {
    const avatar = this.model.avatarUrl && this.model.avatarUrl();
    return (
      <div
        className={classList({ avatar: true, image: !!avatar })}
        style={{
          backgroundColor: this.model.color && this.model.color(),
          color: this.model.textColor && this.model.textColor(),
          backgroundImage: avatar ? `url(${avatar})` : undefined,
        }}
      >
        {this.model.icon && this.model.icon() ? (
          <i className={this.model.icon()}></i>
        ) : avatar ? null : (
          (this.firstLetter((this.model.title && this.model.title()) || '') || '').toUpperCase()
        )}
      </div>
    );
  }

  componentAvatarChannel() {
    const avatar = this.model.avatarUrl && this.model.avatarUrl();
    return (
      <div
        className="avatar"
        style={{
          backgroundColor: this.model.color && this.model.color(),
          color: this.model.textColor && this.model.textColor(),
          backgroundImage: avatar ? `url(${avatar})` : undefined,
        }}
      >
        {this.model.icon && this.model.icon() ? (
          <i className={this.model.icon()}></i>
        ) : avatar ? null : (
          (this.firstLetter((this.model.title && this.model.title()) || '') || '').toUpperCase()
        )}
      </div>
    );
  }

  view() {
    return (this.model.type && this.model.type()) == 1
      ? this.componentAvatarChannel()
      : this.componentAvatarPM();
  }

  firstLetter(str) {
    if (!str) return '';
    for (let i = 0; i < str.length; i++) {
      if (this.isLetter(str[i])) return str[i];
    }
    return str[0] || '';
  }

  isLetter(c) {
    return c && c.toLowerCase() != c.toUpperCase();
  }
}


