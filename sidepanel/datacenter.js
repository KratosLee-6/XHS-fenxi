/**
 * datacenter.js — 创作者中心数据中心
 * v2.5.0 新增
 *
 * 能力来源：把 RPA 采集方案（xhs-note-analytics.py / xhs-creator-snapshot.py）
 * 原生化进扩展。扩展自己的 content script 就是采集器，
 * 不再需要 kimi-webbridge daemon，也不依赖 cron + Python 环境。
 *
 * 相比 RPA 脚本多出来的三件事：
 *  1. 自动翻页取全量（内容分析页每页 10 条，账号常超一页）
 *  2. noteId 映射（内容分析页只有标题和日期，不含 noteId）
 *  3. 跨快照诊断（藏赞比 / CTR 基准 / 涨粉率 / 主页转粉率 / 曝光集中度）
 *     —— RPA 只负责把数字搬进 Markdown，诊断留给扩展
 */

'use strict';

const DC = {
  latest: null,
  prev: null,
  /* 当前配置的 AI 模型名（initDataCenter 从 getAiConfig 带回）。
     诊断卡的 pending/错误态标签用它 —— 那两态没有报告可读模型，
     曾经写死 deepseek-flash，配 MiniMax 的用户看到标签以为请求发错了家。 */
  aiModel: '',
  /* 单篇明细的客户端分页状态。notePageFor 记录「这份分页属于哪次采集」——
     换了一条采集记录（capturedAt 变了）就回到第 1 页，
     同一份记录内重渲染（如 AI 结论更新）则停留在当前页。 */
  notePageIndex: 0,
  notePageFor: null,
  /* 单篇明细排序：null = 采集原始顺序。点击列头在 降序 ↔ 升序 间切换。 */
  noteSort: { key: null, dir: 'desc' }
};

/**
 * 单篇明细的比较器值对。⚠️ null（缺失 / '-' 解析失败）**无论升降都垫底** ——
 * 缺失不是 0：把它当 0 排序，新笔记会在「曝光降序」里永远沉底、
 * 在「曝光升序」里永远登顶，两个方向都在骗人。
 * 字符串（笔记标题）用中文 localeCompare。纯函数，insight-test 直接测。
 */
function dcCompareVals(a, b, dir) {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  let d;
  if (typeof a === 'string' || typeof b === 'string') {
    d = String(a).localeCompare(String(b), 'zh');
  } else {
    d = a - b;
  }
  return dir === 'asc' ? d : -d;
}

const dc$ = (s) => document.querySelector(s);

/**
 * 当前数据集的 CTR 中位数（与 dcDiagnose 完全同口径：中位数、缺失剔除）。
 * 无有效值返回 null。注意是**全量**笔记的口径 —— 分页只影响显示，不影响基线。
 * 纯函数，insight-test 直接测。
 */
function dcCtrMedianOf(notes) {
  const ctrs = (notes || [])
    .map(n => dcPct(n['封面点击率']))
    .filter(v => v !== null)
    .sort((a, b) => a - b);
  if (!ctrs.length) return null;
  return ctrs.length % 2
    ? ctrs[(ctrs.length - 1) / 2]
    : (ctrs[ctrs.length / 2 - 1] + ctrs[ctrs.length / 2]) / 2;
}

/** CTR 与中位数的差（百分点，一位小数）。任一为 null → null（不当 0）。 */
function dcCtrDeltaPts(ctr, median) {
  if (ctr === null || ctr === undefined || median === null || median === undefined) return null;
  return Math.round((ctr - median) * 1000) / 10;
}

// =====================================================================
// 解析工具
// =====================================================================

/** '-' 和空串都是「无数据」，必须区别于 0 —— 新发笔记常见 */
function dcNum(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s === '-') return null;
  // 与 content.js 的 parseCount 保持一致：创作者中心会把大数渲染成「1.2万」「3.4亿」。
  // 不处理的话 dcNum 会读成 1.2，实际值差 1e4 倍，且完全静默。
  const wan = s.match(/^([\d.]+)万$/);
  if (wan) return parseFloat(wan[1]) * 10000;
  const yi = s.match(/^([\d.]+)亿$/);
  if (yi) return parseFloat(yi[1]) * 1e8;
  const n = s.replace(/[,，\s]/g, '').replace(/[^\d.]/g, '');
  if (!n) return null;
  const num = parseFloat(n);
  return Number.isFinite(num) ? num : null;
}

/** 百分比字符串 → 小数（18.70% → 0.187） */
function dcPct(v) {
  const n = dcNum(v);
  if (n === null) return null;
  return String(v).includes('%') ? n / 100 : n;
}

/** 人均观看时长 "21s" / "1m21s" → 秒 */
function dcDur(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s === '-') return null;
  const m = s.match(/^(?:(\d+)m)?\s*(\d+(?:\.\d+)?)s$/i);
  if (m) return (m[1] ? parseInt(m[1], 10) * 60 : 0) + parseFloat(m[2]);
  return dcNum(s);
}

/**
 * 安全比值：任一端缺数就返回 null，绝不返回 0。
 *
 * 为什么必须这么写：`x && x > 0 ? y / x : null` 在 y 为 null 时会算出 `null / x` = 0，
 * 于是「该笔记没有收藏数据」被当成「收藏为 0」混进均值，把藏赞比压低。
 * 实测案例：藏赞比 0.75（错） vs 1.50（对），还会把结论从 good 翻成 warn。
 * 这正是 AGENTS.md 写的「`-` 不是 0」，代码必须守住。
 */
function dcRatio(num, den) {
  if (num === null || num === undefined) return null;
  if (den === null || den === undefined) return null;
  if (den <= 0) return null;
  return num / den;
}

function dcPctText(x, digits = 1) {
  return x === null || x === undefined ? '—' : (x * 100).toFixed(digits) + '%';
}

function dcNumText(x) {
  return x === null || x === undefined ? '—' : x.toLocaleString('zh-CN');
}

// =====================================================================
// 诊断
// =====================================================================

/**
 * 诊断阈值来自账号历史基线，不是拍脑袋：
 *  · CTR 15%  —— 5 月为 3–10%，9 月起稳定越过
 *  · 藏赞比 1.0 —— 工具类内容的「存下来以后用」行为基准
 */
const DC_BENCH = { ctr: 0.15, collectLike: 1.0 };

