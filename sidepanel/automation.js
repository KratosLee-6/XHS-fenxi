/**
 * automation.js — 自动化面板
 * v2.6.0 新增
 *
 * 三个子场景，都是「指令级」的窄场景，不做通用流程编排：
 *   ⏰ 定时任务  —— 每任务一条独立 chrome.alarms，带执行状态回写
 *   🔍 对标监控  —— 批量博主主页串行抓取，出对比表（纯 DOM，零新基建）
 *   📡 网页监听  —— MAIN world 挂钩 XHR/fetch，noteId 的唯一来源
 *
 * 对标影刀：这三个分别对应【定时调度】、【循环相似元素 + 获取元素信息】、
 * 【开始/获取网页监听结果】。元素库可视化捕获、流程编排、魔法指令
 * 属于「企业流程再造」的重资产，扩展不做。
 */

'use strict';

const AU = {
  tasks: [],
  net: [],
  bench: null
};

const au$ = (s) => document.querySelector(s);

function auStatus(text, tone) {
  const dot = au$('#benchDot');
  const txt = au$('#benchStatusText');
  if (txt) txt.textContent = text;
  if (dot) dot.className = 'dot ' + (tone || 'idle');
}

// =====================================================================
// ⏰ 定时任务
// =====================================================================

function auDownload(filename, content, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function auDay() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function auAgo(ts) {
  if (!ts) return '未运行';
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  return Math.floor(diff / 86400000) + ' 天前';
}

// =====================================================================
// ⏰ 定时任务
// ---------------------------------------------------------------------
// 以下渲染函数一律用 common.css 的类，禁止内联 style（见 common.css 顶部硬约束）
// =====================================================================

const auEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

async function auLoadTasks() {
  const res = await chrome.runtime.sendMessage({ action: 'getTasks' });
  AU.tasks = res && res.success ? res.data : [];
  auRenderTasks();
}

function auRenderTasks() {
  const box = au$('#taskList');
  if (!box) return;
  if (!AU.tasks.length) {
    // ⚠️ 原来只有「暂无任务」三个字，连「怎么加任务」都不说 ——
    //    用户看到会以为功能坏了。至少给一个去设置的入口。
    //    不用 .ask：任务区只是页面的一部分，占满整屏反而不像局部内容。
    box.innerHTML = '<div class="empty-hint">还没有定时任务<br>'
      + '<span class="hint">到「设置 → 自动采集」一键开启，或在下方新建</span>'
      + '<div class="action-row mt-3"><button class="btn btn-primary btn-sm" id="auAddTask">新建一个任务</button></div>'
      + '</div>';
    au$('#auAddTask')?.addEventListener('click', () => {
      if (typeof switchToTab === 'function') switchToTab('settings');
    });
    return;
  }

  box.innerHTML = '<div class="stagger">' + AU.tasks.map((t, ti) => {
    const st = t.lastStatus;
    const badge = st === 'ok'
      ? '<span class="pill ok">正常</span>'
      : st === 'fail'
        ? `<span class="pill err" title="${auEsc(t.lastError || '')}">失败</span>`
        : '<span class="pill idle">未运行</span>';
    // 「关闭」只是把一条定时停掉，随时能再开 —— 不是破坏性动作，不该用红色。
    // 红色留给清空/解绑那种撤销成本真的高的操作。
    const armed = t.enabled
      ? 'class="btn btn-sm off au-toggle"'
      : 'class="btn btn-sm au-toggle"';
    return `<div class="task task-row" style="--i:${ti}">
      <div class="task-main">
        <div class="task-n title-2" title="${auEsc(t.name)}">${auEsc(t.name)}</div>
        <div class="task-m">
          ${badge} · ${auAgo(t.lastRunAt)}${t.lastDurationMs ? ' · 耗时 ' + (t.lastDurationMs / 1000).toFixed(1) + 's' : ''}
          ${t.scheduled || !t.enabled ? '' : ' <span class="pill warn">alarm 未就绪</span>'}
        </div>
        ${t.lastError ? `<div class="task-m err-text">${auEsc(t.lastError)}</div>` : ''}
      </div>
      <div class="task-ctrl">
        <input type="time" class="input au-time" data-id="${auEsc(t.id)}" value="${auEsc(t.time || '09:00')}" aria-label="执行时间">
        <button ${armed} data-id="${auEsc(t.id)}">${t.enabled ? '关闭' : '开启'}</button>
        <button class="btn btn-sm au-run" data-id="${auEsc(t.id)}">试跑</button>
      </div>
    </div>`;
  }).join('') + '</div>';
}

async function auTaskToggle(id) {
  const t = AU.tasks.find(x => x.id === id);
  if (!t) return;
  const patch = { id, type: t.type, time: t.time, enabled: !t.enabled };
  await chrome.runtime.sendMessage({ action: 'upsertTask', payload: patch });
  await auLoadTasks();
}

async function auTaskTime(id, time) {
  const t = AU.tasks.find(x => x.id === id);
  if (!t) return;
  await chrome.runtime.sendMessage({
    action: 'upsertTask',
    payload: { id, type: t.type, time, enabled: t.enabled }
  });
  await auLoadTasks();
}

async function auTaskRun(id) {
  auStatus('试跑中：正在打开后台标签页…', 'warn');
  const res = await chrome.runtime.sendMessage({ action: 'runTaskNow', payload: { id } });
  if (res && res.success) auStatus('试跑完成', 'ok');
  else auStatus('试跑失败：' + ((res && res.error) || '未知原因'), 'err');
  await auLoadTasks();
}

async function auTaskReset() {
  await chrome.storage.local.remove(['xhsTasks']);
  await chrome.runtime.sendMessage({ action: 'upsertTask', payload: { id: 't-overview', type: 'creatorOverview', time: '20:00', enabled: false } });
  const cur = await chrome.runtime.sendMessage({ action: 'getTasks' });
  const list = (cur.data || []).map(({ name, scheduled, nextRunAt, ...t }) => t);
  for (const t of list) {
    await chrome.runtime.sendMessage({ action: 'upsertTask', payload: t });
  }
  await auLoadTasks();
}

// =====================================================================
// 🔍 对标监控
// =====================================================================

/**
 * 对标增量趋势：从扫描历史给每个博主建时间序列（时间正序，最多近 10 次）。
 * 只收 ok 且带 url 的结果。纯函数，insight-test 直接测。
 */
function auBenchSeries(records, cap = 10) {
  const list = (records || []).filter(r => r && r.at && Array.isArray(r.results)).slice(-cap);
  const map = new Map();
  for (const rec of list) {
    for (const r of rec.results || []) {
      if (!r || !r.ok || !r.url) continue;
      if (!map.has(r.url)) map.set(r.url, { name: r.name || r.url, fans: [], avgLikes: [] });
      const s = map.get(r.url);
      s.fans.push(r.fans ?? null);
      s.avgLikes.push(r.avgLikes ?? null);
      if (r.name) s.name = r.name;
    }
  }
  return [...map.values()].filter(s => s.fans.length >= 2);
}

/**
 * 迷你折线的 polyline points（手写 SVG，项目不引图表库）。
 * 缺失断开不补 0（AGENTS.md：`-` 不是 0）；有效点 <2 返回 ''（不画）。
 */
function auSparkPoints(vals, w = 100, h = 24) {
  const valid = (vals || []).filter(v => v !== null && v !== undefined);
  if (valid.length < 2) return '';
  const min = Math.min(...valid), max = Math.max(...valid);
  const span = (max - min) || 1;
  const n = vals.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    if (v === null || v === undefined) continue;
    pts.push((i / (n - 1) * w).toFixed(1) + ',' + (h - ((v - min) / span) * (h - 4) - 2).toFixed(1));
  }
  return pts.join(' ');
}

