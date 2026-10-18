# AGENTS.md

面向 AI agent 的项目指南。人类开发者看 `README.md`。

## 这是什么

**small-RPA** —— 一个 Chrome MV3 扩展，为小红书运营者提供「浏览器内的小型 RPA」能力。

对标影刀 RPA，但**只做指令级的窄场景**，不做通用流程编排器。核心主张：

> 所有能力都在浏览器本地完成，100% DOM 读取或本地 XHR 钩子，不爬协议、不绕风控、不依赖任何外部 daemon。

## 架构（动手前必须理解）

MV3 双世界模型是这个项目最容易踩坑的地方，**改任何采集逻辑前先读这段**。

```
┌─ MAIN world ──────────────────┐
│  net-listener.js               │  挂钩页面自己的 fetch / XHR
│  （拿得到响应体）               │  → window.postMessage
└───────────────┬───────────────┘
                │
┌─ ISOLATED world ──────────────┐  ← 拿不到页面的 fetch 引用
│  content.js                   │  content_scripts (ISOLATED)
│  · DOM 抓取器                  │  · 校验并中继监听数据
│  · 监听中继                    │  · 注入「加入分析车」按钮
│  · 创作者中心抓取器            │
└───────────────┬───────────────┘
                │ chrome.runtime.sendMessage
┌─ Service Worker ──────────────┐
│  background.js                │  · 消息路由
│  · 采集编排（后台标签页）        │  · chrome.alarms 任务调度
│  · storage 落盘 + 脱敏          │  · AI Provider 适配
└───────────────────────────────┘
                │
┌─ Side Panel ──────────────────┐
│  sidepanel.js  主界面 + 模板    │
│  datacenter.js 📈 数据中心      │
│  automation.js 🤖 自动化        │
└───────────────────────────────┘
```

### 视觉层硬约束

### CSS 分层（v2.7.0 起）

| 文件 | 装什么 | 为什么 |
|---|---|---|
| `common.css` | 令牌 + 可复用组件 | sidepanel 与设计实验室共用。**只放两者都用得到的东西** |
| `sidepanel/shell.css` | 侧边栏骨架（`sp-body`/`rail`/`stage`/`topbar`/`main`） | 骨架是侧边栏专属的。放进 `common.css` 会用 `body{display:flex;height:100vh;overflow:hidden}` 打中设计实验室，把普通流式页面裁掉 |

骨架根用**作用域类 `.sp-body`** 而不是裸 `body`：设计实验室也 link `shell.css`，
裸选择器会把实验室外壳一起改成 100vh 裁切布局。

### 禁止内联 `style="..."`

`sidepanel/sidepanel.html` / `sidepanel/*.js` 里的视觉一律引用令牌或类名。
**有事故记录**：v2.6.0 时 `common.css` 已有完整令牌，但散落 149 处内联样式绕过了它，
圆角/间距/阴影各自为政，界面显得杂乱。（v2.9.0 起 popup 已删除，入口收进侧边栏。）

自查：

```powershell
Select-String -Path sidepanel\*.js,sidepanel\*.html -Pattern 'style="' | Measure-Object
```

### 尺度来自 VI 基础规则

`design-to-product/references/foundations.md` 的取值，不是随手定的：

- 触控目标 **44×44px**（**导航项、图标按钮**：`.rail-item` / `.btn-icon` /
  `.input-row button`）。文字按钮（`.btn` 36px、`.btn-sm` 30px）
  **不在此范围内** —— 密集表格和工具格里全给 44px 会把版面撑散。
  这条规则的适用对象是导航与图标，不是所有按钮；`dev/a11y-sweep.py` 按此范围判定。
- **导航必须单层可达**：每个功能一次点击就能到，不许有「更多」「展开」这类
  中转层把它藏起来。竖排轨道 10 项约 560px，侧栏通常 700px 以上，放得下。
  这条由 `dev/nav-gate.mjs` 强制，撤销浮层当例会红。
- 圆角收敛为 **8/12/16** 三档，别再出现 4/6/10/14 四档并存
- 间距严格 **4px 基数**：4/8/12/16/24/32，别写 6px 或 20px
- 正文 **15px**，关键数据不允许缩到 12px 以下
- 阴影三级，不让平级卡片全部强悬浮

### 文字色必须过对比度

品牌红当填充、当描边、当图标都没问题，但**当 11px 的文字就读不清**：

