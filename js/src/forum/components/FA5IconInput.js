js/src/forum/components/FA5IconInput.js
// [FIX] 1.8 路径：Component/highlight → flarum/common/*
// [FIX] class → className；为 <li> 添加 key 避免复用错位
// [HARDEN] 初始化 this.inputIconHasFocus=false 防止未定义
// [CLEANUP] 不再维护内部 icon Stream；以外部传入的 options.stream 为准
// [ENH] 失焦时收起下拉；首帧同步一次预览；点选联想项后收起
// [CHANGED] 使用 onkeydown 代替 onkeypress，判断 e.key==='Enter'（更现代/稳妥）

import Component from 'flarum/common/Component';
import highlight from 'flarum/common/helpers/highlight';
import { fa5IconsList } from '../resources';

export default class FA5IconInput extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.dropdownState = {};
    this.inputIconHasFocus = false; // [HARDEN]
  }

  dropdownIconMatches(stream) {
    const inputIcon = stream() || '';
    const state = this.dropdownState;

    if (inputIcon !== state.lastInput) {
      state.matches = fa5IconsList.filter((icon) => icon.includes(inputIcon));
      if (state.matches.length > 5) state.matches = state.matches.sort(() => 0.5 - Math.random());
      state.lastInput = inputIcon;
    }

    return inputIcon.length &&
      state.matches.length > 0 &&
      !(state.matches.length === 1 && state.matches[0] === inputIcon) ? (
      <ul className="Dropdown-menu Dropdown--Icons Search-results">
        <li className="Dropdown-header">Font Awesome 5</li>
        {state.matches.slice(0, 5).map((icon) => (        // [FIX] 取前 5 项
          <li
            key={icon}                                     // [FIX]
            className="IconSearchResult"
            onclick={() => { this.attrs.stream(icon); this.inputIconHasFocus = false; }} // [ENH]
          >
            <icon className="Chat-FullColor">
              <i className={icon}></i>
            </icon>
            <span>{highlight(icon, inputIcon)}</span>
          </li>
        ))}
      </ul>
    ) : null;
  }

  view() {
    const options = this.attrs;

    return [
      options.title ? <label>{options.title}</label> : null,
      <div className="IconSearch">
        {options.desc ? <label>{options.desc}</label> : null}
        <div className="Icon-Input IconSearchResult">
          <input
            className="FormControl"               // [FIX]
            type="text"
            bidi={options.stream}
            placeholder={options.placeholder}
            oncreate={options.inputOnUpdate}      // [ENH] 首帧同步预览图标
            onupdate={options.inputOnUpdate}
            onfocus={() => (this.inputIconHasFocus = true)}
            onclick={() => (this.inputIconHasFocus = true)}
            onkeydown={(e) => (this.inputIconHasFocus = !(e.key === 'Enter'))} // [CHANGED]
            onblur={() => (this.inputIconHasFocus = false)}                    // [ENH]
          />
          <icon className="Chat-FullColor">
            <i className={options.stream() || ''} />
          </icon>
          {this.inputIconHasFocus ? this.dropdownIconMatches(options.stream) : null}
        </div>
      </div>,
    ];
  }
}

