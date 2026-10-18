/**
 * sidepanel.js — 小红书运营工具箱侧边栏
 * v2.3.0 统一入口：共享状态 + DOM 工具 + 消息流 + Tab 切换
 */

'use strict';

// ========== 全局状态 ==========
const _S = {
  currentTab: null,
  scrapedData: null,
  cartItems: [],
  _providers: null,
  _loadingHistory: false
};

// ========== DOM 工具 ==========
const $ = (sel, ctx = document) => (ctx || document).querySelector(sel);
const $$ = (sel, ctx = document) => [...(ctx || document).querySelectorAll(sel)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// HTML 转义：拼 HTML 时凡来自页面/用户的内容都要过一遍。
// ⚠ 不要命名为 `esc` —— datacenter.js 已在全局词法作用域声明了同名 const，
//    重复声明会让整个 script 抛 SyntaxError。
const spEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ========== 获取小红书标签页 ==========
async function getXhsTab() {
  const tabs = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://*.xhs.cn/*'] });
  return tabs[0] || null;
}

async function withXhsTab(actionFn) {
  const tab = await getXhsTab();
  if (!tab) throw new Error('未找到小红书标签页，请确保已打开小红书页面');
  return actionFn(tab.id);
}

// ========== Markdown 格式化 ==========
// 注意：visual 一律走 class（common.css 的 .md-*），不要内联 style。
function formatMarkdown(text) {
  const lines = text.split('\n');
  const out = [];
  let prevBlank = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    line = line
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code class="md-code">$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    if (/^### (.+)/.test(line)) { out.push(`<h3 class="md-h3">${line.replace(/^### /, '')}</h3>`); prevBlank = false; continue; }
    if (/^[-*] (.+)/.test(line)) { out.push(`<li class="md-li">${line.replace(/^[-*] /, '')}</li>`); prevBlank = false; continue; }
    if (/^\d+\. (.+)/.test(line)) { out.push(`<li class="md-li">${line.replace(/^\d+\. /, '')}</li>`); prevBlank = false; continue; }
    if (/^> (.+)/.test(line)) { out.push(`<blockquote class="md-quote">${line.replace(/^> /, '')}</blockquote>`); prevBlank = false; continue; }
    if (/^[-_*]{3,}$/.test(line.trim())) { out.push('<hr class="md-hr">'); prevBlank = false; continue; }
    if (!line.trim()) {
      // 空行是段落分隔，连续空行折叠成一枚 <br>。
      // ⚠️ 之前每枚空行都推一个 <br>、行与行之间又 join('\n')，
      //    而气泡是 white-space:pre-wrap —— 换行被渲染两到三遍，
      //    AI 回复整段「行间距太大」。普通换行交给 pre-wrap 自己渲染。
      if (!prevBlank) out.push('<br>');
      prevBlank = true;
      continue;
    }
    prevBlank = false;
    out.push(line + '\n');
  }
  return out.join('').replace(/^(<br>)+/, '').replace(/(?:<br>|\n)+$/, '');
}

// ========== KPI 数字滚动 ==========
// 数据「长出来」的焦点动效：KPI 数字从 0 滚到目标（480ms 减速，对齐 CSS --dur-3 档）。
// 纪律：只滚**纯数字**（可含千分位）—— '—'、'18.7%'、'3.2万' 一律不碰；
// prefers-reduced-motion 下直接不动画（空间类装饰，减动效时关掉最稳）。
function animateNums(scope) {
  if (!scope || !window.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  scope.querySelectorAll('.kpi-num').forEach(el => {
    const raw = el.textContent.trim();
    if (!/^[\d,]+$/.test(raw)) return;
    const target = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(target) || target === 0) return;
    const t0 = performance.now();
    const DUR = 480;   // 与 CSS --dur-3 同档；JS 侧引用不了 CSS 令牌
    const step = (t) => {
      const k = Math.min(1, (t - t0) / DUR);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(target * eased).toLocaleString('zh-CN');
      if (k < 1) requestAnimationFrame(step);
      else el.textContent = raw;   // 终态严格回到原文，杜绝舍入漂移
    };
    requestAnimationFrame(step);
  });
}
window.animateNums = animateNums;

// ========== 消息流渲染 ==========
// 头像走 SVG 图标层，不用 emoji —— emoji 当图标在 16px 下会糊成一团，
// 而且各系统字形不同，同一个 🤖 在别人机器上是另一种脸。
const MSG_ICON = { user: 'user', assistant: 'bot', tool: 'sliders', error: 'alert' };

function msgAvatarHtml(role) {
  const name = MSG_ICON[role];
  return `<div class="avatar">${name ? Icons.svg(name, { size: 16 }) : ''}</div>`;
}

function addMsg(role, content, type = 'text') {
  const hint = $('#emptyHint');
  if (hint) hint.style.display = 'none';
  const area = $('#messageArea');
  const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.id = id;
  const avatarHtml = msgAvatarHtml(role);
  if (type === 'loading') {
    // ⚠️ 这里**不要**再放 <span class="spinner"> —— .msg.loading .bubble::after
    //    会自动给加载气泡画一枚转圈，曾经两处都画，「AI 思考中 ◯◯」双圈。
    div.innerHTML = `${avatarHtml}<div class="bubble">AI 思考中</div>`;
    div.classList.add('loading');
  } else {
    div.innerHTML = `${avatarHtml}<div class="bubble">${formatMarkdown(content)}</div>`;
  }
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  // 聊天历史自动保存
  if (type !== 'loading') saveChatHistory();
  return id;
}

function updateMsg(id, role, content) {
  const div = $(`#${id}`);
  if (!div) return;
  div.className = `msg ${role}`;
  const avatar = div.querySelector('.avatar');
  if (avatar) {
    const name = MSG_ICON[role];
    avatar.innerHTML = name ? Icons.svg(name, { size: 16 }) : '';
  }
  const bubble = div.querySelector('.bubble');
  if (bubble) bubble.innerHTML = formatMarkdown(content);
  const area = $('#messageArea');
  area.scrollTop = area.scrollHeight;
}

function removeMsg(id) {
  const div = $(`#${id}`);
  if (div) div.remove();
  saveChatHistory();
}

// ========== 聊天历史持久化 ==========
const MAX_CHAT_HISTORY = 50;

function saveChatHistory() {
  if (_S._loadingHistory) return;
  const area = $('#messageArea');
  if (!area) return;
  const messages = [];
  area.querySelectorAll('.msg').forEach(el => {
    const bubble = el.querySelector('.bubble');
    if (!bubble || el.classList.contains('loading')) return;
    const role = el.classList.contains('user') ? 'user' :
                 el.classList.contains('assistant') ? 'assistant' :
                 el.classList.contains('tool') ? 'tool' :
                 el.classList.contains('error') ? 'error' : 'assistant';
    messages.push({ role, content: bubble.innerText });
  });
  if (messages.length > MAX_CHAT_HISTORY) messages.splice(0, messages.length - MAX_CHAT_HISTORY);
  chrome.storage.local.set({ xhsChatHistory: messages }).catch(() => {});
}

function loadChatHistory() {
  chrome.storage.local.get(['xhsChatHistory'], (result) => {
    const messages = result.xhsChatHistory;
    if (!Array.isArray(messages) || !messages.length) return;
    _S._loadingHistory = true;
    const hint = $('#emptyHint');
    if (hint) hint.style.display = 'none';
    messages.forEach(m => addMsg(m.role, m.content));
    _S._loadingHistory = false;
  });
}

// ========== 图标水合 ==========
// 侧栏切换/浮层开关后会新增节点，图标占位需要重新渲染。
// hydrate 内部用 data-ico-done 去重，重复调用安全。
document.addEventListener('DOMContentLoaded', () => {
  if (window.Icons) window.Icons.hydrate(document);
  initSidebarWidth();
});

/* =====================================================================
   侧栏宽度分档 —— 竖排导航 / 顶部横排
   ---------------------------------------------------------------------
   Chrome 的 side panel 宽度由用户拖拽决定，从 320px 一直到窗口全宽。
   窄到 400 左右是「手机式竖排图标轨」，宽到 1000 以上就该转成
   桌面式的顶部横排 —— 否则就是一台被拉成 1900px 宽的手机。

   为什么用 ResizeObserver 而不是 @container：
   容器查询不能查询容器自己。要让它生效，container-type 必须挂在
   .sp-body 的**祖先**上，而 .sp-body 就是侧栏最外层，DOM 里没有
   这样的祖先。挂在它自己身上则 @container 规则完全不生效
   （试过：宽度、方向都没变，stage 被压成 0 宽，整页全白，
    量了三轮才定位到是「容器查不了自己」）。
   断点 1100px 与 shell.css 里 .sp-body.is-wide 的注释保持一致。

   注意：这个数**不是拍脑袋的，也不要再往下调**。
      横排导航的自然宽度是**量出来的**：11 个导航项（今天 75.6 /
      数据中心 99.2 / 工作台 87.4 / 自动化 87.4 / 对话 75.6 / 模板 75.6 /
      工具 75.6 / 博主 75.6 / 分析车 / 起号助手 / 设置）
      加 logo、分隔线、间距与轨道内边距，合计约 **1040px**。
      原值 560 低了整整 480px，于是 560~1040 这一整段：
        · 导航项被 flex 压到内容宽度以下 → 标签竖排成「工/作/台」
        · 改用 flex:0 0 auto 不压之后 → 「分析车」「起号助手」直接
          被推出可视区（.rail-scroll 横向溢出 158px），用户看不到，
          也没任何提示说右边还有东西
      两个坏法都是**同一个根因**：断点比内容需要的位置早了 480px。
      1100 是 1040 往上留的余量。改导航文案能省出宽度，
      但那是拿产品措辞去迁就版式 —— 竖排在 900px 下本来就好看，
      竖排还多 60px 给内容区，所以这里选「把断点挪到放得下的地方」。
      ===================================================================== */
const SIDEBAR_WIDE_BREAKPOINT = 1100;

/**
 * 顶栏窄屏收敛的断点。
 *
 * ⚠ 这里**不能**用 `@media (max-width: 400px)` —— 那是**视口**宽度，
 *    而侧栏是被浏览器窗口限宽的，实验室里更是把三档画布并排放在
 *    一个 1900px 视口里。视口永远是宽的，媒体查询永远不成立
 *    —— 表现就是「CSS 写了收敛规则，实测里元素照样越界」，
 *    而且看不出任何报错。
 *
 *    正确做法与 .is-wide 同源：量**侧栏自己**的宽度，用类来切。
 */
const SIDEBAR_NARROW_BREAKPOINT = 400;
const SIDEBAR_TINY_BREAKPOINT = 340;

function initSidebarWidth() {
  const body = document.querySelector('.sp-body');
  if (!body) return;
  const apply = () => {
    const w = body.getBoundingClientRect().width;
    body.classList.toggle('is-wide', w >= SIDEBAR_WIDE_BREAKPOINT);
    body.classList.toggle('is-narrow', w < SIDEBAR_NARROW_BREAKPOINT);
    body.classList.toggle('is-tiny', w < SIDEBAR_TINY_BREAKPOINT);
  };
  apply();
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(apply).observe(body);
  } else {
    // 兜底：老 Chromium 上没有 ResizeObserver，窗口 resize 也能覆盖
    window.addEventListener('resize', apply);
  }
}
document.addEventListener('click', (e) => {
  if (e.target.closest('.rail-item')) {
    setTimeout(() => { if (window.Icons) window.Icons.hydrate(document); }, 0);
  }
}, true);

// ========== 构建标识 ==========
// 与 manifest.json 的 version + 本文件改动时间绑定。
// 目的：改完代码忘记在 chrome://extensions/ 刷新扩展时，
// 界面上能立刻看出来跑的还是旧版，省掉一轮「代码明明改了怎么没效果」。
(function stampBuild() {
  const el = document.getElementById('buildStamp');
  if (!el) return;
  fetch(chrome.runtime.getURL('manifest.json'))
    .then(r => r.json())
    .then(m => {
      el.textContent = 'v' + m.version + ' · ' + m.name.slice(0, 12);
      el.title = 'manifest 版本 ' + m.version + '　（改了代码后需在 chrome://extensions/ 点刷新才会更新）';
    })
    .catch(() => { el.textContent = 'v?'; });
})();

// ========== Tab 切换 ==========
// v2.31.0：导航是单层轨道，10 个功能都直接挂在 .rail-item 上。
// 之前 6 个低频功能在「更多」浮层里，选中态要在 rail 与 fly 两处各标一次，
// 还要靠 has-active 提示「当前页藏在浮层里」—— 那套机制整体没了。
const TAB_TITLES = {
  today: '今天', chat: '对话', templates: '模板', tools: '工具',
  author: '博主', cart: '分析车', qihao: '起号助手',
  data: '数据中心', board: '工作台', auto: '自动化', settings: '设置'
};

