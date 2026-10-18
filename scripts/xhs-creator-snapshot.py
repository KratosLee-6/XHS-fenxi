#!/usr/bin/env python3
"""
xhs-creator-snapshot.py

Kimi WebBridge 单次 snapshot 创作者中心首页，存到 Obsidian _账号数据/。
- 默认 session: xhs-creator-daily
- 抓取 URL: https://creator.xiaohongshu.com/new/home?source=official
- 失败时打印错误（cron 模式会推送）
- 成功时静默（no_agent cron 默认行为）

退出码:
  0 - 成功
  1 - daemon 不在跑
  2 - daemon 跑但扩展未连接
  3 - navigate 失败
  4 - snapshot 失败（页面可能未登录/被踢）
  5 - 解析失败（XHS 改版）
  6 - 写文件失败
"""
import sys
import json
import subprocess
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

import os
from pathlib import Path

DAEMON_URL = "http://127.0.0.1:10086/command"
URL = "https://creator.xiaohongshu.com/new/home?source=official"
SESSION = "xhs-creator-daily"

# ---- 机器相关配置：全部走环境变量，不写死本机路径 ----
# 原脚本把归档目录与 Windows 用户名硬编码在源码里，收进公共仓库时已改为
# 环境变量。以下均有可用的默认路径，不设环境变量也能跑（输出到脚本同级 out/）。
_OUT = Path(os.environ.get("XHS_DATA_DIR") or (Path(__file__).parent / "out"))
OUTPUT_DIR = _OUT
LEGACY_DIR = Path(os.environ.get("XHS_LEGACY_DIR") or _OUT)
SCREENSHOT_DIR = Path(os.environ.get("XHS_SHOT_DIR") or (_OUT / "shots"))
WEBBRIDGE_EXE = Path(
    os.environ.get("KIMI_WEBBRIDGE_EXE")
    or (Path.home() / ".kimi-webbridge" / "bin" / "kimi-webbridge.exe")
)


def _guard_loopback(url: str) -> str:
    """SSRF 防线：本工具只允许请求本机 WebBridge daemon。

    payload 里带着采集到的小红书数据 —— 显式校验 scheme 与主机，
    保证 URL 即使被误改也不会把数据发往任何非回环地址。"""
    from urllib.parse import urlparse
    p = urlparse(url)
    if p.scheme != "http" or p.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError(f"只允许请求本机 daemon（收到：{url}）")
    return url


def call_daemon(payload: dict, timeout: int = 30) -> dict:
    """调用 daemon 一次"""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        _guard_loopback(DAEMON_URL),
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def check_daemon() -> tuple[bool, str]:
    """检查 daemon 状态：用 list_tabs 探测（轻量、不影响页面）"""
    try:
        r = call_daemon({"action": "list_tabs", "session": SESSION}, timeout=5)
        if r.get("ok") is False:
            return False, f"daemon 拒绝请求: {r}"
        return True, "ok"
    except urllib.error.URLError as e:
        return False, f"daemon unreachable: {e}"
    except Exception as e:
        return False, f"unknown err: {e}"


def ensure_daemon(total_wait: int = 60, poll_every: int = 5) -> tuple[bool, str]:
    """先探测；不可达则尝试拉起 daemon，然后**轮询等待**扩展握手完成。

    2026-09-29 新增：此前 daemon 挂掉后 cron 连续 7 天静默失败
    （job 59181987139f，最后成功 09-21）。实测两件事：
      1. daemon 不会随开机自启 —— 重启机器后必挂；
      2. `start` 返回后扩展侧握手**最长要约 30 秒**才 ready，
         期间端口会返回 502 Bad Gateway / "no extension connected"。
    所以必须「拉起 + 轮询」，单次 sleep 之后探测会误判成失败。
    """
    import time

    ok, msg = check_daemon()
    if ok:
        return True, "already running"

    started = ""
    if WEBBRIDGE_EXE.exists():
        try:
            proc = subprocess.run(
                [str(WEBBRIDGE_EXE), "start"],
                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60,
            )
            started = (proc.stdout or "").strip()
        except Exception as e:
            return False, f"attempted start failed: {e}（原状态：{msg}）"
    else:
        started = f"（找不到 {WEBBRIDGE_EXE}，跳过自动拉起）"

    deadline = time.time() + total_wait
    last = msg
    while time.time() < deadline:
        time.sleep(poll_every)
        ok2, msg2 = check_daemon()
        if ok2:
            elapsed = int(total_wait - (deadline - time.time()))
            return True, f"auto-started, 握手耗时约 {elapsed}s: {started or 'ok'}"
        last = msg2

    return False, f"拉起后 {total_wait}s 内仍未就绪：{last}（start 输出：{started}）"


