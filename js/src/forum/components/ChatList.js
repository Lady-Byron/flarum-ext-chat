// js/src/forum/components/ChatList.js
// [CHANGED] 为外层 <div> 添加 key，避免 DOM 复用导致预览项错位
// [CHANGED] 统一 1.8 导入路径；保留你原有逻辑（受控输入/移动端判定/开关列表）

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
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

        <div className="list">
          {this.content()}
          {app.session.user && app.chat.getPermissions().create.chat ? (
            <div className="panel-add" onclick={() => app.modal.show(ChatCreateModal)}></div>
          ) : null}
        </div>
      </div>
    );
  }

  content() {
    return app.chat.getChatsSortedByLastUpdate().map((model) => (
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