async function auLoadBenchList() {
  const res = await chrome.runtime.sendMessage({ action: 'getBenchmarkList' });
  const urls = res && res.success ? res.data : [];
  const ta = au$('#benchUrls');
  if (ta && !ta.value.trim()) ta.value = urls.join('\n');
  auLoadBenchWeekly();
}

/**
 * 对标周报 —— 模板化总结，每个字来自两次真实扫描的差值（模型没参与）。
 *
 * 窗口：最近 7 天内的最早一次 vs 最新一次（历史新的在前）。
 * 爆文判定：单篇赞 ≥ 3× **该账号自己的近篇均赞**（均赞 > 0）——
 *   基线是账号自身的分布，不是拍脑袋的绝对常数；倍数 3 表示
 *   「显著超出自己的常态」，量级上远过均值的波动带。
 * 数据不足（一周内不足两次 / 只有同一次）时如实说引导，不算周报。
 */
function auBenchWeekly(records, now = Date.now()) {
  const list = (records || []).filter(r => r && r.at && Array.isArray(r.results));
  if (list.length < 2) return { note: '', reason: 'few' };
  const inWeek = list.filter(r => now - Date.parse(r.at) <= 7 * 86400000);
  if (inWeek.length < 2) return { note: '', reason: 'stale' };

  const latest = inWeek[0];
  const earliest = inWeek[inWeek.length - 1];
  const byUrl = (rec) => {
    const m = {};
    for (const r of rec.results) if (r && r.ok && r.url) m[r.url] = r;
    return m;
  };
  const L = byUrl(latest), E = byUrl(earliest);
  const fmt = (v) => Number(v || 0).toLocaleString('zh-CN');

  const parts = [];
  const hits = [];
  for (const url of Object.keys(L)) {
    const cur = L[url];
    const prev = E[url];
    const name = cur.name || url;
    if (!prev) {
      parts.push(`${name}：本周新加入（粉丝 ${fmt(cur.fans)}）`);
    } else {
      const dFans = (cur.fans || 0) - (prev.fans || 0);
      parts.push(dFans === 0 ? `${name}：粉丝持平` : `${name}：粉丝 ${dFans > 0 ? '+' : ''}${fmt(dFans)}`);
    }
    if (cur.avgLikes > 0 && Array.isArray(cur.notes)) {
      const hot = cur.notes.filter(n => n && n.likes >= cur.avgLikes * 3);
      if (hot.length) {
        const top = hot.slice().sort((a, b) => b.likes - a.likes)[0];
        hits.push(`${name}《${top.title}》${fmt(top.likes)} 赞（其均赞的 ${(top.likes / cur.avgLikes).toFixed(1)} 倍）`);
      }
    }
  }
  if (!parts.length) return { note: '', reason: 'empty' };

  const days = Math.max(1, Math.round((Date.parse(latest.at) - Date.parse(earliest.at)) / 86400000));
  let note = `近 ${days} 天：` + parts.join('；');
  if (hits.length) note += `。值得拆解：${hits.join('；')}`;
  return { note, reason: 'ok' };
}