| 令牌 | 白底对比度 | 用途 |
|---|---|---|
| `--accent` #ff2442 | 3.76:1 | 填充 / 描边 / 图标（品牌色本体） |
| `--accent-ink` #c2182f | 6.06:1 | **作文字时用这个** |
| `--success` #0a8f4d | 4.16:1 | 填充 |
| `--success-ink` #0d7f47 | 5.07:1 | 作文字 |
| `--warning` #b26a00 | 4.24:1 | 填充 |
| `--warning-ink` #9a5d00 | 5.33:1 | 作文字 |
| `--ink-3` #676e79 | 5.14:1 | 说明文字（**不得再调浅**） |

**轻盈感不能靠牺牲可读性换。** `--ink-3` 一度是 #838a96（3.19:1），
被 33 条规则用作 9–13px 的小字色 —— 那不是轻盈，是看不清。
`--ink-disabled`（2.04:1）只许用于真正的禁用态，占位符请用 `--ink-placeholder`。
改完跑 `python dev/a11y-sweep.py`。

### 颜色角色先于色名

`--canvas` 画布 / `--surface` 表面 / `--ink` 主文字 / `--ink-2` 次文字 /
`--border` 描边 / `--accent` 强调 / `--on-accent` 强调上的文字 /
`--success` / `--warning` / `--danger` / `--focus`。

**`--accent`（小红书红）只承担三件事**：选中指示条、最高级主动作、AI 建议卡左边框，
面积占比约 10%。界面其余部分回归中性色 —— 「轻盈感」来自减少元素，不是淡化品牌色。
红色块当整块背景会让 400px 侧栏读作「警示」而非「当前位置」。

### 改视觉前先看，别盲改

```text
# 打开设计实验室（mock 数据 + 状态切换 + 窄屏/暗色）
file:///E:/工作/small-RPA/dev/preview.html#data/ready
# hash 格式：#面板/状态/模式   状态=empty|loading|ready|error   模式=dark|narrow
```

历史上连续两版都是**盲改生产 CSS 然后让你去看结果**，第一次直接把界面改废了。
先在实验室里看到效果，再写回生产。

### 类名迁移（v2.38.2 已完成）

v2.7.0 重命名了组件类（`sec-title`→`sec-t`、`metric`→`kpi`、`badge`→`pill`…），
旧名曾靠 `common.css` 逗号选择器过渡兼容。v2.38.2 起 JS/HTML 全部迁到新名，
**逗号里的旧名已删除** —— 别再往规则里并旧别名；新增组件直接用新名。

## 关键约束

1. **响应体只能从 MAIN world 拿。** MV3 的 `chrome.webRequest` 只有观测没有 body，`declarativeNetRequest` 同样读不到。想抓响应体只能 `world: "MAIN"` 注入（需 Chrome 111+）。别试图用别的办法绕。
2. **MAIN → ISOLATED 只能靠 `postMessage`，且必须校验。** 页面上任何脚本都能发 `postMessage`，`content.js` 里的中继必须校验 `event.source === window` + `__xhsNet === true` + URL 是 http(s)，否则等于开了个任意写入 storage 的口子。
3. **后台标签页采集用 `active: false`。** 采集会开/关标签页，绝不能打断用户当前页面。串行而非并发 —— 小红书对并发敏感，且串行能定位到是哪一个失败。
4. **`chrome.alarms` 是 MV3 里唯一可靠的定时机制。** Service Worker 15 分钟空闲即终止，`setTimeout` 不可靠。`onInstalled` 里必须重建 alarm。
5. **缺失值 `-` 不是 0。** 内容分析页对新发笔记大量返回 `-`（未跑够样本）。所有解析必须把它当 `null` 处理，否则诊断均值被 0 污染。这是本项目最常见的正确性 bug 来源。
   计算比值必须走 `datacenter.js` 里的 `dcRatio()`，**不要写 `a > 0 ? b / a : null`** ——
   `b` 为 null 时会算出 `0` 而不是 null。已因此踩过一次（藏赞比 0.75 vs 1.50，结论还反了）。
6. **AI 管线用 `deepseek-flash`。** 2026-07-24 起 `deepseek-chat` / `deepseek-reasoner` 已停用，
   2026-09-10 起统一为 `deepseek-flash`（DeepSeek-V4.1-Flash）。别再写旧名。
7. **采集后必须自动调 AI。** `collectCreatorData()` 末尾会调 `runAutoAnalysis()`，
   不需要用户导出 CSV 再手动去问任何 agent。AI 失败**不能阻断采集**，只记状态。

## 领域概念