function dcDiagnose(notes, overview) {
  const valid = notes.filter(n => dcNum(n['曝光']) !== null || dcNum(n['观看']) !== null);
  const out = [];

  if (!valid.length) {
    return [{ label: '单篇数据', value: '—', tone: 'muted', note: '全部笔记无曝光/观看数据' }];
  }

  // ---- 1. CTR 中位数（抗单篇极值干扰）----
  const ctrs = valid.map(n => dcPct(n['封面点击率'])).filter(v => v !== null).sort((a, b) => a - b);
  if (ctrs.length) {
    const med = ctrs.length % 2
      ? ctrs[(ctrs.length - 1) / 2]
      : (ctrs[ctrs.length / 2 - 1] + ctrs[ctrs.length / 2]) / 2;
    out.push({
      label: 'CTR 中位数',
      value: dcPctText(med),
      tone: med >= DC_BENCH.ctr ? 'good' : 'warn',
      note: med >= DC_BENCH.ctr
        ? `越过 15% 基准线（${ctrs.length} 篇有数据）`
        : `低于 15% 基准线（${ctrs.length} 篇有数据）`
    });
  }

  // ---- 2. 藏赞比 ----
  const cl = valid
    .map(n => dcRatio(dcNum(n['收藏']), dcNum(n['点赞'])))
    .filter(v => v !== null);
  if (cl.length) {
    const avg = cl.reduce((a, b) => a + b, 0) / cl.length;
    out.push({
      label: '藏赞比',
      value: avg.toFixed(2),
      tone: avg >= DC_BENCH.collectLike ? 'good' : 'warn',
      note: avg >= DC_BENCH.collectLike
        ? '有「存下来以后用」的价值锚点'
        : '实用价值锚点偏弱，内容偏消费型'
    });
  }

  // ---- 3. 涨粉率 = 涨粉 / 观看 ----
  const fr = valid
    .map(n => dcRatio(dcNum(n['涨粉']), dcNum(n['观看'])))
    .filter(v => v !== null);
  if (fr.length) {
    const avg = fr.reduce((a, b) => a + b, 0) / fr.length;
    out.push({
      label: '观看→涨粉率',
      value: (avg * 100).toFixed(2) + '%',
      tone: avg >= 0.01 ? 'good' : 'warn',
      note: avg >= 0.01 ? '内容能带关注' : '看了不关注，缺关注理由/钩子'
    });
  }

  // ---- 4. 评论率 ----
  const cr = valid
    .map(n => dcRatio(dcNum(n['评论']), dcNum(n['观看'])))
    .filter(v => v !== null);
  if (cr.length) {
    const avg = cr.reduce((a, b) => a + b, 0) / cr.length;
    out.push({
      label: '观看→评论率',
      value: (avg * 100).toFixed(2) + '%',
      tone: avg >= 0.01 ? 'good' : 'warn',
      note: avg >= 0.01 ? '有互动钩子' : '偏低，通常是 CTA 缺失'
    });
  }

  // ---- 5. 曝光集中度（是否靠单篇爆发）----
  const imps = valid.map(n => dcNum(n['曝光'])).filter(v => v !== null && v > 0);
  if (imps.length >= 2) {
    const total = imps.reduce((a, b) => a + b, 0);
    const top = Math.max(...imps);
    const ratio = top / total;
    out.push({
      label: '曝光集中度',
      value: dcPctText(ratio, 0),
      tone: ratio <= 0.4 ? 'good' : 'warn',
      note: ratio > 0.4
        ? 'Top1 占比过高，分发依赖单篇爆发'
        : '分发相对均衡'
    });
  }

  // ---- 6. 主页转粉率（5 月诊断至今未测的老指标）----
  // 数据源：账号总览的主页访客 / 新增关注，与单篇页口径不同，不能混算
  const ovMetrics = overview && overview.metrics ? overview.metrics : [];
  const pick = (name) => {
    const hit = ovMetrics.find(m => m.metric === name);
    return hit ? dcNum(hit.value) : null;
  };
  const visitors = pick('主页访客');
  const newFollow = pick('新增关注');
  if (visitors && visitors > 0 && newFollow !== null) {
    const r = newFollow / visitors;
    out.push({
      label: '主页转粉率',
      value: (r * 100).toFixed(2) + '%',
      tone: r >= 0.05 ? 'good' : 'warn',
      note: r >= 0.05
        ? '主页承接到位'
        : '主页承接薄弱：访客多但关注少'
    });
  }

  return out;
}

// =====================================================================
// 渲染
// ⚠️ 一律用 common.css 的类，禁止内联 style（见 common.css 顶部硬约束）
// =====================================================================