async function auLoadBenchWeekly() {
  const box = au$('#benchWeekly');
  if (!box) return;
  let records = [];
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getBenchmarkHistory' });
    records = (res && res.success && Array.isArray(res.data)) ? res.data : [];
  } catch (_) {
    // 读不到历史不是错态 —— 周报只是增益信息，主表格照常
  }
  AU.benchHist = records;   // 增量趋势图与周报共用这一份
  const r = auBenchWeekly(records);
  AU.weeklyNote = r.reason === 'ok' ? r.note : '';
  if (r.reason === 'ok') {
    box.textContent = r.note;
    box.classList.remove('hidden');
  } else if (r.reason === 'few') {
    box.textContent = '周报：再扫一次（隔天）就能看到对标账号的周变化。';
    box.classList.remove('hidden');
  } else {
    // stale / empty：有历史但太旧 —— 说清楚为什么不显示，而不是空着
    box.textContent = '周报：最近 7 天内不足两次扫描，暂无周变化可比。';
    box.classList.remove('hidden');
  }
}

async function auBenchRun() {
  const ta = au$('#benchUrls');
  const raw = (ta ? ta.value : '').split('\n').map(s => s.trim()).filter(Boolean);
  if (!raw.length) { auStatus('请先填写博主主页 URL 或 userId', 'warn'); return; }

  await chrome.runtime.sendMessage({ action: 'saveBenchmarkList', payload: { urls: raw } });
  auStatus(`监控中：共 ${raw.length} 个博主，逐个打开…`, 'warn');

  try {
    const res = await chrome.runtime.sendMessage({ action: 'benchmarkScan', payload: { urls: raw } });
    if (!res || !res.success) throw new Error((res && res.error) || '监控失败');
    AU.bench = res.data;
    await auLoadBenchWeekly();   // 先刷新历史（趋势图与周报共用），再渲染
    auRenderBench();
    const okN = AU.bench.results.filter(r => r.ok).length;
    auStatus(`完成：${okN}/${AU.bench.results.length} 成功`, okN === AU.bench.results.length ? 'ok' : 'warn');
  } catch (e) {
    auStatus('失败：' + (e.message || e), 'err');
  }
}