| 术语 | 含义 | 别名/误用 |
|------|------|-----------|
| **内容分析页** | `creator.xiaohongshu.com/statistics/data-analysis`，逐篇明细表格 | 固定「近 90 天」口径 |
| **账号快照/总览** | 创作者中心首页，账号级聚合 | 固定「近 7 日」口径，**不可与单篇数据互相推算** |
| **内容分析列序** | `td[1..10]` = 曝光/观看/封面点击率/点赞/评论/收藏/涨粉/分享/人均观看时长/弹幕 | 2026-10-03 实测确认，改动前先验证 |
| **noteId** | 笔记唯一 ID | **只存在于笔记详情接口的 JSON 响应里**；内容分析页表格没有这个字段 |
| **口径** | 统计周期（近 7 日 vs 近 90 天） | 混用会得出错误结论 |

## 已知的历史纠错

- **2026-06-18「桌面 web 不支持单篇数据」的结论是错的。** 错在用**猜的 URL** 找页面（`/statistics/note`、`/data-board`…）全部 404，而正确路径 `/statistics/data-analysis` 从未试过。真实数据在前端渲染的 DOM 表格里，不走 API。
  → **推论**：断言「某能力不存在 / 某平台限制」之前，必须先在**已登录的真实页面上把菜单点开看一遍**拿到实际 DOM/路由。404 只证明「这个 URL 不对」。
- **noteId 原先靠「去笔记管理页翻 href」拿 —— 那是绕路。** `net-listener.js` 监听笔记详情接口才是正路。

## 对标影刀：明确不做的事

评估要不要加能力时先看这里，避免重复讨论：

| 影刀能力 | 决策 | 原因 |
|----------|------|------|
| 元素库（可视化捕获元素） | ❌ 不做 | 企业级重资产，扩展做不了也不该做 |
| 流程编排 / 拖拽 | ❌ 不做 | 同上 |
| 魔法指令（AI 生成指令） | ❌ 不做 | 面向不会写代码的业务人员，维护者自己写选择器更快 |
| 网页监听 | ✅ 已做 | 唯一真正补上的能力（noteId 正路） |
| 定时调度 | ✅ 已做 | `chrome.alarms` 任务列表 |
| 循环相似元素 | ✅ 已做（简化） | 对标账号批量监控，纯 DOM |

## 仓库结构里的两条并行链路

| 目录 | 是什么 | 状态 |
|------|--------|------|
| 根目录 + `sidepanel/` | **扩展本体**，用户在 Chrome 里跑的东西 | 维护主线 |
| `scripts/` | RPA 采集脚本前身（Kimi WebBridge 版） | **兜底 + 溯源**，非运行依赖 |
| `docs/rpa/` | RPA 采集方案的过程档案 | 归档 |

**关键：不要试图让 `scripts/` 追上扩展。** 扩展的「📈 数据中心」是那两个采集脚本的**超集**
（多了自动翻页、noteId 映射、自动诊断），日常用扩展即可。`scripts/` 只在「扩展装不上」
或「需要 cron 无人值守」时才是退路。

`scripts/` 里有**机器相关配置**，但已全部改成环境变量 + 可用默认值（`XHS_DATA_DIR` /
`KIMI_WEBBRIDGE_EXE` 等），**不设也能直接跑**。改动前先读 `scripts/README.md`。

⚠️ 另有两个个人工具脚本（批量 URL 回填、xlsx 解析）**已刻意排除在公共仓库之外** ——
它们强耦合特定 Obsidian vault 结构且内含未发布选题名。`.gitignore` 里有对应规则，
**不要把它们加回来**。

`docs/rpa/XHS单篇数据抓取失败报告-2026-06-18.md` 的**核心结论已被推翻**，
引用它之前先看 `docs/rpa/README.md` 顶部的失效标注。

`docs/rpa/` 里的本机路径已脱敏为占位符（如 `<本地数据目录>`）；**已发布的笔记标题有意保留**
（那些内容本就在作者的小红书主页上公开），但未发布选题与草稿名一律不进公共仓。

## 开发约定