def extract_metrics(tree) -> dict:
    """从 a11y tree 提取关键指标。
    已知布局（2026-06-07 实测）：
    1. 账号基础区：[KratosLee] [account-status] [关注数:52] [粉丝数:49] [获赞与收藏:183] [小红书账号: xxx]
    2. 笔记数据总览区：[曝光数:1,143] [环比:-7%] [观看数:94] [环比:+62%] ...

    策略：DFS 展平为 [(role, name, path), ...]，对每个指标标签
    找"后面 30 个节点内最近的非指标名数字"作为值，
    找"后面 30 个节点内'环比'后面的数字"作为环比。
    """
    if isinstance(tree, str):
        try:
            tree = json.loads(tree)
        except json.JSONDecodeError:
            return {"raw_len": len(tree), "parse_failed": True}
    if not isinstance(tree, list):
        return {"raw_type": type(tree).__name__, "parse_failed": True}

    flat = []
    def walk(node, path=()):
        if isinstance(node, list):
            for i, n in enumerate(node):
                walk(n, path + (i,))
        elif isinstance(node, dict):
            r = node.get("role", "")
            n = node.get("name", "")
            if r and n:
                flat.append((r, n, path))
            for v in node.values():
                walk(v, path)
    walk(tree)

    targets = [
        "曝光数", "观看数", "封面点击率", "视频完播率",
        "点赞数", "评论数", "收藏数", "分享数",
        "净涨粉", "新增关注", "取消关注", "主页访客",
        "关注数", "粉丝数", "获赞与收藏",
    ]
    metrics = {}
    rings = {}
    for i, (role, name, path) in enumerate(flat):
        if name not in targets or name in metrics:
            continue
        # 找值
        for j in range(i + 1, min(i + 30, len(flat))):
            r2, n2, _ = flat[j]
            if n2 in targets or n2 == "环比":
                continue
            if r2 in ("StaticText", "heading") and n2:
                metrics[name] = n2
                break
        # 找环比
        for j in range(i + 1, min(i + 30, len(flat))):
            r2, n2, _ = flat[j]
            if n2 == "环比" and j + 1 < len(flat):
                r3, n3, _ = flat[j + 1]
                if r3 in ("StaticText", "heading") and n3:
                    rings[name] = n3
                    break

    return {"flat_count": len(flat), "metrics": metrics, "rings": rings}


def fetch_metrics_via_evaluate() -> dict | None:
    """通过 page DOM 直接读取关键指标（最准，2026-06-07 实战验证 100% 准）。
    关键发现（DOM 实际结构）：
    - 账号基础区：parent.children = [数字div, 标签div] → 数字在标签前
    - 笔记数据总览区：parent.children = [标签div, 数字div, 环比div("环比X%")] → 3 个 sibling
    返回 None 表示 evaluate 失败（daemon 不在 / 页面未加载）。
    """
    js = """(() => {
      const out = {};
      const all = Array.from(document.querySelectorAll('*'));
      const wanted = [
        '曝光数','观看数','封面点击率','视频完播率',
        '点赞数','评论数','收藏数','分享数',
        '净涨粉','新增关注','取消关注','主页访客',
        '关注数','粉丝数','获赞与收藏'
      ];
      const isNum = s => /^[+\\-]?\\d[\\d,.]*\\d%?$/.test(s) || /^\\d%?$/.test(s);
      const extractRing = s => {
        const m = (s||'').match(/^环比\\s*([+\\-]?\\d[\\d,.]*\\d?%?|\\-)$/);
        return m ? m[1] : null;
      };
      for (const el of all) {
        const t = (el.textContent||'').trim();
        if (!t || t.length > 30 || wanted.indexOf(t) < 0) continue;
        if (out[t]) continue;
        const p = el.parentElement;
        if (!p) continue;
        const kids = Array.from(p.children);
        const elIdx = kids.indexOf(el);
        let val = null, ring = null;
        for (let k = elIdx + 1; k < kids.length; k++) {
          const kt = (kids[k].textContent||'').trim();
          if (val === null && isNum(kt)) {
            val = kt;
          } else if (kt.startsWith('环比')) {
            const r = extractRing(kt);
            if (r) ring = r;
          }
        }
        if (val === null && elIdx > 0) {
          const prev = (kids[elIdx - 1].textContent||'').trim();
          if (isNum(prev)) val = prev;
        }
        if (val !== null) out[t] = val;
        if (ring !== null) out[t + '_ring'] = ring;
      }
      return JSON.stringify(out);
    })()"""
    try:
        r = call_daemon({
            "action": "evaluate",
            "args": {"code": js},
            "session": SESSION,
        }, timeout=15)
        d = r.get("data") or r
        v = d.get("value") if isinstance(d, dict) else None
        if not v:
            return None
        return json.loads(v)
    except Exception as e:
        print(f"⚠️  evaluate 失败: {e}", file=sys.stdout)
        return None


