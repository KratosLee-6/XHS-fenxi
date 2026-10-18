# RPA 脚本（历史链路 / 兜底通道）

> **这些脚本不是本扩展的运行依赖。** 它们是扩展的前身形态，保留下来有两个原因：
> 1. **兜底** —— 扩展装不上、或需要无人值守（cron）跑时，脚本仍可用；
> 2. **溯源** —— 记录了「单篇数据到底能不能抓到」这段排查过程，包括那次错判。
>
> 能力上，扩展的 **📈 数据中心** 是下面两个采集脚本的**超集**（多了自动翻页、noteId 映射、自动诊断），日常优先用扩展。

## 两个脚本

| 脚本 | 职责 | 与扩展的关系 |
|------|------|-------------|
| `xhs-creator-snapshot.py` | 创作者中心账号级快照（近 7 日聚合） | 已被「数据中心 → 一键采集」覆盖 |
| `xhs-note-analytics.py` | 内容分析页逐篇明细（近 90 天） | 已被「数据中心 → 一键采集」覆盖（扩展版多自动翻页 + noteId） |

> 另有两个更早的个人工具（批量 URL 回填、xlsx 解析）因**强耦合特定 Obsidian vault 结构、
> 内含未发布选题名**，已从公共仓库移除，仅保留在维护者本地。

## 依赖与前提

两个脚本走 **Kimi WebBridge**（`kimi-webbridge.exe`）作为中转：
脚本 → 本地 daemon（127.0.0.1:10086）→ Chrome 扩展 → 页面 `evaluate`。

> ⚠️ 这是脚本方案最大的结构性缺点：**多一个 daemon 依赖**，daemon 停了就得人工拉起。
> 扩展把这层彻底去掉了 —— content script 自己就是采集器。参见 `AGENTS.md` 的架构图。

前置条件：

- Python 3.8+（仅用标准库，无第三方依赖）
- 已安装 Kimi WebBridge 且 daemon 在跑
- Chrome 已登录 `creator.xiaohongshu.com`

## 配置：环境变量（可选）

**不设任何环境变量也能直接跑** —— 两个脚本的输出会落到 `scripts/out/`，
`kimi-webbridge.exe` 通过 `Path.home()` 自动定位。要写入别处才需要设：

| 变量 | 作用 | 默认 |
|------|------|------|
| `XHS_DATA_DIR` | 采集产出目录 | `scripts/out/` |
| `XHS_SHOT_DIR` | 截图存档目录（仅 snapshot 脚本） | `scripts/out/shots/` |
| `XHS_LEGACY_DIR` | 旧路径兼容目录（仅 snapshot 脚本） | 同 `XHS_DATA_DIR` |
| `KIMI_WEBBRIDGE_EXE` | kimi-webbridge 可执行文件 | `~/.kimi-webbridge/bin/kimi-webbridge.exe` |

Windows PowerShell 示例：

```powershell
$env:XHS_DATA_DIR = "D:\你的归档目录"
python scripts\xhs-note-analytics.py
```

> **为什么是环境变量而不是直接改源码**：初版把维护者本机的知识库路径与 Windows 用户名
> 硬编码在源码里，收进公共仓库时已改为环境变量 + 可用默认值。这样脚本既不泄露本机
> 目录结构，也能在别的机器上直接运行。

## 退出码约定

两个脚本共用一套退出码，便于 cron 或告警系统判断：

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | daemon 不可用 |
| 2 | 浏览器扩展未连接 |
| 3 | navigate 失败 |
| 4 | 页面未登录 |
| 5 | 解析失败 |
| 6 | 写文件失败 |

## 两个踩坑（迁移脚本时别再犯）

1. **PowerShell 传 JS 里的中文字面量会被编码破坏**，`evaluate` 直接抛正则错误。
   必须写成 `\uXXXX` 转义。见 `xhs-note-analytics.py` 里的 `JS_EXTRACT` 与 `parse_rows`。
2. **`& python ... 2>$null` 会让 `$LASTEXITCODE` 拿到 `NativeCommandError` 而不是真实退出码** ——
   成功的 `exit=0` 会被误判成失败。要取真实退出码就别把 stderr 重定向到 `$null`。

## 相关文档

- [`../docs/rpa/单篇数据RPA采集方案.md`](../docs/rpa/单篇数据RPA采集方案.md) —— 完整方案：真实路径、表格列序、4 个踩坑
- [`../docs/rpa/XHS单篇数据抓取失败报告-2026-06-18.md`](../docs/rpa/XHS单篇数据抓取失败报告-2026-06-18.md) —— **结论已被推翻**，保留作反面教材
- [`../docs/rpa/XHS单篇数据分析报告-2026-06-18.md`](../docs/rpa/XHS单篇数据分析报告-2026-06-18.md) —— 当期数据分析
