# 小红书运营工具箱

[![GitHub stars](https://img.shields.io/github/stars/KratosLee-6/XHS-fenxi?style=social)](https://github.com/KratosLee-6/XHS-fenxi/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/KratosLee-6/XHS-fenxi?style=social)](https://github.com/KratosLee-6/XHS-fenxi/network/members)
[![Version](https://img.shields.io/badge/version-v2.2.0-blue)](https://github.com/KratosLee-6/XHS-fenxi)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Manifest](https://img.shields.io/badge/manifest-MV3-orange)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)

一款面向小红书内容运营者的 Chrome 浏览器扩展，100% 本地 DOM 读取，无需爬虫协议，不爬取不存储任何数据到服务端。

---

## 功能概览

### 侧边栏（主要工作区）

打开小红书任意页面后，点击扩展图标即可打开侧边栏，包含五个工作模式：

| Tab | 功能说明 |
|-----|----------|
| **💬 对话** | 粘贴任意小红书笔记链接，自动抓取内容并调用 AI 进行分析、改写、检测或生成文案 |
| **🛠 工具** | 手动抓取当前页面笔记数据（标题/正文/图片/评论），一键复制 |
| **👤 博主** | 查看当前笔记作者的主页信息（粉丝数、获赞数等） |
| **📦 分析车** | 批量管理待分析的笔记队列，支持单篇删除、清空、批量 AI 分析 |
| **⚙️ 设置** | 配置 AI 模型服务商、API Key、模型参数，以及绑定小红书账号 |

### 分析车（批量操作）

在笔记详情页，右下角会出现一个 **「📦 加入分析车」** 浮动按钮。点击后当前笔记进入队列，可批量添加多篇笔记后一键 AI 分析，特别适合需要集中分析多位博主或多篇爆款的场景。

- 支持批量删除单篇或清空全部
- 支持批量分析（分析 / 改写 / 检测 / 生成文案四种模式）

### 弹出配置页

点击扩展图标打开 popup，提供快速配置入口：

- 一键切换 AI 服务商（MiniMax / OpenAI / Kimi / DeepSeek / 硅基流动 / 智谱 AI / 通义千问）
- 填写 API Key 和自定义 Endpoint
- 设置默认模型和 MaxTokens
- 开启/关闭插件

### 账号绑定

支持一键绑定小红书账号。点击「绑定当前账号」后，插件自动读取浏览器中已登录的账号 cookie，调用小红书接口获取昵称和头像进行确认。绑定后可将登录态用于需要账号权限的操作。

---

## 安装方式

### 开发者模式安装

1. 下载本项目到本地，解压得到文件夹（**路径中不要有中文和特殊字符**）
2. 打开 Chrome，进入 `chrome://extensions/`
3. 开启右上角 **「开发者模式」**
4. 点击 **「加载已解压的扩展程序」**
5. 选择项目文件夹即可

> 每次修改文件后，在 `chrome://extensions/` 页面点击扩展卡片的 **刷新按钮** 重新加载。

---

## AI 模型接入

插件支持以下 AI 服务商（均为标准 OpenAI 兼容接口）：

| 服务商 | 默认 Endpoint | 默认模型 | 认证方式 |
|--------|-------------|---------|---------|
| **MiniMax** | `https://api.minimaxi.com/anthropic/v1/messages` | `MiniMax-M2.7` | `X-Api-Key` Header |
| **OpenAI** | `https://api.openai.com/v1/chat/completions` | `gpt-4o` | Bearer Token |
| **Kimi** | `https://api.moonshot.cn/v1/chat/completions` | `moonshot-v1-8k` | Bearer Token |
| **DeepSeek** | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` | Bearer Token |
| **硅基流动** | `https://api.siliconflow.cn/v1/chat/completions` | `Qwen/Qwen2.5-7B-Instruct` | Bearer Token |
| **智谱 AI** | `https://api.bigmodel.cn/api/paas/v4/chat/completions` | `glm-4-flash` | Bearer Token |
| **通义千问** | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | `qwen-turbo` | Bearer Token |

> **MiniMax 特别注意**：Token Plan 类型账户使用 Anthropic 兼容接口，认证方式为 `X-Api-Key` Header，而非 `Authorization: Bearer`。按量计费套餐则使用 `https://api.minimax.chat/v1/text/chatcompletion_v2` 接口，请根据实际套餐选择对应配置。

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
2. 点击工具栏右侧的扩展图标，打开侧边栏
3. 切换到 **💬 对话** Tab，直接粘贴另一篇笔记的链接
4. 插件自动识别 URL → 抓取内容 → 调用 AI 分析，结果显示在消息流中

### 批量分析多篇笔记

1. 打开第一篇目标笔记，点击右下角 **「📦 加入分析车」** 按钮
2. 打开第二篇笔记，同样点击加入分析车，重复直到选完
3. 在侧边栏切换到 **📦 分析车** Tab，查看队列
4. 选择分析模式（分析 / 改写 / 检测 / 生成文案），点击 **🚀 批量分析**
5. AI 逐篇分析，结果在消息流中展示

### 绑定小红书账号

1. 先在小红书网页（`www.xiaohongshu.com`）正常登录你的账号
2. 打开侧边栏 → 切换到 **⚙️ 设置**
3. 点击「绑定当前账号」按钮
4. 插件自动读取浏览器 cookie 并获取账号信息，显示头像和昵称确认绑定

### 抓取当前页面数据

在笔记详情页打开侧边栏，切换到 **🛠 工具** Tab，点击对应按钮可单独抓取：
- 标题、正文、图片链接、评论数据
- 支持一键复制

---

## 技术特点

- **纯本地操作**：所有数据抓取通过浏览器 DOM 读取，不拦截任何网络请求，不上传任何内容到第三方服务器
- **隐私安全**：API Key 和登录凭证仅存储在浏览器本地 `chrome.storage.local`，不经过任何中转
- **动态页面兼容**：使用 MutationObserver 监听 DOM 变化，适配小红书单页应用（SPA）的动态渲染
- **MV3 架构**：使用 Manifest V3、Service Worker，无持久后台页面，性能更优

---

## 文件结构

```
google插件/
├── manifest.json          # 扩展配置（MV3）
├── background.js          # Service Worker：账号管理 / AI 代理 / 消息路由
├── content.js             # 内容脚本：DOM 抓取 / 分析车按钮注入
├── content.css           # 内容页样式（浮动按钮等）
├── sidepanel.html        # 侧边栏界面
├── sidepanel.js          # 侧边栏逻辑
├── popup/
│   ├── popup.html        # 弹出配置页
│   └── popup.js          # 弹出页逻辑
├── icons/                # 扩展图标
├── LICENSE               # MIT 开源协议
└── README.md             # 本文件
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

**Q：分析车数据关闭浏览器后会丢失吗？**
A：会丢失。分析车数据存储在内存中，关闭浏览器或刷新页面后清空。

**Q：账号绑定失败怎么办？**
A：确认已在 `www.xiaohongshu.com` 页面登录账号，且浏览器允许扩展读取该域名的 cookie。可尝试刷新小红书页面后重试。

---

## 更新日志

- **v2.2.0**：支持 7 家 AI 服务商接入；修复 URL 粘贴抓取和分析车单篇删除问题
- **v2.1.0**：新增分析车批量分析功能；重构侧边栏为对话流界面
- **v2.0.0**：MV3 重构，Service Worker + SidePanel API
- **v1.0.0**：初始版本

---

## Star History

如果你觉得这个项目有帮助，欢迎点一个 ⭐
