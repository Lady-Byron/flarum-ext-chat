// js/src/forum/components/ChatSearchUser.js
// 兼容修复：给 Search Source 自动补上 isCached(query)（以及缺省 results: Map）
// - 不污染全站搜索：改用传入的 this.attrs.state（getValue/setValue/getInitialSearch）
// - 仅当 canSearchUsers !== false 时启用用户搜索

import app from 'flarum/forum/app';
import Search from 'flarum/common/components/Search';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import ItemList from 'flarum/common/utils/ItemList';
import classList from 'flarum/common/utils/classList';
import icon from 'flarum/common/helpers/icon';

import UsersSearchSource from './UsersSearchResults';

// —— 给任意 source 打补丁：确保有 results 与 isCached(query) —— //
function withCacheShim(source) {
  // results：核心实现通常是 Map<string, any[]>；若不存在就给个 Map
  if (!source.results) {
    try {
      source.results = new Map();
    } catch {
      source.results = {}; // 极端兜底
    }
  }

  // isCached：返回当前 query 是否已有结果
  if (typeof source.isCached !== 'function') {
    source.isCached = (query) => {
      const q = String(query ?? '');
      const r = source.results;

      // Map 情况
      if (r && typeof r.has === 'function') return r.has(q);
      if (r && typeof r.get === 'function') return r.get(q) !== undefined;

      // 普通对象兜底
      return !!(r && r[q]);
    };
  }

  return source;
}

export default class ChatSearchUser extends Search {
  oninit(vnode) {
    super.oninit(vnode);

    // 使用传入的 state；若未传入，给一个最小实现，避免读写报错
    this.state =
      this.attrs.state ??
      {
        getValue: () => '',
        setValue: () => {},
        getInitialSearch: () => '',
      };

    this._sources = null; // 懒加载一次
  }

  // 只在首次使用时构建，且对 source 打补丁
  buildSources() {
    const items = new ItemList();

    // 仅当 canSearchUsers !== false 时开启用户搜索
    const can = app.forum.attribute('canSearchUsers');
    if (can !== false) {
      items.add('users', withCacheShim(new UsersSearchSource({ state: this.state })));
    }

    this._sources = items.toArray();
  }

  // 兼容 Search 基类
  updateMaxHeight() {}

  clear() {
    this.state.setValue?.('');
  }

  view() {
    // 同步初始值（只在空时灌入一次）
    const currentSearch = this.state.getInitialSearch?.() || '';
    if (!this.state.getValue?.()?.length) {
      this.state.setValue?.(currentSearch || '');
    }

    if (!this._sources) this.buildSources();
    if (!this._sources.length) return <div></div>;

    return (
      <div
        className={
          'Search ' +
          classList({
            open: this.hasFocus,
            active: !!this.state.getValue?.(),
            loading: !!this.loadingSources,
          })
        }
      >
        <div className="Search-input SearchInput">
          <input
            className="FormControl"
            type="search"
            placeholder={app.translator.trans(
              'xelson-chat.forum.chat.list.add_modal.search.placeholder'
            )}
            value={this.state.getValue?.()}
            oninput={(e) => this.state.setValue?.(e.target.value)}
            onfocus={() => (this.hasFocus = true)}
          />
          {this.loadingSources ? (
            <LoadingIndicator size="tiny" className="Button Button--icon Button--link" />
          ) : this.state.getValue?.() ? (
            <button
              className="Search-clear Button Button--icon Button--link"
              onclick={this.clear.bind(this)}
            >
              {icon('fas fa-times-circle')}
            </button>
          ) : (
            ''
          )}
        </div>

        {this.state.getValue?.() && this.hasFocus ? (
          <ul className="Dropdown-menu Dropdown--Users Search-results">
            {this._sources.map((source) => source.view(this.state.getValue?.()))}
          </ul>
        ) : null}
      </div>
    );
  }
}
