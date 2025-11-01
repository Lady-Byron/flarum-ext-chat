// js/src/forum/models/Message.js  （完整替换版）

import app from 'flarum/forum/app';
import Model from 'flarum/common/Model';

export default class Message extends Model {}

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

  // 关键：根据是否存在决定调用的端点
  apiEndpoint() {
    const base = `${app.forum.attribute('apiUrl')}/chatmessages`;

    // 已存在 -> /chatmessages/{message_id}
    if (this.exists) return `${base}/${this.id()}`;

    // 新建 -> /chatmessages/{chat_id}
    const relChat = typeof this.chat === 'function' ? this.chat() : null;
    const chatId =
      relChat?.id?.() ??
      this.data?.attributes?.chat_id ??
      this.data?.relationships?.chat?.data?.id;

    if (!chatId) {
      // 没拿到 chat_id 就退回集合端点（一般会 404），便于排查
      // 你也可以改成 throw Error 中断
      console.warn('[xelson-chat] Missing chat_id when creating message; fallback POST /chatmessages (will likely 404).');
      return base;
    }

    return `${base}/${chatId}`;
  },
});
