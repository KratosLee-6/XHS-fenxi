/**
 * today.js — 驾驶舱（v2.32.0 由「今天」仪表盘改造而来）
 *
 * ============================ 为什么改 ============================
 * 原来这屏是仪表盘：三个数字 + 两行灰字。功能都在，但**没人告诉用户
 * 该按什么顺序用** —— 这是产品最大的摩擦点，也是「做了一堆功能但用不起来」
 * 的真正原因：不是功能坏，是流程没串起来。
 *
 * 改成对话式主流程，三步走完：绑定账号 → 采集数据 → 出建议。
 * 走完之后这屏变成日常驾驶舱：今天发什么 + 未来 7 天怎么发。
 *
 * ============================ 一条不能破的规矩 ============================
 * **计划是「基于你的数据」还是「通用建议」，由 background 的 normalizePlan
 * 判定（它按真实笔记数算），这里只负责把它显示得不可能被忽略。**
 * 冷启动时那条黄色警告必须渲染出来 —— 漏渲染等于骗用户按一份
 * 没有依据的计划执行。
 */

'use strict';

const TD = { loaded: false };

const td$ = (s) => document.querySelector(s);
const tdEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\"/g, '&quot;');

/**
 * 选题闭环第二段：把勾掉的排期条目和「勾选后发布的新笔记」对上，回收效果。
 *
 * 匹配规则（数据事实，不是猜测）：
 *   勾选意味着「这条建议我已经照着发了」。发布时间落在
 *   「勾选当天 00:00 起 3 天内」的**最早一篇**笔记即视为该条目的产出。
 *   为什么不用标题匹配 —— 计划条目是建议文本（如「正文末尾加提问」），
 *   和笔记标题天然无关，按标题猜对错两说；时间窗口是可判定的。
 * 效果口径：该篇 CTR 与这批笔记的 CTR 中位数比（与 dcDiagnose 同口径，
 * 缺失值永远不当 0）。匹配不到就不显示 —— 可能只是还没采集到，
 * 说「无效果」是替数据下它没下的结论。
 */
function tdMatchOutcomes(plan, notes) {
  const sched = (plan && Array.isArray(plan.schedule)) ? plan.schedule : [];
  const doneItems = sched.filter(d => d && d.done && d.doneAt);
  if (!doneItems.length) return [];

  const noteTs = (n) => {
    if (!n || !n.publishDate) return null;
    // '2026-09-26' + '19:01' → 时间戳。斜杠形式避免 Safari 对 '-' 的历史解析差异。
    const t = Date.parse(String(n.publishDate).replace(/-/g, '/') + ' ' + (n.publishTime || '00:00'));
    return Number.isFinite(t) ? t : null;
  };

  // CTR 中位数基线：与 dcDiagnose 完全同口径（中位数、非 0 剔除）
  const ctrs = (notes || [])
    .map(n => (typeof dcPct === 'function' ? dcPct(n['封面点击率']) : null))
    .filter(v => v !== null).sort((a, b) => a - b);
  const med = ctrs.length
    ? (ctrs.length % 2 ? ctrs[(ctrs.length - 1) / 2] : (ctrs[ctrs.length / 2 - 1] + ctrs[ctrs.length / 2]) / 2)
    : null;

  const out = [];
  for (const item of doneItems) {
    const doneTs = Date.parse(item.doneAt);
    if (!Number.isFinite(doneTs)) continue;
    const dayStart = new Date(doneTs);
    dayStart.setHours(0, 0, 0, 0);
    const winEnd = dayStart.getTime() + 3 * 86400000;
    const cands = (notes || [])
      .map(n => ({ n, ts: noteTs(n) }))
      .filter(x => x.ts !== null && x.ts >= dayStart.getTime() && x.ts <= winEnd)
      .sort((a, b) => a.ts - b.ts);
    if (!cands.length) continue;   // 没对上就不出场（见函数头注释）
    const n = cands[0].n;
    const ctr = (typeof dcPct === 'function') ? dcPct(n['封面点击率']) : null;
    out.push({
      day: item.day,
      topic: item.topic,
      note: {
        title: n.title || '（无标题）',
        ctr,
        impressions: n['曝光'] ?? null
      },
      vsMedian: (ctr !== null && med !== null)
        ? (ctr > med ? 'above' : ctr < med ? 'below' : 'flat')
        : null
    });
  }
  return out;
}

