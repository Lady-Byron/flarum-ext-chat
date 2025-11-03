// js/src/forum/components/ChatWelcome.js
// [FIX] 1.8 路径：import app/Component 改为 flarum/forum|common/*
// [HARDEN] transform 缺省兜底为 {y: 400}；app.chat 为空时也能安全渲染
// [ENH] 为 wrapper 增加更明确的类名 ChatWelcome-wrapper，避免与全局选择器混淆
// [ENH] 限制最小高度 200px，避免过度拥挤（最终高度 = (max(y,200) + 40)px）

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';

export default class ChatWelcome extends Component {
  view() {
    const transform = (app.chat && app.chat.getFrameState('transform')) || { y: 400 };
    const heightPx = (Math.max(transform?.y ?? 400, 200) + 40) + 'px'; // [ENH]

    return (
      <div>
        {/* [ENH] 额外类名，避免选择器误伤 ChatViewport 的 wrapper */}
        <div className="wrapper ChatWelcome-wrapper" style={{ height: heightPx }}>
          {app.chat && app.chat.getChats().length ? (
            <div className="welcome">
              <h1>{app.translator.trans('xelson-chat.forum.chat.welcome.header')}</h1>
              <span>{app.translator.trans('xelson-chat.forum.chat.welcome.subheader')}</span>
            </div>
          ) : null}
        </div>
      </div>
    );
  }
}