function dcStatus(text, tone) {
  const dot = dc$('#dataStatusDot');
  const txt = dc$('#dataStatusText');
  if (txt) txt.textContent = text;
  if (dot) dot.className = 'dot ' + (tone || 'idle');
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function dcMetric(k, v, delta) {
  const d = delta
    ? `<span class="kpi-d ${/^-/.test(delta) ? 'down' : 'up'}">${esc(delta)}</span>` : '';
  return `<div class="kpi"><div class="kpi-k">${esc(k)}</div><div class="kpi-v"><span class="kpi-num">${esc(v ?? '—')}</span>${d}</div></div>`;
}

function dcRenderOverview(overview) {
  const box = dc$('#dcOverview');
  if (!box) return;
  if (!overview) { box.innerHTML = ''; return; }

  const acct = overview.account || {};
  let html = '<div class="sec-t"><span class="t-ico" data-ico="user" data-ico-size="16"></span>账号总览 <span class="sub">近 7 日</span></div>';
  html += '<div class="kpis mb-4">'
    + dcMetric('关注数', acct['关注数'])
    + dcMetric('粉丝数', acct['粉丝数'])
    + dcMetric('获赞与收藏', acct['获赞与收藏'])
    + '</div>';

  const metrics = (overview.metrics || []).slice(0, 12);
  if (metrics.length) {
    html += '<div class="kpis k2">'
      + metrics.map(m => dcMetric(m.metric, m.value, m.delta)).join('')
      + '</div>';
  }
  box.innerHTML = html;
  // KPI 数字滚动（reduced-motion 时为空操作）
  if (typeof window.animateNums === 'function') animateNums(box);
}

function dcRenderDiag(items) {
  // ⚠️ 这里的 id 是 #dcDiagCopy —— 2026-10-07 之前按钮和渲染容器**都叫
  //    #dcDiag**（重复 id），dc$ 取到的是 DOM 里的第一个（按钮），
  //    于是整个「标题 + 诊断网格」被塞进按钮里：布局横向撑爆、
  //    得拉宽侧栏才能看全。按钮改名后此容器才真正接到自己的渲染。
  const box = dc$('#dcDiag');
  if (!box) return;
  if (!items || !items.length) { box.innerHTML = ''; return; }
  const tone = { good: 'ok', warn: 'warn', muted: 'idle' };
  let html = '<div class="sec-t"><span class="t-ico" data-ico="signal" data-ico-size="16"></span>规则诊断 <span class="sub">阈值来自账号历史基线</span></div>';
  html += '<div class="kpis k2">';
  items.forEach(d => {
    const t = tone[d.tone] || 'idle';
    html += `<div class="kpi">
      <div class="kpi-k">${esc(d.label)}</div>
      <div class="kpi-v"><span class="pill ${t}">${esc(d.value)}</span></div>
      <div class="hint mt-1">${esc(d.note)}</div>
    </div>`;
  });
  html += '</div>';
  box.innerHTML = html;
}

/**
 * AI 失败态 → 用户可执行的文案与恢复路径。
 *
 * 依据 design-to-product/references/component-states.md「转移与文案」：
 *   - 超时不是取消：「尚未确认任务是否结束，避免重复请求」
 *   - 错误不是终局：「输入已保留，可重试或检查连接」
 *   - 权限不给假成功：提供返回/申请路径
 * 绝不用「失败」两个字打发 —— 每种都要说清现在是什么、能做什么。
 */
const AI_ERR = {
  'permission-denied': {
    title: '没有权限调用模型',
    body: '采集数据不受影响，仍可正常导出。请到「设置」填入当前服务商的 API Key 并保存。',
    action: '去设置'
  },
  'quota': {
    title: '额度不足或触发限流',
    body: '采集数据不受影响。可稍后重试，或到「设置」查看余额与模型是否匹配。',
    action: '重新分析'
  },
  'bad-model': {
    title: '模型名不被服务端接受',
    body: '请到「设置」核对模型名是否属于当前服务商（不同家的模型名互不通用），改成该服务商支持的型号后重试。',
    action: '去设置'
  },
  'timeout': {
    title: '等待超时',
    body: '尚未确认任务是否结束 —— 请勿重复提交。可稍后点「重新分析」查看是否已生成。',
    action: '重新分析'
  },
  offline: {
    title: '连不上服务端',
    body: '请检查网络与 Endpoint 配置。采集数据仍保存在本地，不受影响。',
    action: '重新分析'
  },
  'bad-json': {
    title: '模型返回的不是合法 JSON',
    body: '可重试一次；若反复出现，到「设置」换个输出更稳的模型再试。',
    action: '重新分析'
  },
  error: {
    title: '未完成这一步',
    body: '采集数据已保留，可重试或检查连接配置。',
    action: '重新分析'
  }
};

/** 采集结果多久算「过期」—— 超过这个时长就提示重新采集 */
const STALE_MS = 6 * 3600 * 1000;

function dcIsStale(record) {
  if (!record || !record.capturedAt) return false;
  return Date.now() - new Date(record.capturedAt).getTime() > STALE_MS;
}
function dcRenderAI(analysis, hasRecord) {
  const box = dc$('#dcAiResult');
  if (!box) return;
  // 统一用类控制显隐：内联 style.display 本身能用，但它是个陷阱 ——
  // 以后谁给这个 div 加个 hidden 类，显示就静默失效了。
  box.classList.remove('hidden');

  /* 模型标签必须来自真实数据：成功态读报告里记录的那一次模型，
     pending/错误态读当前配置（请求即将/正在用它发）。
     不许写死任何模型名 —— 曾经三处硬编码 deepseek-flash，
     配 MiniMax 的用户看着标签以为请求发错了家（2026-10-13 真实投诉，
     实际存储与请求全程都是 MiniMax）。 */
  const dcAiTag = (m, cls) => {
    const s = String(m || '').trim();
    return s ? `<span class="${cls || 'sub'}">${esc(s)}</span>` : '';
  };

  if (!hasRecord) {
    // ⚠️ 这里原来也画一块「还没有采集数据，点上方一键采集」，
    //    而 #dcEmpty 说的是同一件事 —— **两个空态并存，用户看到两段重复灰字**。
    //    现在空态只由 #dcEmpty 承担，这里不再另画。
    //    但仍保留 AI 诊断的**区块标题**，否则用户会以为这功能不存在。
    box.innerHTML = '<div class="sec-t">'
      + '<span class="t-ico" data-ico="bot" data-ico-size="16"></span>AI 诊断</div>'
      + '<div class="card"><div class="hint">采集完成后会自动生成诊断，'
      + '不需要你导出文件或手动提问。</div></div>';
    return;
  }

  if (analysis && analysis.pending) {
    box.innerHTML = '<div class="sec-t"><span class="t-ico" data-ico="bot" data-ico-size="16"></span>AI 诊断 ' + dcAiTag(DC.aiModel) + '</div>'
      + '<div class="card"><div class="row"><span class="spinner"></span>'
      + '<span class="hint">正在分析，数据已采到，结论稍后自动出现…</span></div></div>';
    return;
  }

  if (analysis && analysis.ok === false) {
    const e = AI_ERR[analysis.code] || AI_ERR.error;
    const goSettings = e.action === '去设置';
    box.innerHTML = `<div class="sec-t"><span class="t-ico" data-ico="alert" data-ico-size="16"></span>AI 诊断
        ${dcAiTag(DC.aiModel, 'sec-sub')}</div>
      <div class="card">
        <p class="ai-err-title">${esc(e.title)}</p>
        <p class="hint">${esc(e.body)}</p>
        ${analysis.hint ? `<p class="hint sm">判定：${esc(analysis.hint)}</p>` : ''}
        <div class="action-row">
          <button class="btn btn-sm btn-primary" data-ai-act="${goSettings ? 'settings' : 'retry'}">${esc(e.action)}</button>
        </div>
      </div>`;
    box.querySelector('[data-ai-act]')?.addEventListener('click', () => {
      if (goSettings) { if (typeof switchToTab === 'function') switchToTab('settings'); }
      else dcRetryAi();
    });
    if (window.Icons) window.Icons.hydrate(box);
    return;
  }

  if (!analysis) {
    box.innerHTML = '<div class="sec-t"><span class="t-ico" data-ico="bot" data-ico-size="16"></span>AI 诊断</div>'
      + '<div class="card"><div class="hint">这次采集没有带回 AI 结论（可能是升级前采的旧数据）。</div>'
      + '<div class="action-row mt-3"><button class="btn btn-sm btn-primary" id="dcRetryAi">立即分析</button></div></div>';
    dc$('#dcRetryAi')?.addEventListener('click', dcRetryAi);
    return;
  }

  const r = analysis.result || analysis;
  /* parseError 存在**不等于**什么都没有 ——
     抢救层（background 的 salvageAnalysis）可能已经把 summary/healthScore/
     highlights/actions 抠出来了。
     以前这里一见 parseError 就 return，**整份分析全丢**：
     用户明明看到模型写了一大段有用的结论，界面上只有一句「不是合法 JSON」。
     现在：抢救到内容就照常渲染，但**必须显眼地标明只拿到一部分**，
     让人知道哪些结论没拿到，而不是把残缺当完整。 */
  const onlyBroken = !!r.parseError && !r._partial;
  if (onlyBroken) {
    box.innerHTML = '<div class="sec-t"><span class="t-ico" data-ico="bot" data-ico-size="16"></span>AI 诊断</div>'
      + `<div class="card"><div class="hint err">模型返回的不是合法 JSON：${esc(r.parseError)}</div>`
      + `<pre class="ai-raw">${esc(r.raw)}</pre></div>`;
    return;
  }

  const sec = (title, arr, cls) => {
    if (!Array.isArray(arr) || !arr.length) return '';
    return `<div class="sec-t">${title}</div><ul class="ai-list ${cls}">`
      + arr.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>';
  };

  let html = `<div class="sec-t"><span class="t-ico" data-ico="bot" data-ico-size="16"></span>AI 诊断
    <span class="sub">${esc(analysis.model || DC.aiModel || '未知模型')} · 自动生成</span></div>`
    /* 抢救到的部分结果必须说清「不完整」。
       不说的话，用户会拿一份缺了逐篇诊断的残缺报告当完整结论用。 */
    + (r._partial
        ? `<div class="card"><div class="hint t-warn">这份报告只恢复了一部分 —— 模型返回的 JSON 有一处语法错误
             （${esc(String(r.parseError).slice(0, 60))}），没能拿到的部分不会出现在下面。</div></div>`
        : '');

  /* 健康度分数：放在最前面，因为用户第一个想知道的是「整体到底行不行」。
     0-100，null 表示模型没给（旧数据或解析失败）——不显示占位，避免假数据。 */
  if (Number.isFinite(r.healthScore)) {
    const h = Math.max(0, Math.min(100, Math.round(r.healthScore)));
    const tone = h >= 70 ? 'ok' : h >= 40 ? 'warn' : 'bad';
    html += `<div class="health-row">
      <div class="health-num ${tone}">${h}</div>
      <div class="health-txt"><div class="health-l">账号健康度</div>
        <div class="health-bar"><i class="${tone}" style="--h:${h}%"></i></div></div>
    </div>`;
  }

  if (r.summary) html += `<div class="card ai-summary">${esc(r.summary)}</div>`;

  /* 指标逐项判断：比一段话更可读，也更容易让人发现「哪一项掉队了」。 */
  if (Array.isArray(r.metrics) && r.metrics.length) {
    html += '<div class="sec-t">逐项指标</div><div class="metric-grid-ai">'
      + r.metrics.map(m => {
        const v = m.verdict || '';
        const cls = v === 'good' ? 'ok' : v === 'bad' ? 'bad'
          : /不足|unknown/i.test(v) ? 'idle' : 'warn';
        return `<div class="mcard ${cls}">
          <div class="mk">${esc(m.metric || '')}</div>
          <div class="mv">${esc(v === 'good' ? '达标' : v === 'bad' ? '掉队'
            : v === 'warn' ? '注意' : '样本不足')}</div>
          <div class="md">${esc(m.read || '')}</div></div>`;
      }).join('') + '</div>';
  }

  html += sec('做得好的地方', r.highlights, 'ok');
  html += sec('需要警惕', r.concerns, 'warn');
  html += sec('反常识信号', r.counterintuitive, 'info');

  /* 逐篇诊断：这是「完整报告」的核心 ——
     以前只有整体印象，用户不知道具体哪篇好、为什么好。
     标题可点回原笔记（依赖 noteId，采集时已关联）。 */
  if (Array.isArray(r.noteReviews) && r.noteReviews.length) {
    html += '<div class="sec-t">逐篇诊断'
      + '<span class="sec-sub">点标题回原笔记</span></div><ul class="ai-list reviews">'
      + r.noteReviews.map(nv => {
        const v = nv.verdict || '';
        const cls = v === 'good' ? 'ok' : v === 'bad' ? 'bad' : 'warn';
        const label = v === 'good' ? '值得复制' : v === 'bad' ? '要复盘' : '待观察';
        return `<li class="rv ${cls}">
          <div class="rv-t"><span class="rv-name" title="${esc(nv.title || '')}">${esc(nv.title || '')}</span><span class="rv-b">${label}</span></div>
          <div class="rv-r">${esc(nv.reason || '')}</div></li>`;
      }).join('') + '</ul>';
  }

  /* 选题闭环第一段：诊断建议旁边直接给「转计划」。
     建议躺在报告里等于没提 —— 点一下进排期，发布后勾掉，下次采集回收效果。 */
  if (Array.isArray(r.actions) && r.actions.length) {
    html += '<div class="sec-t">下一步可以立刻做的 3 件事 <span class="sec-sub">点「转计划」进排期</span></div>'
      + '<ul class="ai-list act">'
      + r.actions.map(x => `<li>${esc(x)}<button type="button" class="btn btn-sm dc-to-plan" data-topic="${esc(x)}">转计划</button></li>`).join('')
      + '</ul>';
  }
  html += sec('下周节奏', r.nextSteps, 'info');

  if (r.dataQuality) {
    html += `<div class="hint mt-3">样本量 ${esc(r.dataQuality.sampleSize ?? '-')} · ${esc(r.dataQuality.notes || '')}</div>`;
  }
  box.innerHTML = html;

  /* 「转计划」→ background 的 appendPlanItem（只加不改：不动 basis、不覆盖已有条目）。
     成功后按钮就地变成状态文案并禁用 —— 重复点击要么重复入排期、要么被查重拦下，
     都不如让按钮自己说清楚。失败还原可点状态，错误挂在 title 上。 */
  box.querySelectorAll('.dc-to-plan').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        const res = await chrome.runtime.sendMessage({
          action: 'appendPlanItem', payload: { topic: btn.dataset.topic }
        });
        if (res && res.success) {
          btn.textContent = res.data && res.data.duplicate ? '已在排期' : '已加入';
          btn.classList.add('is-done');
          btn.title = '到「今天」页查看 7 天排期';
        } else {
          btn.disabled = false;
          btn.title = (res && res.error) || '加入失败';
        }
      } catch (e) {
        btn.disabled = false;
        btn.title = '加入失败：' + (e && e.message || e);
      }
    });
  });
}

