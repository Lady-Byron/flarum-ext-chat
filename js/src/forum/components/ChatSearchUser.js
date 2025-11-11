// 兼容修复：给 Search Source 自动补上 isCached(query)（以及缺省 results: Map）
// - 不污染全站搜索：改用传入的 this.attrs.state（getValue/setValue/getInitialSearch）
// - 仅当 canSearchUsers !== false 时启用用户搜索
// - 汇聚子 source 的 searching → 在输入框上显示 Loading
// - 失焦/点击外部自动收起下拉

import app from 'flarum/forum/app';
import Search from 'flarum/common/components/Search';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import ItemList from 'flarum/common/utils/ItemList';
import classList from 'flarum/common/utils/classList';
import icon from 'flarum/common/helpers/icon';

import UsersSearchSource from './UsersSearchResults';

function withCacheShim(source) {
  if (!source.results) {
    try { source.results = new Map(); } catch { source.results = {}; }
  }
  if (typeof source.isCached !== 'function') {
    source.isCached = (query) => {
      const q = String(query ?? '');
      const r = source.results;
      if (r && typeof r.has === 'function') return r.has(q);
      if (r && typeof r.get === 'function') return r.get(q) !== undefined;
      return !!(r && r[q]);
    };
  }
  return source;
}

export default class ChatSearchUser extends Search {
  oninit(vnode) {
    super.oninit(vnode);

    this.state =
      this.attrs.state ?? {
        getValue: () => '',
        setValue: () => {},
        getInitialSearch: () => '',
      };

    this._sources = null;   // 懒构建
    this.hasFocus = false;  // 控制下拉显隐
  }

  oncreate(vnode) {
    super.oncreate(vnode);
    // 点击外部收起
    this.__clickAway = (e) => {
      if (!this.element) return;
      if (!this.element.contains(e.target)) {
        this.hasFocus = false;
        m.redraw();
      }
    };
    document.addEventListener('click', this.__clickAway, true);
  }

  onremove() {
    if (this.__clickAway) {
      document.removeEventListener('click', this.__clickAway, true);
      this.__clickAway = null;
    }
    super.onremove();
  }

  buildSources() {
    const items = new ItemList();
    const can = app.forum.attribute('canSearchUsers');
    if (can !== false) {
      items.add('users', withCacheShim(new UsersSearchSource({ state: this.state })));
    }
    this._sources = items.toArray();
  }

  clear() {
    this.state.setValue?.('');
  }

  // 聚合所有 source 的 searching 状态
  get loadingSources() {
    if (!this._sources) return false;
    return this._sources.some((s) => !!s.searching);
  }

  view() {
    // 初始化默认值
    const currentSearch = this.state.getInitialSearch?.() || '';
    if (!this.state.getValue?.()?.length) {
      this.state.setValue?.(currentSearch || '');
    }

    if (!this._sources) this.buildSources();
    if (!this._sources.length) return <div></div>;

    const val = this.state.getValue?.() || '';

    return (
      <div
        className={
          'Search ' +
          classList({
            open: this.hasFocus,
            active: !!val,
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
            value={val}
            oninput={(e) => this.state.setValue?.(e.target.value)}
            onfocus={() => (this.hasFocus = true)}
            onblur={() => setTimeout(() => { this.hasFocus = false; m.redraw(); }, 100)} // 留点时间给 click
          />
          {this.loadingSources ? (
            <LoadingIndicator size="tiny" className="Button Button--icon Button--link" />
          ) : val ? (
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

        {val && this.hasFocus ? (
          <ul className="Dropdown-menu Dropdown--Users Search-results">
            {this._sources.map((source) => source.view(val))}
          </ul>
        ) : null}
      </div>
    );
  }
}