async function tdLoad(force) {
  // ⚠️ 原来只有一次性守卫 `if (TD.loaded) return;`，
  //    于是**采集完切回「今天」页看到的还是旧数据** ——
  //    用户刚采完，点过来却是「还没有数据可看」，像采集没成功。
  if (TD.loaded && !force) return;
  TD.loaded = true;
  try {
    const [histRes, anaRes, taskRes, planRes, acctRes] = await Promise.all([
      chrome.runtime.sendMessage({ action: 'getCreatorHistory' }),
      chrome.runtime.sendMessage({ action: 'getAnalysisHistory' }),
      chrome.runtime.sendMessage({ action: 'getTasks' }),
      chrome.runtime.sendMessage({ action: 'getPlan' }),
      chrome.runtime.sendMessage({ action: 'getAccount' })
    ]);
    tdRender({
      record: (histRes && histRes.success && histRes.data && histRes.data[histRes.data.length - 1]) || null,
      analysis: (anaRes && anaRes.success && anaRes.data && anaRes.data[0]) || null,
      tasks: (taskRes && taskRes.success && taskRes.data) || [],
      plan: (planRes && planRes.success && planRes.data) || null,
      account: (acctRes && acctRes.success && acctRes.data) || null
    });
  } catch (e) {
    console.warn('[Today] 加载失败', e);
    tdRender({ record: null, analysis: null, tasks: [], plan: null, account: null });
  }
}

/**
 * 引导条：三步，每一步都必须对应一个用户能点的真实动作。
 *
 * ⚠️ 类名用模板字符串而不是 'a' + state + 'b' 拼。
 * 拼接出来的 class，class-sweep 扫不到 —— 它会把 state 当成一个类名
 * 然后报「未定义」。那次报警本身是个**假阳性**，但报警的位置是对的：
 * 用 + 拼类名的代码，工具验不了，也就等于没有样式契约。
 */
function tdSteps(step) {
  const items = [{ k: 1, t: '绑定账号' }, { k: 2, t: '采集数据' }, { k: 3, t: '出建议' }];
  const rows = items.map(i => {
    const state = i.k < step ? 'done' : (i.k === step ? 'now' : 'todo');
    const mark = state === 'done'
      ? `<span class="ck-dot-i" data-ico="check" data-ico-size="12"></span>`
      : String(i.k);
    return `<li class="ck-step is-${state}">
      <span class="ck-dot" aria-hidden="true">${mark}</span>
      <span class="ck-step-t">${i.t}</span></li>`;
  });
  return `<ol class="ck-steps">${rows.join('')}</ol>`;
}