function dcRenderTable(notes) {
  const table = dc$('#dcTable');
  const countEl = dc$('#dcNoteCount');
  if (countEl) {
    // dcRender 明明收到了 record，这里却去读模块全局 DC.latest ——
    // 两者只要有一个是 null，这行就抛 TypeError，
    // 异常一路冒出去，dcStatus 永远执行不到，**状态栏不更新**。
    const pager = (DC.latest && DC.latest.pager) || {};
    const totalPages = pager.totalPages || 0;
    const collected = pager.pagesCollected || 1;
    const totalRows = pager.totalRows || 0;

    /* 原来这里写「10 条 · 2 页」。
       **这个写法本身就是问题的藏身处** —— 它读起来像「10 条，2 页」，
       既是 10 条又像覆盖了 2 页，读者不会知道该不该怀疑。
       拆成三件事分开说：采到多少 / 应有多少 / 翻了几页。 */
    let text = notes.length + ' 条';
    if (totalRows > 0) text += ' / 共 ' + totalRows + ' 条';
    if (totalPages > 1) text += ' · 第 ' + collected + '/' + totalPages + ' 页';

    // 少采是静默失败 —— 必须显眼，且不能用和「采全了」一样的颜色
    const incomplete = totalPages > 1 && collected < totalPages;
    countEl.textContent = text;
    countEl.className = incomplete ? 'sub t-err' : 'sub';

    /* 停止原因**不能塞在这个副标题里**。
       用户实测截图显示它被挤成一列竖排（连「单篇明细」四个字都竖了），
       原因文字直接被裁掉 —— 而那恰恰是排查翻页唯一需要的信息。
       现在：标题只留数字，原因单独一行全宽显示。 */
    const warnHost = countEl.parentElement && countEl.parentElement.parentElement;
    let warn = warnHost && warnHost.querySelector('.dc-shortfall');
    if (incomplete) {
      if (!warn) {
        warn = document.createElement('div');
        warn.className = 'dc-shortfall';
        if (warnHost) warnHost.insertBefore(warn, countEl.parentElement.nextSibling);
      }
      const tr = pager.pageTrace && pager.pageTrace.length
        ? pager.pageTrace[pager.pageTrace.length - 1].note : '';
      warn.textContent = '未采全：停在第 ' + collected + ' 页。'
        + (tr ? tr : '原因未知') + '。把这段话发给我可以定位。';
    } else if (warn) {
      /* ⚠️ 采全了必须把上一轮的提示**清掉**。
         以前只有 incomplete 分支，没有移除分支 ——
         于是上一轮失败的黄字一直挂在页面上，
         采集成功之后它还在说「未采全：停在第 1 页」。
         用户看到的是「数据对了一半、提示却说没采全」，
         比不显示更糟：**一个过期的事实比没有事实更有害。** */
      warn.remove();
    }
  }

  /** 采集一开始就把上一轮的提示清掉，别让它挂到采完那一刻 */
  function dcClearShortfall() {
    const warn = document.querySelector('.dc-shortfall');
    if (warn) warn.remove();
  }
  if (!table) return;
  if (!notes.length) { table.innerHTML = ''; renderNotePager(notes); return; }

  /* 客户端分页：几十篇笔记一整张表在 400px 侧栏里要滚很久，
     而且行数越多「找某一篇」越难。每页 10 条 + 上一页/下一页，
     导出（Markdown/CSV/JSON）仍走全量 notes，不受分页影响。 */
  const DC_PAGE_SIZE = 10;
  const pages = Math.max(1, Math.ceil(notes.length / DC_PAGE_SIZE));
  const capturedAt = (DC.latest && DC.latest.capturedAt) || '';
  if (DC.notePageFor !== capturedAt) { DC.notePageFor = capturedAt; DC.notePageIndex = 0; }
  if (DC.notePageIndex >= pages) DC.notePageIndex = pages - 1;
  if (DC.notePageIndex < 0) DC.notePageIndex = 0;
  const start = DC.notePageIndex * DC_PAGE_SIZE;

  const cols = ['笔记', '曝光', '观看', 'CTR', '赞', '评', '藏', '涨粉', '时长'];
  const key = {
    '笔记': n => n.title || '',
    '曝光': n => dcNum(n['曝光']), '观看': n => dcNum(n['观看']),
    'CTR': n => dcPct(n['封面点击率']), '赞': n => dcNum(n['点赞']),
    '评': n => dcNum(n['评论']), '藏': n => dcNum(n['收藏']),
    '涨粉': n => dcNum(n['涨粉']), '时长': n => dcDur(n['人均观看时长'])
  };
  const fmt = { 'CTR': dcPctText, '时长': v => v === null ? '—' : Math.round(v) + 's' };

  /* 排序视图：不改 notes 本身（导出走全量原始顺序），
     note-link 的下标以**排序后的视图**为准。 */
  const view = DC.noteSort.key
    ? [...notes].sort((a, b) => dcCompareVals(key[DC.noteSort.key](a), key[DC.noteSort.key](b), DC.noteSort.dir))
    : notes;
  const pageNotes = view.slice(start, start + DC_PAGE_SIZE);

  /* 较中位列：每篇 CTR 对全量中位数的差（百分点）。派生值不单列排序 ——
     按 CTR 排序等价。中位数来自全量 notes，不是当前页。 */
  const median = dcCtrMedianOf(notes);

  let html = '<thead><tr>' + cols.map(c => {
    const sortable = !!key[c];
    const aria = sortable && DC.noteSort.key === c
      ? (DC.noteSort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    return `<th class="${c === '笔记' ? '' : 'num'}${sortable ? ' dc-th-sort' : ''}"`
      + `${sortable ? ` data-key="${c}" aria-sort="${aria}" title="点击按 ${c} 排序"` : ''}>${c}</th>`;
  }).join('') + '<th class="num" title="CTR 减去全部笔记的中位数（百分点）">较中位</th>' + '</tr></thead><tbody>';

  pageNotes.forEach((n, i) => {
    const ri = start + i;   // 视图下标：note-link 靠它回到 view 里取这一行
    const ctr = dcPct(n['封面点击率']);
    const ctrCls = ctr === null ? '' : (ctr >= DC_BENCH.ctr ? 'up' : 'warn-num');
    const delta = dcCtrDeltaPts(ctr, median);
    // ⚠️ 类名先算成变量再拼 —— class 属性里顶格写 ${...} 插值，
    //    class-sweep 的扫描器会把插值内容当类名（误报 delta/null）。
    let deltaCls = 'num';
    if (delta !== null) deltaCls += delta > 0 ? ' up' : delta < 0 ? ' warn-num' : '';
    const deltaCell = `<td class="${deltaCls}">${delta === null ? '—' : (delta > 0 ? '+' : '') + delta.toFixed(1) + 'pt'}</td>`;
    // 有 noteId 就把标题变成可点开的链接：点一下直接跳到那篇原笔记。
    // 没有就还是纯文本 —— 不给一个可能是错的去处。
    const titleCell = n.noteId
      ? `<td class="ellipsis" title="${esc(n.title)}">`
        + `<a class="note-link" href="#" data-note-row="${ri}">${esc(n.title)}</a></td>`
      : `<td class="ellipsis" title="${esc(n.title)}">${esc(n.title)}</td>`;
    html += '<tr>'
      + titleCell
      + cols.slice(1).map(c => {
          const v = key[c](n);
          const t = (fmt[c] || dcNumText)(v);
          const extra = c === 'CTR' ? ` class="num ${ctrCls}"` : ' class="num"';
          return `<td${extra}>${t}</td>`;
        }).join('')
      + deltaCell
      + '</tr>';
  });
  table.innerHTML = html + '</tbody>';
  renderNotePager(view, pages);

  // 列头点击：同列升降切换，换列从降序开始（用户第一反应是「谁最好」）；
  // 排序变了回第 1 页。重渲染走自己 —— view 在函数内重建。
  table.querySelectorAll('th.dc-th-sort').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.key;
      if (DC.noteSort.key === k) {
        DC.noteSort.dir = DC.noteSort.dir === 'desc' ? 'asc' : 'desc';
      } else {
        DC.noteSort = { key: k, dir: 'desc' };
      }
      DC.notePageIndex = 0;
      dcRenderTable(notes);
    });
  });

  table.querySelectorAll('.note-link').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const n = view[Number(a.dataset.noteRow)];
      if (n && n.noteHref) chrome.tabs.create({ url: n.noteHref });
    });
  });
}

