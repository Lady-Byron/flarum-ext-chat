// js/src/forum/addChatPage.js
import { extend } from 'flarum/common/extend';
import app from 'flarum/forum/app';
import IndexPage from 'flarum/forum/components/IndexPage';
import LinkButton from 'flarum/common/components/LinkButton';
import ChatPage from './components/ChatPage';

// [CHANGED] 进入此模块就兜底注册一次路由（幂等）
(function ensureRoute() {
  try {
    app.routes.chat = app.routes.chat || { path: '/chat', component: ChatPage };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[xelson-chat] route fallback failed:', e);
  }
})();

export default function addChatPage() {
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