function tdRender({ record, analysis, tasks, plan, account }) {
  const box = td$('#todayBody');
  if (!box) return;

  const bound = !!(account && (account.session || account.a1));
  const hasData = !!record;

  // ---- 1. 还没绑账号：这是唯一真正需要用户动手的一步，先把它说清楚 ----
  if (!bound && !hasData) {
    box.innerHTML = '<section class="ask">'
      + '<div class="ask-badge" aria-hidden="true"></div>'
      + '<p class="ask-q">先把账号接上，我来告诉你今天发什么</p>'
      + '<div class="chips">'
      + '<button class="chip" data-act="bind"><span class="chip-ico" data-ico="user" data-ico-size="14"></span>绑定小红书账号</button>'
      + '<button class="chip" data-act="collect"><span class="chip-ico" data-ico="download" data-ico-size="14"></span>直接采集一次</button>'
      + '</div>'
      + '<p class="ask-note">数据只存在你本机，不上传任何服务器</p>'
      + '<p class="ask-hint hint" role="status" aria-live="polite" hidden></p>'
      + '</section>';
    tdBindChips(box);
    return;
  }

  // ---- 2. 有账号但还没数据：告诉他下一步是采集，并说清要做什么 ----
  if (!hasData) {
    box.innerHTML = '<div class="ck">'
      + tdSteps(2)
      + '<div class="ck-msg"><div class="ck-ava" aria-hidden="true"><span data-ico="sparkle" data-ico-size="14"></span></div>'
      + '<div class="ck-bubble">账号接上了。现在缺数据 —— '
      + '到<b>创作者中心的「内容分析」页</b>保持打开，我采一次就能给你建议。</div></div>'
      + '<button class="btn btn-primary btn-block btn-lg" data-act="collect">去采集第一次</button>'
      + '<p class="ask-hint hint" role="status" aria-live="polite" hidden></p>'
      + '</div>';
    tdBindChips(box);
    return;
  }

  // ---- 3. 有数据了：驾驶舱 ----
  const cold = !plan || plan.basis === 'coldstart';
  const pick = plan && plan.todayPick;
  const sampleSize = (record && record.notes && record.notes.length) || 0;
  /* 样本不够的**真实原因**要写出来。
     只有两个数摆在一起，用户才会把「今天看不出体裁」和「采集只到 10 篇」
     这两件事联系起来 —— 否则他只会以为是 AI 不行，换个模型再试。 */
  const pg = (DC && DC.latest && DC.latest.pager) || {};
  const totalPages = pg.totalPages || 0;
  const pagesGot = pg.pagesCollected || 1;
  const pageGap = totalPages > pagesGot
    ? '，而页面声明共 ' + totalPages + ' 页（只采到第 ' + pagesGot + ' 页）'
    : '';
  const dayList = (plan && Array.isArray(plan.schedule)) ? plan.schedule : [];
  /* 效果回收：计划（勾选时间）× 最新采集（笔记发布时间）在这里交汇 ——
     选题闭环的两段数据各在一处，这是唯一的接头点。 */
  const outcomes = (plan && record && Array.isArray(record.notes))
    ? tdMatchOutcomes(plan, record.notes)
    : [];

  const bubble = cold
    ? '你的账号只有 <b>' + sampleSize + ' 篇</b>笔记，还看不出什么体裁更适合你。'
      + '先给你一份通用起步计划 —— <b>它不是基于你的数据得出的</b>，'
      + '发满 ' + (plan && plan.sampleSize >= 5 ? 5 : 5) + ' 篇我会重算。'
    : '我读完了你最近 <b>' + (plan ? plan.sampleSize : sampleSize) + ' 篇</b>笔记和账号整体数据。';

  const why = pick
    ? (pick.why || '（模型没有给出理由）')
    /* 今天发什么 = null，说明模型没给出**可用的**体裁判断。
       这里必须说清**真实原因**，不能写「换一次模型再试试」——
       那是在把「你的数据不够」误导成「模型抽风了」，用户会白折腾。
       真实原因几乎总是样本不够：体裁结论需要足够多的笔记才能看出哪种更适合这个号。 */
    : '样本不足：只采到 ' + sampleSize + ' 篇笔记' + pageGap
      + '，判断不出哪种体裁更适合你。'
      + '建议把日期范围拉到近 30 天、并且把全部页都采完，再重算一次。';

  const noPick = !pick;

  box.innerHTML = '<div class="ck">'
    + tdSteps(3)
    + '<div class="ck-msg"><div class="ck-ava" aria-hidden="true"><span data-ico="sparkle" data-ico-size="14"></span></div>'
    + '<div class="ck-bubble">' + bubble + '</div></div>'

    /* 账号不一致时这条比下面的计划都重要 —— 计划是照着「另一个号」的数据算的。
       v2.44.0：采集侧会用 web_session 指纹做比对，mismatch 时这里必须明说。 */
    + (record && record.accountMismatch
        ? '<div class="ck-acct-warn">'
          + '<span class="t-ico" data-ico="alert" data-ico-size="14"></span>'
          + '<span class="t-err">下面的计划基于「' + tdEsc(record.account || '未识别账号')
          + '」的数据 —— 与扩展绑定的「' + tdEsc(record.accountMismatch)
          + '」不是同一个号，请先去设置核对绑定。</span></div>'
        : '')

    /* 有数据了也必须能重新采一次。
       v2.32.0 改版时把旧仪表盘里的「采集最新」按钮弄丢了，
       结果驾驶舱一旦有了数据就**再也无法主动刷新** ——
       只能等自动采集、或手动去数据中心。这个缺口是 flow-test 第 2 段抓出来的：
       断言「驾驶舱上必须有采集入口」时，数出来是 0 个。 */
    + '<div class="action-row">'
    + '<button class="btn btn-sm" data-act="collect">重新采集</button>'
    + '<button class="btn btn-sm" data-act="plan">重新算计划</button>'
    + '</div>'

    + '<section class="ck-card">'
    + '<div class="ck-card-h"><span class="ck-k">今天发什么</span>'
    + '<span class="ck-genre' + (noPick ? ' is-unknown' : '') + '">'
    + tdEsc(pick ? pick.genre : '样本不足') + '</span></div>'
    + '<p class="ck-why">' + tdEsc(why) + '</p>'
    + (pick && pick.topicSeed
        ? '<p class="ck-topic"><span class="ck-k">选题</span>' + tdEsc(pick.topicSeed) + '</p>' : '')
    + (pick ? '<button class="btn btn-primary btn-block btn-sm ck-go" data-act="write" data-genre="'
        + tdEsc(pick.key) + '">用这个体裁写文案</button>' : '')
    + '</section>'

    // 冷启动标注：cold 为真时**必须**出现。这一块不是装饰，
    // 是「这份计划能不能信」的唯一提示，漏了就是在骗用户。
    + (cold ? '<div class="ck-flag" role="note">'
      + '<span class="ck-flag-ico" aria-hidden="true"><span data-ico="alert" data-ico-size="14"></span></span>'
      + '<span>下面这份排期是<b>通用建议，不是基于你的数据</b>。'
      + (plan && plan.reasons && plan.reasons[0] ? tdEsc(plan.reasons[0]) + '。' : '')
      + '发满 5 篇后重算。</span></div>' : '')

    + '<section class="ck-card">'
    + '<div class="ck-card-h"><span class="ck-k">未来 7 天</span>'
    + '<span class="ck-sub">发完可以勾掉</span></div>'
    + (dayList.length
        ? '<ul class="ck-plan">' + dayList.map(d => {
            // 选题闭环第二段：勾掉的条目若对上了「勾选后发布的新笔记」，
            // 行下追加一行效果回收。对不上就什么都不显示（tdMatchOutcomes 的纪律）。
            const oc = outcomes.find(o => o.day === d.day);
            const ocLine = (d.done && oc)
              ? '<div class="ck-outcome">'
                + '→《' + tdEsc(oc.note.title) + '》'
                + (oc.note.ctr !== null
                    ? ' CTR ' + (oc.note.ctr * 100).toFixed(1) + '%'
                      + (oc.vsMedian === 'above' ? '（高于你的中位数）'
                        : oc.vsMedian === 'below' ? '（低于你的中位数）' : '（与中位数持平）')
                    : '（CTR 未出数）')
                + '</div>'
              : '';
            return '<li>'
              + '<button class="ck-plan-row" role="checkbox" aria-checked="' + (d.done ? 'true' : 'false') + '"'
              + ' data-day="' + d.day + '">'
              + '<span class="ck-done" aria-hidden="true"></span>'
              + '<span class="ck-day">' + (d.day === 1 ? '明天' : d.day + ' 天后') + '</span>'
              + '<span class="ck-plan-g">' + tdEsc(d.genre) + '</span>'
              + '<span class="ck-plan-t">' + tdEsc(d.topic || '') + '</span>'
              + '</button>' + ocLine + '</li>';
          }).join('') + '</ul>'
        : '<p class="ck-why">这次没拿到 7 天排期 —— 采集完会自动生成，也可以到「数据中心」点重新分析。</p>')
    + '</section>'

    + '<div class="ck-input">'
    + '<input class="ck-input-box" id="ckAsk" type="text" placeholder="问我：为什么该发这个体裁？" aria-label="提问">'
    + '<button class="ck-send" id="ckSend" aria-label="发送"><span data-ico="arrow" data-ico-size="16"></span></button>'
    + '</div>'
    + '<p class="ask-hint hint" role="status" aria-live="polite" hidden></p>'
    + '</div>';

  tdBindChips(box);
  tdBindPlan(box);
  tdBindAsk(box);
}