/** 单篇明细的翻页条：只在数据超过一页时出现。 */
function renderNotePager(notes, pages) {
  const host = dc$('#dcNotePager');
  if (!host) return;
  const DC_PAGE_SIZE = 10;
  const totalPages = pages || Math.max(1, Math.ceil(notes.length / DC_PAGE_SIZE));
  if (notes.length <= DC_PAGE_SIZE) {
    host.classList.add('hidden');
    host.innerHTML = '';
    return;
  }
  host.classList.remove('hidden');
  const start = DC.notePageIndex * DC_PAGE_SIZE;
  const end = Math.min(start + DC_PAGE_SIZE, notes.length);
  host.innerHTML =
    `<button type="button" class="btn btn-sm" id="dcPrevPage"`
      + `${DC.notePageIndex === 0 ? ' disabled' : ''}>上一页</button>`
    + `<span class="t-xs t-muted">第 ${DC.notePageIndex + 1} / ${totalPages} 页`
      + ` · 本页 ${start + 1}–${end} 条 / 共 ${notes.length} 条</span>`
    + `<button type="button" class="btn btn-sm" id="dcNextPage"`
      + `${DC.notePageIndex >= totalPages - 1 ? ' disabled' : ''}>下一页</button>`;
  host.querySelector('#dcPrevPage').addEventListener('click', () => {
    if (DC.notePageIndex > 0) { DC.notePageIndex--; dcRenderTable(notes); }
  });
  host.querySelector('#dcNextPage').addEventListener('click', () => {
    if (DC.notePageIndex < totalPages - 1) { DC.notePageIndex++; dcRenderTable(notes); }
  });
}

