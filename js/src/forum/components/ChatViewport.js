// js/src/forum/components/ChatViewport.js
// [FIX] 1.8 路径 & 导入 app
// [CHANGED] 全面改为“按 id 比较（字符串化）”，避免“同 id 不同实例”漏配
// [CHANGED] loadChat(): 基于实际滚动容器计算回滚位置（wrapper / documentElement）
// [FIX] Loader 读取 this.state.loading（原误读 this.state.scroll.loading）
// [CHANGED] getChatWrapper(): 优先返回当前实例的 this.wrapperEl，避免全局选择器误配
// [FIX] 将所有使用 el.offsetHeight / wrapper.offsetHeight 的位置统一改为 clientHeight，
//       以兼容 document.documentElement 作为滚动容器的场景（移动端 ChatPage）
// [FIX] wrapperOnBeforeUpdate(): 使用 this.state.scroll.autoScroll（原误用 this.state.autoScroll）
// [FIX] 小坑 A：checkUnreaded() 查询消息节点限定在当前视口作用域（this.element）
// [FIX] 小坑 B：scrollToAnchor() 用矩形差计算相对位移，兼容 documentElement/.wrapper
// [HARDEN] 加固 1：loadChat() 回滚定位加定时器防抖，切会话频繁不叠加
// [HARDEN] 加固 2：wrapperOnScroll() 缓存本次回调使用的 state，避免切会话竞态
// [FIX] 必改：scrollToBottom 提前 return 时复位 this.scrolling，避免卡死
// [FIX] Mithril keys：为 Loader 添加稳定 key，并以数组形式组装 children，避免“键混用”错误
// [FIX] 临时 key：对消息条目统一计算 key（优先 id()，否则 tempKey，再退回 map index），避免“无 key”乐观消息与“有 key”历史消息混用
// [NEW ✅] 首帧权限闪现修复 1：在 onbeforeupdate 中抢先同步 this.model/this.state，确保 view() 首帧用新会话
// [NEW ✅] 首帧权限闪现修复 2：view() 顶部改用 const model = this.attrs.chatModel || this.model
// [NEW ✅] 未获权限时 loadChat() 立即 m.redraw()，避免短暂渲染输入框

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
// +++ 新增 Import +++
import Button from 'flarum/common/components/Button';

import ChatInput from './ChatInput';
import ChatMessage from './ChatMessage';
import ChatEventMessage from './ChatEventMessage';
import ChatWelcome from './ChatWelcome';
import Message from '../models/Message';
import timedRedraw from '../utils/timedRedraw';
import ChatPage from './ChatPage';

