// js/src/forum/components/ChatList.js
// [CHANGED] 为外层 <div> 添加 key，避免 DOM 复用导致预览项错位
// [CHANGED] 统一 1.8 导入路径；保留你原有逻辑（受控输入/移动端判定/开关列表）
//
// [!!! 关键修复 2025/11/12 !!!]
// 移除了 'Button' 和 'ButtonGroup' 的 imports，这两个导入在 ChatList 中导致了
// "selector must be a string or a component" 和 "reading 'onbeforeupdate'" 的级联错误。
//
// `componentFilters()` 已被重构，使用与 ChatCreateModal 相同的
// 'div.ChatType' 和 'div.Tab' 样式，不再依赖外部组件。

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
// --- (已删除 'Button' 和 'ButtonGroup' imports) ---
import classList from 'flarum/common/utils/classList'; // +++ 新增 Import

import ChatCreateModal from './ChatCreateModal';
import ChatPreview from './ChatPreview';

export default class ChatList extends Component {
  isPhone() {
    return typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(max-width: 768px)').matches;
  }

  view() {
    const classes = ['ChatList'];
    if (app.chat.getFrameState('beingShownChatsList') || this.attrs.inPage) classes.push('toggled');

    return (
      <div className={classes.join(' ')}>
        <div className="header">
          <div className="input-wrapper input--down">
            <input
              id="chat-find"
              value={app.chat.q()}
              oninput={(e) => app.chat.q(e.target.value)}
              placeholder={app.translator.trans('xelson-chat.forum.chat.list.placeholder')}
            />
          </div>

          <div
            className="icon icon-minimize"
            onclick={this.toggleChat.bind(this)}
            data-title={app.translator.trans(
              'xelson-chat.forum.toolbar.' + (app.chat.getFrameState('beingShown') ? 'minimize' : 'maximize')
            )}
          >
            <i className={app.chat.getFrameState('beingShown') ? 'fas fa-window-minimize' : 'fas fa-window-maximize'} />
          </div>

          {this.attrs.inPage ? (
            ''
          ) : (
            <div
              className="ToggleButton icon icon-toggle"
              onclick={this.toggleChatsList.bind(this)}
              data-title={app.translator.trans(
                'xelson-chat.forum.chat.list.' + (app.chat.getFrameState('beingShownChatsList') ? 'unpin' : 'pin')
              )}
            >
              <i className="fas fa-paperclip" />
            </div>
          )}
        </div>

        {/* +++ 过滤器 UI (已重构) +++ */}
        {this.componentFilters()}

        <div className="list">
          {this.content()}
          {app.session.user && app.chat.getPermissions().create.chat ? (
            <div className="panel-add" onclick={() => app.modal.show(ChatCreateModal)}></div>
          ) : null}
        </div>
      </div>
    );
  }

  // +++ 重构：过滤器组件 (不使用 Button/ButtonGroup) +++
  componentFilters() {
    // 这依赖于我们在 ChatState 中添加的 Stream
    if (!app.chat || typeof app.chat.filterMode !== 'function') return null;

    const currentFilter = app.chat.filterMode();

    return (
      <div className="ChatList-filters">
        {/* 使用 ChatCreateModal 中的 .ChatType 样式 */}
        <div className="ChatType">
          <div
            className={classList({ 'Tab Tab--left': true, 'Tab--active': currentFilter === 'ALL' })}
            onclick={() => app.chat.filterMode('ALL')}
            title={app.translator.trans('xelson-chat.forum.chat.list.filters.all')}
          >
             <i className="fas fa-comments" />
          </div>
          <div
            className={classList({ Tab: true, 'Tab--active': currentFilter === 'PM' })}
            onclick={() => app.chat.filterMode('PM')}
            title={app.translator.trans('xelson-chat.forum.chat.list.filters.pm')}
          >
             <i className="fas fa-user" />
          </div>
          <div
            className={classList({ Tab: true, 'Tab--active': currentFilter === 'GROUP' })}
            onclick={() => app.chat.filterMode('GROUP')}
            title={app.translator.trans('xelson-chat.forum.chat.list.filters.group')}
          >
             <i className="fas fa-users" />
          </div>
          <div
            className={classList({ 'Tab Tab--right': true, 'Tab--active': currentFilter === 'PUBLIC' })}
            onclick={() => app.chat.filterMode('PUBLIC')}
            title={app.translator.trans('xelson-chat.forum.chat.list.filters.public')}
          >
             <i className="fas fa-hashtag" />
          </div>
        </div>

        {/* 管理员视图开关 */}
        {app.session.user && app.session.user.isAdmin() ? (
          <div
            className={'ChatList-adminView ' + (app.chat.adminView() ? 'active' : '')}
            onclick={() => app.chat.adminView(!app.chat.adminView())}
            title={app.translator.trans('xelson-chat.forum.chat.list.filters.admin_view')}
          >
             <i className={app.chat.adminView() ? 'fas fa-eye' : 'fas fa-eye-slash'} />
          </div>
        ) : null}
      </div>
    );
  }