function dcRender(record, analysis) {
  const empty = dc$('#dcEmpty');
  const result = dc$('#dcResult');
  const stale = dc$('#dcStale');
  // ⚠️ 走 .hidden 类，不写内联 style.display。
  // .hidden 是 display:none !important（common.css:1098），
  // 内联样式赢不了它 —— 原来 `result.style.display='block'`
  // 在 #dcResult（class 含 hidden）上**完全无效**：
  // 采集成功后账号总览、笔记表格、AI 诊断整块不出现，
  // 状态栏却说「已采集」，用户只看到一片空白。
  if (empty) empty.classList.toggle('hidden', !!record);
  if (result) result.classList.toggle('hidden', !record);
  // 过期提示必须每次重算：采到新数据后上一轮的「数据已过期」
  // 不该继续挂着。以前只在过期时显示、从不收起，陈旧横幅会一直赖着。
  if (stale) stale.classList.add('hidden');

  // AI 板块无论有没有数据都要画出来，否则用户以为功能不存在
  dcRenderAI(analysis, !!record);

  if (!record) {
    dcStatus('未采集', 'idle');
    return;
  }

  // stale：采集数据放太久要明说，不能让人拿过期数字做决策
  if (dcIsStale(record)) {
    dcRenderStale(record);
  }

  const when = new Date(record.capturedAt);
  const pad = (x) => String(x).padStart(2, '0');
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;

  dcRenderAccount(record);
  dcRenderOverview(record.overview);
  dcRenderDiag(dcDiagnose(record.notes || [], record.overview));
  dcRenderTable(record.notes || []);
  {
    // 一致时账号名并进状态条（谁的数据一眼可见）；mismatch 时交给 dcRenderAccount 的红条
    const acct = record.account && !record.accountMismatch ? ` · ${esc(record.account)}` : '';
    dcStatus(dcIsStale(record) ? `数据已过期 · 采集于 ${stamp}${acct}` : `已采集 ${stamp} · ${(record.notes || []).length} 条${acct}`,
      dcIsStale(record) ? 'warn' : 'ok');
  }

  // 图标占位在 dcRenderOverview / dcRenderDiag / dcRenderAI 生成的 HTML 里。
  // 以前是「谁生成谁记得 hydrate」，漏一处就是一个空洞 —— 在统一入口兜底，
  // hydrate 内部按 data-ico-done 去重，重复调用安全。
  if (window.Icons) window.Icons.hydrate(result || document);
}

function dcRenderStale(record) {
  const old = dc$('#dcStale');
  if (!old) return;
  const hours = Math.floor((Date.now() - new Date(record.capturedAt).getTime()) / 3600000);
  // 同上：.hidden 带 !important，只能用类切换
  old.classList.remove('hidden');
  old.innerHTML = `<div class="card stale">
    <div class="row">
      <span class="t-ico" data-ico="clock" data-ico-size="16"></span>
      <span>数据采集于 <b>${hours}</b> 小时前，可能已不是最新。</span>
    </div>
    <div class="action-row">
      <button class="btn btn-sm" data-stale-act="recollect">重新采集</button>
    </div>
  </div>`;
  old.querySelector('[data-stale-act]')?.addEventListener('click', () => dcCollect());
  if (window.Icons) window.Icons.hydrate(old);
}

/** 账号戳记条（v2.44.0）：mismatch = 采集时 web_session 指纹与绑定时不一致。
    「样本怎么抽到别的账号了」的直接答案就在这条 —— Chrome 换过登录时，
    采到的确实是另一个号的数据。一致时账号名并进状态条，不占卡片。 */
