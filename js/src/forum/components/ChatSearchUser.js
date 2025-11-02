// js/src/forum/components/ChatSearchUser.js
// [FIX] 1.8 路径 & 导入 app；使用传入的独立 state；不污染全站搜索
// [CHANGED] sourceItems() 使用 this.state 而不是 app.search.neonchat
// [CHANGED] canSearchUsers 判定更稳：仅当 attribute 明确为 false 时禁用
// [FIX] clear() 安全调用 this.state.setValue
// 其余维持与 core Search API 一致

import app from 'flarum/forum/app';
import Search from 'flarum/common/components/Search';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import ItemList from 'flarum/common/utils/ItemList';
import classList from 'flarum/common/utils/classList';
import icon from 'flarum/common/helpers/icon';

import UsersSearchSource from './UsersSearchResults';

export default class ChatSearchUser extends Search {
  oninit(vnode) {
    super.oninit(vnode);
    // [FIX] 确保使用传入的独立 state，而不是全局 app.search
    this.state =
      this.attrs.state ?? {
        getValue: () => '',
        setValue: () => {},
        getInitialSearch: () => '',
      };
  }

  sourceItems() {
    const items = new ItemList();
    // [CHANGED] 仅在明确为 false 时禁用用户搜索；未设置时默认允许
    const can = app.forum.attribute('canSearchUsers');
    if (can !== false) {
      // [CHANGED] 用 this.state 传入 UsersSearchSource
      items.add('users', new UsersSearchSource({ state: this.state }));
    }
    return items;
  }

  // Search 基类需要，但本组件不动态限制高度
  updateMaxHeight() {}

  clear() {
    // [FIX] 防御式调用
    this.state.setValue?.('');
  }

  view() {
    const currentSearch = this.state.getInitialSearch?.() || '';

    if (!this.state.getValue?.()?.length) {
      this.state.setValue?.(currentSearch || '');
    }

    if (!this.sources) {
      this.sources = this.sourceItems().toArray();
    }

    if (!this.sources.length) return <div></div>;

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
            {this.sources.map((source) => source.view(this.state.getValue?.()))}
          </ul>
        ) : null}
      </div>
    );
  }
}
