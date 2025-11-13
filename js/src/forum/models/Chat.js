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
  removed_by: Model.attribute('removed_by'), // <-- 我们需要这个属性

  // -------------------------------------------------------------------
  // +++ (已修正) 权限辅助函数 +++
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
   * 是否为当前会话的 *活跃* 成员
   * (供 ChatList.js 使用)
   * @returns {boolean}
   */
  isMember() {
    return this.joined_at() && !this.removed_at();
  },

  /**
   * 是否 *可以* 访问内容（读/写）
   * (供 ChatViewport.js 使用)
   * @returns {boolean}
   */
  canAccessContent() {
    if (this._isAdmin()) return true;
    return this.isMember();
  },

  /**
   * 是否 *可以* 加入 (或 重新加入)
   *
   * [!!! 最终修复 !!!]
   * 新增了“被踢”检查。
   * @returns {boolean}
   */
  canJoin() {
    // 1. 已经是成员了，不能加入
    if (this.isMember()) return false;
    
    // 2. 管理员总是可以（虽然他们不需要，因为 canAccessContent 总是 true）
    if (this._isAdmin()) return true;

    // 3. 检查是否“被踢”
    const me = app.session.user;
    const wasKicked = this.removed_at() && this.removed_by() && me && this.removed_by() != me.id();

    if (wasKicked) {
        // 如果你被踢了，你永远不能通过这个按钮重新加入
        return false;
    }

    // 4. 如果没被踢：
    
    // 4a. 如果是公共频道，任何人都可以加入（包括首次加入或自愿离开后回归）
    if (this.isPublic()) {
        return true;
    }

    // 4b. 如果是私聊/群聊：
    const didLeave = this.removed_at() && this.removed_by() && me && this.removed_by() == me.id();
    
    // 只有“自愿离开”的人才能“复归”
    // (新用户必须被邀请，不能主动加入私聊)
    return didLeave;
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
