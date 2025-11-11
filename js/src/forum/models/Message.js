// js/src/forum/models/Message.js
//
// 回到原始通路：新建 => POST /chatmessages（集合端点，body.attributes 里带 chat_id）
// 已存在 => /chatmessages/{id}（用于 PATCH/DELETE）
// 其它属性/关系保持不变

import Model from 'flarum/common/Model';

export default class Message extends Model {
  apiEndpoint() {
    const type = 'chatmessages';

    // 已存在：/chatmessages/{id}
    const id =
      (typeof this.id === 'function' ? this.id() : this.data?.id) || null;
    if (this.exists && id) return `/${type}/${id}`;

    // 新建：集合端点（chat_id 通过 body.attributes 提交）
    return `/${type}`;
  }
}

Object.assign(Message.prototype, {
  message: Model.attribute('message'),
  user: Model.hasOne('user'),
  deleted_by: Model.hasOne('deleted_by'),
  chat: Model.hasOne('chat'),
  created_at: Model.attribute('created_at', Model.transformDate),
  edited_at: Model.attribute('edited_at', Model.transformDate),
  type: Model.attribute('type'),
  is_readed: Model.attribute('is_readed'),
  ip_address: Model.attribute('ip_address'),
  is_censored: Model.attribute('is_censored'),
});