def main() -> int:
    # 1. 确保 daemon 在跑（不可达则自动拉起 —— 2026-09-29 自愈修复）
    ok, msg = ensure_daemon()
    if not ok:
        # 注意：失败信息走 **stdout**（不是 stderr）。
        # no_agent 的投递契约是「非空 stdout → 原样投递」，走 stderr 会直接丢掉；
        # 本脚本原先写 stderr，于是 job 59181987139f 连续 7 天失败而无人知晓。
        print(f"❌ XHS 快照失败：daemon 不可用且自动拉起失败 —— {msg}")
        return 1
    if not msg.startswith("already"):
        print(f"ℹ️ XHS 快照：daemon 已自愈（{msg}）")

    # 1b. 检查扩展是否连上（daemon 在跑 ≠ 浏览器扩展在连）
    try:
        st = subprocess.run(
            [str(WEBBRIDGE_EXE), "status"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20,
        )
        if '"extension_connected":true' not in (st.stdout or "").replace(" ", ""):
            print(
                "❌ XHS 快照失败：浏览器扩展未连接（daemon 在跑但 Chrome 侧桥断了）——"
                "需人工重开 Chrome / Kimi 桌面端后重试"
            )
            return 2
    except Exception:
        pass  # status 不可用时不阻塞，继续按原路径走

    # 2. navigate
    try:
        nav = call_daemon({
            "action": "navigate",
            "args": {"url": URL, "newTab": True, "group_title": "XHS数据-日"},
            "session": SESSION,
        })
        if not nav.get("ok") or not nav.get("data", {}).get("success"):
            print(f"❌ navigate 失败: {nav}", file=sys.stdout)
            return 3
    except Exception as e:
        print(f"❌ navigate 异常: {e}", file=sys.stdout)
        return 3

    # 3. 等加载
    import time
    time.sleep(4)

    # 4a. 读账号身份
    account_info = {}
    try:
        js_id = """(() => {
          const out = {name: '', xhs_id: ''};
          // 策略：从顶部 banner 找"用AI的眼睛看世界"或"KratosLee"，
          // 跳过导航栏/侧边栏文字（更短更准）
          const all = Array.from(document.querySelectorAll('*'));
          const candidates = [];
          for (const el of all) {
            const t = (el.textContent||'').trim();
            if (!t || t.length < 4 || t.length > 30) continue;
            if (/^(用AI的眼睛看世界|KratosLee)$/.test(t)) {
              candidates.push(t);
            }
          }
          if (candidates.length) out.name = candidates[0];
          // xhs_id: 找包含"小红书账号"的最短文本
          for (const el of all) {
            const t = (el.textContent||'').trim();
            const m = t.match(/小红书账号[:：]?\\s*([A-Za-z0-9_-]+)/);
            if (m && m[1] && t.length < 50) {
              out.xhs_id = m[1];
              break;
            }
          }
          return JSON.stringify(out);
        })()"""
        r = call_daemon({
            "action": "evaluate",
            "args": {"code": js_id},
            "session": SESSION,
        }, timeout=10)
        d = r.get("data") or r
        v = d.get("value") if isinstance(d, dict) else None
        if v:
            account_info = json.loads(v)
    except Exception:
        pass

    # 4. evaluate（DOM 直接读，最准）
    raw = fetch_metrics_via_evaluate()
    if raw is None:
        print("❌ evaluate 失败（daemon 502 或页面未加载）", file=sys.stdout)
        return 4
    if not raw:
        print("❌ evaluate 返回空（页面可能没渲染完成 / 改版）", file=sys.stdout)
        return 5

    # 拆分 metrics + rings
    metrics = {k: v for k, v in raw.items() if not k.endswith("_ring")}
    rings = {k[:-5]: v for k, v in raw.items() if k.endswith("_ring")}

    # 检测账号身份 → 决定输出目录
    account_name = account_info.get("name", "") or ""
    xhs_id = account_info.get("xhs_id", "") or ""
    is_a_account = "用AI的眼睛看世界" in account_name
    is_b_account = "KratosLee" in account_name
    if is_a_account:
        target_dir = OUTPUT_DIR  # 兼容旧版：同时写一份到 LEGACY_DIR
    elif is_b_account:
        target_dir = LEGACY_DIR  # KratosLee小红书/_账号数据
    else:
        # 兜底：写到 LEGACY_DIR（旧 B 账号位置）
        target_dir = LEGACY_DIR
        account_name = account_name or "未知账号"
        xhs_id = xhs_id or "未识别"

    # 5. 截图（可选）
    screenshot_path = None
    try:
        SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        s = call_daemon({
            "action": "screenshot",
            "args": {"format": "jpeg", "quality": 85, "path": str(SCREENSHOT_DIR / f"xhs-{ts}.jpg")},
            "session": SESSION,
        })
        if s.get("ok") and s.get("data", {}).get("path"):
            screenshot_path = s["data"]["path"]
    except Exception:
        pass

    # 6. close session
    try:
        call_daemon({"action": "close_session", "args": {}, "session": SESSION})
    except Exception:
        pass

    # 7. 写文件
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now()
        date_str = ts.strftime("%Y-%m-%d")
        out = target_dir / f"snapshot-{date_str}.md"

        lines = [
            f"# {account_name or 'XHS 账号'} 小红书创作者中心 snapshot",
            "",
            f"> **抓取时间**：{ts.strftime('%Y-%m-%d %H:%M:%S')}",
            f"> **抓取方式**：Kimi WebBridge + DOM evaluate（cron 自动）",
            f"> **统计周期**：XHS 后台默认近 7 日（**注意：数据滞后 1 天**）",
            f"> **来源 session**：{SESSION}",
            f"> **账号身份**：{account_name}（小红书 ID: {xhs_id or '未识别'}）",
            "",
            "## 账号基础",
            "",
            "| 字段 | 值 |",
            "|---|---|",
        ]
        for k in ["关注数", "粉丝数", "获赞与收藏"]:
            if k in metrics:
                lines.append(f"| {k} | {metrics[k]} |")

        lines += [
            "",
            "## 笔记数据总览",
            "",
            "| 指标 | 数值 | 环比 |",
            "|---|---|---|",
        ]
        for k in ["曝光数", "观看数", "封面点击率", "视频完播率", "点赞数", "评论数", "收藏数", "分享数", "净涨粉", "新增关注", "取消关注", "主页访客"]:
            v = metrics.get(k, "-")
            r = rings.get(k, "-")
            lines.append(f"| {k} | {v} | {r} |")

        if screenshot_path:
            lines += [
                "",
                f"## 截图",
                "",
                f"截图存档: `{screenshot_path}`",
            ]

        lines += ["", "---", "", f"_raw fields: {len(raw)}_"]
        out.write_text("\n".join(lines), encoding="utf-8")
        # 成功走 stderr：stdout 必须保持**空**，否则 no_agent 会把「✅ 已写入」当成
        # 变化通知投递出去，违背「无变化静默」的 watchdog 契约。
        print(f"✅ {out} ({out.stat().st_size}B)", file=sys.stderr)
    except Exception as e:
        print(f"❌ 写文件失败: {e}", file=sys.stdout)
        return 6

    return 0


if __name__ == "__main__":
    sys.exit(main())