function dcRenderAccount(record) {
  const slot = dc$('#dcAccount');
  if (!slot) return;
  if (!record.accountMismatch) {
    slot.classList.add('hidden');
    slot.innerHTML = '';
    return;
  }
  slot.classList.remove('hidden');
  slot.innerHTML = `<div class="card stale">
    <div class="row">
      <span class="t-ico" data-ico="alert" data-ico-size="16"></span>
      <span class="t-err">本次采到的${record.account ? `是「<b>${esc(record.account)}</b>」的号，` : ''}与扩展绑定的「<b>${esc(record.accountMismatch)}</b>」不是同一个 —— Chrome 当前登录可能换了号，请核对后再使用这批数据。</span>
    </div>
    <div class="action-row">
      <button class="btn btn-sm" data-acct-act="settings">去设置核对绑定</button>
    </div>
  </div>`;
  slot.querySelector('[data-acct-act]')?.addEventListener('click', () => {
    // sidepanel.js 顶层函数，经典 script 下即 window.switchToTab
    if (typeof switchToTab === 'function') switchToTab('settings');
  });
  if (window.Icons) window.Icons.hydrate(slot);
}

/** 拉一次分析历史并回显；返回是否拿到结果 */
async function dcLoadAnalysis() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getAnalysisHistory' });
    const hist = res && res.success ? res.data : [];
    if (!hist.length) return null;
    const latest = hist[0];
    return { ok: true, model: latest.model, result: latest.result };
  } catch (_) {
    return null;
  }
}

/**
 * AI 分析是异步的（采集先返回，DeepSeek 后台跑），这里轮询等它落地。
 * 轮询而不是等 sendMessage 的返回：Service Worker 可能被回收，
 * 反复发短消息比挂着一个长请求更不容易断。
 */
let _aiPollTimer = null;
function dcPollAnalysis(timeoutMs = 90000) {
  clearTimeout(_aiPollTimer);
  const t0 = Date.now();
  const tick = async () => {
    if (Date.now() - t0 > timeoutMs) {
      dcStatus('采集完成，AI 分析超时（数据仍有效）', 'warn');
      return;
    }
    const a = await dcLoadAnalysis();
    if (a) {
      dcRender(DC.latest, a);
      dcStatus('采集 + AI 诊断完成', 'ok');
    } else {
      _aiPollTimer = setTimeout(tick, 2500);
    }
  };
  _aiPollTimer = setTimeout(tick, 2500);
}

async function dcRetryAi() {
  dcRenderAI({ pending: true }, true);
  dcStatus('正在重新分析…', 'warn');
  try {
    const res = await chrome.runtime.sendMessage({ action: 'analyzeLatest' });
    if (res && res.success && res.data) {
      dcRender(DC.latest, res.data);
      dcStatus(res.data.ok === false ? 'AI 分析失败' : 'AI 诊断完成', res.data.ok === false ? 'warn' : 'ok');
    }
  } catch (e) {
    dcRenderAI({ ok: false, error: e.message || String(e) }, true);
    dcStatus('AI 分析失败', 'err');
  }
}

// =====================================================================
// 导出
// =====================================================================