/** 引导条 / 建议卡上的动作。每个都必须真的能做一件事。 */
function tdBindChips(box) {
  const hintEl = box.querySelector('.ask-hint');
  const say = (msg) => {
    if (!hintEl) return;
    hintEl.textContent = msg;
    hintEl.hidden = !msg;
  };
  box.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'bind') {
        switchToTab('settings');
        say('到「账号」一栏点绑定，会读取你当前的小红书登录态');
      } else if (act === 'collect') {
        /* 一次点击做完，不再让人到数据中心再点一次。
           以前这里只 switchToTab('data')，用户看到的是一个需要他再点一下的页面 ——
           引导链断在这里，前面铺的「绑定→采集→建议」等于白铺。

           dcCollect 是 datacenter.js 的顶层函数（经典脚本 → 全局），
           采集过程中的进度由它自己的状态行播报，这里不重复提示。
           采完自动切回驾驶舱并强制重读，用户直接看到结果。 */
        switchToTab('data');
        if (typeof dcCollect !== 'function') {
          say('采集功能没加载好，刷新扩展再试一次');
          return;
        }
        (async () => {
          try {
            await dcCollect();
          } catch (e) {
            console.warn('[Today] 采集失败', e);
          }
          // 采完回驾驶舱。TD.loaded=false 是必须的 ——
          // 否则 tdLoad 的懒加载守卫会直接 return，驾驶舱还停在「还没有数据」。
          TD.loaded = false;
          switchToTab('today');
          await tdLoad(true);
        })();
      } else if (act === 'plan') {
        /* 重新算计划：数据没变、只想换一次判断时用。
           和「重新采集」分开 —— 采集要开页面、慢且动数据；
           重算是纯 AI 调用，快且不动数据。合成一个按钮会让人
           以为每次都要重采。 */
        switchToTab('data');
        if (typeof dcRetryAi === 'function') {
          (async () => {
            try { await dcRetryAi(); } catch (e) { console.warn('[Today] 重算失败', e); }
            TD.loaded = false;
            switchToTab('today');
            await tdLoad(true);
          })();
        }
      } else if (act === 'write') {
        // 体裁 → 模板页的对应场景，用户落地就有地方填内容
        switchToTab('templates');
        if (typeof selectTemplate === 'function') {
          selectTemplate(btn.dataset.genre, true).catch(() => {});
        }
      }
    });
  });
}

/** 勾掉某天。写回 background 持久化，刷新后仍然记得。 */
function tdBindPlan(box) {
  box.querySelectorAll('.ck-plan-row').forEach(btn => {
    btn.addEventListener('click', async () => {
      const day = Number(btn.dataset.day);
      const next = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(next));
      try {
        await chrome.runtime.sendMessage({ action: 'markPlanDay', payload: { day, done: next } });
      } catch (e) {
        // 写不回去就必须还原勾选状态 —— 否则界面上「打勾了」但其实没存，
        // 明天打开又变回没做，用户会以为记错了。
        btn.setAttribute('aria-checked', String(!next));
      }
    });
  });
}

/** 提问：接到已有的对话页，不另造一套消息流。 */
function tdBindAsk(box) {
  const input = box.querySelector('#ckAsk');
  const send = box.querySelector('#ckSend');
  if (!input || !send) return;
  const go = () => {
    const text = input.value.trim();
    if (!text) return;
    switchToTab('chat');
    if (typeof prefillChat === 'function') prefillChat(text);
  };
  send.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

document.addEventListener('DOMContentLoaded', tdLoad);
