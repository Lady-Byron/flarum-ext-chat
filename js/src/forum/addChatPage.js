// js/src/forum/addChatPage.js

// [CHANGED] 统一 1.8 导入路径，并移除未文档化的 app.screen()
import { extend } from 'flarum/common/extend';
import app from 'flarum/forum/app';
import IndexPage from 'flarum/forum/components/IndexPage';
import LinkButton from 'flarum/common/components/LinkButton';
import ChatPage from './components/ChatPage';

export default function addChatPage() {
  app.routes.chat = { path: '/chat', component: ChatPage };

  extend(IndexPage.prototype, 'navItems', function (items) {
    // [CHANGED] 使用媒体查询判定手机视口
    const isPhone =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(max-width: 768px)').matches;
    if (!isPhone) return;

    items.add(
      'chat',
      <LinkButton icon="fas fa-comment" href={app.route('chat')}>
        {app.translator.trans('xelson-chat.forum.index.chat_link')}
      </LinkButton>,
      -10
    );
  });
}
