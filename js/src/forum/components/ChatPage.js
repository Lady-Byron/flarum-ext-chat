// js/src/forum/components/ChatPage.js
// [FIX] 1.8 路径 & 导入 app；更稳地解绑 window 事件
// [CHANGED] 用“实例化的 IndexPage”来安全调用 sidebarItems（满足扩展对 this 的实例预期）
// [CHANGED] 兜底改为顶层 import 的 ItemList（ESM 下不使用 require）
// [OPT] 懒缓存 IndexPage 实例（避免每次 view() 都 new；可去掉，不影响功能）

import app from 'flarum/forum/app';
import Page from 'flarum/common/components/Page';
import IndexPage from 'flarum/forum/components/IndexPage';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import listItems from 'flarum/common/helpers/listItems';
import ItemList from 'flarum/common/utils/ItemList'; // [FIX] 顶层 import 以适配 ESM
import Stream from 'flarum/common/utils/Stream';

import ChatHeader from './ChatHeader';
import ChatList from './ChatList';
import ChatViewport from './ChatViewport';

export default class ChatPage extends Page {
  oninit(vnode) {
    super.oninit(vnode);

    this.bodyClass = 'App--chat';
    this.listOpen = Stream(false);

    // [OPT] 懒缓存 IndexPage 实例（也可不提前创建，view 里按需创建）
    this._idx = null;
  }

  view() {
    // [CHANGED] 安全获取侧边栏：用实例来调用 sidebarItems，满足扩展对 this 的实例依赖
    let navItems;
    try {
      if (!this._idx) this._idx = new IndexPage(); // [OPT] 懒创建
      // 注意：不显式调用 _idx.oninit()；sidebarItems 通常仅依赖 app/session
      navItems = this._idx.sidebarItems();
    } catch {
      // [FIX] ESM 兜底：直接 new ItemList，而不是 require(...)
      navItems = new ItemList();
    }

    // 与原逻辑一致：可选移除论坛统计挂件
    if (navItems.has('forumStatisticsWidget')) navItems.remove('forumStatisticsWidget');

    return (
      <div className="ChatPage">
        <nav className="IndexPage-nav sideNav">
          <ul>{listItems(navItems.toArray())}</ul>
        </nav>

        <ChatHeader showChatListStream={this.listOpen} />

        {app.chat.chatsLoading ? (
          <LoadingIndicator />
        ) : (
          <ChatViewport chatModel={app.chat.getCurrentChat()} />
        )}

        {this.listOpen() ? (
          <div className="ChatPage--list">
            <ChatList inPage={true} />
          </div>
        ) : (
          ''
        )}
      </div>
    );
  }

  oncreate(vnode) {
    super.oncreate(vnode);

    // 不依赖 jQuery 的事件绑定；用于点击空白收起列表
    this._winClick = (e) => {
      const chatList = this.$('.ChatList')[0];
      if (this.listOpen() && !(chatList && chatList.contains(e.target))) {
        this.listOpen(false);
        m.redraw();
      }
    };

    window.addEventListener('click', this._winClick, true);
  }

  onupdate(vnode) {
    super.onupdate(vnode);
    if (this.listOpen()) {
      const panel = this.element.querySelector('.ChatPage--list');
      if (panel) {
        panel.style.height =
          document.documentElement.clientHeight - panel.getBoundingClientRect().top + 'px';
      }
    }
  }

  onremove(vnode) {
    super.onremove(vnode);
    if (this._winClick) {
      window.removeEventListener('click', this._winClick, true);
      this._winClick = null;
    }
  }
}
