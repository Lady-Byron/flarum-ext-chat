// js/src/forum/components/ColorInput.js
// [FIX] 1.8 路径：Component → flarum/common/*
// [FIX] class → className（JSX/Mithril）
// [CLEANUP] 移除对 type="color" 无效的 placeholder；由色盘控件自行展示
// [NOTE] 仍保留 bidi；1.8 官方 API 允许使用
// [ENH] 首帧联动：oncreate + onupdate 都触发父级传入的 inputOnUpdate

import Component from 'flarum/common/Component';

export default class ColorInput extends Component {
  view() {
    const options = this.attrs;

    return [
      options.title ? <label>{options.title}</label> : null,
      <div>
        {options.desc ? <label>{options.desc}</label> : null}
        <div className="Color-Input">
          <input
            className="FormControl"               // [FIX]
            type="color"
            bidi={options.stream}                 // [NOTE] 继续使用 bidi 绑定（1.8 仍支持）
            oncreate={options.inputOnUpdate}      // [ENH] 首帧就同步色块
            onupdate={options.inputOnUpdate}
          />
          <color className="Chat-FullColor" />
        </div>
      </div>,
    ];
  }
}
