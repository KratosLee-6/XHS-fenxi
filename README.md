# 小红书运营工具箱


> ## ⚠️ 本仓库已迁移至 [KratosLee-6/small-RPA](https://github.com/KratosLee-6/small-RPA)
>
> **当前版本 v2.3.0 已停止维护。** 最新进展（v2.6.0）在 small-RPA 仓库：
>
> - 📈 **数据中心** —— 创作者中心直读（账号总览 + 全量单篇明细 + noteId 映射），六项自动诊断
> - 🤖 **自动化** —— 定时任务列表 / 对标账号批量监控 / 网页监听（MAIN world 挂钩 XHR）
> - 🧩 原 RPA 采集脚本与过程档案一并收进 scripts/ 与 docs/rpa/
>
> 本仓库保留原状作为历史快照，请勿再从此处安装或拉取。

[![GitHub stars](https://img.shields.io/github/stars/KratosLee-6/XHS-fenxi?style=social)](https://github.com/KratosLee-6/XHS-fenxi/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/KratosLee-6/XHS-fenxi?style=social)](https://github.com/KratosLee-6/XHS-fenxi/network/members)
[![Version](https://img.shields.io/badge/version-v2.6.0-blue)](https://github.com/KratosLee-6/XHS-fenxi)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Manifest](https://img.shields.io/badge/manifest-MV3-orange)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)

一款面向小红书内容运营者的 Chrome 浏览器扩展，100% 本地 DOM 读取，无需爬虫协议，不爬取不存储任何数据到服务端。

---

## 功能概览

### 侧边栏（主要工作区）

打开小红书任意页面后，点击扩展图标或使用快捷键 **`Ctrl+Shift+X`**（Mac: `Cmd+Shift+X`）即可打开侧边栏，包含五个工作模式：

| Tab | 功能说明 |
|-----|----------|
| **💬 对话** | 粘贴任意小红书笔记链接，自动抓取内容并调用 AI 进行分析、改写、检测或生成文案。支持 Markdown 格式渲染，对话历史自动保存 |
| **📋 模板** | 6大文案场景模板（种草/探店/攻略/Vlog/日签/测评）+ 6种语气风格，填写关键信息一键生成小红书风文案 |
| **🛠 工具** | 手动抓取当前页面笔记数据（标题/正文/图片/评论/搜索列表），一键复制 |
| **👤 博主** | 查看当前笔记作者的主页信息（粉丝数、获赞数等） |
| **📦 分析车** | 批量管理待分析的笔记队列，支持单篇删除、清空、批量 AI 分析、导出为 CSV/JSON/Markdown |
| **📈 数据中心** | 直读创作者中心：账号总览 + 全量单篇明细 + 自动诊断 + 导出 |
| **🤖 自动化** | 定时任务列表 / 对标账号批量监控 / 网页监听（XHR 抓取） |
| **⚙️ 设置** | 配置 AI 模型服务商、API Key、模型参数，以及绑定小红书账号 |

### 📈 数据中心（创作者中心数据直读）

> 本模块由独立的 RPA 采集方案原生化而来。原先用脚本 + 桥接进程读创作者中心，扩展的 content script 本身就是采集器 —— 不再需要外部 daemon、Python 环境或 cron。

打开侧边栏切到 **📈 数据中心**：

1. 点 **📥 一键采集** —— 扩展在**后台标签页**（不打断你当前页面）依次读：
   - 数据看板 → 内容分析：逐篇明细（曝光/观看/CTR/赞/评/藏/涨粉/分享/人均时长/弹幕）
   - **自动翻页**取全量（每页 10 条，最多 5 页）
   - 笔记管理页取 **noteId 映射**（内容分析页只有标题和日期，不含 noteId）
   - 创作者中心首页取账号总览（关注/粉丝/获赞 + 近 7 日指标表）
2. 看 **🔬 自动诊断** —— 六项指标，阈值来自账号历史基线：

| 指标 | 基准 | 含义 |
|------|------|------|
| CTR 中位数 | ≥ 15% | 用中位数抗单篇极值干扰 |
| 藏赞比 | ≥ 1.0 | 工具类内容「存下来以后用」的价值锚点 |
| 观看→涨粉率 | ≥ 1% | 看了不关注 = 缺关注钩子 |
| 观看→评论率 | ≥ 1% | 偏低通常是 CTA 缺失 |
| 曝光集中度 | ≤ 40% | Top1 占比过高 = 靠单篇爆发 |
| 主页转粉率 | ≥ 5% | 访客多但关注少 = 主页承接弱 |

3. 点 **📥 一键采集** 旁边的导出按钮：**Markdown**（Obsidian 归档格式，与历史 `note-analytics-*.md` 兼容）/ **CSV**（带 BOM，Excel 直接开）/ **JSON**。

**定时采集**：已迁移到 **🤖 自动化 → ⏰ 定时任务**（见下节），数据中心不再重复维护一份定时配置。

> ⚠️ 缺失值 `-` 表示平台未出数（新发笔记未跑够样本），**不是 0**。诊断模块已按 `null` 处理，不参与计算。

### 🤖 自动化

三个子页，都是**指令级的窄场景**，不是通用流程编排器。

#### ⏰ 定时任务

每个任务一条独立 `chrome.alarms`（名字 `xhstask:<id>`），改时间即重建对应 alarm。默认三条，全部默认关闭：

| 任务 | 默认时间 | 说明 |
|------|----------|------|
| 账号总览快照 | 20:00 | 读关注/粉丝/获赞 + 近 7 日指标表 |
| 单篇数据明细 | 20:40 | 逐篇明细 + 自动翻页 + noteId 映射 |
| 对标账号监控 | 09:00 | 跑「对标监控」里的博主列表 |

每条任务显示上次执行时间、结果（✓/✗）、耗时和错误原因。**「▶ 试跑」可以立刻验证一条任务是否真的能跑通**，不用等到点。

> 任务失败只写状态、不抛异常 —— 一次没跑成不该影响其他任务。
> MV3 Service Worker 不常驻，Service Worker 重启后 `onInstalled` 会自动重建 alarm。

#### 🔍 对标监控

贴一批博主主页 URL（也接受裸 userId），点「▶ 开始监控」：

- 后台标签页**串行**逐个打开（不并发：小红书对并发敏感，且串行更容易定位是哪一号失败）
- 每个博主抓：昵称 / userId / 粉丝 / 获赞动态 / 主页最近笔记的点赞数
- 出一张对比表，「近篇均赞」只统计**已取到点赞数**的笔记（否则均值被 0 拉低）
- 导出 CSV / Markdown

列表会保存，可直接被「对标账号监控」定时任务复用。

#### 📡 网页监听

等价于影刀的【开始监听网页请求】+【获取网页监听结果】。

- `net-listener.js` 以 **`world: "MAIN"`** 注入，在页面主世界里给 `fetch` / `XMLHttpRequest` 打补丁
- 通过 `window.postMessage` → `content.js` 中继 → background 落盘
- **存最近 200 条**，超出淘汰最旧的
- 入库前过滤：图片/字体/CSS/埋点（sentry、umeng、mmstat 等）不占额度；无响应体的非 2xx 也丢弃
- 落盘前脱敏：URL 里的 `token` / `sign` / `signature` / `web_session` / `a1` 等参数替换为 `***`
- 「🔑 提取 noteId」一键从监听日志里挖出所有 noteId

> **为什么用 MAIN world**：content script 跑在隔离世界里，拿不到页面自己的 `fetch`/`XHR` 引用；MV3 的 `chrome.webRequest` 只有观测没有响应体，`declarativeNetRequest` 同样读不到 body。注入主世界挂钩是唯一可行路径。
>
> ⚠️ `world: "MAIN"` 需要 **Chrome 111+**。
>
> 💡 **noteId 只有这一个来源**。内容分析页的表格里根本没有 noteId 字段 —— RPA 方案原先是「去笔记管理页翻 href」绕过去的，那是绕路；监听笔记详情接口的 JSON 响应才是正路。

> **明确不做**（对标影刀时有意识地砍掉）：元素库可视化捕获、流程编排/拖拽、魔法指令。这些是「企业流程再造」的重资产，扩展做不了也不该做。



### 模板生成（AI 文案创作）

切换到 **📋 模板** Tab，选择场景模板后填写关键信息，AI 自动生成符合小红书风格的高质量文案。

**6大场景模板：**

| 模板 | 适用场景 | 示例输入 |
|------|---------|---------|
| 🌿 种草体 | 好物/好店推荐 | 产品名、核心卖点、使用场景、价格、目标人群 |
| 🍽️ 探店体 | 美食/咖啡馆/小众店 | 店名、品类、招牌菜、环境、人均、地址 |
| 🌴 攻略体 | 旅行/城市攻略 | 目的地、天数、主题、必去清单、预算 |
| 🎬 Vlog脚本 | 短视频分镜 | 视频主题、时长、场景、情绪、BGM风格 |
| 📝 日签体 | 朋友圈/日常短文案 | 今日场景、心情、配图描述、天气 |
| 📊 测评体 | 真实对比测评 | 测评对象、对比项、维度、体验、适合人群 |

**6种语气风格：** 热血版 / 松弛版 / 反套路版 / 干货版 / 故事版 / 毒舌版

**智能安全检测：** 所有生成和改写输出自动通过 A/B/C/D 四级违禁词库（110+ 词汇）扫描，C 级词汇自动替换，A/B 级触发警告提示。

> 详细 Prompt 设计文档见 `Prompt模板库v2.md`

### 分析车（批量操作）

在笔记详情页，右下角会出现一个 **「📦 加入分析车」** 浮动按钮。点击后当前笔记进入队列，可批量添加多篇笔记后一键 AI 分析，特别适合需要集中分析多位博主或多篇爆款的场景。

- 支持批量删除单篇或清空全部
- 支持批量 AI 分析（分析 / 改写 / 检测 / 生成文案四种模式）
- 支持导出数据为 **CSV**（Excel 可打开）、**JSON**（程序处理）、**Markdown**（文档阅读）

### 弹出配置页

点击扩展图标打开 popup，提供快速配置入口：

- 一键切换 AI 服务商（MiniMax / OpenAI / Kimi / DeepSeek / 硅基流动 / 智谱 AI / 通义千问 / 自定义）
- 填写 API Key 和自定义 Endpoint
- 设置默认模型和 MaxTokens
- 开启/关闭插件

### 搜索页/发现页列表抓取

在搜索页或发现页，切换到 **🛠 工具** Tab，点击「列表抓取」即可批量抓取当前页面上显示的所有笔记卡片，方便快速收集选题灵感。

### 账号绑定

支持一键绑定小红书账号。点击「绑定当前账号」后，插件自动读取浏览器中已登录的账号 cookie，调用小红书接口获取昵称和头像进行确认。**账号凭证使用会话级存储（`chrome.storage.session`），关闭浏览器后自动清除，保障隐私安全。**

---

## 安装方式

### 开发者模式安装

1. 下载本项目到本地，解压得到文件夹（**路径中不要有中文和特殊字符**）
2. 打开 Chrome，进入 `chrome://extensions/`
3. 开启右上角 **「开发者模式」**
4. 点击 **「加载已解压的扩展程序」**
5. 选择项目文件夹即可

> 每次修改文件后，在 `chrome://extensions/` 页面点击扩展卡片的 **刷新按钮** 重新加载。

### 打包安装（分享给他人）

1. 在 `chrome://extensions/` 页面点击 **「打包扩展程序」**
2. 选择项目文件夹，生成 `.crx` 和 `.pem` 文件
3. 或将整个项目文件夹压缩为 `.zip` 发送给对方
4. 对方解压后以「开发者模式」加载即可

---

## AI 模型接入

插件支持以下 AI 服务商，配置统一由代码中 `PROVIDERS` 对象管理，UI 层动态获取：

| 服务商 | 默认 Endpoint | 默认模型 | 认证方式 |
|--------|-------------|---------|---------|
| **MiniMax** | `https://api.minimaxi.com/anthropic/v1/messages` | `MiniMax-M2.7` | `X-Api-Key` Header |
| **OpenAI** | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` | Bearer Token |
| **Kimi** | `https://api.moonshot.cn/v1/chat/completions` | `moonshot-v1-8k` | Bearer Token |
| **DeepSeek** | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` | Bearer Token |
| **硅基流动** | `https://api.siliconflow.cn/v1/chat/completions` | `Qwen/Qwen2.5-7B-Instruct` | Bearer Token |
| **智谱 AI** | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | `glm-4-flash` | Bearer Token |
| **通义千问** | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | `qwen-turbo` | Bearer Token |
| **自定义** | 手动填写 | 手动填写 | Bearer Token |

> **MiniMax 特别注意**：本项目默认使用 Token Plan 账户的 Anthropic 兼容接口，认证方式为 `X-Api-Key` Header。按量计费套餐请选择「自定义」并手动填写 `https://api.minimax.chat/v1/text/chatcompletion_v2`。

### 获取 API Key

| 服务商 | 获取地址 |
|--------|---------|
| MiniMax | [platform.minimaxi.com](https://platform.minimaxi.com) → Token Plan |
| OpenAI | [platform.openai.com](https://platform.openai.com) → API Keys |
| Kimi | [platform.moonshot.cn](https://platform.moonshot.cn) → API Key |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) → API Keys |
| 硅基流动 | [siliconflow.cn](https://www.siliconflow.cn) → API 密钥 |
| 智谱 AI | [open.bigmodel.cn](https://open.bigmodel.cn) → API Key |
| 通义千问 | [bailian.console.aliyun.com](https://bailian.console.aliyun.com) → API-KEY |

---

## 使用流程

### 基础分析单篇笔记

1. 在 Chrome 打开小红书笔记详情页（如 `https://www.xiaohongshu.com/explore/xxxxx`）
2. 点击工具栏右侧的扩展图标（或按 `Ctrl+Shift+X`），打开侧边栏
3. 切换到 **💬 对话** Tab，直接粘贴另一篇笔记的链接
4. 插件自动识别 URL → 抓取内容 → 调用 AI 分析，结果显示在消息流中

### 批量分析多篇笔记

1. 打开第一篇目标笔记，点击右下角 **「📦 加入分析车」** 按钮
2. 打开第二篇笔记，同样点击加入分析车，重复直到选完
3. 在侧边栏切换到 **📦 分析车** Tab，查看队列
4. 点击 **📊 批量分析** 按钮
5. AI 横向对比分析，结果在消息流中展示

### 导出分析数据

1. 收集笔记到分析车后，切换到 **📦 分析车** Tab
2. 点击底部导出按钮：
   - **📥 CSV** — 表格格式，可用 Excel / WPS 打开
   - **📦 JSON** — 结构化数据，适合程序处理
   - **📝 MD** — Markdown 文档，包含正文和前 5 张图片链接

### 绑定小红书账号

1. 先在小红书网页（`www.xiaohongshu.com`）正常登录你的账号
2. 打开侧边栏 → 切换到 **⚙️ 设置**
3. 点击「绑定当前账号」按钮
4. 插件自动读取浏览器 cookie 并获取账号信息，显示头像和昵称确认绑定
5. 关闭浏览器后账号自动解绑（会话级安全存储）

### 抓取当前页面数据

在笔记详情页打开侧边栏，切换到 **🛠 工具** Tab，点击对应按钮可单独抓取：
- 标题、正文、图片链接、评论数据、搜索列表
- 支持一键复制

---

## 技术特点

- **纯本地操作**：所有数据抓取通过浏览器 DOM 读取，不拦截任何网络请求，不上传任何内容到第三方服务器
- **隐私安全**：
  - API Key 存储在 `chrome.storage.local`，不经过任何中转
  - 账号 Cookie 使用 `chrome.storage.session`（会话级存储），关闭浏览器自动清除
  - 已声明内容安全策略（CSP）`script-src 'self'`
- **AI Adapter 架构**：Provider 配置集中管理，新增 AI 服务商只需在 `PROVIDERS` 中添加一行配置
- **动态页面兼容**：多选择器 fallback 机制，适配小红书 SPA 的动态渲染和 class 混淆
- **MV3 架构**：Manifest V3 + Service Worker + Side Panel API，无持久后台页面，性能更优
- **暗色模式**：支持 `prefers-color-scheme: dark`，跟随系统自动切换
- **容错机制**：AI 请求支持 60 秒超时控制 + 指数退避重试（最多 2 次）

---

## 文件结构

```
google插件/
├── manifest.json              # 扩展配置（MV3 + CSP + 快捷键）
├── background.js              # Service Worker：账号管理 / AI 代理 / 消息路由 / 创作者中心采集 / 任务调度
├── net-listener.js            # 网页监听（MAIN world 注入，挂钩 fetch/XHR）
├── prompts-data.js            # Prompt模板库v2.0（6场景 + 去味规则 + 语气 + 违禁词库）
├── content.js                 # 内容脚本：DOM 抓取 / 分析车按钮注入 / 监听中继
├── content.css                # 内容页样式（分析车浮动按钮）
├── common.css                 # 公共变量（品牌色 + 暗色模式）
├── popup/
│   ├── popup.html             # 弹出配置页（中文界面 / 卡片式布局）
│   └── popup.js               # 弹出页逻辑（动态 Provider 渲染）
├── sidepanel/
│   ├── sidepanel.html         # 侧边栏界面（对话 / 模板 / 工具 / 博主 / 分析车 / 起号助手 / 数据中心 / 自动化 / 设置）
│   ├── sidepanel.js           # 侧边栏主逻辑（含模板生成模块）
│   ├── datacenter.js          # 📈 数据中心：采集编排 / 自动诊断 / 导出
│   └── automation.js          # 🤖 自动化：定时任务 / 对标监控 / 网页监听
├── icons/                     # 扩展图标
├── Prompt模板库v2.md           # Prompt 设计文档（参考）
├── .gitignore                 # Git 忽略规则
├── LICENSE                    # MIT 开源协议
└── README.md                  # 本文件
```

---

## 常见问题

**Q：扩展图标点击没反应？**
A：在 `chrome://extensions/` 页面确认扩展已启用且无报错。尝试移除后重新加载。

**Q：提示 "Receiving end does not exist"？**
A：确保在**小红书页面**（笔记详情页/博主主页等）打开侧边栏，content script 需要在小红书标签页中加载完成后才能响应消息。

**Q：粘贴笔记链接后抓取失败？**
A：确保目标笔记页面已正常加载，且只有一个小红书标签页在工作。如果有多个小红书标签页，插件会默认找第一个。

**Q：MiniMax API 返回错误？**
A：确认使用的是 Token Plan Key（`sk-cp-` 开头）且填写了正确的 Anthropic 兼容接口地址 `https://api.minimaxi.com/anthropic/v1/messages`。Token Plan 和按量计费使用不同的 API，请至 [platform.minimaxi.com](https://platform.minimaxi.com) 核查套餐类型。

**Q：数据中心提示「创作者中心页面未就绪」？**
A：扩展在后台标签页打开创作者中心，若该域名的 content script 未注入（扩展刚更新但旧标签页未刷新）会报此错。关掉所有小红书标签页后重开，或在 `chrome://extensions/` 点一次刷新即可。

**Q：网页监听为什么抓不到东西？**
A：三个检查点。① Chrome 需 111+（`world: "MAIN"` 支持）；② 扩展更新后要刷新页面，旧标签页不会注入新脚本；③ 监听只在**小红书域名**页面上生效，且要等页面真的发出 XHR —— 静态页可能一条都没有。去创作者中心或笔记详情页逛一下再看。

**Q：监听日志里 URL 带着 `token=***` 是怎么回事？**
A：主动脱敏。`token` / `sign` / `signature` / `web_session` / `a1` 等是账号凭证参数，落盘前替换成 `***`，避免导出的日志泄露导致账号风险。需要完整 URL 时在 DevTools 里看原页面。

**Q：定时任务显示「alarm 未就绪」？**
A：Service Worker 重启或浏览器重启后 alarm 需要重建。点该任务的开关切一次即可重建；扩展更新时也会自动重建。持续出现说明时间格式非法（必须是 `HH:MM`）。

**Q：定时任务为什么某天没数据？**
A：需要 Chrome 正在运行且对应页面处于登录态。任一条件不满足时本次会标记为失败并把原因写在任务卡片上，**不会写入错误数据**，也不影响其他任务。侧边栏手动点「▶ 试跑」可立即验证，不必等到点。

**Q：以前用脚本抓的小红书数据，现在还用那个脚本吗？**
A：不需要了。数据中心的采集能力是那套 RPA 方案的超集（多了自动翻页、noteId 映射、自动诊断），且不依赖外部 daemon 与 Python 环境。历史 `note-analytics-*.md` 与新导出的 Markdown 格式兼容，可继续在同一个 Obsidian 目录归档。

**Q：分析车数据关闭浏览器后会丢失吗？**
A：不会丢失。分析车数据和聊天历史存储在 `chrome.storage.local` 持久化存储中，关闭浏览器或重启电脑后仍然保留。但账号绑定信息会在关闭浏览器后自动清除（安全性设计）。

**Q：如何导出分析车中的数据？**
A：在分析车 Tab 底部有三个导出按钮，分别导出为 CSV（表格）、JSON（结构化数据）、Markdown（文档）。有笔记时按钮自动启用。

**Q：账号绑定后为什么关闭浏览器就要重新绑定？**
A：这是有意为之的安全设计。账号 Cookie 存储在 `chrome.storage.session` 会话级存储中，关闭浏览器自动清除，防止 Cookie 泄露。每次打开浏览器后手动绑定即可，流程只需点击一个按钮。

**Q：AI 请求超时或失败怎么办？**
A：插件内置了 60 秒超时和自动重试机制（最多重试 2 次，间隔 1-2 秒）。如果仍失败，请检查网络连接、API Key 余额和 Endpoint 地址。

**Q：暗色模式如何启用？**
A：插件会自动跟随系统设置。如果系统开启了暗色模式，插件界面会自动切换为深色主题。

---

## 更新日志

- **v2.6.0**（2026-10-03）：
  - 🆕 新增侧边栏「🤖 自动化」Tab，含三个子场景（对标影刀 RPA 的指令级能力）
  - 🆕 **网页监听**：`net-listener.js` 以 `world: "MAIN"` 注入，挂钩 `fetch`/`XHR` 抓响应体
    （MV3 的 `webRequest`/`declarativeNetRequest` 都读不到响应体，主世界挂钩是唯一路径；需 Chrome 111+）
  - 🆕 监听日志只留最近 200 条，入库前过滤图片/埋点、落盘前脱敏 token/sign 等凭证参数
  - 🆕 **noteId 正路打通**：从监听日志一键提取，替代「去笔记管理页翻 href」的绕路做法
  - 🆕 **对标账号批量监控**：批量 URL 串行抓取，出粉丝/互动对比表，导出 CSV/Markdown
  - 🆕 **定时任务列表**：每任务一条独立 `chrome.alarms`，带执行状态/耗时/错误回写 + 「试跑」按钮
  - 🔧 定时采集配置从「数据中心」收敛到「自动化 → 定时任务」，消除双份配置
  - 需求澄清：影刀的**元素库可视化捕获 / 流程编排 / 魔法指令**明确不做 —— 属「企业流程再造」重资产
- **v2.5.0**（2026-10-03）：
  - 🆕 新增侧边栏「📈 数据中心」Tab：直读创作者中心数据，替代原 RPA 脚本链路
  - 🆕 创作者中心采集：账号总览 + 内容分析逐篇明细 + 笔记管理 noteId 映射
  - 🆕 自动翻页取全量（内容分析页每页 10 条，原脚本只取第 1 页）
  - 🆕 六项自动诊断：CTR 中位数 / 藏赞比 / 观看→涨粉率 / 观看→评论率 / 曝光集中度 / 主页转粉率
  - 🆕 每日定时采集（`chrome.alarms`，默认 20:40），采集历史本地保留 30 次
  - 🆕 导出 Markdown（Obsidian 归档格式）/ CSV（带 BOM）/ JSON
  - 🔧 采集全程在后台标签页执行，不打断用户当前页面
  - 🔧 缺失值 `-` 与 0 严格区分，避免新发笔记污染诊断统计
  - 订正：2026-06-18「桌面 web 不支持单篇数据」的结论是错的 —— 真实路径是
    `creator.xiaohongshu.com/statistics/data-analysis`（数据看板 → 内容分析），
    数据在前端渲染的表格 DOM 里，不走 API。当时用猜的 URL 找页面，正确路径从未试过。
- **v2.3.0**（2026-06）：
  - 🆕 集成 Prompt 模板库 v2.0（`prompts-data.js`）：6大场景 + 去味规则 + 语气调节 + 违禁词库
  - 🆕 新增侧边栏「📋 模板」标签页：模板选择 → 填写字段 → 语气调校 → 一键生成
  - 🆕 违禁词智能检测：A/B/C/D 四级 110+ 词汇库，C 级自动替换，A/B 级阻断警告
  - 🆕 弹窗 UI 全面中文重设计：卡片式布局、渐变色头部、品牌色体系
  - 🆕 侧边栏暗色模式 CSS 变量统一管理，标签页渐变选中态
  - 新增键盘快捷键 `Ctrl+Shift+X` 打开侧边栏
  - 新增聊天历史持久化（关闭侧边栏后对话不丢失）
  - 新增分析车数据导出（CSV / JSON / Markdown）
  - 新增搜索页/发现页列表批量抓取
  - 新增 Markdown 渲染增强（标题/列表/链接/引用）
  - 新增 AI 请求超时控制（60s）+ 指数退避重试
  - 优化 AI Provider 配置收敛为单一数据源（`PROVIDERS` 对象）
  - 优化账号 Cookie 改用会话级存储（关闭浏览器自动清除）
  - 修复 Popup 开关可能清空 AI 配置的 Bug
  - 修复版本号不一致问题
  - 新增 CSP 安全策略声明
- **v2.2.0**：支持 7 家 AI 服务商接入；修复 URL 粘贴抓取和分析车单篇删除问题
- **v2.1.0**：新增分析车批量分析功能；重构侧边栏为对话流界面
- **v2.0.0**：MV3 重构，Service Worker + SidePanel API
- **v1.0.0**：初始版本

---

## Star History

如果你觉得这个项目有帮助，欢迎点一个 ⭐