function auRenderBench() {
  const box = au$('#benchResult');
  if (!box || !AU.bench) return;
  const rows = AU.bench.results;
  const cols = ['博主', '粉丝', '获赞/动态', '近篇均赞', '最高赞', '抓到'];
  const num = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('zh-CN'));
  const fmtDelta = (v) => (v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + Number(v).toLocaleString('zh-CN'));

  let html = '';

  /* 增量趋势：每次扫描一个点。手写 SVG 不引库；缺失断开、不足两点不画。 */
  const series = auBenchSeries(AU.benchHist || []);
  const trendBlocks = [];
  for (const s of series) {
    const pf = auSparkPoints(s.fans), af = auSparkPoints(s.avgLikes);
    if (!pf && !af) continue;
    const spark = (pts) => pts
      ? `<svg class="bench-spark" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label="趋势折线"><polyline points="${pts}" pathLength="1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`
      : '<span class="bench-tr-none">点太少</span>';
    const dFans = s.fans[s.fans.length - 1] !== null && s.fans[0] !== null
      ? s.fans[s.fans.length - 1] - s.fans[0] : null;
    const dAvg = s.avgLikes[s.avgLikes.length - 1] !== null && s.avgLikes[0] !== null
      ? s.avgLikes[s.avgLikes.length - 1] - s.avgLikes[0] : null;
    trendBlocks.push(`<div class="bench-tr">
      <div class="bench-tr-n">${auEsc(s.name)}</div>
      <div class="bench-tr-row"><span class="bench-tr-k">粉丝</span>${spark(pf)}<span class="bench-tr-d">${fmtDelta(dFans)}</span></div>
      <div class="bench-tr-row"><span class="bench-tr-k">近篇均赞</span>${spark(af)}<span class="bench-tr-d">${fmtDelta(dAvg)}</span></div>
    </div>`);
  }
  if (trendBlocks.length) {
    html += '<div class="sec-t">增量趋势 <span class="sub">每次扫描一个点</span></div>'
      + '<div class="bench-trend">' + trendBlocks.join('') + '</div>';
  }

  html += '<div class="sec-t"><span class="t-ico" data-ico="chart" data-ico-size="16"></span>对比表</div><div class="tbl-wrap"><table class="tbl">';
  html += '<thead><tr>' + cols.map((c, i) =>
    `<th class="${i === 0 ? '' : 'num'}">${c}</th>`).join('') + '</tr></thead><tbody>';

  rows.forEach(r => {
    if (!r.ok) {
      html += `<tr><td colspan="${cols.length}" class="err-text">${auEsc(r.url)} —— ${auEsc(r.error)}</td></tr>`;
      return;
    }
    html += '<tr>'
      + `<td class="ellipsis" title="${auEsc(r.name || r.url)}">${auEsc(r.name || '(未取到昵称)')}</td>`
      + `<td class="num">${num(r.fans)}</td>`
      + `<td class="num">${num(r.posts)}</td>`
      + `<td class="num">${num(r.avgLikes)}</td>`
      + `<td class="num">${num(r.topLikes)}</td>`
      + `<td class="num">${r.noteCount}</td>`
      + '</tr>';
  });
  html += '</tbody></table></div>';

  html += '<div class="btn-row">'
    + '<button class="btn btn-sm" id="benchCsv"><span class="t-ico" data-ico="download" data-ico-size="14"></span>导出 CSV</button>'
    + '<button class="btn btn-sm" id="benchMd"><span class="t-ico" data-ico="doc" data-ico-size="14"></span>导出 Markdown</button>'
    + '</div>';

  box.innerHTML = html;
  au$('#benchCsv')?.addEventListener('click', auBenchCsv);
  au$('#benchMd')?.addEventListener('click', auBenchMd);
}