- 无构建步骤、无 `package.json`、无依赖。改完直接 `chrome://extensions/` 点刷新。
- **授权系统是零服务器的，别按有后端来改。** 签发在 `dev/mint-license.mjs`
  （运营者本机跑，私钥 `dev/license-key.json` **已 gitignore**），
  验签在 `license.js`（内置公钥 + `crypto.subtle`，**无网络**）。
  过期 / 72h 宽限 / 额度 / 时钟回拨全部**离线判定**。
  ⚠️ 本地 AI 额度计数**只是提示，不是安全边界** ——
  真要防作弊必须接服务端，理由见设计文档 2.5。
  ⚠️ `dev/mint-license.mjs` 签名必须带 `dsaEncoding: 'ieee-p1363'`：
  Node 默认输出 DER（71 字节），WebCrypto 只认 raw r‖s（64 字节），
  不一致则**所有码一律验不过，且错误只说「签名失败」**，极难排查。
  这个 bug 真实发生过，由 `dev/license-test.mjs` 的「签发→验签闭环」抓出。
- **改完先跑 `node dev/verify.mjs`** —— 一条命令跑完全部质量闸门
  （当前 41 道，以 `node dev/verify.mjs` 的输出为准：自检 / 图标 / 逻辑 / 过滤行为 /
  采集解析 / 翻页 / 账号标签 / 授权 / agent 调用 / 可达性 / 导航层级 / 显隐机制 /
  内容计划 / 使用流程 / 网格不撑破 / 字阶收敛 / 控件排得下 / 上下文摘要 /
  语音与快捷键 / 类覆盖 / 内联样式 / 实验室同步 / 实验室开关 / 溢出实测 /
  动效 / 动效缺口 / keyframes / emoji / 可读性 / 键盘焦点 / 200% 缩放 /
  尺度 / 截断声明 / 长内容 / 去装饰）。
  `--quiet` 只出结论，`node dev/verify.mjs a11y` 只跑单项。
  改完只跑其中几条，闸门等于没有。
- 闸门报的是**可判定的不变量**，不是主观打分。看到大面积误报要先把闸门改准 ——
  一个永远失败的检查会让人习惯性忽略它，比没有检查更糟。
- **新写的浏览器闸门必须做反向验证**：故意把被检查的那行改坏，
  确认闸门真的会红，然后改回来。没验证过的闸门和没有闸门一样 ——
  本项目已经吃过两次亏（`overflow-sweep` 因探针闭包引用外部变量一路假绿，
  静默返回 undefined 被当空数组）。
- **送进 `Runtime.evaluate` 的函数必须自包含**，不能引用 Node 侧变量。
- **静态检查与实测必须成对**。`text-fit-sweep.py` 查「截断规则写得自不自洽」，
  `longtext-sweep.mjs` 查「真的灌长文本进去有没有生效」——
  前者查不出「声明在、但不生效」，后者查不出「规则写漏了一处」。
  同理：类覆盖 vs 实验室同构、动效声明 vs 减动效实测、触控尺寸 vs 键盘焦点。
- **实验室必须与生产同构**。分析车面板曾经用 `.list-row / .title-2`，
  生产用的是 `.cart-item / .cart-item-title`，导致针对生产样式的判断
  全都在验一个不存在的元素。改面板结构时同步核对 `sidepanel.js` 的渲染函数。
- 落在浏览器里的检查，`Runtime.evaluate` 抛错或返回值形状不对时**必须硬失败**，
  不能 `|| []` 兜成空结果。
- **改完必须 `node --check` 全部 JS**，manifest 必须是合法 JSON。
- 版本号四处同步：`manifest.json` 的 `version`、`background.js` `onInstalled` 的日志
  （已改为从 manifest 读）、README badge 与更新日志、`dev/preview.html` 的
  `LAB_VERSION`（由 `node dev/sync-lab.mjs` 注入，别手改）。
- 新增 `content_scripts` 条目时确认 `world` 字段 —— 漏了就是 ISOLATED，MAIN world 的代码会静默拿不到东西。
- 存储 key 一律 `xhs` 前缀，集中在 `background.js` 顶部的常量里声明，不要散落字面量。
- `dev/*.py` 自带 `sys.stdout.reconfigure(encoding='utf-8')`：控制台默认可能是 GBK，
  输出 ✅/✗ 会抛 `UnicodeEncodeError`。**不要靠调用方设 `PYTHONIOENCODING`**，
  那是 shell 在替脚本兜底，换个终端就崩。

## 验收边界：已测 / 未测

写在这里是为了不让「16/16 通过」被当成「所有东西都验过了」。
design-to-product 的 craft 规则要求明确列出未执行项，不以总分掩盖阻断缺陷。

**已用真实浏览器实测**（`dev/lab-sweep.mjs`、`dev/overflow-sweep.mjs`、
`dev/focus-sweep.mjs`、`dev/zoom-sweep.mjs`、`dev/longtext-sweep.mjs`、
`dev/plain-sweep.mjs`）：

