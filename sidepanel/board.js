/**
 * board.js — 工作台：历史时间线 + 趋势 + 单日详情
 *
 * ============================ 为什么有这一页 ============================
 * 采集数据**一直都在** chrome.storage.local 里，关浏览器也在。
 * 但「今天」和「数据中心」都只读 hist[length-1]（最新一条），
 * 于是 90 天历史里 89 条没有任何入口 —— 每天采一次，却只看当天。
 *
 * 这不是「数据不够」，是**数据被界面藏起来了**。
 * 而用户要这个工具的理由恰恰是「看得出成长」，成长需要时间轴。
 *
 * ============================ 这一页的三个动作 ============================
 * ① 时间线：每次采集一行，点开看当天完整报告（不是只有总数）
 * ② 趋势：把 N 天的关键指标画成折线 —— 这才是「数据越多越有用」
 * ③ 导出：把全部历史导成 CSV。**storage 有上限，导出让数据归用户所有。**
 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const BOARD = { hist: [], analysis: [], selected: null, loaded: false };

  /* ---------- 解析 ---------- */

  /** 去掉千分位与单位，只留可比较的数字。拿不到就返回 null（不当 0）。 */
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }

  /** 从一条采集记录里抽出趋势用的数值。 */
  function pointOf(rec) {
    const ov = rec?.overview;
    const acc = ov?.account || {};
    /* 总览页表格的指标名会随改版漂移（曝光数/曝光量/曝光…）——
       精确匹配曾经让 曝光/净涨粉 两条曲线永远「数据不足」。
       先按别名精确匹配，再退化到去「数/量」后缀的归一化匹配；
       两级都落空才认 null（不当 0）。 */
    const CANON = {
      impressions: ['曝光数', '曝光量', '曝光'],
      likes: ['点赞数', '点赞量', '点赞'],
      comments: ['评论数', '评论量', '评论'],
      collects: ['收藏数', '收藏量', '收藏'],
      follows: ['净涨粉', '涨粉数', '涨粉量', '新增粉丝', '涨粉']
    };
    const norm = (s) => String(s || '').replace(/[数量]$/g, '').trim();
    const metrics = ov?.metrics || [];
    const metric = (canon) => {
      const aliases = CANON[canon];
      let m = metrics.find(x => aliases.includes(x.metric));
      if (!m) m = metrics.find(x => aliases.some(a => norm(a) === norm(x.metric)));
      return m ? num(m.value) : null;
    };
    return {
      at: rec.capturedAt || (rec.id ? new Date(rec.id).toISOString() : ''),
      ts: rec.id || Date.parse(rec.capturedAt) || 0,
      noteCount: Array.isArray(rec.notes) ? rec.notes.length : 0,
      fans: num(acc['粉丝数']),
      impressions: metric('impressions'),
      likes: metric('likes'),
      comments: metric('comments'),
      collects: metric('collects'),
      follows: metric('follows')
    };
  }

  function dateLabel(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function relLabel(ts) {
    if (!ts) return '';
    const d = Date.now() - ts;
    if (d < 3600e3) return `${Math.max(1, Math.floor(d / 60e3))} 分钟前`;
    if (d < 86400e3) return `${Math.floor(d / 3600e3)} 小时前`;
    return `${Math.floor(d / 86400e3)} 天前`;
  }

  /* ---------- 趋势折线 ---------- */

  /**
   * 画一条折线。**不引第三方图表库** —— 项目无依赖，
   * 而且三个点的折线用 SVG 手写十几行就够，引库反而是负担。
   *
   * ⚠️ 只画有值的点：缺失（null）断线，**绝不连成 0**。
   *    小红书新笔记的曝光是 `-` 不是 0，画成 0 会把曲线压到地板上，
   *    让人以为账号崩了（见 AGENTS.md「缺失值 `-` 不是 0」）。
   */
  function sparkline(points, key, opts = {}) {
    const vals = points.map(p => p[key]);
    const valid = vals.filter(v => v !== null);
    if (valid.length < 2) {
      // 「次」不是「天」：同一天采两次也有两个点（总览是近 7 日口径，变化小是事实，
      // 但把曲线画出来比一句「数据不足」诚实）。
      return '<div class="spark-empty">数据不足（需要两次有效采集）</div>';
    }
    const W = 100, H = 28;
    const min = Math.min(...valid), max = Math.max(...valid);
    const span = max - min || 1;

    // 按**有效点的时间跨度**映射 x，而不是按数组下标 ——
    // 否则缺失的那天会被当成「和前一天同一天」，曲线形状会骗人。
    const t0 = points[0].ts, t1 = points[points.length - 1].ts;
    const tspan = (t1 - t0) || 1;

    const xy = points.map(p => {
      const v = p[key];
      if (v === null) return null;
      const x = ((p.ts - t0) / tspan) * W;
      const y = H - ((v - min) / span) * (H - 4) - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).filter(Boolean).join(' ');

    const last = [...vals].reverse().find(v => v !== null);
    const first = valid[0];
    const delta = last - first;
    const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const sign = delta > 0 ? '+' : '';

    return `<div class="spark">
      <div class="spark-head">
        <span class="spark-k">${esc(opts.label || key)}</span>
        <span class="spark-v">${esc(first)} → ${esc(last)}</span>
        <span class="spark-d ${dir}">${sign}${esc(Math.round(delta * 10) / 10)}</span>
      </div>
      <svg class="spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
           role="img" aria-label="${esc(opts.label || key)}趋势，从 ${esc(first)} 到 ${esc(last)}">
        <polyline points="${xy}" pathLength="1" fill="none" stroke="currentColor" stroke-width="1.5"
                  stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg>
    </div>`;
  }

  /**
   * 模板化趋势解读 —— 每个字都来自上面算出的数字，**代码说话，模型没参与**。
   * （与 plan-test 同一条纪律：凡是替用户总结数据的地方，不许有编造空间。）
   * first ≤ 0 时不给百分比 —— 除零和「从无到有」都不是百分比能表达的。
   */
  function trendSummary(points) {
    const items = [
      { key: 'impressions', label: '曝光' },
      { key: 'fans', label: '粉丝' },
      { key: 'follows', label: '净涨粉' }
    ];
    const fmt = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const parts = [];
    for (const it of items) {
      const vals = points.map(p => p[it.key]);
      const valid = vals.filter(v => v !== null);
      if (valid.length < 2) continue;           // 画不出线的指标也不进总结
      const last = [...vals].reverse().find(v => v !== null);
      const first = valid[0];
      const d = Math.round((last - first) * 10) / 10;
      const pct = first > 0 ? Math.round((last - first) / first * 100) : null;
      let seg;
      if (d === 0) seg = `${it.label}持平`;
      else if (d > 0) seg = `${it.label} ${fmt(first)}→${fmt(last)}（+${pct === null ? fmt(d) : pct + '%'}）`;
      else seg = `${it.label} ${fmt(first)}→${fmt(last)}（${pct === null ? fmt(d) : pct + '%'}）`;
      parts.push(seg);
    }
    if (!parts.length) return '';
    return `近 ${points.length} 次采集：` + parts.join('；');
  }

  function renderTrend() {
    const box = $('#boardTrend');
    if (!box) return;
    const pts = BOARD.hist.map(pointOf).filter(p => p.ts);
    if (pts.length < 2) {
      // 只在「确实有数据但还不够画曲线」时出现。
      // 一条都没有的情况由 renderAll 整页走 .ask 空态，不走这里。
      box.innerHTML = '<div class="empty-hint">再采一次就会出现趋势曲线</div>';
      return;
    }
    const note = trendSummary(pts);
    box.innerHTML =
      sparkline(pts, 'impressions', { label: '曝光' })
      + sparkline(pts, 'fans', { label: '粉丝' })
      + sparkline(pts, 'follows', { label: '净涨粉' })
      + (note ? `<p class="spark-note">${esc(note)}</p>` : '');
  }

  /* ---------- 时间线 ---------- */

  function renderList() {
    const box = $('#boardList');
    if (!box) return;
    if (!BOARD.hist.length) {
      box.innerHTML = '<div class="empty-hint">还没有采集记录。<br>到「数据中心」点一次一键采集。</div>';
      return;
    }
    // 新的在前
    const rows = [...BOARD.hist].reverse().map((rec, i) => {
      const p = pointOf(rec);
      const on = BOARD.selected === rec.id;
      return `<button class="tl-row${on ? ' is-on' : ''}" data-id="${rec.id}">
        <span class="tl-d">${esc(dateLabel(p.at))}</span>
        <span class="tl-m">${p.noteCount} 篇</span>
        <span class="tl-r">${esc(relLabel(p.ts))}</span>
      </button>`;
    });
    box.innerHTML = rows.join('');
  }

  /* ---------- 单日详情 ---------- */

  function renderDetail() {
    const box = $('#boardDetail');
    if (!box) return;
    const rec = BOARD.selected ? BOARD.hist.find(h => h.id === BOARD.selected) : null;
    if (!rec) { box.innerHTML = ''; return; }

    const p = pointOf(rec);
    const notes = Array.isArray(rec.notes) ? rec.notes : [];
    // 找这一天的 AI 诊断：按时间就近配对，而不是只取最新那条
    const ana = BOARD.analysis.find(a => a.capturedAt === rec.capturedAt || a.id === rec.id);

    const kpi = (k, v) => `<div class="kpi"><div class="kpi-k">${esc(k)}</div><div class="kpi-v"><span class="kpi-num">${esc(v ?? '—')}</span></div></div>`;

    let html = `<div class="sec-t mt-5">${esc(dateLabel(p.at))} 的采集结果</div>`;
    html += '<div class="kpis mb-4">'
      + kpi('笔记数', p.noteCount) + kpi('粉丝数', p.fans) + kpi('净涨粉', p.follows)
      + '</div>';

    if (ana && ana.result) {
      const r = ana.result;
      html += '<div class="today-hero"><div class="hero-label">AI 诊断</div>';
      html += `<div class="hero-text">${esc(r.summary || '')}</div>`;
      if (Array.isArray(r.metrics) && r.metrics.length) {
        html += '<ul class="today-actions">'
          + r.metrics.map(m => `<li><span class="today-num">${esc(m.metric || '')}</span><span>${esc(m.read || m.verdict || '')}</span></li>`).join('')
          + '</ul>';
      }
      html += '</div>';
    } else {
      html += '<div class="card mb-4"><div class="hint">这一天没有 AI 诊断记录（可能当时没配 API Key）。</div></div>';
    }

    if (notes.length) {
      html += '<div class="sec-t">逐篇明细 <span class="sub">' + notes.length + ' 篇</span></div>';
      /* 版式 v2.41.2：此前 .dc-row 没有任何 CSS 定义（裸 div 叠文字）——
         真机反馈「排列太难看」。现在：标题一行 + 指标一行右对齐，
         数字等宽对齐，CTR 按基线上色（阈值读数据中心的 DC_BENCH，
         读不到就退 15% —— 脚本加载顺序里 datacenter 在 board 后）。 */
      const benchCtr = (typeof DC_BENCH !== 'undefined' && DC_BENCH.ctr) || 0.15;
      const pctOf = (v) => {
        const m = String(v ?? '').match(/-?\d+(\.\d+)?/);
        return m ? Number(m[0]) / 100 : null;
      };
      html += '<div class="bd-notes">' + notes.map(n => {
        const ctr = pctOf(n['封面点击率']);
        const ctrTxt = ctr === null ? 'CTR —' : 'CTR ' + (ctr * 100).toFixed(1) + '%';
        const ctrCls = ctr === null ? '' : (ctr >= benchCtr ? ' up' : ' down');
        return `<div class="bd-note">
          <div class="bd-note-t" title="${esc(n.title || '')}">${esc(n.title || '（无标题）')}</div>
          <div class="bd-note-m">
            <span>曝光 ${esc(n['曝光'] ?? '—')}</span>
            <span class="bd-ctr${ctrCls}">${esc(ctrTxt)}</span>
            <span>赞 ${esc(n['点赞'] ?? '—')}</span>
            <span>收藏 ${esc(n['收藏'] ?? '—')}</span>
          </div>
        </div>`;
      }).join('') + '</div>';
    }

    box.innerHTML = html;
    // KPI 数字滚动（reduced-motion 时为空操作）
    if (typeof window.animateNums === 'function') animateNums(box);
  }

  /* ---------- 导出 ---------- */

  async function doExport(btn) {
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = '导出中…';
    try {
      const res = await chrome.runtime.sendMessage({ action: 'exportHistoryCsv' });
      if (!res || !res.success) {
        alert(res?.error || '导出失败');
        return;
      }
      // BOM 已经在 background 侧加好了（Excel 打开中文不乱码）
      const blob = new Blob([res.data.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      a.href = url;
      a.download = `小红书运营数据_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      // 告诉用户导出了多少，而不是让他们猜文件对不对
      const line = $('#boardCount');
      if (line) line.textContent = `${res.data.count} 次采集 · ${res.data.rows} 行已导出`;
    } catch (e) {
      alert('导出失败：' + (e?.message || '未知错误'));
    } finally {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  }

  /* ---------- 加载 ---------- */

  async function load(force) {
    if (BOARD.loaded && !force) { renderAll(); return; }
    try {
      const [h, a] = await Promise.all([
        chrome.runtime.sendMessage({ action: 'getCreatorHistory' }),
        chrome.runtime.sendMessage({ action: 'getAnalysisHistory' })
      ]);
      BOARD.hist = (h && h.success && Array.isArray(h.data)) ? h.data : [];
      BOARD.analysis = (a && a.success && Array.isArray(a.data)) ? a.data : [];
      BOARD.loaded = true;
      if (!BOARD.selected && BOARD.hist.length) {
        // 默认展开最新一次 —— 用户回来就是要看上次结果
        BOARD.selected = BOARD.hist[BOARD.hist.length - 1].id;
      }
      renderAll();
    } catch (e) {
      const box = $('#boardList');
      if (box) box.innerHTML = '<div class="empty-hint">读取历史失败：' + esc(e.message) + '</div>';
    }
  }

  function renderAll() {
    /* ⚠️ 这里**只切换一个空态块的显隐，不替换整页 innerHTML**。
       换整页的话，采集到数据再回来时 #boardCount / #boardList /
       #boardDetail 全都不存在了 —— 页面会永远停在空态，
       而用户明明已经有数据。曾经的写法就是这个坑。
       显隐是唯一安全的做法：原元素一直在，只是看不见。 */
    const emptyBox = $('#boardEmpty');
    if (emptyBox) emptyBox.hidden = BOARD.hist.length > 0;

    const wrap = $('#boardContent');
    if (wrap) wrap.hidden = BOARD.hist.length === 0;

    if (BOARD.hist.length === 0) {
      if (emptyBox && window.Icons) window.Icons.hydrate(emptyBox);
      return;
    }

    const c = $('#boardCount');
    if (c) {
      c.textContent = `${BOARD.hist.length} 次采集 · 最近 ${relLabel(pointOf(BOARD.hist[BOARD.hist.length - 1]).ts)}`;
    }
    renderTrend();
    renderList();
    renderDetail();
  }

  // ---- 事件 ----
  document.addEventListener('click', (e) => {
    const row = e.target.closest('.tl-row');
    if (row) {
      BOARD.selected = Number(row.dataset.id);
      renderList();
      renderDetail();
      return;
    }
    if (e.target.closest('#boardExport')) doExport($('#boardExport'));
    if (e.target.closest('#boardGoCollect')) {
      if (typeof switchToTab === 'function') switchToTab('data');
    }
  });

  // 切到本页时若还没加载过就去读；已加载则重渲染（让相对时间保持新鲜）
  document.addEventListener('DOMContentLoaded', () => {
    load(false);
  });

  // 供数据中心导出复用趋势总结（同一套模板文案，不造第二套话术）
  window.XhsBoard = {
    load, BOARD,
    trendSummaryOf: (hist) => trendSummary((hist || []).map(pointOf).filter(p => p.ts))
  };
})();