function switchToTab(tabName) {
  $$('.tool-panel, .settings-panel').forEach(p => p.classList.remove('active'));
  $$('.rail-item').forEach(t => {
    t.classList.remove('is-active');
    t.setAttribute('aria-current', 'false');
  });

  const panel = $(`#panel-${tabName}`);
  if (panel) {
    // ⚠ 一定要顺手摘掉 hidden。
    // .hidden 带 !important（common.css），只加 .active 的话，
    // 一个「本来就带 hidden」的面板会永远停在 display:none ——
    // #panel-chat 就这样废掉了整个对话页，连带工具页 7 个功能、
    // 模板生成、分析车批量分析，全部静默失效（错误提示生成了，
    // 只是写进了一个 display:none 的容器，所以表现是「点了没反应」）。
    // 摘掉它没有副作用：.tool-panel 本身就是 display:none（panels.css），
    // 可见性完全由 .active 决定，hidden 在这里本来就是冗余的。
    panel.classList.remove('hidden');
    panel.classList.add('active');
  }

  // 当前项在轨道上始终可见，直接标高亮即可
  const item = $(`.rail-item[data-tab="${tabName}"]`);
  if (item) {
    item.classList.add('is-active');
    item.setAttribute('aria-current', 'true');
  }

  const title = $('#topbarTitle');
  if (title) title.textContent = TAB_TITLES[tabName] || tabName;

  // 切换到模板页时刷新模板列表
  if (tabName === 'templates') refreshTemplateList();
  // 今天页读的是采集结果。用户很可能刚在「数据中心」采完再切过来 ——
  // 不重读就会看到旧数据（曾经只加载一次，导致采集完切回来仍是「还没有数据」）
  if (tabName === 'today' && typeof tdLoad === 'function') tdLoad(true);
  // 工作台读的是历史，量比其它页大 —— 切过去时才拉，
  // 否则每次开侧栏都要等它，白白拖慢首屏
  if (tabName === 'board' && window.XhsBoard) window.XhsBoard.load(false);
  // 自动采集状态在设置页和自动化页是同一份数据。用户可能刚在
  // 「自动化」页改过某个任务的开关，直接切过来看到的必须是新状态 ——
  // 否则总开关会说「已开启」而实际只有一个任务开着。
  if (tabName === 'settings' && typeof loadAutoCollectState === 'function') {
    loadAutoCollectState();
  }
}

document.addEventListener('click', (e) => {
  const item = e.target.closest('[data-tab]');
  if (item) switchToTab(item.dataset.tab);
});

// =====================================================================
// 对话模块
// =====================================================================

function initChat() {
  const input = $('#chatInput');
  if (!input) return;

  // ⚠ 高度上限**从 CSS 读**，不要再写一个魔法数字。
  //   原来这里硬编码 100、panels.css 里也写 100 —— 两处各自定义，
  //   改了一处忘了另一处就会出现「框只长一半、字还在往下溢出」。
  //   读 CSS 是唯一能让它们永远同步的办法。
  const maxH = () => {
    const raw = getComputedStyle(input).maxHeight;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 280;   // 解析失败（vh/百分比）时的兜底
  };

  /* 默认占位符从 HTML 读，不在这里再抄一份 ——
     抄一份就会出现「改了 HTML 这边没改」，而占位符被抄错时
     表现是「第二行被裁」，肉眼看不出是哪一份过期了。 */
  const defaultPlaceholder = input.placeholder;

  const autoGrow = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, maxH()) + 'px';
    // 空输入点快捷按钮时会换成提示语（见下方 click 处理），
    // 用户一动手打字就必须换回来 —— 否则那句「先粘贴文案」会一直赖在框里，
    // 哪怕他已经打了一半。
    if (input.placeholder !== defaultPlaceholder && input.value.trim()) {
      input.placeholder = defaultPlaceholder;
    }
  };
  input.addEventListener('input', autoGrow);
  // 粘贴长文时 input 事件可能不触发（部分来源走 paste），补一次
  input.addEventListener('paste', () => setTimeout(autoGrow, 0));

  // 空态里的示例 chip：点一下把示例填进输入框。
  // ⚠ 刻意**不直接发送** —— 用户还没确认这就是他想要的，
  //    直接发出去等于替他做了决定，而且示例文本不是他的真实意图。
  //    填进去让他改，比替他按回车更稳妥。
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('#emptyHint .chip[data-sample]');
    if (!chip) return;
    input.value = chip.dataset.sample || '';
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    autoGrow();
    // 填了内容就把空态让开，否则它会一直占着整个消息区
    // （addMsg 里也有同样的隐藏，但点 chip 不产生消息，走不到那里）
    const hint = $('#emptyHint');
    if (hint) hint.style.display = 'none';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  });
  $('#btnSend')?.addEventListener('click', handleChatSubmit);
  initChatShortcuts(input);
  initVoiceInput(input);
  /* 选择器跟着 HTML 走。原来写死 '.tab-action-btn' —— 那个类名早已没有任何
     CSS 规则命中它，早就是死类名；删掉 HTML 里的那一刻这里就会静默失效，
     四个按钮同时变成没监听器的死按钮。**改按钮的 class 必须同步改这里。** */
  $$('.qa[data-action]').forEach(btn => {    btn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) {
        // ⚠ 原来只改 placeholder 就 return。placeholder 变化**几乎不可见** ——
        //    用户点了没反应，会直接判定这按钮坏了。
        //    改成往消息流里插一条可见提示（对话页现在可见了，见 switchToTab）。
        //    同时聚焦输入框，让用户知道该往哪填。
        //
        // ⚠ 占位符只有 136px 净宽（见 sidepanel.html 的注释），一行 9 个字。
        //    原来这句 18 个字会被裁成两行、露半截，比什么都不写更糟。
        //    完整句子交给 addMsg 那一行去说，占位符只留一个短提示。
        //
        // ⚠ 原来这句写死「分析按钮」，点「改写」也说分析 —— 按钮有四个，
        //    提示必须跟着 btn 自己走。
        const label = btn.textContent.trim();
        input.placeholder = '先粘贴文案';
        addMsg('error', `请先在上面的输入框里粘贴文案，再点「${label}」。`);
        input.focus();
        return;
      }
      handleChatAIAction(btn.dataset.action, text);
    });
  });
}

// =====================================================================
// 对话快捷键
// =====================================================================

/**
 * 快捷键只有三条，刻意做少。
 *
 *   Ctrl / Cmd + Enter  发送
 *   Alt + V              开关语音
 *   Alt + /              显示/隐藏快捷键说明
 *
 * ============================ 一条最容易踩的坑 ============================
 * **焦点在 #chatInput 里时，输入普通字符绝不能触发任何快捷键。**
 *
 * Alt+V 看起来很安全 —— 中文输入法下 v 很少单独出现。
 * 但 Alt+/ 更危险：用户很可能就是想打一个斜杠，或者「1/2 的时间」这种词。
 * 一旦普通字符被劫持，他**打不出那句话**，而且完全不知道为什么。
 *
 * 所以这里的判据是**必须带修饰键**（ctrlKey / metaKey / altKey 三者之一），
 * 且必须**精确匹配** key。三个条件缺一不可。
 *
 * 另外：textarea 里 Enter 本来就是换行，这里不抢 Enter 的默认行为 ——
 * initChat 里 Enter 已经绑了「发送」，Shift+Enter 换行的行为保持不变。
 * Ctrl+Enter 在 Enter 的分支里本来就会走到发送，这里不重复拦截。
 */
function initChatShortcuts(input) {
  const kbBtn = $('#btnKbHelp');
  const kbBody = $('#kbHelpBody');

  // Alt+/ 切换说明。**用 classList 显隐** ——
  // .hidden 是 display:none !important，写内联 display 等于没写
  // （dev/showhide-gate.mjs 守着这条，历史上出过 6 处「点了没反应」）。
  const toggleKb = () => {
    if (!kbBody || !kbBtn) return;
    const open = kbBody.classList.contains('hidden');
    kbBody.classList.toggle('hidden', !open);
    kbBtn.setAttribute('aria-expanded', String(open));
  };
  kbBtn?.addEventListener('click', toggleKb);

  document.addEventListener('keydown', (e) => {
    // 普通字符：立刻放行，一个字都不拦。
    // 这一句放在最前面是刻意的 —— 后面所有分支都必须先证明
    // 「用户确实按了修饰键」，否则就别碰他的输入。
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if (!mod) return;
    // IME 组合中的按键一律放行，否则中文输入会被快捷键打断
    if (e.isComposing || e.keyCode === 229) return;

    if (e.key === 'Enter' || e.keyCode === 13) {
      // Ctrl/Cmd+Enter 发送。焦点不在输入框时不抢 ——
      // 用户可能正在别的控件里按回车（比如 chip 上），抢了会误发。
      if ((e.ctrlKey || e.metaKey) && !e.altKey && document.activeElement === input) {
        e.preventDefault();
        handleChatSubmit();
        return;
      }
      // 裸 Enter（无修饰键）不在这里处理：initChat 已绑定，且
      // 它的行为是 Shift+Enter 换行 / Enter 发送，属于既有契约。
      return;
    }

    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = String(e.key || '').toLowerCase();
      if (k === 'v') {
        e.preventDefault();
        toggleVoice(input);
        return;
      }
      if (e.key === '/' || e.code === 'Slash' || e.keyCode === 191) {
        e.preventDefault();
        toggleKb();
      }
    }
  });
}

// =====================================================================
// 语音输入
// =====================================================================

/**
 * ============================ 隐私代价（必须如实说明） ============================
 * Chrome 的 `webkitSpeechRecognition` **不是本地识别**。
 * 它会把麦克风音频送到 **Google 的服务器**去识别，再把文字返回来。
 *
 * 这与本项目「所有能力都在浏览器本地完成，100% DOM 读取或本地 XHR 钩子」
 * 的主张**存在真实张力**：本产品的其它能力确实不外传数据，
 * 但**开了语音输入，就等于把一段语音交给了 Google**。
 *
 * 也就是说：
 *   · 采集到的账号数据仍然只存在本机（这一点没变）
 *   · 但**用户对着麦克风说的话**会离开这台机器
 *   · 侧栏页面向 chrome-extension:// 申请麦克风权限时，
 *     浏览器会告知用户「正在访问麦克风」—— 但**不会告知他音频去了 Google**
 *
 * 没有任何办法在扩展侧关闭这一点，也不应该假装可以。
 * 所以：说明文字、注释、快捷键说明表三处都写明这一点，
 * 并且**识别结果只填入输入框、不自动发送** ——
 * 用户能先看一眼自己刚说了什么，再决定发不发。
 *
 * ============================ 为什么不做本地识别 ============================
 * Web Speech API 没有本地模式；Chrome 里也没有可用的本地替代。
 * 唯一能真正本地跑的方案是自建 Whisper 之类的模型（几百 MB，
 * 且扩展环境里不可行）。所以这里**如实告知**，而不是假装「也在本地」。
 */

/** 语音状态。'unsupported' 表示浏览器根本没有这个 API。 */
let _voice = { rec: null, on: false, supported: null, watchdog: null };

/**
 * 状态行文案。**每一种失败都要说人话。**
 * 静默失败 = 用户看到按钮点了没反应，直接判定功能坏了。
 */
function voiceSay(text, tone) {
  const el = $('#voiceStatus');
  if (!el) return;
  el.textContent = text || '';
  // 用 classList 清状态：连着点几次之后不能残留上一次的红色
  el.classList.remove('is-listening', 'is-warn', 'is-error');
  if (tone === 'listening') el.classList.add('is-listening');
  if (tone === 'warn') el.classList.add('is-warn');
  if (tone === 'error') el.classList.add('is-error');
}

/** 识别结束后把按钮与状态行复位。 */
function voiceReset(btn) {
  _voice.on = false;
  if (btn) btn.classList.remove('is-listening');
}

/**
 * 浏览器是否支持。无痕窗口、部分 Linux 发行版、
 * 以及带扩展禁用策略的环境里 webkitSpeechRecognition 可能是 undefined。
 */
function voiceSupported() {
  return typeof window.webkitSpeechRecognition === 'function'
      || typeof window.SpeechRecognition === 'function';
}