- 10 个面板 × 空/加载/有数据三态 × **900 / 400 / 320 三种画布** ——
  无元素越出画布。**900 覆盖宽屏横排形态，400/320 覆盖竖排形态**
- 键盘 Tab 走到 187 个可聚焦控件 —— 焦点环全部可见，导航/图标按钮均 ≥44×44
- `prefers-reduced-motion: reduce` 下逐元素读计算样式 —— 动效时长真的归零
- 实验室 hash flag 单个/组合/非法值 —— S 状态、DOM 外观、checkbox 三者一致
- 200% 缩放（等效宽度 = 实测标称值 ÷ 2）—— 无越界、正文 ≥10px CSS、点击目标 ≥32px
- 向每个文本容器灌入约 120 字长中文 —— 无静默裁切、截断策略全部生效、
  多行夹取处均有 title 提示、数字未被拆行
- 剥掉阴影/彩色底/边框/图标 —— 文字仍达 WCAG AA、无不可见元素、标题层级仍在

**授权系统（`dev/license-test.mjs`，44 条断言 + 3 项变异验证）**：

- 真私钥签的码能被验过；改 payload / 改签名 / 换公钥 / 改版本 → **全部如期失败**
- 五个状态各自的进入条件与关键字段（`active` / `grace` / `expired` /
  `quota_exhausted` / `unactivated`）
- 72h 宽限期、到期后 `daysPastDue`、3 天内到期提醒
- 时钟回拨：超 5 分钟判定、微小抖动容忍、水位 delta 如实回报
- 特征门控：未激活与已过期**仍可查看与导出**；额度用尽**仍可采集**（只拦 AI）
- **签发→验签闭环**：真跑 `mint-license.mjs` 产出码再验，
  确认两侧规范化逐字节一致（这条抓出了 DER/raw 的真实 bug）
- **变异验证**：把过期判定、额度判定、宽限期可用性分别改坏，
  确认对应断言真的会红 —— 没做过这一步的闸门等于没有闸门

**只测了窄屏的后果（真实教训）**

侧栏宽度由用户拖拽决定，范围 320px 到窗口全宽，跨度六倍。
前二十几轮全部锁在 320/360/400 三档，于是「宽屏该是什么样」
从来没被验证过 —— 直到用户发来真实运行截图（面板被拉到约 1900px），
才看见标题与按钮隔了一千多像素、正文拉到屏幕边缘。
**这不是「再补一个更窄的画布」，而是整个设计前提错了：
把桌面侧栏当成了手机侧栏。**

现在实验室三档是 900 / 400 / 320，且 `dev/shot.mjs` 支持
`SHOT_CANVAS=<px>` 临时拉宽做实拍。

**闸门里不许写死画布标称宽度**

`overflow-sweep` 与 `zoom-sweep` 曾把 400/360/320 写死，
实验室改宽后与实际差 500px，而闸门一路全绿 —— 它压根没看真实宽度。
现在一律现场量 `getBoundingClientRect().width`。

**仅静态分析，未在浏览器里验过**：

- 文字对比度（`a11y-sweep.py` 按 WCAG 公式算，不等于实际渲染后的观感）
- 圆角三档与 4px 间距基数、ellipsis/line-clamp 自洽性
- emoji、内联样式、类覆盖、keyframes 跨文件重复

**离线原理上验不了，必须装上扩展 + 登录真实小红书**：

1. C11 账号绑定是否真带上登录态（`credentials:'include'`）
2. C7 noteId 真实匹配率（`joinNoteIndex` 离线抽样 3/4 命中，真实数据未知）
3. C10 过滤后列表在真实数据下是否真的变
4. 定时采集在 Chrome 休眠 / 扩展重载后是否仍按点触发
5. AI 诊断在真实 API 上的耗时与失败率（`deepseek-flash`）

**完全未做**：

- 屏幕阅读器实测（VoiceOver / NVDA）
- 浏览器「最小字号」设置（与页面缩放不同，会强制放大根字号）
- 跨浏览器（只在 Chromium 上验过；项目是 Chrome 扩展，暂不视为缺陷）

**已知但判定为不做**：

- 200% 缩放下「用户调大字号后版面是否跟着变」：面板是固定 px 宽的侧栏，
  按设计就该维持物理宽度（放大让内容变大，不是让面板变宽）。要真验这条
  得跑两次浏览器对比两次结果，本轮没有做。

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues, operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles with label strings identical to their names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
