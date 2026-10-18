#!/usr/bin/env python3
"""
xhs-note-analytics.py — 单篇笔记级数据采集（内容分析页）

背景
----
2026-06-18 的《XHS单篇数据抓取失败报告》断言「单篇笔记数据桌面 web 不支持」。
**该结论是错的**，错因有二：
  1. 当时用**猜 URL** 的方式找页面（/statistics/note、/new/notes-data、/data-board …）
     全部 404 —— 但这些路径本来就是编的，正确路径从来没被试过。
  2. `note_detail_new` API 返回账号 7 日总览，被误读成「平台不提供单篇数据」。
     实际上**单篇数据在「数据看板 → 内容分析」页的表格里**，是前端渲染的 DOM，
     不走那条 API。

真实路径（2026-10-03 实测）
------------------------
    https://creator.xiaohongshu.com/statistics/data-analysis?source=official

到达方式（二选一）：
  A. 直接 navigate 到上面这个 URL（最快，推荐）
  B. 首页 → 点「数据看板」(.d-sub-menu__header) → 点「内容分析」(.d-menu-item__title)

表格结构（2026-10-03 实测，11 行 = 1 表头 + 10 条笔记）
------------------------------------------------------
    <tr> 内 <td> 顺序：
      [0] 笔记基础信息（标题 + 发布于 <日期> <时间> 混在一个单元格）
      [1] 曝光  [2] 观看  [3] 封面点击率  [4] 点赞  [5] 评论
      [6] 收藏  [7] 涨粉  [8] 分享  [9] 人均观看时长  [10] 弹幕  [11] 操作
    数值列缺失时为 '-'，新发笔记的曝光/点击率/人均时长尤为常见（未跑够样本）。

与账号级快照的关系
------------------
    xhs-creator-snapshot.py  → 近 7 日账号聚合（粉丝/曝光/互动总量）
    xhs-note-analytics.py   → 逐篇明细（每篇独立曝光/CTR/赞藏评分享）
    两者互补，**不要**用账号级数字去推单篇，也不要用单篇加总去核对账号级
    （统计周期与口径不同：账号级默认近 7 日，单篇页是「近 90 天」）。

退出码： 0 成功 / 1 daemon 不可用 / 2 扩展未连接 / 3 navigate 失败 / 4 页面未登录 / 5 解析失败
"""
import sys
import json
import os
import time
import re
import subprocess
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

DAEMON_URL = "http://127.0.0.1:10086/command"
URL = "https://creator.xiaohongshu.com/statistics/data-analysis?source=official"
SESSION = "xhs-note-analytics"

# ---- 机器相关配置：全部走环境变量，不写死本机路径 ----
# 原脚本把归档目录与 Windows 用户名硬编码在源码里，收进公共仓库时已改为
# 环境变量。以下均有可用的默认路径，不设环境变量也能跑（输出到脚本同级 out/）。
WEBBRIDGE_EXE = Path(
    os.environ.get("KIMI_WEBBRIDGE_EXE")
    or (Path.home() / ".kimi-webbridge" / "bin" / "kimi-webbridge.exe")
)
OUTPUT_DIR = Path(os.environ.get("XHS_DATA_DIR") or (Path(__file__).parent / "out"))

# 表格数值列的列名（与 [1]..[10] 一一对应）
METRIC_COLS = ["曝光", "观看", "封面点击率", "点赞", "评论", "收藏", "涨粉", "分享", "人均观看时长", "弹幕"]


def _guard_loopback(url: str) -> str:
    """SSRF 防线：本工具只允许请求本机 WebBridge daemon。

    payload 里带着采集到的小红书数据 —— 显式校验 scheme 与主机，
    保证 URL 即使被误改也不会把数据发往任何非回环地址。"""
    from urllib.parse import urlparse
    p = urlparse(url)
    if p.scheme != "http" or p.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError(f"只允许请求本机 daemon（收到：{url}）")
    return url


def call_daemon(payload: dict, timeout: int = 40) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        _guard_loopback(DAEMON_URL), data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def check_daemon() -> tuple[bool, str]:
    try:
        r = call_daemon({"action": "list_tabs", "session": SESSION}, timeout=6)
        if r.get("ok") is False:
            return False, f"daemon 拒绝请求: {r}"
        return True, "ok"
    except Exception as e:
        return False, f"daemon unreachable: {e}"


def ensure_daemon(total_wait: int = 60, poll_every: int = 5) -> tuple[bool, str]:
    """探测 → 不可达则拉起 → **轮询等扩展握手**。

    沿用 xhs-creator-snapshot.py 的教训：daemon 不随开机自启，且 `start` 返回后
    扩展握手最长约 30s，单次 sleep 判定必然误报失败。
    """
    ok, msg = check_daemon()
    if ok:
        return True, "already running"
    if not WEBBRIDGE_EXE.exists():
        return False, f"找不到 {WEBBRIDGE_EXE}，无法自动拉起"
    try:
        subprocess.run([str(WEBBRIDGE_EXE), "start"], capture_output=True,
                       text=True, encoding="utf-8", errors="replace", timeout=60)
    except Exception as e:
        return False, f"start 失败: {e}（原状态：{msg}）"
    deadline = time.time() + total_wait
    last = msg
    while time.time() < deadline:
        time.sleep(poll_every)
        ok2, msg2 = check_daemon()
        if ok2:
            return True, f"auto-started（约 {int(total_wait - (deadline - time.time()))}s 握手）"
        last = msg2
    return False, f"拉起后 {total_wait}s 内未就绪：{last}"


