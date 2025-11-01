// js/src/forum/components/ChatAvatar.js
// [CHANGED] Imports to flarum/common/*; add null guards in firstLetter()

import Component from 'flarum/common/Component';            // [CHANGED]
import classList from 'flarum/common/utils/classList';       // [CHANGED]

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
          'background-color': this.model.color && this.model.color(),
          color: this.model.textColor && this.model.textColor(),
          'background-image': avatar ? `url(${avatar})` : null,
        }}
      >
        {this.model.icon && this.model.icon() ? (
          <i class={this.model.icon()}></i>
        ) : avatar ? null : (
          this.firstLetter((this.model.title && this.model.title()) || '').toUpperCase()
        )}
      </div>
    );
  }

  componentAvatarChannel() {
    return (
      <div
        className="avatar"
        style={{
          'background-color': this.model.color && this.model.color(),
          color: this.model.textColor && this.model.textColor(),
        }}
      >
        {this.model.icon && this.model.icon() ? (
          <i class={this.model.icon()}></i>
        ) : this.model.avatarUrl && this.model.avatarUrl() ? null : (
          this.firstLetter((this.model.title && this.model.title()) || '').toUpperCase()
        )}
      </div>
    );
  }

  view() {
    return (this.model.type && this.model.type()) == 1 ? this.componentAvatarChannel() : this.componentAvatarPM();
  }

  firstLetter(str) {                        // [CHANGED] null guard
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
