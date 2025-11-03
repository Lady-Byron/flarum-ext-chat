// js/src/forum/components/UsersSearchResults.js
// [FIX] 1.8 路径：avatar/username/highlight/extractText/LoadingIndicator → flarum/common/*
// [FIX] class → className；为 <li> 添加 key
// [FIX] “加载中”时实际返回 LoadingIndicator
// [CHANGED] 结果缓存按小写 query 存取，和 view() 的 toLowerCase 对齐
// [CHANGED] 去重/比较/过滤一律按 id 判断（避免实例不一致导致误判）
// [CHANGED] “更多结果”节点为 <li>，保持 <ul> 结构完整；截断取前 5 项
// [ENH] view() 在无缓存且未搜索时主动触发 this.search(q) 兜底
// [HARDEN] 搜索失败也要重置 searching（finally 统一收敛）
// [ENH] 设置 searching=true 后立即 m.redraw()，立刻显示 Loading 指示
// [FIX] 高亮用户名：username() → vnode；先 extractText() 再 highlight()

import app from 'flarum/forum/app';
import avatar from 'flarum/common/helpers/avatar';
import username from 'flarum/common/helpers/username';
import highlight from 'flarum/common/helpers/highlight';
import extractText from 'flarum/common/utils/extractText'; // [FIX]
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';

export default class UsersSearchResults {
  constructor(props) {
    this.results = {};       // { [lower_q]: UserModel[] }
    this.searching = false;

    if (!props.state.usersSelected) props.state.usersSelected = [];
    this.usersSelected = props.state.usersSelected;
  }

  // ---- helpers -------------------------------------------------------------

  idOf(user) {
    if (!user) return '';
    const id =
      (typeof user.id === 'function' ? user.id() : user.id) ??
      (user?.data?.id ?? null);
    return String(id ?? '');
  }

  isUserSelected(user) {
    const uid = this.idOf(user);
    return this.usersSelected.some((u) => this.idOf(u) === uid);
  }

  toggleUser(user) {
    const uid = this.idOf(user);
    const idx = this.usersSelected.findIndex((u) => this.idOf(u) === uid);
    if (idx === -1) this.usersSelected.push(user);
    else this.usersSelected.splice(idx, 1);
  }

  // ---- search API ----------------------------------------------------------

  search(query) {
    const q = String(query || '').toLowerCase();

    this.searching = true;
    m.redraw(); // 立刻显示 loading

    return app.store
      .find('users', {
        filter: { q },
        page: { limit: 5 },
      })
      .then((results) => {
        this.results[q] = results || [];
      })
      .finally(() => {
        this.searching = false;
        m.redraw();
      });
  }

  // ---- view (render items into <ul>) --------------------------------------

  view(query) {
    const q = String(query || '').toLowerCase();

    // 若无缓存且未在请求中，主动触发一次搜索（兜底）
    if (q && !this.searching && !this.results[q]) {
      this.search(q);
    }

    const meId = this.idOf(app.session.user);

    const fromCache = this.results[q] || [];
    const fromAll = app
      .store
      .all('users')
      .filter((user) => {
        const uname = (user.username?.() || '').toLowerCase();
        const dname = (user.displayName?.() || '').toLowerCase();
        return uname.startsWith(q) || dname.startsWith(q) || uname.includes(q) || dname.includes(q);
      });

    // 合并 & 按 id 去重
    const merged = fromCache.concat(fromAll);
    const uniqById = merged.filter(
      (u, i, arr) => arr.findIndex((x) => this.idOf(x) === this.idOf(u)) === i
    );

    // 过滤掉 “自己” 与 “已选用户”
    let resultsFind = uniqById
      .filter((u) => this.idOf(u) !== meId)
      .filter((u) => !this.isUserSelected(u))
      .sort((a, b) => (a.displayName?.() || '').localeCompare(b.displayName?.() || ''));

    // 计算“更多结果”
    let moreText = null;
    if (resultsFind.length > 5) {
      const extra = resultsFind.length - 5;
      resultsFind = resultsFind.slice(0, 5);
      moreText = (
        <li className="MoreResultsText">
          {app.translator.trans('xelson-chat.forum.chat.list.add_modal.search.more_results', {
            more_results: extra,
          })}
        </li>
      );
    }

    // 空结果：展示 Loading 或 “未找到”
    if (!resultsFind.length) {
      return this.searching ? (
        <li className="LoadingResults">
          <LoadingIndicator size="tiny" className="Button Button--icon Button--link" />
        </li>
      ) : (
        <li className="SearchFailed">
          {app.translator.trans('xelson-chat.forum.chat.list.add_modal.search.failed')}
        </li>
      );
    }

    const resultsSelected = Object.values(this.usersSelected).slice(-5);

    return [
      <li className="Dropdown-header">
        {app.translator.trans('core.forum.search.users_heading')}
      </li>,

      // 搜索结果（未选）
      resultsFind.map((user) => {
        const id = this.idOf(user);
        // [FIX] 先取纯文本，再高亮
        const plain = extractText(username(user));
        const highlighted = highlight(plain, q);

        return (
          <li
            key={'users-' + id}
            className="UserSearchResult"
            data-index={'users' + id}
            onclick={this.toggleUser.bind(this, user)}
          >
            <span>
              {avatar(user)}
              <span className="username">{highlighted}</span> {/* [FIX] 自建文本节点承载高亮 */}
            </span>
          </li>
        );
      }),

      moreText,

      // 已邀请（已选）
      resultsSelected.length ? (
        <li className="Dropdown-header">
          {app.translator.trans('xelson-chat.forum.chat.list.add_modal.search.invited')}
        </li>
      ) : null,

      resultsSelected.map((user) => {
        const id = this.idOf(user);
        // [FIX] 选中区同样使用 extractText + highlight，保持一致
        const plain = extractText(username(user));
        const highlighted = highlight(plain, q);

        return (
          <li
            key={'invited-' + id}
            className="UserSearchResult"
            data-index={'users' + id}
            onclick={this.toggleUser.bind(this, user)}
          >
            <span className="selected">
              {avatar(user)}
              <span className="username">{highlighted}</span>
            </span>
          </li>
        );
      }),
    ];
  }
}