function auBenchCsv() {
  if (!AU.bench) return;
  const head = ['URL', '昵称', 'userId', '粉丝', '获赞动态', '抓到笔记数', '近篇均赞', '最高赞', '状态'];
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = AU.bench.results.map(r =>
    [r.url, r.name, r.userId, r.fans, r.posts, r.noteCount, r.avgLikes, r.topLikes, r.ok ? 'ok' : r.error]
      .map(esc).join(','));
  auDownload(`benchmark-${auDay()}.csv`, '\ufeff' + head.join(',') + '\n' + lines.join('\n'), 'text/csv');
}

function auBenchMd() {
  if (!AU.bench) return;
  const L = ['# 对标账号监控', '', `> **采集时间**：${AU.bench.at}`, '', '| 博主 | 粉丝 | 获赞/动态 | 近篇均赞 | 最高赞 | 抓到 |', '|---|---|---|---|---|---|'];
  AU.bench.results.forEach(r => {
    if (!r.ok) { L.push(`| ${r.url} | — | — | — | — | — ${r.error} |`); return; }
    L.push(`| ${r.name || r.url} | ${r.fans} | ${r.posts} | ${r.avgLikes ?? '—'} | ${r.topLikes ?? '—'} | ${r.noteCount} |`);
  });
  L.push('', '---', '', '> 「近篇均赞」只统计已取到点赞数的笔记，避免 0 值拉低均值。');
  if (AU.weeklyNote) L.push(`> **周报**：${AU.weeklyNote}`);
  auDownload(`benchmark-${auDay()}.md`, L.join('\n'), 'text/markdown');
}

// =====================================================================
// 📡 网页监听
// =====================================================================

async function auLoadNet() {
  const filter = au$('#netFilter') ? au$('#netFilter').value.trim() : '';
  const res = await chrome.runtime.sendMessage({ action: 'getNetLog', payload: { filter } });
  AU.net = res && res.success ? res.data : [];
  const meta = res && res.meta ? res.meta : { total: AU.net.length, max: 200 };
  const m = au$('#netMeta');
  // 只在后端真的筛了的时候才说「已过滤」。过滤词是非法正则时后端会
  // 原样返回全部，这时要告诉用户「没筛成」，而不是照旧显示「已过滤」。
  const tail = meta.invalid
    ? ' · 过滤词不是有效的正则，已显示全部'
    : (meta.filtered ? ' · 已过滤：' + filter : '');
  if (m) m.textContent = `已存 ${meta.total} / ${meta.max} 条（滚动淘汰，超出丢弃最旧的）${tail}`;
  auRenderNet();
}

function auRenderNet() {
  const box = au$('#netList');
  if (!box) return;
  if (!AU.net.length) {
    // ⚠️ 原来只说「还没有捕获到响应」，但用户真正想知道的是
    //    「为什么没有」——多半是**没开过笔记页 / 没开网页监听**。
    //    把前置条件说清楚，比只报结果有用。
    box.innerHTML = '<div class="empty-hint">还没有捕获到任何接口响应<br>'
      + '<span class="hint">需要：① 在小红书页面打开「网页监听」'
      + '② 然后浏览一篇笔记或打开创作者中心</span></div>';
    return;
  }
  box.innerHTML = AU.net.map((e, i) => {
    const d = new Date(e.ts);
    const p = (x) => String(x).padStart(2, '0');
    const hh = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const okStatus = e.status >= 200 && e.status < 300;
    const body = e.body || '（空）';
    const tags = [e.kind, e.body ? e.body.length + 'B' : '', e.truncated ? '截断' : '', e.redacted ? '已脱敏' : '']
      .filter(Boolean).join(' · ');
    return `<div class="task net-row ${okStatus ? 'ok' : 'bad'}">
      <div class="task-main">
        <div class="net-head">
          <span class="net-time">${hh}</span>
          <span class="pill ${okStatus ? 'ok' : 'warn'}">${e.status || '—'}</span>
          <span class="net-method">${auEsc(e.method)}</span>
          <span class="net-url" title="${auEsc(e.url)}">${auEsc(e.url.replace(/^https?:\/\//, ''))}</span>
        </div>
        <div class="task-m">
          ${auEsc(tags)}
          <button class="btn btn-sm au-body" data-i="${i}">响应体</button>
        </div>
        <pre class="ai-raw au-body-pre hidden" data-i="${i}">${auEsc(body)}</pre>
      </div>
    </div>`;
  }).join('');
}