function toggleVoice(input) {
  const btn = $('#btnVoice');
  if (!btn) return;

  // ---- 状态 1：浏览器不支持 ----
  if (!voiceSupported()) {
    // 不静默。按钮保持可点，但每次点都解释为什么。
    btn.classList.remove('is-listening');
    voiceSay('这个浏览器不支持语音识别（webkitSpeechRecognition 不可用），'
      + '无痕窗口与部分环境会这样。打字输入不受影响。', 'error');
    return;
  }

  // ---- 状态 2：正在听/正在启动，再点一次是停止 ----
  // ⚠ 判据用 `_voice.rec` 而不是 `_voice.on`：
  //    onstart 之前 _voice.on 还是 false，但按钮已经进入「正在启动」状态了。
  //    只看 _voice.on 的话，「点一下开始、立刻再点一下取消」会失效 ——
  //    第二次点击会被当成「重新开始」，按钮越点越乱。
  if (_voice.rec) {
    clearTimeout(_voice.watchdog);
    _voice.watchdog = null;
    try { _voice.rec.abort(); } catch (_) { /* 已经停了 */ }
    _voice.rec = null;
    voiceReset(btn);
    voiceSay('已停止录音。', 'warn');
    return;
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  _voice.rec = rec;
  rec.lang = 'zh-CN';
  rec.continuous = false;   // 单次识别：说完一段就停，不做长录音
  rec.interimResults = false;   // 只取最终结果，避免半句话被塞进输入框
  rec.maxAlternatives = 1;

  /* ⚠ 必须在 start() **之前**就给出反馈。
     onstart 是异步的，而 onstart 并不总会来：没有麦克风设备、
     被别的程序占用、或系统拒绝访问时，Chrome 可能既不 onstart
     也不 onerror —— 按钮就那样点下去毫无反应。
     这是 dev/reachable-test.mjs 实测抓到的：headless 里
     webkitSpeechRecognition 存在（有定义），但识别永远起不来，
     于是「点了 #btnVoice 毫无反应」。

     先说「正在启动」再等 onstart，用户至少知道系统收到了这次点击；
     onstart 到了再升级成「正在听」。 */
  btn.classList.add('is-listening');
  voiceSay('正在启动麦克风…', 'listening');

  rec.onstart = () => {
    _voice.on = true;
    btn.classList.add('is-listening');
    // 明说「音频会送到 Google」—— 见上面的隐私代价说明
    voiceSay('正在听…（音频由 Chrome 送到 Google 识别，不在本机；说完自动停止）', 'listening');
  };

  /* 清掉启动兜底计时器。onresult / onerror / onend / 手动取消 / start 抛错
     都要走这里 —— 漏一处就留下一颗会误报「麦克风没能启动」的定时器。 */
  const clearWatchdog = () => { clearTimeout(_voice.watchdog); _voice.watchdog = null; };

  rec.onresult = (ev) => {
    clearWatchdog();
    _voice.rec = null;
    let text = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r && r.isFinal) text += r[0].transcript;
    }
    text = String(text || '').trim();
    voiceReset(btn);
    if (!text) {
      voiceSay('没听清，再说一次试试。', 'warn');
      return;
    }
    // **只填，不发送。** 替用户按下发送键是他没同意的事 ——
    // 这与 prefillChat / 空态 chip 的处理是同一条规矩。
    const box = input || $('#chatInput');
    if (!box) { voiceSay('识别到：' + text, 'warn'); return; }
    box.value = box.value ? (box.value.replace(/\s+$/, '') + ' ' + text) : text;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
    box.dispatchEvent(new Event('input', { bubbles: true }));   // 触发自动增高
    voiceSay('已填入输入框，确认后再点发送。', 'warn');
  };

  rec.onerror = (ev) => {
    clearWatchdog();
    _voice.rec = null;
    voiceReset(btn);
    const code = (ev && ev.error) || 'unknown';
    // 四类错误分别说清楚，不合并成一句「出错了」
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      voiceSay('麦克风权限被拒绝。请点地址栏左侧的图标允许本站使用麦克风，再试一次。', 'error');
    } else if (code === 'no-speech') {
      voiceSay('没有听到声音，靠近麦克风再说一次。', 'warn');
    } else if (code === 'network') {
      // 识别在云端做，所以断网 = 一定失败，如实说
      voiceSay('识别需要联网（音频送到 Google 识别），当前网络不可用。', 'error');
    } else if (code === 'audio-capture') {
      voiceSay('找不到麦克风设备，请检查系统输入设备。', 'error');
    } else {
      voiceSay('语音识别失败（' + code + '），可以改用打字。', 'error');
    }
  };

  rec.onend = () => {
    // 没出结果就结束（比如被外部打断）时也要复位，
    // 否则按钮会一直停在「正在听」的样子
    if (_voice.on) { voiceReset(btn); voiceSay('已结束。', 'warn'); }
    _voice.rec = null;
  };

  /* onstart/onerror/onend 全都不来的兜底。
     上面已经说过为什么会有这种环境：识别起不来又不报错。
     既然等不到回调，就自己设一个上限 ——
     超时后明确告诉用户「没启动起来」，并把按钮复位。
     没有这个上限，按钮会永远停在「正在启动麦克风…」，比不做还糟。 */
  _voice.watchdog = setTimeout(() => {
    if (_voice.rec === rec && !_voice.on) {
      _voice.rec = null;
      voiceReset(btn);
      voiceSay('麦克风没能启动（可能被系统拒绝或没有可用设备），'
        + '可以改用打字。', 'error');
    }
  }, 4000);

  // start / error / end 也各自清一次：上面三个属性处理器覆盖的是
  // 「已经有结果或已经出错」，而这三个事件可能在它们之前就触发
  rec.addEventListener('start', clearWatchdog);
  rec.addEventListener('error', clearWatchdog);
  rec.addEventListener('end', clearWatchdog);

  try {
    rec.start();
  } catch (err) {
    clearWatchdog();
    // start() 在某些环境会直接抛（比如同时只允许一个识别实例）
    _voice.rec = null;
    voiceReset(btn);
    voiceSay('无法启动语音识别：' + (err && err.message ? err.message : '未知原因'), 'error');
  }
}

function initVoiceInput(input) {
  const btn = $('#btnVoice');
  if (!btn) return;
  btn.addEventListener('click', () => toggleVoice(input));

  // 首次进来就把「不支持」这件事说清楚，而不是等用户点一下才发现。
  // 这是「不许有点了没反应的按钮」这条规矩的延伸：
  // 一个可见但永远没用的按钮，不如一开始就讲明它为什么没用。
  if (!voiceSupported()) {
    btn.setAttribute('aria-disabled', 'true');
    voiceSay('语音输入：当前环境不支持（webkitSpeechRecognition 不可用），打字输入不受影响。', 'warn');
  }
  /* ⚠ 正常可用时**刻意什么都不写**。
     原来这里每次开面板都往状态行塞一句「语音输入可用，快捷键 Alt+V。
     （音频由 Chrome 送到 Google 识别，不在本机）」—— 36px 两行常驻，
     而 panels.css 对 .status-line 的定义写着「平时不占眼、出事才说话」。
     代码和它自己的注释直接打架。

     隐私那句不能删（那是真的代价，删了就是不诚实），
     所以挪到两个「读过一次就不用再看」的地方：
       · 按钮 title（鼠标悬停即得，见 sidepanel.html）
       · #kbHelp 快捷键表（默认收起，Alt+/ 展开）
     状态行重新回到它该有的状态：只在出错或录音中说话。 */
}

/**
 * 从别处（驾驶舱的提问框）把一句话带进对话页。
 *
 * 只**填**不自动发：AI 分析要花钱，替用户按下发送键是他没同意的事。
 * 填完聚焦并把光标放到末尾，他看一眼再决定发不发。
 */
function prefillChat(text) {
  const input = $('#chatInput');
  if (!input) return;
  input.value = String(text || '');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

async function handleChatSubmit() {
  const input = $('#chatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  // 复位。initChat 的 autoGrow 会按 scrollHeight 重新收拢，
  // 这里清掉内联 height 让 CSS 的 min-height 接管。
  input.style.height = 'auto';
  addMsg('user', text);
  const isTopic = text.length < 30 && !text.includes('。') && !text.includes('\n');
  await handleChatAIAction(isTopic ? 'generate' : 'analyze', text);
}

/**
 * 拉一次本机数据，压成给 AI 的上下文摘要。
 *
 * 只**读** background 已有的 action（getCreatorHistory / getAnalysisHistory /
 * getPlan / getAccount / getTasks），不新增存储、不改 background。
 *
 * ⚠ 任何一步失败都**不阻断对话**，只让摘要少一段。
 *    上下文是加分项，AI 诊断失败不该让用户连字都打不了 ——
 *    那是「AI 失败不能阻断采集」同一条原则的延伸。
 */
async function loadChatContext() {
  if (typeof CTX === 'undefined' || !CTX || typeof CTX.buildContextDigest !== 'function') return '';
  try {
    const [h, a, p, acc, t] = await Promise.all([
      chrome.runtime.sendMessage({ action: 'getCreatorHistory' }),
      chrome.runtime.sendMessage({ action: 'getAnalysisHistory' }),
      chrome.runtime.sendMessage({ action: 'getPlan' }),
      chrome.runtime.sendMessage({ action: 'getAccount' }),
      chrome.runtime.sendMessage({ action: 'getTasks' })
    ]);
    const hist = (h && h.success && Array.isArray(h.data)) ? h.data : [];
    return CTX.buildContextDigest({
      // 与 today.js 同判据：最新一条是列表末尾
      record: hist.length ? hist[hist.length - 1] : null,
      history: hist,
      analysis: (a && a.success && Array.isArray(a.data) && a.data[0]) || null,
      plan: (p && p.success && p.data) || null,
      account: (acc && acc.success && acc.data) || null,
      tasks: (t && t.success && Array.isArray(t.data)) ? t.data : []
    });
  } catch (e) {
    console.warn('[Chat] 上下文摘要读取失败，本次不带上下文', e);
    return '';
  }
}

async function handleChatAIAction(mode, text) {
  // 文案与图标分开：文字负责可读与可访问，图标只做视觉锚点
  const LABELS = { analyze: '分析', rewrite: '改写', check: '检测', generate: '生成' };
  const ICONS  = { analyze: 'search', rewrite: 'pen', check: 'alert', generate: 'sparkle' };
  const label = LABELS[mode] || 'AI';
  const labelIco = ICONS[mode];
  const loadingId = addMsg('assistant', '', 'loading');
  try {
    // 用户可见的气泡里**只有他自己那句** —— 上下文摘要不给用户看，
    // 它是给模型的事实底座，混进气泡会让用户以为自己说过这些话。
    const ctx = await loadChatContext();
    let finalText = ctx ? (ctx + '\n\n【用户的问题】\n' + text) : text;
    if (text.match(/https?:\/\/(www\.)?(xiaohongshu\.com|xhs\.cn)\/.*/i)) {
      addMsg('assistant', '检测到小红书链接，正在抓取内容…', '');
      try {
        const [xhsTab] = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://*.xhs.cn/*'] });
        if (!xhsTab) { updateMsg(loadingId, 'error', '未找到已打开的小红书页面，请先切换到小红书标签页'); return; }
        const scrapeRes = await chrome.tabs.sendMessage(xhsTab.id, { action: 'scrape' });
        if (scrapeRes?.success && scrapeRes.data?.content) {
          // ⚠ 这里**不能**整段覆盖 finalText：原代码直接赋值，
          //    会把刚挂上去的上下文摘要整段丢掉 ——
          //    结果是「粘贴链接时 AI 反而看不到你的数据」，最需要上下文
          //    的场景（问自己的笔记）恰恰失效。改成把笔记内容接在摘要之后。
          finalText = (ctx ? ctx + '\n\n' : '')
            + `[小红书笔记内容]\n标题：${scrapeRes.data.title || '无标题'}\n正文：${scrapeRes.data.content}`;
        } else {
          updateMsg(loadingId, 'error', '链接无法直接访问，请确保在笔记详情页打开侧边栏后，再粘贴链接重试');
          return;
        }
      } catch (scrapeErr) {
        updateMsg(loadingId, 'error', `抓取失败：${scrapeErr.message}`);
        return;
      }
    }
    let res;
    if (mode === 'generate') {
      res = await chrome.runtime.sendMessage({ action: 'generateText', payload: { topic: finalText } });
    } else {
      res = await chrome.runtime.sendMessage({
        action: mode === 'analyze' ? 'analyzeText' : mode === 'rewrite' ? 'rewriteText' : 'checkText',
        payload: { text: finalText }
      });
    }
    if (!res.success) throw new Error(res.error);
    updateMsg(loadingId, 'assistant', res.data);
  } catch (err) {
    updateMsg(loadingId, 'error', `${label}失败：${err.message}`);
  }
}

// =====================================================================
// 工具模块
// =====================================================================

function initTools() {
  $$('.func-item').forEach(item => {
    // ⚠ 限定范围是对的，但**只认 #panel-tools 是漏的**。
    //
    // 原来：`if (item.closest('#panel-tools') === null) return;`
    // 这道守卫本身有正当理由 —— 其它面板（数据中心）也复用了 .func-item
    // 样式类，不限定就会被这里无条件 switchToTab('chat') 劫持，
    // 点「一键采集」先跳回对话页，用户在数据中心看不到任何状态。
    //
    // 但 .func-item 实际有**三个**复用方：#panel-tools（7 个）、
    // #panel-author（1 个 scrapeAuthor）、#panel-data（由 datacenter.js
    // 的 document 级代理另行处理）。只写 tools 就让博主页那颗按钮
    // **一个监听器都没有** —— 点了完全没动静，且没有任何报错。
    //
    // 跳转策略也要分：工具页结果输出到对话页（addMsg → #messageArea），
    // 所以要跳走；博主页的 toolScrapeAuthor 会**就地**渲染 #authorCard，
    // 跳走反而看不到卡片。
    const inTools = item.closest('#panel-tools');
    const inAuthor = item.closest('#panel-author');
    if (!inTools && !inAuthor) return;

    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      if (inTools) switchToTab('chat');
      await handleToolAction(action);
    });
  });
}

async function handleToolAction(action) {
  switch (action) {
    case 'scrapePage':    await toolScrapePage(); break;
    case 'analyzePage':  await toolAnalyzePage(); break;
    case 'scrapeImages': await toolScrapeImages(); break;
    case 'scrapeText':   await toolScrapeText(); break;
    case 'viewComments': await toolViewComments(); break;
    case 'scrapeNoteList': await toolScrapeNoteList(); break;
    case 'openComposer': window.open('https://creator.xiaohongshu.com/publish/publish', '_blank'); break;
    case 'scrapeAuthor': await toolScrapeAuthor(); break;
  }
}