export default class ChatViewport extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.model = this.attrs.chatModel;
    if (this.model) this.state = app.chat.getViewportState(this.model);

    // +++ 新增：用于 "加入" 按钮的 loading 状态 +++
    this.loadingJoin = false;
  }

  // [NEW ✅] 抢先于 view() 同步 this.model/this.state，避免首帧用旧会话造成权限闪现
  onbeforeupdate(vnode, vnodeNew) {
    try {
      const next = vnodeNew.attrs && vnodeNew.attrs.chatModel;
      if (next !== this.model) {
        this.model = next || null;
        this.state = this.model ? app.chat.getViewportState(this.model) : null;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('ChatViewport onbeforeupdate sync error:', e);
    }
    return true;
  }

  oncreate(vnode) {
    super.oncreate(vnode);
    this.loadChat();
  }

  onupdate(vnode) {
    super.onupdate(vnode);
    const model = vnode.attrs.chatModel;

    if (model !== this.model) {
      this.model = model || null;
      this.state = this.model ? app.chat.getViewportState(this.model) : null;
      if (this.model) this.loadChat();
      const jq = this.$ ? this.$('.wrapper') : (window.$ && window.$('.wrapper'));
      if (jq) app.chat.flashItem(jq);
    }
  }

  loadChat() {
    if (!this.state) return;

    // +++ 新增：权限检查 +++
    // 如果用户不能访问内容（model.canAccessContent 内已含管理员绕行），不要加载消息
    if (this.model && !this.model.canAccessContent()) {
      // 标记为已加载，防止后续触发
      this.state.messagesFetched = true;
      // [NEW ✅] 立即重绘，避免短暂显示输入框/空消息容器
      try { m.redraw(); } catch {}
      return;
    }
    // +++ 检查结束 +++

    const oldScroll = Number(this.state.scroll.oldScroll || 0);
    this.reloadMessages();
    m.redraw();

    // [HARDEN] 防抖，避免频繁切会话导致多次定位叠加
    if (this._loadTimer) clearTimeout(this._loadTimer);
    this._loadTimer = setTimeout(() => {
      const chatWrapper = this.getChatWrapper();
      if (
        chatWrapper &&
        Number.isFinite(chatWrapper.scrollHeight) &&
        Number.isFinite(chatWrapper.clientHeight)
      ) {
        const nextTop = Math.max(0, chatWrapper.scrollHeight - chatWrapper.clientHeight - oldScroll);
        chatWrapper.scrollTop = nextTop;
      }
    }, 200);
  }

  view() {
    // [NEW ✅] 首帧直接使用“最新 attrs”里的 chatModel，回退 this.model（双保险）
    const model = this.attrs.chatModel || this.model;

    if (model) {
      // +++ 新增：核心权限 UI 切换 +++
      if (model.canAccessContent()) {
        // --- 场景1：有权访问 (旧逻辑) ---
        // [FIX] children 显式组装为数组（loader + 消息），确保同层级 keyed children 一致
        const children = [
          this.componentLoader(this.state?.loading),
          ...this.componentsChatMessages(model),
        ];

        return (
          <div className="ChatViewport">
            <div
              className="wrapper"
              oncreate={this.wrapperOnCreate.bind(this)}
              onbeforeupdate={this.wrapperOnBeforeUpdate.bind(this)}
              onupdate={this.wrapperOnUpdate.bind(this)}
              onremove={this.wrapperOnRemove.bind(this)}
            >
              {children}
            </div>
            <ChatInput
              state={this.state}
              model={model}
              oninput={() => {
                if (this.nearBottom() && !this.state.messageEditing) {
                  this.scrollToBottom();
                }
              }}
            />
            {this.isFastScrollAvailable() ? this.componentScroller() : null}
          </div>
        );
      } else {
        // --- 场景2：无权访问 (新逻辑) ---
        // (非成员)
        return (
          <div className="ChatViewport ChatViewport--blocked">
            {model.canJoin() ? (
              // 2a: 可以加入 (公共频道 / 已退出的私聊)
              <div className="ChatViewport-join">
                <p>{app.translator.trans('xelson-chat.forum.chat.viewport.must_join_description', { title: model.title() })}</p>
                <Button
                  className="Button Button--primary"
                  icon="fas fa-plus"
                  loading={this.loadingJoin}
                  onclick={this.joinChat.bind(this)}
                >
                  {app.translator.trans('xelson-chat.forum.chat.viewport.join_button')}
                </Button>
              </div>
            ) : (
              // 2b: 无法加入 (无权的私聊)
              <div className="ChatViewport-join">
                <p>{app.translator.trans('xelson-chat.forum.chat.viewport.no_permission_description')}</p>
              </div>
            )}
          </div>
        );
      }
      // +++ 权限检查结束 +++
    }

    // --- 场景3：未选择聊天 (旧逻辑) ---
    return (
      <div className="ChatViewport">
        <ChatWelcome />
      </div>
    );
  }

  // +++ 新增：加入聊天的方法 +++
  joinChat() {
    if (this.loadingJoin) return;
    this.loadingJoin = true;

    app.chat.apiJoinChat(this.model)
      .then(() => {
        this.loadingJoin = false;
        this.loadChat(); // 成功后立即尝试加载消息
        m.redraw();
      })
      .catch((e) => {
        this.loadingJoin = false;
        m.redraw();
        // eslint-disable-next-line no-console
        console.error('[neon-chat] Join chat failed:', e);
        app.alerts.show({ type: 'error' }, e?.response?.errors?.[0]?.detail || app.translator.trans('core.lib.error.generic_with_reason_text'));
      });
  }

  // [FIX] 临时 key：优先使用真实 id()；若尚未分配 id（乐观消息），使用 tempKey；仍无则退回 map index
  componentChatMessage(model, idx) {
    const id = typeof model.id === 'function' ? model.id() : model?.data?.id;
    const key = id ?? model?.tempKey ?? `__idx_${idx}`;
    return model.type()
      ? <ChatEventMessage key={key} model={model} />
      : <ChatMessage key={key} model={model} />;
  }

  // [CHANGED] 用 id 比较，规避“同 id 不同实例”漏配
  componentsChatMessages(chat) {
    const chatId = String(chat?.id?.() ?? '');
    const list = app.chat.getChatMessages(
      (mdl) => String(mdl.chat()?.id?.() ?? '') === chatId
    );
    return list.map((model, idx) => this.componentChatMessage(model, idx));
  }

  componentScroller() {
    return (
      <div className="scroller" onclick={this.fastScroll.bind(this)}>
        <i className="fas fa-angle-down"></i>
      </div>
    );
  }

  componentLoader(watch) {
    // [FIX] Mithril keys：给 Loader 一个稳定 key，避免与消息条目（已 keyed）混用
    // 始终渲染同一个带 key 的 vnode；用样式控制显隐，规避“时有时无”的 children 结构差异
    return (
      <msgloader
        key="__loader__"
        className="message-wrapper--loading"
        style={{ display: watch ? '' : 'none' }}
      >
        <LoadingIndicator className="loading-old Button-icon" />
      </msgloader>
    );
  }

  isPhone() {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(max-width: 768px)').matches
    );
  }

  getChatWrapper() {
    if (this.isPhone() && app.current.matches?.(ChatPage)) {
      return document.documentElement;
    }
    if (this.wrapperEl) return this.wrapperEl; // [CHANGED] 优先当前实例 wrapper
    const wrapper = this.element?.querySelector?.('.wrapper')
      || document.querySelector('.ChatViewport .wrapper');
    return wrapper || null;
  }

  isFastScrollAvailable() {
    if (!this.state || !this.model) return false;
    const chatWrapper = this.getChatWrapper();
    if (!chatWrapper) return false;

    return (
      (this.state.newPushedPosts ||
        this.model.unreaded() >= 30 ||
        (chatWrapper.scrollHeight > 2000 &&
          chatWrapper.scrollTop < chatWrapper.scrollHeight - 2000)) &&
      !this.nearBottom()
    );
  }

  fastScroll(e) {
    if (!this.model) return;
    if (this.model.unreaded() >= 30) this.fastMessagesFetch(e);
    else {
      const chatWrapper = this.getChatWrapper();
      if (chatWrapper) {
        chatWrapper.scrollTop = Math.max(
          chatWrapper.scrollTop,
          chatWrapper.scrollHeight - 3000
        );
        this.scrollToBottom();
      }
    }
  }

  fastMessagesFetch(e) {
    e.redraw = false;
    app.chat.chatmessages = [];

    app.chat.apiFetchChatMessages(this.model).then(() => {
      this.scrollToBottom();
      timedRedraw(300);

      this.model.pushAttributes({ unreaded: 0 });
      const message = app.chat
        .getChatMessages((mdl) => String(mdl.chat()?.id?.() ?? '') === String(this.model?.id?.() ?? ''))
        .slice(-1)[0];
      app.chat.apiReadChat(this.model, message);
    });
  }

  wrapperOnCreate(vnode) {
    super.oncreate(vnode);
    this.wrapperEl = vnode.dom;        // [CHANGED]
    this.wrapperOnUpdate(vnode);

    const target = app.current.matches?.(ChatPage) ? window : this.wrapperEl;
    this.boundScrollTarget = target;
    this.boundScrollListener = this.wrapperOnScroll.bind(this);
    target.addEventListener('scroll', this.boundScrollListener, { passive: true });
  }

  wrapperOnBeforeUpdate(vnode, vnodeNew) {
    try {
      super.onbeforeupdate(vnode, vnodeNew);
      if (
        !this.state ||
        !this.state.scroll?.autoScroll ||  // [FIX] 使用 this.state.scroll.autoScroll
        !this.nearBottom() ||
        !this.state.newPushedPosts
      ) {
        return;
      }
      this.scrollAfterUpdate = true;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('ChatViewport wrapperOnBeforeUpdate error:', e);
    }
  }

  wrapperOnUpdate(vnode) {
    try {
      super.onupdate(vnode);
      const el = this.getChatWrapper();
      if (!el) return;

      // 仅当允许粘底且确有新消息时安排一次“滚到底”
      if (this.model && this.state && this.state.scroll.autoScroll && this.state.newPushedPosts) {
        if (this.autoScrollTimeout) clearTimeout(this.autoScrollTimeout);
        this.autoScrollTimeout = setTimeout(this.scrollToBottom.bind(this, true), 100);
      }
      if (el.scrollTop <= 0) el.scrollTop = 1;
      this.checkUnreaded();

      if (this.scrollAfterUpdate) {
        this.scrollAfterUpdate = false;
        this.scrollToBottom();
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('ChatViewport wrapperOnUpdate error:', e);
    }
  }

  wrapperOnRemove(vnode) {
    try {
      super.onremove(vnode);
      // [HARDEN] 清理 loadChat 防抖定时器
      if (this._loadTimer) { clearTimeout(this._loadTimer); this._loadTimer = null; }
      if (this.boundScrollListener && this.boundScrollTarget) {
        this.boundScrollTarget.removeEventListener('scroll', this.boundScrollListener);
        this.boundScrollListener = null;
        this.boundScrollTarget = null;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('ChatViewport wrapperOnRemove error:', e);
    }
  }

  wrapperOnScroll(e) {
    const el = app.current.matches?.(ChatPage) ? document.documentElement : e.currentTarget;
    const state = this.state;                      // [HARDEN] 捕获当次回调所用 state
    if (!el || !state) return;

    state.scroll.oldScroll = el.scrollHeight - el.clientHeight - el.scrollTop; // [FIX] clientHeight

    this.checkUnreaded();

    if (this.lastFastScrollStatus != this.isFastScrollAvailable()) {
      this.lastFastScrollStatus = this.isFastScrollAvailable();
      m.redraw();
    }

    const currentHeight = el.scrollHeight;

    // 根据是否在底部更新“粘底”开关
    state.scroll.autoScroll = this.atBottom();

    if (this.atBottom()) {
      state.newPushedPosts = false;
    }

    if (state.scroll.autoScroll || state.loading || this.scrolling) return;

    if (!state.messageEditing && el.scrollTop >= 0) {
      if (el.scrollTop <= 500) {
        const topMessage = app.chat
          .getChatMessages((model) => String(model.chat()?.id?.() ?? '') === String(this.model?.id?.() ?? ''))[0];
        if (topMessage && topMessage != this.model.first_message()) {
          app.chat.apiFetchChatMessages(this.model, topMessage.created_at().toISOString());
        }
      } else if (el.scrollTop + el.clientHeight >= currentHeight - 500) { // [FIX] clientHeight
        const bottomMessage = app.chat
          .getChatMessages((model) => String(model.chat()?.id?.() ?? '') === String(this.model?.id?.() ?? ''))
          .slice(-1)[0];
        if (bottomMessage && bottomMessage != this.model.last_message()) {
          app.chat.apiFetchChatMessages(this.model, bottomMessage.created_at().toISOString());
        }
      }
    }
  }

  checkUnreaded() {
    const wrapper = this.getChatWrapper();
    if (wrapper && this.model && this.model.unreaded() && app.chat.chatIsShown()) {
      const list = app.chat.getChatMessages(
        (mdl) =>
          String(mdl.chat()?.id?.() ?? '') === String(this.model?.id?.() ?? '') &&
          mdl.created_at() >= this.model.readed_at() &&
          !mdl.isReaded
      );

      for (const message of list) {
        // [FIX] 小坑 A：限定作用域在当前视口，避免命中另一个视口
        const scope = this.element || document;
        const msg = scope.querySelector(`.message-wrapper[data-id="${message.id()}"]`);
        if (!msg) continue;

        // [FIX] 小坑 B 同类：用矩形差判断是否进入可视区，兼容 documentElement / .wrapper
        const msgTop = msg.getBoundingClientRect().top;
        const wrapRectTop = wrapper.getBoundingClientRect().top;
        const visibleBottom = wrapRectTop + wrapper.clientHeight;

        if (msgTop <= visibleBottom) {
          message.isReaded = true;

          if (this.state.scroll.autoScroll && app.chat.getCurrentChat() == this.model) {
            app.chat.apiReadChat(this.model, new Date());
            this.model.pushAttributes({ unreaded: 0 });
          } else {
            app.chat.apiReadChat(this.model, message);
            this.model.pushAttributes({ unreaded: this.model.unreaded() - 1 });
          }

          m.redraw();
        }
      }
    }
  }

  // [FIX] 改为矩形差定位，兼容不同滚动容器
  scrollToAnchor(anchor) {
    let element;
    if (anchor instanceof Message) {
      const jq = this.$ ? this.$(`.message-wrapper[data-id="${anchor.id()}"]`) : null;
      element = jq ? jq[0] : document.querySelector(`.message-wrapper[data-id="${anchor.id()}"]`);
    } else {
      element = anchor;
    }

    const chatWrapper = this.getChatWrapper();
    if (!chatWrapper || !element) return setTimeout(() => this.scrollToAnchor(anchor), 100);

    const elRect  = element.getBoundingClientRect();
    const ctRect  = chatWrapper.getBoundingClientRect();
    const targetTop = Math.max((elRect.top - ctRect.top) + chatWrapper.scrollTop - element.clientHeight, 0);

    const jq = window.$ && window.$(chatWrapper);
    if (jq && jq.stop && jq.animate) {
      jq.stop().animate({ scrollTop: targetTop }, 500);
    } else {
      chatWrapper.scrollTo({ top: targetTop, behavior: 'smooth' });
    }
  }

  scrollToBottom(force = false) {
    this.scrolling = true;
    const chatWrapper = this.getChatWrapper();
    if (chatWrapper) {
      const notAtBottom = !force && this.atBottom();
      let fewMessages = false;
      if (app.current.matches?.(ChatPage)) {
        const wrapper = this.wrapperEl || document.querySelector('.ChatViewport .wrapper');
        fewMessages = wrapper && wrapper.scrollHeight + 200 < document.documentElement.clientHeight;
      }
      // [FIX] 容器缺失或提前返回也要复位，避免卡死
      if (notAtBottom || fewMessages) { this.scrolling = false; return; }

      const time = this.pixelsFromBottom() < 80 ? 0 : 250;

      const jq = window.$ && window.$(chatWrapper);
      if (jq && jq.stop && jq.animate) {
        jq
          .stop()
          .animate({ scrollTop: chatWrapper.scrollHeight }, time, 'swing', () => {
            this.scrolling = false;
          });
      } else {
        chatWrapper.scrollTo({ top: chatWrapper.scrollHeight, behavior: time ? 'smooth' : 'auto' });
        this.scrolling = false;
      }
    } else {
      // [FIX] 容器缺失也要复位，避免卡死
      this.scrolling = false;
    }
  }

  reloadMessages() {
    // [FIX] 确保 state 存在
    if (!this.state || this.state.messagesFetched) return;

    let query;
    if (this.model.unreaded()) {
      query = this.model.readed_at()?.toISOString() ?? new Date(0).toISOString();
      this.state.scroll.autoScroll = false;
    }

    app.chat.apiFetchChatMessages(this.model, query).then(() => {
      if (!this.state) return;

      if (this.model.unreaded()) {
        const anchor = app.chat.getChatMessages(
          (mdl) =>
            String(mdl.chat()?.id?.() ?? '') === String(this.model?.id?.() ?? '') &&
            mdl.created_at() > this.model.readed_at()
        )[0];
        this.scrollToAnchor(anchor);
      } else this.state.scroll.autoScroll = true;

      m.redraw();
    });

    this.state.messagesFetched = true;
  }

  nearBottom() {
    try {
      return this.pixelsFromBottom() <= 500;
    } catch {
      return false;
    }
  }

  atBottom() {
    try {
      return this.pixelsFromBottom() <= 5;
    } catch {
      return false;
    }
  }

  pixelsFromBottom() {
    const element = this.getChatWrapper();
    if (
      !element ||
      element.scrollHeight === undefined ||
      element.scrollTop === undefined ||
      element.clientHeight === undefined
    ) {
      return 0;
    }
    return Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight);
  }
}
