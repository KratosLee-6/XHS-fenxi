/**
 * icons.js — 确定性 SVG 图标层
 *
 * 依据 design-to-product/references/icon-system.md：
 *   · 24 网格 viewBox="0 0 24 24"，线宽 1.75（允许 1.5 / 2），圆端点 + 圆连接
 *   · 单色 currentColor，装饰性 SVG 对辅助技术隐藏（aria-hidden）
 *   · 按钮靠 aria-label 或可见文字命名，不靠图标本身
 *   · **禁用元素：渐变、阴影、emoji、字母拼贴、第三方品牌标志**
 *
 * 16 个基础几何来自技能自带的确定性生成器（assets/template-starter/icons.js），
 * 原样沿用保证家族一致。下面 24 个业务语义图标按**同一套几何约束**新写：
 * 优先复用已有形状（tools 直接用 sliders），确实缺才新增，
 * 并按「圆形/斜线/实心区域即使同样外框也会显得轻重不同」做了光学校正
 * —— 全部走开放描边而非粗轮廓，避免在 16px 下压过文字。
 *
 * 用法：
 *   Icons.svg('chart', { size: 20 })          → 内联 SVG 字符串
 *   Icons.el('chart', { size: 20, cls:'x' })  → 直接插入 DOM
 */
(function () {
  'use strict';

  // ---- 家族基础几何（技能自带，保持一致）----
  const base = {
    search:    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    arrow:     '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    close:     '<path d="m6 6 12 12M6 18 18 6"/>',
    check:     '<path d="m5 12 4 4L19 6"/>',
    plus:      '<path d="M12 5v14M5 12h14"/>',
    minus:     '<path d="M5 12h14"/>',
    /* chevron 指向**右**：折叠态用它，展开态由 CSS 旋转 90° 变朝下。
       之前快捷键那行用 list 当折叠指示器，12px 下三条横线糊成一团，
       渲染出来像「⋮=」这种乱码 —— list 表达的是「清单」，
       不是「这里能展开」。方向本身就是状态，不该再配一个字去解释。 */
    chevron:   '<path d="m9 5 7 7-7 7"/>',
    grid:      '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    list:      '<path d="M9 6h11M9 12h11M9 18h11M4 6h.1M4 12h.1M4 18h.1"/>',
    download:  '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    sliders:   '<path d="M4 7h5m4 0h7M4 17h9m4 0h3"/><circle cx="11" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
    play:      '<path d="m8 5 11 7-11 7Z"/>',
    pause:     '<path d="M8 5v14M16 5v14"/>',
    folder:    '<path d="M3 6h7l2 3h9v11H3Z"/>',
    external:  '<path d="M14 3h7v7m0-7L11 13M10 5H4v15h15v-6"/>',
    bookmark:  '<path d="M6 4h12v17l-6-4-6 4Z"/>'
  };

  // ---- 业务语义图标（同网格新写）----
  const app = {
    // 导航
    home:     '<path d="M4 10.5 12 4l8 6.5"/><path d="M6.5 9.5V20h11V9.5"/>',
    chart:    '<path d="M4 20h16"/><path d="M7.5 20v-5.5M12 20V9M16.5 20v-8"/>',
    bot:      '<rect x="4" y="8.5" width="16" height="11" rx="3"/><path d="M12 4.5v4"/><path d="M9.5 14h.01M14.5 14h.01"/>',
    dots:     '<path d="M6 12h.01M12 12h.01M18 12h.01"/>',
    chat:     '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9.5L5 20Z"/>',
    template: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9.5 9.5v10"/>',
    user:     '<circle cx="12" cy="8" r="3.75"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    inbox:    '<path d="M3.5 13.5 5.5 5h13l2 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z"/><path d="M3.5 13.5h4.2l1.2 2.6h6.2l1.2-2.6h4.2"/>',
    bulb:     '<path d="M12 3.5a5.5 5.5 0 0 0-3.3 9.9V16h6.6v-2.6A5.5 5.5 0 0 0 12 3.5Z"/><path d="M9.8 19h4.4M10.5 21.2h3"/>',
    gear:     '<circle cx="12" cy="12" r="3"/><path d="M12 2.6v3.2M12 18.2v3.2M21.4 12h-3.2M5.8 12H2.6M18.6 5.4l-2.3 2.3M7.7 16.3l-2.3 2.3M18.6 18.6l-2.3-2.3M7.7 7.7 5.4 5.4"/>',

    // 动作
    refresh:  '<path d="M19.4 10.5A7.5 7.5 0 1 0 20 12.6"/><path d="M20 4.6v5.9h-5.9"/>',
    sparkle:  '<path d="M12 3.6 13.7 9.2 19.3 10.9 13.7 12.6 12 18.2 10.3 12.6 4.7 10.9 10.3 9.2Z"/>',
    pen:      '<path d="M15.4 4.4 19.6 8.6 8.2 20H4v-4.2Z"/><path d="m13.6 6.2 4.2 4.2"/>',
    trash:    '<path d="M4 7h16M9.5 7V4.2h5V7M6.2 7l1 13h9.6l1-13"/>',
    clock:    '<circle cx="12" cy="12" r="8"/><path d="M12 7.4V12l3.2 2.1"/>',
    signal:   '<circle cx="12" cy="12" r="1.6"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 15.8a5.4 5.4 0 0 0 0-7.6"/><path d="M5.4 5.4a9.4 9.4 0 0 0 0 13.2M18.6 18.6a9.4 9.4 0 0 0 0-13.2"/>',
    alert:    '<path d="M12 4.2 21 19.6H3Z"/><path d="M12 10v4.2M12 17h.01"/>',
    image:    '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.8" cy="10" r="1.5"/><path d="m4.2 17.4 4.8-4.8 3.6 3.6 3-3 4.4 4.4"/>',
    doc:      '<path d="M6.5 3.5h7.5l4 4v13h-11.5Z"/><path d="M14 3.5v4h4"/><path d="M9 12h6M9 16h4"/>',
    upload:   '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    copy:     '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 5.5H5.5a1 1 0 0 0-1 1v10"/>',
    // 眼睛/闭眼：替换原先的 👁 / 🙈 —— 同一枚图标的两态靠斜线区分，不靠换字形
    eye:      '<path d="M2.6 12S6.2 5.8 12 5.8 21.4 12 21.4 12 17.8 18.2 12 18.2 2.6 12 2.6 12Z"/><circle cx="12" cy="12" r="2.8"/>',
    'eye-off': '<path d="M9.6 6.2A8.6 8.6 0 0 1 12 5.8c5.8 0 9.4 6.2 9.4 6.2a16 16 0 0 1-3 3.6"/><path d="M6.4 8A16 16 0 0 0 2.6 12s3.6 6.2 9.4 6.2a8.7 8.7 0 0 0 3.4-.7"/><path d="m4 4 16 16"/><path d="M10.2 10.4a2.8 2.8 0 0 0 3.6 3.8"/>',
    // 链条：账号绑定 / 外链的语义锚点。原表里只有 external（外跳箭头），语义不同
    link:     '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.3-1.3"/>',
    // 麦克风：语音输入。开放描边，与 signal 的同心弧刻意区分 ——
    // signal 是「信号强度」，mic 是「一个具体的拾音器」，语义不能混
    mic:      '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/>'
  };

  const paths = Object.assign({}, base, app);
  // 12/14 供「图标与文字同行」的场合（13px 标签、12px 统计行）；
  // 16 及以上用于独立图标位。再往下的尺寸在这个线宽下会糊成一团。
  const SIZES = [12, 14, 16, 20, 24, 32, 48];
  const STROKES = [1.5, 1.75, 2];

  function svg(name, options) {
    const o = options || {};
    if (!Object.prototype.hasOwnProperty.call(paths, name)) {
      throw new Error('Unknown icon: ' + name);
    }
    const size = Number(o.size == null ? 24 : o.size);
    const stroke = Number(o.stroke == null ? 1.75 : o.stroke);
    if (SIZES.indexOf(size) < 0) throw new Error('Unsupported icon size: ' + size);
    if (STROKES.indexOf(stroke) < 0) throw new Error('Unsupported stroke: ' + stroke);
    const color = o.color == null ? 'currentColor' : o.color;
    if (color !== 'currentColor' && !/^#[0-9a-f]{6}$/i.test(color)) {
      throw new Error('Invalid icon color: ' + color);
    }
    const cls = o.cls ? ' class="' + String(o.cls).replace(/"/g, '') + '"' : '';
    // 装饰性图标对辅助技术隐藏；独立导出时才用 role=img + title
    const a11y = o.standalone
      ? 'role="img" aria-labelledby="icon-title"'
      : 'aria-hidden="true" focusable="false"';
    const title = o.standalone ? '<title id="icon-title">' + name + '</title>' : '';
    return '<svg xmlns="http://www.w3.org/2000/svg"' + cls +
      ' width="' + size + '" height="' + size + '" viewBox="0 0 24 24"' +
      ' fill="none" stroke="' + color + '" stroke-width="' + stroke + '"' +
      ' stroke-linecap="round" stroke-linejoin="round" ' + a11y + '>' +
      title + paths[name] + '</svg>';
  }

  /** 插入 DOM 的便捷封装 */
  function el(name, options) {
    const span = document.createElement('span');
    span.className = 'ico' + ((options && options.cls) ? ' ' + options.cls : '');
    span.innerHTML = svg(name, options);
    return span;
  }

  const Icons = Object.freeze({
    names: Object.keys(paths),
    svg: svg,
    el: el,
    /** 批量替换容器里 [data-ico] 占位 */
    hydrate(root) {
      const failed = [];
      (root || document).querySelectorAll('[data-ico]').forEach(node => {
        if (node.dataset.icoDone === '1') return;
        try {
          node.innerHTML = svg(node.dataset.ico, {
            size: Number(node.dataset.icoSize || 20),
            cls: node.dataset.icoCls || ''
          });
          node.dataset.icoDone = '1';
        } catch (e) {
          // 一颗坏占位不能拖垮整批 —— 记下来继续处理下一个
          failed.push(node.dataset.ico + ' @ ' + node.dataset.icoSize);
        }
      });
      if (failed.length) {
        console.warn('[Icons] 跳过 ' + failed.length + ' 个无效占位：', failed.join(', '));
      }
    }
  });

  if (typeof window !== 'undefined') window.Icons = Icons;
  if (typeof globalThis !== 'undefined') globalThis.Icons = Icons;
}());