  // +++ 重构：核心过滤逻辑 (保持不变) +++
  content() {
    // 这依赖于我们在 ChatState 中添加的 Stream
    if (!app.chat || typeof app.chat.filterMode !== 'function') {
        return app.chat.getChatsSortedByLastUpdate().map((model) => (
            <div key={model.id()} onclick={this.onChatPreviewClicked.bind(this, model)}>
              <ChatPreview model={model} />
            </div>
        ));
    }

    const q = app.chat.q().toLowerCase(); // 搜索词
    const filterMode = app.chat.filterMode(); // 'ALL', 'PM', 'GROUP', 'PUBLIC'
    const adminView = app.chat.adminView() && app.session.user.isAdmin(); // 管理员视图是否开启

    // 我们从 ChatState 获取“全量”列表
    const chats = app.chat.getChatsSortedByLastUpdate(); 

    const filteredChats = chats.filter(model => {
      if (!model || !model.users || !model.type) return false;

      // --- 步骤 1：类别过滤 ---
      const userCount = (model.users() || []).length;
      const isPM = model.type() === 0 && userCount <= 2;
      const isGroup = model.type() === 0 && userCount > 2;
      const isPublic = model.type() === 1;

      if (filterMode === 'PM' && !isPM) return false;
      if (filterMode === 'GROUP' && !isGroup) return false;
      if (filterMode === 'PUBLIC' && !isPublic) return false;
      // (filterMode === 'ALL' 则通过所有)

      // --- 步骤 2：搜索/可见性 过滤 ---
      
      // 场景 A：用户正在搜索 (q 有值)
      if (q) {
        // 允许搜索。这会搜索*该类别*下的所有聊天，
        // 包括已退出的（因为 model.matches() 不检查 isMember()）
        // 这就是“搜索复归”逻辑！
        return model.matches(q);
      }
      
      // 场景 B：用户没有搜索 (q 为空，正常列表视图)
      
      // B1: 管理员视图开启
      if (adminView) {
        // 管理员：显示该类别的所有聊天
        return true; 
      }
      
      // B2: 普通用户视图
      // (我们依赖 Chat.js 中 model.isMember() 的管理员绕行)
      // 普通用户：只显示“活跃成员”或“公共”
      // 管理员 (adminView=false)：也应用此规则，只看自己相关的
      return model.isMember() || model.isPublic();
    });

    return filteredChats.map((model) => (
      // [CHANGED] 把 key 放在外层 div，避免 DOM 复用错位
      <div key={model.id()} onclick={this.onChatPreviewClicked.bind(this, model)}>
        <ChatPreview model={model} />
      </div>
    ));
  }

  onChatPreviewClicked(model, e) {
    e.redraw = false;
    if (this.isPhone()) app.chat.toggleChatsList();
    app.chat.onChatChanged(model);
  }

  toggleChatsList(e) {
    app.chat.toggleChatsList();
    e.preventDefault();
    e.stopPropagation();
  }

  toggleChat(e) {
    app.chat.toggleChat();
    e.preventDefault();
    e.stopPropagation();
  }
}