/** 从监听日志里挖 noteId —— 内容分析页表格没有这个字段 */
function auExtractNoteIds() {
  const map = new Map();
  AU.net.forEach(e => {
    const re = /\/(?:explore|discovery\/item|note)\/([a-z0-9]{8,})/gi;
    let m;
    while ((m = re.exec(e.url || '')) !== null) map.set(m[1], e.url);
  });
  return [...map.entries()].map(([noteId, url]) => ({ noteId, url }));
}

function auNetExport(fmt) {
  if (!AU.net.length) { auStatus('暂无监听数据可导出', 'warn'); return; }
  if (fmt === 'noteid') {
    const ids = auExtractNoteIds();
    if (!ids.length) {
      auStatus('日志里没找到 noteId（需要先在小红书页面浏览笔记）', 'warn');
      return;
    }
    auDownload(`note-ids-${auDay()}.json`, JSON.stringify(ids, null, 2), 'application/json');
    auStatus(`已导出 ${ids.length} 个 noteId`, 'ok');
    return;
  }
  auDownload(`net-log-${auDay()}.json`, JSON.stringify(AU.net, null, 2), 'application/json');
  auStatus(`已导出 ${AU.net.length} 条监听记录`, 'ok');
}

// =====================================================================
// 初始化
// =====================================================================

function initAutomation() {
  if (!au$('#panel-auto')) return;

  // 子页切换
  document.addEventListener('click', (e) => {
    const st = e.target.closest('.subtab');
    if (st) {
      document.querySelectorAll('.subtab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.subpane').forEach(x => x.classList.remove('active'));
      st.classList.add('active');
      const pane = au$('#sub-' + st.dataset.sub);
      if (pane) pane.classList.add('active');
      if (st.dataset.sub === 'net') auLoadNet();
      return;
    }

    const run = e.target.closest('.au-run');
    if (run) { auTaskRun(run.dataset.id); return; }

    const tg = e.target.closest('.au-toggle');
    if (tg) { auTaskToggle(tg.dataset.id); return; }

    const body = e.target.closest('.au-body');
    if (body) {
      const pre = document.querySelector(`.au-body-pre[data-i="${body.dataset.i}"]`);
      // 用 class 切换显隐，不写 style —— 内联样式会绕过设计系统
      if (pre) pre.classList.toggle('hidden');
      return;
    }

    const ne = e.target.closest('.net-export');
    if (ne) { auNetExport(ne.dataset.fmt); }
  });

  document.addEventListener('change', (e) => {
    const ti = e.target.closest('.au-time');
    if (ti) auTaskTime(ti.dataset.id, ti.value);
  });

  au$('#taskReset')?.addEventListener('click', auTaskReset);
  au$('#benchSave')?.addEventListener('click', async () => {
    const ta = au$('#benchUrls');
    await chrome.runtime.sendMessage({ action: 'saveBenchmarkList', payload: { urls: ta.value.split('\n').map(s => s.trim()).filter(Boolean) } });
    auStatus('列表已保存', 'ok');
  });
  au$('#benchRun')?.addEventListener('click', auBenchRun);
  au$('#netRefresh')?.addEventListener('click', auLoadNet);
  au$('#netClear')?.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'clearNetLog' });
    auLoadNet();
  });

  let netTimer = null;
  au$('#netFilter')?.addEventListener('input', () => {
    clearTimeout(netTimer);
    netTimer = setTimeout(auLoadNet, 300);
  });

  auLoadTasks();
  auLoadBenchList();
}

document.addEventListener('DOMContentLoaded', initAutomation);