async function toolScrapePage() {
  const msgId = addMsg('tool', '正在抓取笔记数据…');
  try {
    const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrape' }));
    if (!res.success) throw new Error(res.error);
    _S.scrapedData = res.data;
    const d = _S.scrapedData;
    const summary = [
      '抓取成功', `标题：${d.title || '(无)'}`, `作者：${d.author?.name || '(无)'}`,
      `点赞：${d.stats?.likes || 0}`, `评论：${d.stats?.comments || 0}`, `收藏：${d.stats?.collects || 0}`,
      `图片：${d.images?.length || 0} 张`,
      d.tags?.length ? `话题：${d.tags.slice(0, 5).join(' / ')}` : ''
    ].filter(Boolean).join('\n');
    updateMsg(msgId, 'tool', summary);
  } catch (err) { updateMsg(msgId, 'error', `抓取失败：${err.message}`); }
}

async function toolAnalyzePage() {
  let msgId;
  if (!_S.scrapedData?.content) {
    msgId = addMsg('tool', '正在抓取笔记内容用于分析…');
    try {
      const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrape' }));
      if (!res.success) throw new Error(res.error);
      _S.scrapedData = res.data;
      updateMsg(msgId, 'tool', `已抓取：${_S.scrapedData.title || '(无标题)'}，开始 AI 分析...`);
    } catch (err) { updateMsg(msgId, 'error', `抓取失败：${err.message}`); return; }
  } else {
    addMsg('tool', `分析笔记：${_S.scrapedData.title || '(无标题)'}`);
  }
  const text = _S.scrapedData?.content || _S.scrapedData?.title;
  if (!text) { addMsg('error', '未获取到正文内容'); return; }
  const loadingId = addMsg('assistant', '', 'loading');
  try {
    const res = await chrome.runtime.sendMessage({ action: 'analyzeText', payload: { text } });
    if (!res.success) throw new Error(res.error);
    updateMsg(loadingId, 'assistant', res.data);
  } catch (err) { updateMsg(loadingId, 'error', `分析失败：${err.message}`); }
}

async function toolScrapeImages() {
  const msgId = addMsg('tool', '正在抓取图片…');
  try {
    if (!_S.scrapedData?.images) {
      const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrape' }));
      if (!res.success) throw new Error(res.error);
      _S.scrapedData = res.data;
    }
    const imgs = _S.scrapedData.images || [];
    if (!imgs.length) { updateMsg(msgId, 'tool', '未找到图片'); return; }
    await navigator.clipboard.writeText(imgs.join('\n'));
    updateMsg(msgId, 'tool', `已复制 ${imgs.length} 个图片链接到剪贴板`);
  } catch (err) { updateMsg(msgId, 'error', `抓取失败：${err.message}`); }
}

async function toolScrapeText() {
  const msgId = addMsg('tool', '正在抓取文案…');
  try {
    if (!_S.scrapedData) {
      const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrape' }));
      if (!res.success) throw new Error(res.error);
      _S.scrapedData = res.data;
    }
    const text = _S.scrapedData.content || _S.scrapedData.title || '';
    if (!text) { updateMsg(msgId, 'tool', '未找到正文内容'); return; }
    await navigator.clipboard.writeText(text);
    updateMsg(msgId, 'tool', `已复制 ${text.length} 字到剪贴板`);
  } catch (err) { updateMsg(msgId, 'error', `抓取失败：${err.message}`); }
}

async function toolViewComments() {
  const msgId = addMsg('tool', '正在读取评论…');
  try {
    const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrapeComments' }));
    if (!res.success) throw new Error(res.error);
    const comments = res.data || [];
    if (!comments.length) { updateMsg(msgId, 'tool', '未找到评论（可能需要展开评论区）'); return; }
    const top5 = comments.slice(0, 5);
    const lines = top5.map((c, i) => `${i + 1}. 【${c.author || '匿名'}】${(c.content || '').slice(0, 50)}${c.content?.length > 50 ? '...' : ''}`).join('\n');
    const total = comments.length > 5 ? `\n…还有 ${comments.length - 5} 条` : '';
    updateMsg(msgId, 'tool', `共 ${comments.length} 条（显示前5条）：\n${lines}${total}`);
  } catch (err) { updateMsg(msgId, 'error', `读取失败：${err.message}`); }
}

async function toolScrapeNoteList() {
  const msgId = addMsg('tool', '正在抓取笔记列表…');
  try {
    const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrapeNoteList' }));
    if (!res.success) throw new Error(res.error);
    const notes = res.data || [];
    if (!notes.length) { updateMsg(msgId, 'tool', '未找到笔记卡片，请在搜索页或发现页使用此功能'); return; }
    const lines = notes.slice(0, 20).map((n, i) => `${i + 1}. ${n.title} — ${n.author || '未知'} · 赞 ${n.likes || 0}`).join('\n');
    const more = notes.length > 20 ? `\n…还有 ${notes.length - 20} 篇` : '';
    updateMsg(msgId, 'tool', `共抓取 ${notes.length} 篇（显示前20条）：\n${lines}${more}`);
    _S.scrapedData = { noteList: notes };
  } catch (err) { updateMsg(msgId, 'error', `列表抓取失败：${err.message}`); }
}

async function toolScrapeAuthor() {
  const msgId = addMsg('tool', '正在抓取博主数据…');
  try {
    const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrapeProfile' }));
    if (!res.success) throw new Error(res.error);
    const d = res.data;
    const card = $('#authorCard');
    const formatNum = (n) => {
      if (!n) return '—';
      if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
      return n.toString();
    };
    if (card) {
      $('#authorName').textContent = d.name || '—';
      $('#authorId').textContent = d.url || '—';
      $('#authorFans').textContent = formatNum(d.fans);
      $('#authorPosts').textContent = formatNum(d.posts);
      $('#authorFollowing').textContent = formatNum(d.following);
      $('#authorIntro').textContent = d.intro || '暂无简介';
      $('#authorAvatar').textContent = d.name ? d.name[0] : '';
      // ⚠ 用 .hidden 类切换，不要写 style.display。
      // .hidden 是 display:none !important（common.css:1098），
      // 内联样式没有 !important 永远赢不了 —— 写了等于没写，
      // 卡片永远不出现，表现就是「点了没反应」。
      card.classList.remove('hidden');
    }
    updateMsg(msgId, 'tool', [
      '博主信息', `名称：${d.name || '—'}`, `粉丝：${formatNum(d.fans)}`,
      `笔记：${formatNum(d.posts)}`, `关注：${formatNum(d.following)}`,
      d.intro ? `简介：${d.intro}` : ''
    ].filter(Boolean).join('\n'));
  } catch (err) { updateMsg(msgId, 'error', `抓取失败：${err.message}`); }
}

// =====================================================================
// 分析车模块
// =====================================================================

async function initCart() {
  await loadCart();
  bindCartActions();
  listenAddToCart();
}

async function loadCart() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getCart' });
    if (res && res.success && Array.isArray(res.data)) _S.cartItems = res.data;
  } catch (_) {}
  renderCart();
}

async function saveCart() {
  try { await chrome.runtime.sendMessage({ action: 'setCart', payload: _S.cartItems }); } catch (_) {}
}

function addToCart(noteData) {
  if (_S.cartItems.some(n => n.id === noteData.id)) return false;
  _S.cartItems.push({
    id: noteData.id || Date.now().toString(),
    title: noteData.title || '(无标题)',
    author: noteData.author?.name || '',
    likes: noteData.stats?.likes || 0,
    collects: noteData.stats?.collects || 0,
    comments: noteData.stats?.comments || 0,
    content: noteData.content || '',
    tags: noteData.tags || [],
    images: noteData.images || [],
    url: noteData.url || '',
    addedAt: new Date().toLocaleString('zh-CN')
  });
  saveCart();
  renderCart();
  return true;
}

function removeFromCart(index) { _S.cartItems.splice(index, 1); saveCart(); renderCart(); }

/* =====================================================================
   撤销条 —— 高撤销成本操作的可回退执行
   ---------------------------------------------------------------------
   以前清空分析车、解除绑定都走 confirm()：原生阻塞弹窗，样式不可控，
   和侧栏的设计语言完全割裂；而且确认只能防误触，防不了「想清楚了但手滑」。
   现在改成：先执行，立刻给一条限时撤销 —— 两条路都能防。
   ===================================================================== */
let _undoTimer = null;

function showUndo(text, onUndo) {
  const stage = $('.stage');
  if (!stage) return;
  clearTimeout(_undoTimer);
  const old = $('.undo-bar');
  if (old) old.remove();

  const bar = document.createElement('div');
  bar.className = 'undo-bar';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  const txt = document.createElement('span');
  txt.className = 'undo-txt';
  txt.textContent = text;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'undo-btn';
  btn.textContent = '撤销';
  btn.addEventListener('click', () => {
    clearTimeout(_undoTimer);
    onUndo();
    hideUndo();
  });
  bar.append(txt, btn);
  stage.appendChild(bar);

  _undoTimer = setTimeout(() => hideUndo(), 6000);
  // 限时消失的提示不该抢焦点，键盘用户按 Tab 时自然跳过它
}

function hideUndo() {
  const bar = $('.undo-bar');
  if (!bar) return;
  clearTimeout(_undoTimer);
  bar.classList.add('is-out');
  setTimeout(() => bar.remove(), 160);
}

function clearCart() { _S.cartItems = []; saveCart(); renderCart(); }

/** 清空分析车：先执行，再给撤销。清空前把内容留一份在闭包里。 */
function clearCartWithUndo() {
  if (_S.cartItems.length === 0) return;
  const snapshot = _S.cartItems.slice();
  clearCart();
  showUndo(`已清空 ${snapshot.length} 篇笔记`, () => {
    _S.cartItems = snapshot;
    saveCart();
    renderCart();
  });
}

function renderCart() {
  const list = $('#cartList');
  const countEl = $('#cartCount');
  const dot = $('#cartDot');
  const batchBtn = $('#btnBatchAnalyze');
  const hint = $('#cartHint');
  if (!list) return;

  countEl.textContent = `${_S.cartItems.length} 篇笔记`;
  dot.className = 'dot ' + (_S.cartItems.length > 0 ? 'ok' : '');

  if (_S.cartItems.length === 0) {
    list.innerHTML = '';
    if (batchBtn) { batchBtn.disabled = true; batchBtn.classList.add('is-off'); batchBtn.innerHTML = `${Icons.svg('chart', { size: 16 })} 批量分析（需2篇以上）`; }
    if (hint) hint.textContent = '浏览笔记时点击「加入分析车」即可收集';
    ['btnExportCSV','btnExportJSON','btnExportMD','btnSendQihao'].forEach(id => { const b = $('#' + id); if (b) b.disabled = true; });
    return;
  }

  list.innerHTML = _S.cartItems.map((n, i) => `
    <div class="cart-item">
      <div class="cart-item-title" title="${spEsc(n.title)}">${spEsc(n.title)}</div>
      <div class="cart-item-meta">
        ${n.author ? `<span>${Icons.svg('user', { size: 12 })}${spEsc(n.author)}</span>` : ''}
        <span>${Icons.svg('sparkle', { size: 12 })}${Number(n.likes) || 0}</span><span>${Icons.svg('bookmark', { size: 12 })}${Number(n.collects) || 0}</span><span>${Icons.svg('chat', { size: 12 })}${Number(n.comments) || 0}</span>
        ${n.tags?.length ? `<span>${Icons.svg('inbox', { size: 12 })}${spEsc(n.tags.slice(0, 2).join('/'))}</span>` : ''}
      </div>
      <div class="cart-item-time">${spEsc(n.addedAt)}</div>
      <button data-cart-index="${i}" class="cart-item-delete cart-item-del" aria-label="移出分析车">${Icons.svg('close', { size: 14 })}</button>
    </div>
  `).join('');

  list.querySelectorAll('.cart-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.cartIndex, 10);
      if (!isNaN(idx)) removeFromCart(idx);
    });
  });

  if (_S.cartItems.length >= 2) {
    if (batchBtn) { batchBtn.disabled = false; batchBtn.classList.remove('is-off'); batchBtn.innerHTML = `${Icons.svg('chart', { size: 16 })} 批量分析 ${_S.cartItems.length} 篇笔记`; }
  } else {
    if (batchBtn) { batchBtn.disabled = true; batchBtn.classList.add('is-off'); batchBtn.innerHTML = `${Icons.svg('chart', { size: 16 })} 批量分析（还差 ${2 - _S.cartItems.length} 篇）`; }
  }
  if (hint) hint.textContent = `${_S.cartItems.length} 篇笔记待分析`;
  ['btnExportCSV','btnExportJSON','btnExportMD','btnSendQihao'].forEach(id => { const b = $('#' + id); if (b) b.disabled = false; });
}