function dcDownload(filename, content, mime) {
  // BOM 头：Excel 打开中文 CSV 不乱码
  const blob = new Blob([mime === 'text/csv' ? '\ufeff' + content : content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dcDay() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dcToMarkdown(record, trendNote) {
  const when = new Date(record.capturedAt);
  const pad = (x) => String(x).padStart(2, '0');
  const ts = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
  const L = [];

  L.push('# 小红书单篇笔记数据（内容分析）', '');
  L.push(`> **抓取时间**：${ts}`);
  if (trendNote) L.push(`> **趋势**：${trendNote}`);
  L.push('> **抓取方式**：小红书运营工具箱 · 创作者中心直读（表格 DOM）');
  L.push('> **数据来源**：创作者中心 · 数据看板 → 内容分析');
  L.push('> **统计周期**：近 90 天（该页固定口径，非近 7 日）');
  L.push('> **采集工具**：本扩展（原 RPA 脚本 xhs-note-analytics.py 已内置）', '');
  L.push(`**本次解析到 ${(record.notes || []).length} 条笔记。**`, '');
  L.push('| 标题 | 发布 | 曝光 | 观看 | CTR | 赞 | 评 | 藏 | 涨粉 | 分享 | 人均时长 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  (record.notes || []).forEach(n => {
    L.push(`| ${n.title} | ${n.publishDate || ''} ${n.publishTime || ''} | ${n['曝光']} | ${n['观看']} | ${n['封面点击率']} | ${n['点赞']} | ${n['评论']} | ${n['收藏']} | ${n['涨粉']} | ${n['分享']} | ${n['人均观看时长']} |`);
  });

  const diag = dcDiagnose(record.notes || [], record.overview);
  if (diag.length) {
    L.push('', '## 自动诊断', '', '| 指标 | 数值 | 判断 |', '|---|---|---|');
    diag.forEach(d => L.push(`| ${d.label} | ${d.value} | ${d.note} |`));
  }

  L.push('', '---', '',
    '**口径提醒**：`账号快照`（近 7 日聚合）与本表（近 90 天逐篇明细）不可互相推算。',
    '**缺失值说明**：`-` 表示平台未出数（新发笔记未跑够样本），不是 0。');
  return L.join('\n');
}

function dcToCsv(record) {
  const cols = ['标题', '发布日期', '发布时间', '曝光', '观看', '封面点击率', '点赞', '评论', '收藏', '涨粉', '分享', '人均观看时长', '弹幕'];
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = (record.notes || []).map(n => cols.map(c => esc(n[c])).join(','));
  return cols.join(',') + '\n' + rows.join('\n');
}

function dcExport(fmt) {
  if (!DC.latest) { dcStatus('暂无数据可导出', 'warn'); return; }
  const base = `note-analytics-${dcDay()}`;
  if (fmt === 'md') {
    // 导出带上趋势总结（跨 IIFE 复用 board.js 的同一套模板文案）
    const trend = (window.XhsBoard && typeof XhsBoard.trendSummaryOf === 'function' && Array.isArray(DC.hist))
      ? XhsBoard.trendSummaryOf(DC.hist) : '';
    dcDownload(`${base}.md`, dcToMarkdown(DC.latest, trend), 'text/markdown');
  }
  else if (fmt === 'csv') dcDownload(`${base}.csv`, dcToCsv(DC.latest), 'text/csv');
  else dcDownload(`${base}.json`, JSON.stringify(DC.latest, null, 2), 'application/json');
  dcStatus(`已导出 ${base}.${fmt}`, 'ok');
}

// =====================================================================
// 交互
// =====================================================================

/**
 * 采集入口。
 *
 * 防重入按 component-states.md「按钮：防重入 / 名称不消失」：
 * 运行期间按钮保持可见但 disabled —— 消失会让用户以为没点上。
 * runToken 保证**迟到的旧响应不覆盖新任务**（取消/重开后）。
 */
let DC_BUSY = false;
let DC_RUN = 0;

/** 状态切换用 aria-live 播报，整态播一次，不逐 token 念 */
function dcAnnounce(text) {
  const live = dc$('#dcLive');
  if (live) live.textContent = text;
}

async function dcCollect() {
  if (DC_BUSY) return;              // 快速双击只有一次任务
  DC_BUSY = true;
  const token = ++DC_RUN;
  // 一开始就把上一轮的「未采全」清掉：让它挂到采完那一刻，
  // 会让用户看到「新数据已经全了、提示却还在说没采全」。
  if (typeof dcClearShortfall === 'function') dcClearShortfall();

  const btn = document.querySelector('[data-action="dcCollect"]');
  if (btn) { btn.setAttribute('aria-disabled', 'true'); btn.style.pointerEvents = 'none'; }
  dcStatus('采集中：正在打开后台标签页…', 'warn');
  dcRenderAI({ pending: true }, true);
  dcAnnounce('开始采集，正在打开后台标签页');

  try {
    // ⚠️ 原来这里写死 `maxPages: 5`（最多 50 篇），**绕过了 background 里的
    //    COLLECT_MAX_PAGES**。改那边不生效，就是这个原因 ——
    //    采集上限改了两处调用点，只改一处等于没改。
    //    不传 maxPages，让 background 用它自己的默认值。
    const res = await chrome.runtime.sendMessage({ action: 'creatorCollect', payload: {} });
    if (token !== DC_RUN) return;    // 已被更新的任务取代，丢弃迟到响应
    if (!res || !res.success) throw new Error((res && res.error) || '采集失败');
    DC.prev = DC.latest;
    DC.latest = res.data;
    // 采集已返回，AI 在后台跑 —— 先把数据画出来，再轮询等结论
    dcRender(DC.latest, { pending: true });
    // ⚠️ 把**采集诊断**一起显示出来。
    //    以前只显示「采集完成 N 条」，一旦分页没生效（只采到第一页 10 条），
    //    用户和开发者都看不出「其实只采了一半」——
    //    少采数据是**静默失败**，比报错更难发现。
    const pgr = res.data.pager || {};
    const bits = [`采集完成 ${(res.data.notes || []).length} 条`];
    if (pgr.pagesCollected) bits.push(`翻到第 ${pgr.pagesCollected} 页`);
    if (pgr.mismatch) bits.push('注意：' + pgr.mismatch);
    const trace = Array.isArray(pgr.pageTrace) ? pgr.pageTrace : [];
    const lastTrace = trace[trace.length - 1];
    if (lastTrace && lastTrace.note && !pgr.mismatch) bits.push(lastTrace.note);
    const statusText = bits.join(' · ') + '，AI 分析中…';
    dcStatus(statusText, pgr.mismatch ? 'warn' : 'ok');
    dcAnnounce(statusText);
    if (pgr.mismatch || (lastTrace && /失败|点不动|未找到/.test(lastTrace.note || ''))) {
      // 停在 warn 而不是 ok：宁可显眼一点，也别让人以为数据是全的
      console.warn('[XHS] 采集未覆盖全部页：', pgr);
    }
    dcPollAnalysis();
    // 采完就让「今天」页重读一次 —— 否则用户切过去看到的还是采集前的旧数据
    if (typeof tdLoad === 'function') tdLoad(true);
  } catch (e) {
    if (token !== DC_RUN) return;
    dcStatus('采集失败：' + (e.message || e), 'err');
    dcRenderAI(null, false);
    dcAnnounce('采集失败：' + (e.message || e));
    console.error('[DC] 采集失败', e);
  } finally {
    if (token === DC_RUN) {
      DC_BUSY = false;
      if (btn) { btn.removeAttribute('aria-disabled'); btn.style.pointerEvents = ''; }
    }
  }
}

function dcOpenBackground() {
  chrome.tabs.create({ url: 'https://creator.xiaohongshu.com/statistics/data-analysis', active: true });
}

function initDataCenter() {
  if (!dc$('#panel-data')) return;

  // 空态里的「采集第一次」——接管后立即采集，
  // 免得用户点了还要再找上面的按钮
  dc$('#dcGoCollect')?.addEventListener('click', () => dcCollect());

  /* 一键采集诊断：把「为什么只采到一页」直接复制到剪贴板。
     翻页这件事已经反复三轮，每次都卡在「要不要开 F12 敲探针」——
     **诊断的获取成本必须低于用户放弃的阈值**。
     这里让用户点一下就完事，剩下的只需要粘贴。

     走 background 而不是侧栏直接发消息：采集那条链路已经有一套
     「开好创作者中心标签页 + 等 content script 握手」的成熟逻辑
     （openCreatorTab），复用它比在侧栏重写一遍可靠。 */
  dc$('#dcDiagCopy')?.addEventListener('click', async () => {
    const hint = dc$('#dcDiagHint');
    const say = (t) => { if (hint) hint.textContent = t; };
    say('正在采集诊断，可能要十几秒…');
    try {
      const res = await chrome.runtime.sendMessage({ action: 'creatorDiag' });
      if (res && res.success) {
        say('已复制到剪贴板，直接粘贴给我就行');
      } else {
        say('没拿到诊断：' + ((res && res.error) || '未知'));
      }
    } catch (e) {
      say('采集诊断失败：' + ((e && e.message) || '网络错误'));
    }
  });

  document.addEventListener('click', (e) => {
    const item = e.target.closest('.func-item[data-action]');
    if (item) {
      const act = item.dataset.action;
      if (act === 'dcCollect') dcCollect();
      if (act === 'dcOpen') dcOpenBackground();
      return;
    }
    const exp = e.target.closest('.dc-export');
    if (exp) dcExport(exp.dataset.fmt);
  });

  // 回填最近一次采集结果 + 上一次的 AI 诊断
  // 注意：定时采集已迁移到「🤖 自动化 → ⏰ 定时任务」，这里不再重复维护一份
  Promise.all([
    chrome.runtime.sendMessage({ action: 'getCreatorHistory' }),
    dcLoadAnalysis(),
    chrome.runtime.sendMessage({ action: 'getAiConfig' }).catch(() => null)
  ]).then(([res, analysis, aiRes]) => {
    const hist = res && res.success ? res.data : [];
    DC.hist = hist;   // 全量历史：导出趋势行用（分页/明细只用 latest）
    if (aiRes && aiRes.success && aiRes.data) {
      DC.aiModel = String(aiRes.data.model || '').trim();
    }
    if (hist.length) {
      DC.prev = hist.length > 1 ? hist[hist.length - 2] : null;
      DC.latest = hist[hist.length - 1];
    }
    dcRender(DC.latest, analysis);
  }).catch(() => dcRender(null, null));
}

document.addEventListener('DOMContentLoaded', initDataCenter);