def extension_connected() -> bool | None:
    """True/False；None 表示 status 不可用，不阻塞主流程。"""
    try:
        st = subprocess.run([str(WEBBRIDGE_EXE), "status"], capture_output=True, text=True,
                             encoding="utf-8", errors="replace", timeout=20)
        return '"extension_connected":true' in (st.stdout or "").replace(" ", "")
    except Exception:
        return None


# 抓取表格的 JS —— 全部用 \uXXXX 转义写中文，规避 PowerShell 传参的中文编码损坏
JS_EXTRACT = r"""(() => {
  const trs = Array.from(document.querySelectorAll('tr'));
  const rows = [];
  for (const tr of trs) {
    const tds = Array.from(tr.querySelectorAll('td,th')).map(function(td){
      return (td.innerText || td.textContent || '').trim().replace(/\s+/g, ' ');
    });
    if (tds.length) rows.push(tds);
  }
  const body = (document.body.innerText || '').slice(0, 400);
  return JSON.stringify({rows: rows, head: body, url: location.href});
})()"""


def fetch_table() -> dict:
    r = call_daemon({"action": "evaluate", "args": {"code": JS_EXTRACT}, "session": SESSION}, timeout=40)
    d = r.get("data") or r
    v = d.get("value") if isinstance(d, dict) else None
    if not v:
        raise RuntimeError(f"evaluate 无返回: {r}")
    return json.loads(v)


def parse_rows(rows: list) -> list:
    """把表格行解析成结构化笔记记录。跳过表头行与操作列。"""
    notes = []
    for tds in rows:
        if len(tds) < 2:
            continue
        first = tds[0]
        # 表头行：首格是「笔记基础信息」
        if first.startswith("\u7b14\u8bb0\u57fa\u7840\u4fe1\u606f"):
            continue
        # 从首格拆出标题与发布时间：「标题 发布于 2026-10-01 19:01」
        m = re.match(r"^(.*?)\s*\u53d1\u5e03\u4e8e\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})", first)
        if m:
            title, pub_date, pub_time = m.group(1).strip(), m.group(2), m.group(3)
        else:
            title, pub_date, pub_time = first, "", ""
        rec = {"title": title, "publish_date": pub_date, "publish_time": pub_time}
        for i, col in enumerate(METRIC_COLS, start=1):
            rec[col] = tds[i] if i < len(tds) else "-"
        notes.append(rec)
    return notes


def main() -> int:
    ok, msg = ensure_daemon()
    if not ok:
        print(f"❌ 单篇数据采集失败：daemon 不可用 —— {msg}")
        return 1
    conn = extension_connected()
    if conn is False:
        print("❌ 单篇数据采集失败：浏览器扩展未连接（daemon 在跑但 Chrome 侧桥断了）"
              "—— 需人工重开 Chrome / Kimi 桌面端后重试")
        return 2

    try:
        nav = call_daemon({
            "action": "navigate",
            "args": {"url": URL, "newTab": True, "group_title": "XHS单篇数据"},
            "session": SESSION,
        })
        if not nav.get("ok") or not nav.get("data", {}).get("success"):
            print(f"❌ navigate 失败: {nav}")
            return 3
    except Exception as e:
        print(f"❌ navigate 异常: {e}")
        return 3

    time.sleep(5)

    try:
        table = fetch_table()
    except Exception as e:
        print(f"❌ 解析失败: {e}")
        return 5

    head = table.get("head", "")
    if "\u767b\u5f55" in head[:200] and "\u521b\u4f5c\u670d\u52a1" not in head:
        print("❌ 页面停在登录态（未登录创作者中心）—— 请在 Chrome 里登录后重试")
        return 4

    notes = parse_rows(table.get("rows", []))
    if not notes:
        print("❌ 未解析到任何笔记行（页面可能改版或未渲染完成）")
        return 5

    try:
        call_daemon({"action": "close_session", "args": {}, "session": SESSION})
    except Exception:
        pass

    # 写文件
    try:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now()
        out = OUTPUT_DIR / f"note-analytics-{ts.strftime('%Y-%m-%d')}.md"
        lines = [
            "# KratosLee 小红书单篇笔记数据（内容分析）",
            "",
            f"> **抓取时间**：{ts.strftime('%Y-%m-%d %H:%M:%S')}",
            "> **抓取方式**：Kimi WebBridge + DOM evaluate（表格直读）",
            "> **数据来源**：创作者中心 · 数据看板 → 内容分析",
            "> **统计周期**：近 90 天（该页固定口径，非近 7 日）",
            f"> **来源 session**：{SESSION}",
            f"> **页面**：{table.get('url','')}",
            "",
            f"**本次解析到 {len(notes)} 条笔记。**",
            "",
            "| 标题 | 发布 | 曝光 | 观看 | CTR | 赞 | 评 | 藏 | 涨粉 | 分享 | 人均时长 |",
            "|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        for n in notes:
            lines.append(
                f"| {n['title']} | {n['publish_date']} {n['publish_time']} | "
                f"{n['曝光']} | {n['观看']} | {n['封面点击率']} | {n['点赞']} | {n['评论']} | "
                f"{n['收藏']} | {n['涨粉']} | {n['分享']} | {n['人均观看时长']} |"
            )
        lines += ["", "---", "", "**口径提醒**：`账号快照`（snapshot-*.md）是近 7 日聚合，"
                  "本表是近 90 天逐篇明细，两者不可互相推算。"]
        out.write_text("\n".join(lines), encoding="utf-8")
        print(f"✅ {out} ({out.stat().st_size}B, {len(notes)} 条)")
    except Exception as e:
        print(f"❌ 写文件失败: {e}")
        return 6

    return 0


if __name__ == "__main__":
    sys.exit(main())