// ========== 数据导出 ==========
function downloadFile(content, filename, mimeType) {
  const blob = new Blob(['﻿' + content], { type: mimeType + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  cartExportReceipt(filename, blob.size);
}

/**
 * 导出回执。借鉴 component-states.md「success → saving → saved 是独立链，
 * 生成不等于持久化」——点完导出界面毫无变化，用户不知道写没写成。
 *
 * ⚠ 措辞必须是「已生成」而不是「导出成功」：
 *    a.click() 之后浏览器是否真的把文件落盘，扩展**无法确认**
 *    （用户可能取消下载、可能被浏览器拦截、磁盘可能写失败）。
 *    说「导出成功」是在替系统下一个它没下过的结论。
 *    能确定的是「我们生成了多大一个文件、里面有多少条」。
 */
function cartExportReceipt(filename, bytes) {
  const el = $('#cartExportStatus');
  if (!el) return;
  const kb = bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB';
  const ext = (filename.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toUpperCase();
  el.textContent = '已生成 ' + kb + ' 的 ' + ext + ' 文件（'
    + _S.cartItems.length + ' 篇）· ' + filename
    + ' —— 请到浏览器下载目录确认文件已落盘';
  el.className = 'status-line mt-2 st-ok';
}

function exportCSV() {
  const header = '序号,标题,作者,点赞,收藏,评论,标签,URL,添加时间';
  const rows = _S.cartItems.map((n, i) =>
    `${i + 1},"${(n.title || '').replace(/"/g, '""')}","${(n.author || '').replace(/"/g, '""')}",${n.likes || 0},${n.collects || 0},${n.comments || 0},"${(n.tags || []).join(' ')}","${n.url || ''}","${n.addedAt || ''}"`
  );
  downloadFile([header, ...rows].join('\n'), `xhs-cart-${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
}

function exportJSON() {
  const data = _S.cartItems.map(n => ({
    title: n.title, author: n.author, likes: n.likes, collects: n.collects,
    comments: n.comments, tags: n.tags, content: n.content, images: n.images,
    url: n.url, addedAt: n.addedAt
  }));
  downloadFile(JSON.stringify(data, null, 2), `xhs-cart-${new Date().toISOString().slice(0,10)}.json`, 'application/json');
}

function exportMD() {
  const lines = ['# 小红书分析车笔记导出', '', `> 导出时间：${new Date().toLocaleString('zh-CN')}`, `> 共 ${_S.cartItems.length} 篇笔记`, '', '---', ''];
  _S.cartItems.forEach((n, i) => {
    lines.push(`## ${i + 1}. ${n.title}`, '');
    lines.push(`- **作者**：${n.author || '未知'}`);
    lines.push(`- **点赞**：${n.likes || 0} / **收藏**：${n.collects || 0} / **评论**：${n.comments || 0}`);
    if (n.tags?.length) lines.push(`- **标签**：${n.tags.join(' / ')}`);
    if (n.url) lines.push(`- **链接**：${n.url}`);
    lines.push(`- **添加时间**：${n.addedAt || ''}`);
    if (n.content) { lines.push('', '### 正文', '', n.content.slice(0, 500), ''); }
    if (n.images?.length) { lines.push('', '### 图片', ''); n.images.forEach(img => lines.push(`- ${img}`)); }
    lines.push('', '---', '');
  });
  downloadFile(lines.join('\n'), `xhs-cart-${new Date().toISOString().slice(0,10)}.md`, 'text/markdown');
}

function bindCartActions() {
  $('#btnClearCart')?.addEventListener('click', clearCartWithUndo);
  $('#btnBatchAnalyze')?.addEventListener('click', () => { if (_S.cartItems.length < 2) return; batchAnalyze(); });
  $('#btnExportCSV')?.addEventListener('click', exportCSV);
  $('#btnExportJSON')?.addEventListener('click', exportJSON);
  $('#btnExportMD')?.addEventListener('click', exportMD);
  $('#btnSendQihao')?.addEventListener('click', sendToQihaoDemo);
}

const QIHAO_DEMO_URL = 'http://127.0.0.1:8123';

async function sendToQihaoDemo() {
  const btn = $('#btnSendQihao');
  const status = $('#sendQihaoStatus');
  if (!_S.cartItems || _S.cartItems.length === 0) {
    status.textContent = '分析车为空，先在小红书页面点「加入分析车」';
    status.classList.add('warn');
    return;
  }

  btn.disabled = true;
  btn.textContent = '发送中…';
  status.textContent = '';
  status.classList.remove('warn', 'err', 'ok');

  // 转换 cart 数据为 demo 后端期望格式（v0.3 竞品导入 API）
  const items = _S.cartItems.map(n => ({
    id: n.id || n.noteId || (Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
    title: n.title || '',
    author: n.author?.name || n.author || '',
    likes: n.likes || n.stats?.likes || 0,
    collects: n.collects || n.stats?.collects || 0,
    comments: n.comments || n.stats?.comments || 0,
    content: n.content || '',
    tags: n.tags || [],
    url: n.url || '',
  }));

  try {
    const resp = await fetch(`${QIHAO_DEMO_URL}/api/competitors/from-extension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items,
        workspace_id: 'ws-default',
      }),
    });
    const j = await resp.json();
    if (j.imported !== undefined) {
      status.className = 'status-line st-ok';
      status.innerHTML = `导入 <b>${Number(j.imported) || 0}</b> 条竞品 · ${Number(j.skipped) || 0} 跳过<br><span class="t-ok">切回 demo 查看「调研素材」</span>`;
      // 自动打开 demo 工作台（research 视图）
      setTimeout(() => chrome.tabs.create({ url: `${QIHAO_DEMO_URL}/workbench` }), 600);
    } else {
      status.className = 'status-line st-err';
      status.textContent = j.detail || '导入失败';
    }
  } catch (err) {
    status.className = 'status-line st-err';
    status.innerHTML = `无法连接 demo（${spEsc(QIHAO_DEMO_URL)}）<br><span class="t-xs t-muted">确认 demo 已启动：cd 汐构起号助手Demo/backend && python -m uvicorn app.main:app --port 8123</span>`;
    status.classList.add('err');
  } finally {
    btn.disabled = false;
    btn.textContent = '发送到起号助手（v0.3）';
  }
}

function listenAddToCart() {
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'addToCart') {
      const added = addToCart(req.payload || {});
      sendResponse({ success: true, added });
    }
  });
}

async function batchAnalyze() {
  switchToTab('chat');
  const noteList = _S.cartItems.map((n, i) =>
    `【笔记 ${i + 1}】\n标题：${n.title}\n作者：${n.author || '未知'}\n点赞：${n.likes} / 收藏：${n.collects} / 评论：${n.comments}\n话题：${n.tags?.join(' / ') || '无'}\n正文：${(n.content || '').slice(0, 300)}`
  ).join('\n\n' + '─'.repeat(30) + '\n\n');

  const prompt = `以下是我在小红书收集的多篇笔记，请进行横向对比分析：\n\n${noteList}\n请从以下维度分析：\n1. 各笔记的爆款共性（选题/标题/内容结构）\n2. 差异点与各自优势\n3. 适合借鉴的套路\n4. 综合建议`;

  const area = $('#messageArea');
  if (area) { const hint = $('#emptyHint'); if (hint) hint.style.display = 'none'; area.innerHTML = ''; if (hint) area.appendChild(hint); }
  addMsg('user', `批量分析 ${_S.cartItems.length} 篇笔记\n\n${_S.cartItems.map(n => `• ${n.title}`).join('\n')}`);
  const loadingId = addMsg('assistant', '', 'loading');
  try {
    const res = await chrome.runtime.sendMessage({ action: 'analyzeText', payload: { text: prompt } });
    if (!res.success) throw new Error(res.error);
    updateMsg(loadingId, 'assistant', res.data);
  } catch (err) { updateMsg(loadingId, 'error', `分析失败：${err.message}`); }
}

// =====================================================================
// 设置模块
// =====================================================================

async function initSettings() {
  // Provider 切换自动填 endpoint / model
  $('#aiProvider')?.addEventListener('change', async (e) => {
    // ⚠️ _providers 没加载完时**必须现拉**，不能静默 return ——
    //    曾经直接 no-op，用户切了服务商但 endpoint/模型纹丝不动，
    //    看起来就是「切换坏了」。拉不到再如实提示。
    if (!_S._providers) {
      try {
        const r = await chrome.runtime.sendMessage({ action: 'getProviders' });
        if (r && r.success) _S._providers = r.data;
      } catch (_) {}
    }
    const def = _S._providers ? _S._providers[e.target.value] : null;
    if (!def) return;
    const epEl = $('#aiEndpoint'); const modelEl = $('#aiModel'); const keyEl = $('#aiApiKey');
    if (epEl) epEl.value = def.endpoint || '';
    if (modelEl) modelEl.value = def.model || '';
    if (keyEl) { keyEl.value = ''; keyEl.placeholder = def.placeholder || ''; }
  });

  // Cookie 显示/隐藏切换
  $('#btnToggleCookie')?.addEventListener('click', () => {
    const input = $('#accountCookie'); const btn = $('#btnToggleCookie');
    if (!input || !btn) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    // 隐藏时给「睁眼」提示可看；显示时给「闭眼」提示可藏
    btn.innerHTML = Icons.svg(isHidden ? 'eye' : 'eye-off', { size: 16 });
    btn.setAttribute('aria-label', isHidden ? '显示 Cookie' : '隐藏 Cookie');
  });

  $('#btnSaveSettings')?.addEventListener('click', saveSettings);
  $('#btnBindAccount')?.addEventListener('click', handleBindAccount);
  $('#btnUnbindAccount')?.addEventListener('click', handleUnbindAccount);
  $('#btnAutoCollect')?.addEventListener('click', handleAutoCollectToggle);
  $('#btnActivateLicense')?.addEventListener('click', handleActivateLicense);
  $('#btnClearLicense')?.addEventListener('click', handleClearLicense);
  $('#pageLamp')?.addEventListener('click', handlePageLampClick);

  renderProviderSelect('minimax');
  await loadSettings();
  await loadAutoCollectState();
  await loadLicenseState();
  await refreshPageLamp();
  // 切标签页时状态会变，必须跟着更新 —— 否则灯会一直显示上一个页面的结论
  chrome.tabs?.onActivated?.addListener?.(() => refreshPageLamp());
  chrome.tabs?.onUpdated?.addListener?.((_id, info, tab) => {
    if (info.status === 'complete' && tab?.active) refreshPageLamp();
  });
}

// =====================================================================
// 顶栏状态灯
//
// 承接原 popup 的核心价值：一眼看出「现在能不能抓」。
// 删掉 popup 之后如果缺了这个，用户会一路走到「一键采集」才发现白等。
//
// ⚠ 「不在小红书页面」用中性灰而不是红色 ——
//    用户可能只是切去查资料，那不是错误，是正常状态。
//    用红色报警是把「还没切过去」说成「出问题了」。
// =====================================================================

function _setLamp(state, text) {
  const lamp = $('#pageLamp');
  if (!lamp) return;
  lamp.dataset.state = state;
  // data-label 是窄屏（≤400px）时显示的文字副本 ——
  // 那档下 .lamp-txt 被隐藏，只留灯点，靠 CSS 的 ::after 读这个属性。
  lamp.dataset.label = text;
  const txt = $('#lampTxt');
  if (txt) txt.textContent = text;
  const titles = {
    ready: '当前是小红书页面，点击抓取本页笔记',
    other: '当前不是小红书页面，采集功能受限',
    busy: '正在抓取…'
  };
  lamp.title = titles[state] || '';
  lamp.setAttribute('aria-label', titles[state] || text);
}

async function refreshPageLamp() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';
    if (/xiaohongshu\.com|xhs\.cn/.test(url)) {
      _setLamp('ready', '小红书页面 · 可抓取');
    } else {
      _setLamp('other', '非小红书页面');
    }
  } catch (e) {
    // 拿不到 tab（权限被收回等）时如实说，不要假装「就绪」——
    // 假装就绪的后果是用户点了等半天什么都没发生。
    _setLamp('other', '状态未知');
  }
}

async function handlePageLampClick() {
  const lamp = $('#pageLamp');
  if (lamp?.dataset.state === 'ready') {
    _setLamp('busy', '抓取中…');
    try {
      await chrome.runtime.sendMessage({ action: 'scrape' });
      _setLamp('ready', '已抓取 · 看「分析车」');
    } catch (e) {
      // ⚠ 失败必须说清楚，不能悄悄跳回「就绪」——
      //    那样用户会以为成功了，下一步去分析车找一份不存在的数据。
      _setLamp('ready', '抓取失败 · ' + (e?.message || '未知原因').slice(0, 12));
      setTimeout(refreshPageLamp, 4000);
    }
  } else {
    // 不在小红书页面时，点了就带他去 —— 比给一个错的提示有用
    await chrome.tabs.create({ url: 'https://creator.xiaohongshu.com/statistics/data-analysis' });
  }
}

// =====================================================================
// 内测授权（阶段零）
//
// 为什么激活放在设置页而不是做成启动时的弹窗：
// 一上来就弹「请输入邀请码」会把还没决定用不用的人直接劝退。
// 设置页是用户主动来看的地方，在这里解释清楚「不激活也能用哪些」更合适。
//
// ⚠ 五个状态各有各的文案，不能合并成「授权异常」：
// 「过期」和「额度用完」是两件事，用户需要知道该做什么。
// 把它们混为一谈是最容易引发愤怒的做法（设计文档 2.4）。
// =====================================================================

const LICENSE_STATE_TEXT = {
  unactivated: { tone: 'muted', text: '未激活 · 采集与导出照常可用，AI 诊断需激活' },
  active: { tone: 'ok', text: '内测资格有效' },
  grace: { tone: 'warn', text: '已过期，仍在宽限期内可用' },
  expired: { tone: 'danger', text: '授权已到期' },
  quota_exhausted: { tone: 'warn', text: '今日 AI 额度已用完，明天 0 点重置' }
};

function _fmtDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadLicenseState() {
  const activeBox = $('#licenseActive');
  const unboundBox = $('#licenseUnbound');
  const statusEl = $('#licenseStatus');
  if (!activeBox || !unboundBox) return;

  let lic = null;
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getLicenseState' });
    if (res && res.success) lic = res.data;
  } catch (e) {
    // 读不到状态**不能**当成「未激活」去提示用户输码 ——
    // 那会让一个已经激活的用户以为自己没激活，并覆盖掉一张有效租约。
    if (statusEl) {
      statusEl.textContent = '授权状态读取失败，请刷新扩展后重试';
      statusEl.className = 'status-line mt-2 danger';
    }
    return;
  }
  if (!lic) return;

  const isActive = lic.state === 'active' || lic.state === 'grace' || lic.state === 'quota_exhausted';
  activeBox.classList.toggle('hidden', !isActive);
  unboundBox.classList.toggle('hidden', isActive);

  if (isActive) {
    const planEl = $('#licensePlan');
    const descEl = $('#licenseDesc');
    const quotaEl = $('#licenseQuota');
    const meta = LICENSE_STATE_TEXT[lic.state] || LICENSE_STATE_TEXT.active;

    if (planEl) planEl.textContent = meta.text;

    if (descEl) {
      // 有效期内报「还剩几天」，过期后报「过期几天」—— 让用户知道紧迫程度
      if (lic.state === 'grace') {
        descEl.textContent = `宽限期还剩 ${lic.hoursLeftInGrace} 小时，到期后仅可查看与导出`;
      } else if (lic.daysLeft !== undefined && lic.daysLeft !== null) {
        descEl.textContent = lic.daysLeft > 0
          ? `有效期至 ${_fmtDate(lic.expiresAt)}（还剩 ${lic.daysLeft} 天）`
          : `有效期至 ${_fmtDate(lic.expiresAt)}`;
      } else {
        descEl.textContent = `有效期至 ${_fmtDate(lic.expiresAt)}`;
      }
    }

    if (quotaEl) {
      // 额度只在有限额时显示。beta 档视觉额度是 0，显示「0/0」会让人以为坏了
      const parts = [];
      if (lic.quota?.aiTextDaily > 0) {
        parts.push(`今日 AI ${lic.aiUsedToday}/${lic.quota.aiTextDaily}`);
      }
      if (lic.quota?.aiVisionDaily > 0) {
        parts.push(`视觉 ${lic.aiVisionUsedToday}/${lic.quota.aiVisionDaily}`);
      }
      if (parts.length) {
        quotaEl.textContent = parts.join(' · ');
        quotaEl.hidden = false;
      } else {
        quotaEl.hidden = true;
      }
    }
  }

  // ---- 状态行：把「需要用户做什么」说清楚，而不是只报一个状态名 ----
  if (statusEl) {
    let msg = '';
    let cls = 'status-line mt-2';
    if (lic.clockRollback) {
      // 这是独立于订阅的一条告警，必须显式说出来，不能悄悄放行
      msg = `检测到系统时间被调回 ${Math.abs(lic.clockDeltaMs || 0)} 分钟，请把时间改正确`;
      cls += ' danger';
    } else if (lic.verifyError) {
      msg = `授权校验异常：${lic.verifyError}`;
      cls += ' danger';
    } else if (!isActive && lic.state === 'expired') {
      msg = '授权已到期。已采集的数据与导出功能仍然保留可用。';
      cls += ' warn';
    } else if (isActive && lic.state === 'quota_exhausted') {
      msg = `今日 AI 额度已用完（${lic.aiUsedToday}/${lic.aiLimitToday}），明天 0 点自动重置`;
      cls += ' warn';
    }
    statusEl.textContent = msg;
    statusEl.className = cls;
  }
}

async function handleActivateLicense() {
  const input = $('#licenseInput');
  const btn = $('#btnActivateLicense');
  const statusEl = $('#licenseStatus');
  // 邀请码是 base64url（不含空白）—— 复制时带上换行/首尾空格是最常见的
  // 激活失败原因，这里直接全剥掉，而不是让用户对着「签名失败」猜。
  const code = (input?.value || '').replace(/\s+/g, '');
  if (!code) {
    if (statusEl) {
      statusEl.textContent = '请先粘贴邀请码';
      statusEl.className = 'status-line mt-2 warn';
    }
    return;
  }
  if (btn) btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ action: 'activateLicense', payload: { code } });
    if (!res || !res.success) {
      // 失败时**保留输入框内容** —— 用户多半是复制时少了一段，
      // 让他重新粘贴一遍是白费力气
      const raw = res?.error || '激活失败';
      // 验签类失败几乎都是「码没复制全」—— 直接给下一步，别让人对着术语猜
      const hint = /签名|解析|格式|无效/.test(raw)
        ? raw + '。请重新完整复制邀请码（一整段，前后不能少字符）后重试。'
        : raw;
      if (statusEl) {
        statusEl.textContent = hint;
        statusEl.className = 'status-line mt-2 danger';
      }
      return;
    }
    if (input) input.value = '';
    await loadLicenseState();
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = '激活失败：' + (e?.message || '未知错误');
      statusEl.className = 'status-line mt-2 danger';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleClearLicense() {
  const statusEl = $('#licenseStatus');
  const res = await chrome.runtime.sendMessage({ action: 'clearLicense' });
  if (res && res.success) {
    await loadLicenseState();
    if (statusEl) {
      statusEl.textContent = '已解除激活。你的采集数据与历史记录仍然保留。';
      statusEl.className = 'status-line mt-2 ok';
    }
  }
}

// =====================================================================
// 自动采集总开关
//
// 为什么放在设置页而不是只留在「自动化」页：三个默认定时任务原本
// 全是 enabled:false。装完扩展之后，用户必须先知道「自动化」这个页签存在、
// 再逐个把任务打开、还得自己看时间对不对 —— 三层认知负担，
// 结果就是「什么都不会自动发生」，看起来完全需要人工操作。
// 这里把这件事收敛成一次点击：打开它，就把该跑的两个采集任务点亮。
// 对标监控（09:00 抓别人主页）不在其中 —— 那是另一类意图，
// 该由用户主动在「自动化」页自己决定。
// =====================================================================

const AUTO_COLLECT_TASK_IDS = ['t-overview', 't-analysis'];

function _fmtNext(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function loadAutoCollectState() {
  const card = $('#btnAutoCollect')?.closest('.auto-card');
  const next = $('#autoNext');
  if (!card) return;
  const res = await chrome.runtime.sendMessage({ action: 'getTasks' });
  const tasks = (res && res.success && res.data) || [];
  // 只看默认那两个采集任务：用户在「自动化」页自己加的任务不该被算进来，
  // 否则这个总开关会显示出用户没要求过的信息。
  const mine = AUTO_COLLECT_TASK_IDS
    .map(id => tasks.find(t => t.id === id))
    .filter(Boolean);
  const on = mine.length > 0 && mine.every(t => t.enabled);

  card.classList.toggle('is-on', on);
  const btn = $('#btnAutoCollect');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.textContent = on ? '已开启' : '开启';

  if (next) {
    const times = mine.filter(t => t.enabled && t.nextRunAt).map(t => t.nextRunAt);
    next.hidden = !on;
    if (on && times.length) {
      const soonest = Math.min(...times);
      next.textContent = `下次自动采集：${_fmtNext(soonest)}（可在「自动化」页改时间）`;
    } else if (on) {
      next.textContent = '已开启，正在等待 Chrome 排定下次运行。';
    }
  }
}

async function handleAutoCollectToggle() {
  const btn = $('#btnAutoCollect');
  if (btn) btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getTasks' });
    const tasks = (res && res.success && res.data) || [];
    const mine = AUTO_COLLECT_TASK_IDS.map(id => tasks.find(t => t.id === id)).filter(Boolean);
    const on = mine.length > 0 && mine.every(t => t.enabled);

    for (const t of mine) {
      if (t.enabled === !on) {
        await chrome.runtime.sendMessage({
          action: 'upsertTask', payload: { id: t.id, type: t.type, time: t.time, enabled: !on }
        });
      }
    }
    await loadAutoCollectState();
    // 自动化面板开着时同步刷新，否则任务列表还停在旧状态
    if (typeof auLoadTasks === 'function' && $('.tool-panel.active#panel-auto')) auLoadTasks();
  } catch (e) {
    console.error('[AUTO] 切换失败', e);
    const desc = $('#autoDesc');
    if (desc) desc.textContent = '切换失败：' + (e && e.message ? e.message : e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderProviderSelect(activeKey) {
  const sel = $('#aiProvider');
  if (!sel) return;
  if (!_S._providers) { console.warn('[XHS] Provider 列表未加载，将在 500ms 后重试'); setTimeout(() => renderProviderSelect(activeKey), 500); return; }
  sel.innerHTML = '';
  Object.keys(_S._providers).forEach(key => {
    const p = _S._providers[key];
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = p.name || key;
    if (key === activeKey) opt.selected = true;
    sel.appendChild(opt);
  });
}

async function loadSettings() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getAiConfig' });
    if (!res || !res.success) return;
    const c = res.data || {};
    const prov = c.provider || 'minimax';
    const def = _S._providers ? (_S._providers[prov] || _S._providers['minimax']) : null;

    renderProviderSelect(prov);
    $('#aiEndpoint').value = c.endpoint || (def ? def.endpoint : '');
    $('#aiApiKey').value = c.apiKey || '';
    $('#aiModel').value = c.model || (def ? def.model : '');
    $('#aiTemp').value = c.temperature ?? 0.7;
    $('#aiMaxTokens').value = c.maxTokens || 2000;
  } catch (e) { console.warn('[XHS] 加载设置失败:', e); }
  await loadAccountStatus();
}

async function saveSettings() {
  const aiConfig = {
    provider: $('#aiProvider').value, endpoint: $('#aiEndpoint').value.trim(),
    apiKey: $('#aiApiKey').value.trim(), model: $('#aiModel').value.trim(),
    temperature: parseFloat($('#aiTemp').value) || 0.7, maxTokens: parseInt($('#aiMaxTokens').value) || 2000
  };
  await chrome.runtime.sendMessage({ action: 'setAiConfig', payload: aiConfig });

  const cookie = $('#accountCookie').value.trim();
  if (cookie) {
    const accRes = await chrome.runtime.sendMessage({ action: 'getAccount' });
    const existingAccount = accRes?.data;
    await chrome.runtime.sendMessage({ action: 'setAccount', payload: {
      session: cookie, a1: existingAccount?.a1 || '', nickname: existingAccount?.nickname || '', avatar: existingAccount?.avatar || ''
    }});
  }
  const btn = $('#btnSaveSettings');
  if (btn) { const orig = btn.textContent; btn.textContent = '已保存'; btn.classList.add('is-done'); setTimeout(() => { btn.textContent = orig; btn.classList.remove('is-done'); }, 1500); }
}

// ========== 账号绑定 ==========
/* 单个区块的显隐：统一走 .hidden 类，不用内联 style.display。
   原因：.hidden 是 display:none !important（common.css:1098），
   而内联样式没有 !important —— 给带 .hidden 的元素写
   `el.style.display='block'` 等于什么都没做，元素永远不出现。
   账号三态里「已绑定」「加载中」两块在 HTML 里都带 hidden 类，
   原来用 style.display 切换 → 绑定成功后界面毫无变化，
   按钮看起来就是坏的。 */
function showBlock(el, on) { if (el) el.classList.toggle('hidden', !on); }

async function loadAccountStatus() {
  const unbound = $('#accountUnbound'); const bound = $('#accountBound'); const loading = $('#accountLoading');
  if (!unbound || !bound || !loading) return;
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getAccount' });
    const account = res?.data;
    if (account?.session || account?.a1) {
      showBlock(unbound, false); showBlock(bound, true); showBlock(loading, false);
      const nickEl = $('#boundNickname'); const avatarEl = $('#boundAvatar');
      // 有昵称才敢说「已绑定」；只有 Cookie 时如实写「已保存登录态（未确认账号）」
      if (nickEl) nickEl.textContent = account.nickname || '已保存登录态（未确认账号）';
      if (avatarEl) {
        if (account.avatar) { avatarEl.innerHTML = `<img class="avatar-img" src="${spEsc(account.avatar)}" alt="">`; }
        else { avatarEl.textContent = ''; }
      }
      setAccountNotice(account.nickname ? '' : '没有昵称头像：Cookie 已存下，但没能确认是哪个账号。',
        'warn');
      const cookieEl = $('#accountCookie');
      if (cookieEl && account.session && !cookieEl.value) cookieEl.value = account.session;
    } else { showBlock(unbound, true); showBlock(bound, false); showBlock(loading, false); }
  } catch (_) { showBlock(unbound, true); showBlock(bound, false); showBlock(loading, false); }
}

async function handleBindAccount() {
  const unbound = $('#accountUnbound'); const bound = $('#accountBound'); const loading = $('#accountLoading');
  if (!unbound || !bound || !loading) return;
  showBlock(unbound, false); showBlock(loading, true);
  try {
    const res = await chrome.runtime.sendMessage({ action: 'bindAccount' });
    if (!res || !res.success) { alert(res?.error || '绑定失败'); showBlock(loading, false); showBlock(unbound, true); return; }
    const account = res.data;
    showBlock(bound, true); showBlock(loading, false);
    const nickEl = $('#boundNickname'); const avatarEl = $('#boundAvatar');
    // 没确认出昵称时不说「已绑定账号」——那是在替系统编一个事实。
    // 措辞改成「已保存登录态」，并把未确认这件事原样显示出来。
    if (nickEl) nickEl.textContent = account.nickname || '已保存登录态（未确认账号）';
    if (avatarEl) {
      if (account.avatar) { avatarEl.innerHTML = `<img class="avatar-img" src="${spEsc(account.avatar)}" alt="">`; }
      else { avatarEl.textContent = ''; }
    }
    if (!res.verified && res.warning) {
      setAccountNotice(res.warning, 'warn');
    } else {
      setAccountNotice('');
    }
    const cookieEl = $('#accountCookie');
    if (cookieEl && account.session) cookieEl.value = account.session;
  } catch (err) { alert('绑定失败：' + (err.message || '网络错误')); showBlock(loading, false); showBlock(unbound, true); }
}

/** 绑定区下方的状态行：只说事实 + 下一步，不粉饰 */
function setAccountNotice(text, kind) {
  const el = $('#accountNotice');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'status-line mt-2' + (text ? (kind === 'warn' ? ' st-warn' : ' st-ok') : '');
}

async function handleUnbindAccount() {
  const btn = $('#btnUnbindAccount');
  if (btn) btn.disabled = true;
  try {
    await chrome.runtime.sendMessage({ action: 'unbindAccount' });
    const bound = $('#accountBound'); const unbound = $('#accountUnbound'); const cookieEl = $('#accountCookie');
    // 用 .hidden 类切换而不是内联 style.display ——
    // .hidden 带 !important，比内联更稳，也符合项目自己的「禁止内联样式」约定。
    if (bound) bound.classList.add('hidden');
    if (unbound) unbound.classList.remove('hidden');
    if (cookieEl) cookieEl.value = '';
    showUndo('已解除账号绑定', async () => {
      // 重新绑回当前登录的账号 —— 绑定本身就是「读当前登录态」，
      // 所以回退不需要额外参数，再走一次 bindAccount 即可。
      await handleBindAccount();
    });
  } catch (e) {
    const desc = $('#accountNotice');
    if (desc) { desc.textContent = '解除绑定失败：' + (e && e.message ? e.message : e); desc.className = 'status-line mt-2 st-err'; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// =====================================================================
// 模板生成模块
// =====================================================================

const _TPL = {
  templates: [],
  tones: [],
  selectedTemplate: null,
  selectedTone: null,
  generating: false
};

async function refreshTemplateList() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getTemplateList' });
    if (res?.success && Array.isArray(res.data)) _TPL.templates = res.data;
  } catch (_) {}
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getToneList' });
    if (res?.success && Array.isArray(res.data)) _TPL.tones = res.data;
  } catch (_) {}
  renderTemplateCards();
}

function renderTemplateCards() {
  const grid = $('#templateGrid');
  const hint = $('#tplEmptyHint');
  if (!grid) return;

  // 模板卡图标走 SVG 图标层，不吃服务端下发的 emoji：
  // 六个彩色表情排在一起是「不轻」的根源，而且各系统字形不一致。
  // 语义就近取，key 认不出来就退回 doc，不留空洞。
  const TPL_ICON = {
    recommend: 'sparkle',  // 种草：好物被点亮
    explore:   'home',     // 探店：店
    travel:    'list',     // 行程：清单
    vlog:      'image',    // 分镜：画面
    daily:     'pen',      // 短文案：写
    review:    'chart',    // 测评：数据
    record:    'doc'       // 经验记录：文档（v2.44.0，配套 AI 体裁白名单）
  };
  const templates = _TPL.templates.length > 0 ? _TPL.templates : [
    { key: 'recommend', name: '种草体', desc: '好物/好店推荐' },
    { key: 'explore', name: '探店体', desc: '美食/咖啡馆/小众店' },
    { key: 'travel', name: '行程攻略体', desc: '旅行/城市攻略' },
    { key: 'vlog', name: 'Vlog脚本体', desc: '短视频脚本分镜' },
    { key: 'daily', name: '日签短文案', desc: '朋友圈/日常短文案' },
    { key: 'review', name: '测评对比体', desc: '真实测评对比' },
    { key: 'record', name: '经验记录体', desc: '开发/学习/踩坑复盘记录' }
  ];

  grid.innerHTML = templates.map(t => `
    <div class="tpl-card${_TPL.selectedTemplate === t.key ? ' selected' : ''}" data-tpl="${t.key}">
      <div class="tpl-icon">${Icons.svg(TPL_ICON[t.key] || 'doc', { size: 20 })}</div>
      <div class="tpl-name">${t.name}</div>
      <div class="tpl-desc">${t.desc || ''}</div>
    </div>
  `).join('');

  // 绑定点击
  grid.querySelectorAll('.tpl-card').forEach(card => {
    card.addEventListener('click', () => selectTemplate(card.dataset.tpl));
  });

  // 如果之前有选中，保持表单显示
  if (_TPL.selectedTemplate) {
    selectTemplate(_TPL.selectedTemplate, true);
  }

  // 更新空状态
  if (hint) hint.classList.toggle('hidden', !!_TPL.selectedTemplate);
}

async function selectTemplate(tplKey, keepInputs) {
  _TPL.selectedTemplate = tplKey;

  // 更新卡片选中状态
  document.querySelectorAll('.tpl-card').forEach(c => c.classList.toggle('selected', c.dataset.tpl === tplKey));

  // 获取模板详情
  let tpl = null;
  // 先从服务端拿
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getTemplateDetail', payload: { key: tplKey } });
    // ⚠ 必须校验**形状**，不能只看 res.success。
    // 以前是 `if (res?.success) tpl = res.data;` —— data 只要是真值就照单全收。
    // 一旦返回的不是模板对象（比如 data 是 []、是 null、或结构变了），
    // 后面 `tpl.inputs.forEach` 直接抛 TypeError，
    // 异常一路冒到 selectTemplate 的调用方，**表单一个字都渲染不出来** ——
    // 六个模板卡于是又变成「点了没反应」的假按钮。
    // 形状不对就当没拿到，走下面的内置定义。
    const d = res?.data;
    if (res?.success && d && typeof d === 'object' && Array.isArray(d.inputs)) tpl = d;
  } catch (_) {}

  // fallback: 使用本地默认定义
  if (!tpl) {
    const defaults = {
      recommend: { name: '种草体', inputs: [
        { key: 'name', label: '产品/店名', placeholder: '如：槟城街头榴莲摊' },
        { key: 'selling_point', label: '核心卖点', placeholder: '如：现开猫山王，老板会挑熟度' },
        { key: 'scenario', label: '个人使用场景', placeholder: '如：傍晚逛完街路过被香味吸引' },
        { key: 'price', label: '价格区间', placeholder: '如：人均30-50RM' },
        { key: 'target', label: '适合人群', placeholder: '如：榴莲爱好者' }
      ]},
      explore: { name: '探店体', inputs: [
        { key: 'shop_name', label: '店名', placeholder: '如：胡同深处的独立咖啡馆' },
        { key: 'category', label: '品类', placeholder: '咖啡/美食/酒吧/书店...' },
        { key: 'signature', label: '招牌必点', placeholder: '如：手冲耶加雪菲+自制提拉米苏' },
        { key: 'vibe', label: '环境氛围', placeholder: '如：老厂房改造，水泥墙+绿植' },
        { key: 'cost', label: '人均消费', placeholder: '如：60-80元' },
        { key: 'location_hours', label: '地址/营业时间', placeholder: '如：北京市东城区xx胡同 10:00-22:00' },
        { key: 'story', label: '老板/店员故事（可选）', placeholder: '如：老板之前在澳洲做了8年咖啡' }
      ]},
      travel: { name: '行程攻略体', inputs: [
        { key: 'destination', label: '目的地', placeholder: '如：槟城' },
        { key: 'duration', label: '天数/时长', placeholder: '如：3天2夜' },
        { key: 'theme', label: '主题标签', placeholder: '美食/户外/亲子/情侣/独行侠' },
        { key: 'must_visit', label: '必去清单', placeholder: '如：升旗山、乔治市壁画街、汕头街夜市' },
        { key: 'hidden_gems', label: '小众秘境', placeholder: '如：姓周桥旁边的秘密日落点' },
        { key: 'budget', label: '预算范围', placeholder: '如：人均1500-2000元' }
      ]},
      vlog: { name: 'Vlog脚本体', inputs: [
        { key: 'topic', label: '视频主题', placeholder: '如：一个人的治愈周末' },
        { key: 'duration', label: '总时长（秒）', placeholder: '60' },
        { key: 'scenes', label: '场景清单', placeholder: '如：起床、做早餐、咖啡馆、公园散步、回家看书' },
        { key: 'mood', label: '情绪关键词', placeholder: '治愈/热血/搞笑/悬念' },
        { key: 'music', label: 'BGM风格', placeholder: '轻快/氛围感/节奏感' }
      ]},
      daily: { name: '日签短文案', inputs: [
        { key: 'scene', label: '今日场景', placeholder: '如：雨天在家煮了一壶热茶' },
        { key: 'mood', label: '心情/感悟', placeholder: '如：慢下来的周末真好' },
        { key: 'photo', label: '配图描述', placeholder: '如：窗边的茶壶冒着热气，猫窝在脚边' },
        { key: 'context', label: '时间/天气', placeholder: '如：周六下午/小雨' }
      ]},
      review: { name: '测评对比体', inputs: [
        { key: 'product', label: '测评对象', placeholder: '如：XX品牌的冻干咖啡' },
        { key: 'compare_with', label: '对比项（可选）', placeholder: '如：和之前喝的3款速溶对比' },
        { key: 'dimensions', label: '测评维度', placeholder: '口感/性价比/服务/环境...' },
        { key: 'experience', label: '真实体验', placeholder: '如：喝了三天的真实感受...' },
        { key: 'who_for', label: '适合人群', placeholder: '如：预算有限但不想降低品质的咖啡爱好者' }
      ]},
      record: { name: '经验记录体', inputs: [
        { key: 'event', label: '事件/里程碑', placeholder: '如：我的开源项目转正了' },
        { key: 'process', label: '过程关键点', placeholder: '如：被卡了5次，每次卡在哪' },
        { key: 'numbers', label: '具体数字', placeholder: '如：改了11版、跑了3天' },
        { key: 'takeaway', label: '一句话结论', placeholder: '如：能过审的都有共同结构' },
        { key: 'audience', label: '写给谁', placeholder: '如：想上架收费skill的开发者' }
      ]}
    };
    tpl = defaults[tplKey] || { name: tplKey, inputs: [] };
  }

  // 显示表单
  const form = $('#templateForm');
  const hint = $('#tplEmptyHint');
  // ⚠ 必须是 classList，不是 style.display ——
  // #templateForm 的 class 里有 hidden，而 .hidden 带 !important
  // （common.css:1098）。原来这里写 form.style.display='block'，
  // **内联样式赢不了 !important，表单永远出不来**：
  // 选完模板卡只有卡片高亮，表单和「生成文案」按钮根本不出现 ——
  // 六个模板卡于是全成了「点了没反应」的假按钮。
  if (form) form.classList.remove('hidden');
  if (hint) hint.classList.add('hidden');
  $('#tplFormTitle').textContent = (tpl.icon || '') + ' ' + tpl.name;

  // 渲染输入字段
  renderInputFields(tpl.inputs || [], keepInputs);
  // 渲染语气选择
  renderToneSelector();
}

function renderInputFields(inputs, keepInputs) {
  const container = $('#tplInputFields');
  if (!container) return;

  // 保存已有值（如果 keepInputs）
  const existingValues = {};
  if (keepInputs) {
    container.querySelectorAll('input, textarea').forEach(el => {
      existingValues[el.name] = el.value;
    });
  }

  container.innerHTML = inputs.map(inp => `
    <div class="tpl-field">
      <label>${inp.label}</label>
      ${(inp.key === 'experience' || inp.key === 'story' || inp.key === 'scenes')
        ? `<textarea name="${inp.key}" placeholder="${inp.placeholder || ''}" rows="2">${existingValues[inp.key] || ''}</textarea>`
        : `<input type="text" name="${inp.key}" placeholder="${inp.placeholder || ''}" value="${existingValues[inp.key] || ''}">`
      }
    </div>
  `).join('');
}

function renderToneSelector() {
  const container = $('#toneSelector');
  if (!container) return;

  const tones = _TPL.tones.length > 0 ? _TPL.tones : [
    { key: '', name: '默认', desc: '不调整语气' },
    { key: 'hot', name: '热血版', desc: '感叹号多、节奏快' },
    { key: 'chill', name: '松弛版', desc: '长句、慵懒、反精致' },
    { key: 'anti', name: '反套路版', desc: '反差、吐槽、真实' },
    { key: 'dry', name: '干货版', desc: '短段落、实用' },
    { key: 'story', name: '故事版', desc: '叙事感、细节' },
    { key: 'savage', name: '毒舌版', desc: '吐槽、犀利' }
  ];

  container.innerHTML = tones.map(t => `
    <span class="tone-chip${_TPL.selectedTone === t.key ? ' selected' : ''}" data-tone="${t.key}" title="${t.desc || ''}">${t.name}</span>
  `).join('');

  container.querySelectorAll('.tone-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      _TPL.selectedTone = chip.dataset.tone || null;
      container.querySelectorAll('.tone-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });
}

async function handleTemplateGenerate() {
  if (_TPL.generating) return;
  const tplKey = _TPL.selectedTemplate;
  if (!tplKey) {
    // ⚠ 原来直接静默 return —— 用户看到 6 个场景卡片摆在上面，
    //    第一次很可能直接点「生成」，结果**完全没有任何反应**，
    //    只会以为按钮坏了。静默 return 在这里就是伪装成「死按钮」。
    const st0 = $('#tplStatus');
    if (st0) {
      st0.textContent = '先在上面选一个场景，再点生成。';
      st0.className = 'status-line mt-2 st-warn';
    }
    return;
  }

  // 收集输入值
  const inputs = {};
  const fields = document.querySelectorAll('#tplInputFields input, #tplInputFields textarea');
  let hasValue = false;
  fields.forEach(el => {
    const val = el.value.trim();
    if (val) hasValue = true;
    inputs[el.name] = val;
  });

  if (!hasValue) {
    const status = $('#tplStatus');
    if (status) { status.textContent = '请至少填写一个字段'; status.className = 'status-line mt-2 st-warn'; }
    return;
  }

  _TPL.generating = true;
  const btn = $('#btnGenerateTpl');
  const status = $('#tplStatus');
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
  if (status) { status.textContent = '正在调用 AI 生成…'; status.className = 'status-line mt-2 st-run'; }

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'generateWithTemplate',
      payload: {
        templateType: tplKey,
        inputs: inputs,
        tone: _TPL.selectedTone || undefined
      }
    });
    if (!res.success) throw new Error(res.error);

    // 切换到对话标签显示结果
    switchToTab('chat');
    addMsg('user', `使用【${_TPL.templates.find(t => t.key === tplKey)?.name || tplKey}】模板生成`);
    addMsg('assistant', res.data);

    // 重置状态
    if (btn) { btn.disabled = false; btn.textContent = '生成文案'; }
    if (status) { status.textContent = '生成成功，结果已发送到对话'; status.className = 'status-line mt-2 st-ok'; }
    setTimeout(() => { if (status) { status.textContent = ''; status.className = 'status-line mt-2'; } }, 3000);
  } catch (err) {
    if (status) { status.textContent = '生成失败：' + (err && err.message || '未知错误'); status.className = 'status-line mt-2 st-err'; }
    if (btn) { btn.disabled = false; btn.textContent = '生成文案'; }
  }
  _TPL.generating = false;
}

function initTemplates() {
  $('#btnGenerateTpl')?.addEventListener('click', handleTemplateGenerate);
  $('#btnFillTpl')?.addEventListener('click', handleTemplateFill);
  /* v2.38.0：模板页的空态胶囊已删除 ——
     顶部说明 + 6 张带名字的卡片本身就是选择器，
     再给一组胶囊是同一件事的两个入口。
     这里保留空值保护即可。 */
  // 初始加载模板列表
  refreshTemplateList();
}

/**
 * 「AI 帮我填」——把模板表单逐项预填上。
 *
 * 为什么必须有这个：模板页每个模板 5~7 个字段，全靠手敲的话，
 * AI 的价值就只剩最后那一下「生成」了。用户抱怨的「为什么还是需要人工填」
 * 说的就是这件事。
 *
 * 三条纪律：
 *  ① 拿不到选题方向就不填 —— 没有方向的填充等于编，界面要直说原因
 *  ② 部分失败要**逐项**如实反映，不能因为第 3 项失败就说全都没填
 *  ③ 预填后用户随时能改 —— 这是草稿不是结论，所以不做任何「锁定」
 */
async function handleTemplateFill() {
  const btn = $('#btnFillTpl');
  const status = $('#tplStatus');
  const say = (text, cls) => {
    if (!status) return;
    status.textContent = text;
    status.className = 'status-line mt-2 ' + (cls || 'st-run');
  };

  if (!_TPL.selectedTemplate) {
    say('先在上面选一个场景模板', 'st-warn');
    return;
  }
  const fields = Array.from(document.querySelectorAll('#tplInputFields input, #tplInputFields textarea'))
    .map(el => ({
      key: el.name,
      label: el.closest('.tpl-field')?.querySelector('label')?.textContent?.trim() || el.name,
      placeholder: el.placeholder || '',
      el
    }));
  if (!fields.length) { say('这个模板没有可填的字段', 'st-warn'); return; }

  if (btn) { btn.disabled = true; }

  try {
    // 选题方向：优先用驾驶舱给的 todayPick.topicSeed
    let topicSeed = '';
    let plan = null;
    try {
      const pr = await chrome.runtime.sendMessage({ action: 'getPlan' });
      plan = (pr && pr.success && pr.data) || null;
      topicSeed = (plan && plan.todayPick && plan.todayPick.topicSeed) || '';
    } catch (_) {}

    if (!topicSeed) {
      /* ⚠ 原来这里直接 return 并让用户「先去今天页生成计划」。
         但样本不足时 todayPick 本来就是空的，
         于是用户明明采了数据，却永远等不到那个计划 —— 死锁。
         现在：没有选题方向也让模型根据账号历史自行判断。
         只有连账号上下文都没有时才拒绝，那是真的没东西可用。 */
      const ctx0 = (typeof loadChatContext === 'function') ? await loadChatContext() : '';
      if (!ctx0) {
        say('还没有任何账号数据 —— 先在「今天」页采集一次，这里就能自动预填', 'st-warn');
        return;
      }
      say('没有现成的选题方向，正在按你的历史数据判断一个…', 'st-run');
    }

    const ctx = (typeof loadChatContext === 'function') ? await loadChatContext() : '';
    if (!topicSeed) {
      say('正在按你的历史数据判断选题方向…', 'st-run');
    } else {
      say('正在按你的账号数据预填…', 'st-run');
    }

    const res = await chrome.runtime.sendMessage({
      action: 'fillTemplate',
      payload: {
        templateKey: _TPL.selectedTemplate,
        topicSeed,
        context: ctx,
        fields: fields.map(f => ({ key: f.key, label: f.label, placeholder: f.placeholder }))
      }
    });

    if (!res || !res.success) {
      say((res && res.error) || '预填失败，请重试一次', 'st-warn');
      return;
    }

    let filled = 0, needYou = 0;
    for (const f of fields) {
      const v = res.data ? res.data[f.key] : '';
      if (typeof v !== 'string' || !v.trim()) continue;
      f.el.value = v.trim();
      filled++;
      if (/^需要你补充/.test(v.trim())) needYou++;
    }
    if (!filled) {
      say('模型这次没填出内容，请重试一次', 'st-warn');
      return;
    }
    say(needYou
      ? `已预填 ${filled} 项，其中 ${needYou} 项需要你补充 —— 直接改完就能生成`
      : `已预填全部 ${filled} 项，看看有没有要改的，然后点「生成文案」`, 'st-ok');
  } catch (e) {
    say('预填失败：' + ((e && e.message) || '网络错误'), 'st-warn');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// =====================================================================
// 起号助手联动模块（本地汐构起号助手 http://127.0.0.1:8123）
// =====================================================================

const QIHAO_API = 'http://127.0.0.1:8123';

function initQihao() {
  $('#qihaoDiagNote')?.addEventListener('click', qihaoDiagNote);
  $('#qihaoDiagAuthor')?.addEventListener('click', qihaoDiagAuthor);
  /* v2.36.0：#qihaoOpenWorkbench 已随「打开完整工作台」一并移除。
     工作台定位为独立付费产品（998 元/月），入口不挂在免费侧栏里 ——
     免费工具里露出收费品 + 弹一个配色不同的新页面，用户只会当成 bug。 */
}

/**
 * 起号助手结果区。
 *
 * ⚠ state 原来叫 isErr，只分「不是错」和「是错」，
 *    于是**进行中**也被打成「分析完成」——
 *    用户看到的是「分析完成」+ 一个永远转不完的抓取提示。
 *    假成功比明显失败伤害大得多。
 *    改成三态：run / ok / err。
 */
function qihaoShow(text, state = 'run') {
  const el = $('#qihaoResult');
  if (!el) return;
  el.classList.remove('hidden');
  el.classList.toggle('err', state === 'err');
  el.textContent = text;
  const st = $('#qihaoStatus');
  if (st) {
    st.textContent = { run: '进行中…', ok: '分析完成', err: '连接失败' }[state] || '';
  }
}

async function qihaoSend(ep, payload, label) {
  qihaoShow('正在分析…', 'run');
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    const r = await fetch(QIHAO_API + ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const j = await r.json();
    const d = j.data || {};
    let out = `${label}\n`;
    if (d.status) {
      out += `状态：${d.status.phase_name}\n${(d.status.summary || '').slice(0, 90)}…\n\n【核心问题】\n` +
        (d.problems || []).map(p => `· ${p.title}`).join('\n') +
        `\n\n【前 3 个动作】\n` + (d.actions || []).slice(0, 3).map(a => `· ${a.title}`).join('\n');
    } else if (d.topics) {
      out += `10 个选题模板（前 5）：\n` + (d.topics || []).slice(0, 5).map(t => `${t.no}. ${t.title_template}`).join('\n');
    } else {
      out += JSON.stringify(d).slice(0, 300);
    }
    out += '\n\n→ 点「打开完整工作台」看完整报告';
    qihaoShow(out, 'ok');
  } catch (e) {
    const msg = e.name === 'AbortError' ? '分析超时' : e.message;
    qihaoShow(`无法连接起号助手（${msg}）\n\n请确认：\n1. 已双击 run.bat 启动（端口 8123）\n2. 起号助手窗口未关闭`, 'err');
  }
}

async function qihaoDiagNote() {
  qihaoShow('抓取当前笔记…', 'run');
  // ⚠ 必须 try/catch：withXhsTab 在找不到小红书标签页时 **throw**。
  //    没有 catch 的话异常逃逸成 unhandled rejection，
  //    UI 永远停在「抓取当前笔记…」，用户等不到任何结果也看不到原因。
  let res;
  try {
    res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrape' }));
  } catch (e) {
    qihaoShow(`抓取失败：${e.message}\n\n请打开任意一个小红书页面后重试`, 'err');
    return;
  }
  if (!res || !res.success) { qihaoShow('抓取笔记失败：请切换到小红书笔记详情页后重试', 'err'); return; }
  const n = res.data || {};
  const text = `【爆款笔记】\n标题：${n.title || ''}\n作者：${n.authorName || ''}\n正文：${(n.content || '').slice(0, 800)}\n链接：${n.url || ''}`;
  await qihaoSend('/api/agents/topic-breakdown', { input: text, context: '' }, '爆款拆解完成');
}

async function qihaoDiagAuthor() {
  qihaoShow('抓取博主主页…', 'run');
  let res;
  try {
    res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrapeProfile' }));
  } catch (e) {
    qihaoShow(`抓取失败：${e.message}\n\n请打开任意一个小红书页面后重试`, 'err');
    return;
  }
  if (!res || !res.success) { qihaoShow('抓取失败：请切换到小红书博主主页后重试', 'err'); return; }
  const p = res.data || {};
  const text = `【博主主页】\n博主：${p.name || ''}\n粉丝：${p.fans ?? '未知'}\n笔记：${p.posts ?? '未知'}\n简介：${p.intro || '无'}\n链接：${p.url || ''}`;
  await qihaoSend('/api/agents/account-diagnosis', { input: text, context: '' }, '账号诊断完成');
}

// =====================================================================
// 初始化入口
// =====================================================================

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  _S.currentTab = tab;

  const isXhs = tab?.url?.includes('xiaohongshu.com') || tab?.url?.includes('xhs.cn');
  const pageInfo = $('#pageInfo');
  if (pageInfo) {
    pageInfo.textContent = isXhs ? (tab.title || '小红书页面') : '请切换到小红书页面以使用抓取功能';
  }
  const dot = $('#statusDot') || $('#authorStatusDot');
  if (dot) {
    dot.className = 'dot ' + (isXhs ? 'ok' : 'err');
    const txt = $('#statusText') || $('#authorStatusText');
    if (txt) txt.textContent = isXhs ? '已连接' : '非小红书页面';
  }

  // Tab 绑定
  $$('.tab').forEach(tabEl => {
    tabEl.addEventListener('click', () => switchToTab(tabEl.dataset.tab));
  });

  // 从 background 获取 provider 列表
  try {
    const provRes = await chrome.runtime.sendMessage({ action: 'getProviders' });
    if (provRes && provRes.success) _S._providers = provRes.data;
  } catch (e) { console.warn('[XHS] 获取 Provider 列表失败:', e); }

  // 加载聊天历史
  loadChatHistory();

  // 各模块初始化
  initChat();
  initTemplates();
  initTools();
  initQihao();
  await initCart();
  await initSettings();
});
