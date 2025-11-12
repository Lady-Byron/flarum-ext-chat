// js/src/forum/models/Chat.js

// [CHANGED] 空值守护、未读兜底、用户身份用 id() 比较、computed 依赖调整
import Model from 'flarum/common/Model';
import computed from 'flarum/common/utils/computed';
import app from 'flarum/forum/app';

export default class Chat extends Model {}

Object.assign(Chat.prototype, {
  _title: Model.attribute('title'),
  _color: Model.attribute('color'),
  type: Model.attribute('type'),
  created_at: Model.attribute('created_at', Model.transformDate),
  creator: Model.hasOne('creator'),
  users: Model.hasMany('users'),
  first_message: Model.hasOne('first_message'),
  last_message: Model.hasOne('last_message'),
  icon: Model.attribute('icon'),

  role: Model.attribute('role'),
  // [CHANGED] 避免 NaN
  unreaded: Model.attribute('unreaded', (v) => Math.max(parseInt(v ?? 0, 10) || 0, 0)),
  readed_at: Model.attribute('readed_at', Model.transformDate),
  removed_at: Model.attribute('removed_at', Model.transformDate),
  joined_at: Model.attribute('joined_at', Model.transformDate),
  removed_by: Model.attribute('removed_by'),

  // -------------------------------------------------------------------
  // +++ 新增：权限辅助函数 +++
  // -------------------------------------------------------------------

  /**
   * 是否为管理员
   * @private
   */
  _isAdmin() {
    return app.session.user && app.session.user.isAdmin();
  },

  /**
   * 是否为公共频道
   * @returns {boolean}
   */
  isPublic() {
    return this.type() === 1;
  },

  /**
   * 是否为当前会话的 *活跃* 成员 (或管理员)
   * (这是 ChatUserSerializer 注入的 *当前用户* 的 pivot 状态)
   * @returns {boolean}
   */
  isMember() {
    // 管理员始终被视为成员
    if (this._isAdmin()) return true;

    // 必须有 joined_at 且 *没有* removed_at
    // (注意：这里的 joined_at, removed_at 是从 ChatUserSerializer 序列化来的
    // 它们代表 *当前 actor* 在这个会话中的 pivot 状态)
    return this.joined_at() && !this.removed_at();
  },

  /**
   * 是否 *可以* 访问内容（读/写）
   * @returns {boolean}
   */
  canAccessContent() {
    // 根据我们的需求，公共频道也必须加入才能访问，因此 isMember() 是唯一标准
    return this.isMember();
  },

  /**
   * 是否 *可以* 加入 (或 重新加入)
   * @returns {boolean}
   */
  canJoin() {
    // 已经是成员，不能加入
    if (this.isMember()) return false; 
    
    // 1. 如果是公共频道，总可以加入
    // 2. 如果是私聊/群聊，只有在 (removed_at 存在) = "曾经是成员" 的情况下，才允许重新加入
    //    (注意：'removed_at' 是您自己的 pivot 状态)
    return this.isPublic() || this.removed_at();
  },

  // -------------------------------------------------------------------
  // --- 保持不变的计算属性 ---
  // -------------------------------------------------------------------

  // [CHANGED] 以 users/type 作为依赖，可靠触发
  pm_user: computed('users', 'type', function () {
    return this.getPMUser();
  }),

  title: computed('pm_user', '_title', function (pm_user, _title) {
    return pm_user ? pm_user.displayName() : _title;
  }),

  color: computed('pm_user', '_color', function (pm_user, _color) {
    return pm_user ? pm_user.color() : _color;
  }),

  avatarUrl: computed('pm_user', function (pm_user) {
    return pm_user ? pm_user.avatarUrl() : null;
  }),

  textColor: computed('color', function (color) {
    return this.pickTextColorBasedOnBgColorSimple(color, '#FFF', '#000');
  }),

  matches(q) {
    const t = (this.title() || '').toLowerCase();
    const needle = (q || '').toLowerCase();
    return (
      (!!needle && t.includes(needle)) ||
      (this.users?.() || []).some((u) => (u?.displayName?.() || '').toLowerCase().includes(needle))
    );
  },

  getPMUser() {
    const users = this.users?.() || [];
    if (app.session.user && this.type() === 0 && users.length && users.length < 3) {
      const myId = app.session.user.id?.();
      for (const user of users) {
        if (user && user.id?.() !== myId) return user;
      }
    }
    return null;
  },

  pickTextColorBasedOnBgColorSimple(bgColor, lightColor, darkColor) {
    const color = bgColor?.charAt(0) === '#' ? bgColor.substring(1, 7) : bgColor;
    if (!color || color.length < 6) return lightColor;

    const r = parseInt(color.substring(0, 2), 16);
    const g = parseInt(color.substring(2, 4), 16);
    const b = parseInt(color.substring(4, 6), 16);
    return r * 0.299 + g * 0.587 + b * 0.114 > 186 ? darkColor : lightColor;
  },
});
