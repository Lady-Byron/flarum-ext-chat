// js/src/forum/addChatPage.js
import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import IndexPage from 'flarum/forum/components/IndexPage';
import LinkButton from 'flarum/common/components/LinkButton';
import ChatPage from './components/ChatPage';

export default function addChatPage() {
  // 与后端 extend.php 的 route key 'chat' 对应
  app.routes.chat = { path: '/chat', component: ChatPage };

  // 移动端在首页导航露出入口
  extend(IndexPage.prototype, 'navItems', function (items) {
    // 若你有更严格的判断可换为 window.matchMedia
    if (app.screen() !== 'phone') return;

    items.add(
      'chat',
      <LinkButton icon="fas fa-comment" href={app.route('chat')}>
        {app.translator.trans('xelson-chat.forum.index.chat_link')}
      </LinkButton>,
      -10
    );
  });
}
