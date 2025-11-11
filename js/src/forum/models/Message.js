// js/src/forum/models/Message.js
//
// [CHANGED] apiEndpoint() 返回“相对路径”，避免与 app.request 的 apiUrl 叠加；
//           创建时命中非常规 POST /chatmessages/{chatId}；更新/删除走 /chatmessages/{id}。
// [UNCHANGED] 其余 attrs/relations 保持不变，兼容 Flarum 1.8。

import Model from 'flarum/common/Model';

export default class Message extends Model {
  apiEndpoint() {
    const type = 'chatmessages';

    // 已存在 -> /chatmessages/{message_id}
    const id = (typeof this.id === 'function' ? this.id() : this.data?.id) || null;
    if (this.exists && id) return `/${type}/${id}`;

    // 新建 -> /chatmessages/{chat_id}
    const relChat = typeof this.chat === 'function' ? this.chat() : null;
    const chatId =
      (relChat && (typeof relChat.id === 'function' ? relChat.id() : relChat.data?.id)) ??
      this.data?.attributes?.chat_id ??
      this.data?.relationships?.chat?.data?.id ??
      null;

    if (!chatId) {
      // 拿不到 chat_id：退回集合端点（便于排查；多数后端会 404）
      // 注：降低到 debug，减少生产环境控制台噪音
      console.debug('[xelson-chat] Missing chat_id when creating message; fallback POST /chatmessages (will likely 404).');
      return `/${type}`;
    }

    return `/${type}/${chatId}`;
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
