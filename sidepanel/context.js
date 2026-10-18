/**
 * context.js — 对话上下文底座
 *
 * ============================ 它解决什么 ============================
 * 对话页原先是一个**空白输入框**：用户问「我最近的笔记为什么起量慢」，
 * AI 手里什么都没有，只能给通用建议 —— 而通用建议是这个产品最没价值的东西
 * （小红书运营的通用建议在任何一个网页上都能免费读到）。
 *
 * 这个文件把用户**本机已有的数据**压成一段紧凑文本，挂在每条提问后面，
 * 让 AI 至少是在**这个用户的真实数字**上回答。
 *
 * ============================ 唯一不能破的规矩 ============================
 * **只写数据里真实存在的东西。拿不准就留空，并说明为什么留空。**
 *
 * 这不是风格问题。历史上出过三次事故，全部是「拿不准就给个默认数」：
 *   ① 缺失值 `-` 被当成 0 混进均值，诊断结论从 good 翻成 warn
 *   ② 样本 2 篇却让模型写「基于你的数据表现优秀」
 *   ③ 采集中途失败留下半份记录，界面照样按完整数据算
 *
 * 所以这里的每个数字都必须能追回 storage 里的某个字段。
 * **没有默认值，没有兜底数字，没有「大概」「通常」。**
 *
 * ============================ 另一条铁律 ============================
 * `plan.basis === 'coldstart'` 时，摘要里必须原样带上
 * 「非基于你的数据」这一事实。冷启动计划是通用建议，
 * 摘要却把它当用户数据喂给 AI，等于**由我们在替通用建议背书**。
 * 这条由 dev/context-test.mjs 的防骗断言守着。
 *
 * 本文件是纯函数，不碰 DOM，可离线单测。
 */

'use strict';

const CTX = (function () {
  'use strict';

  /**
   * 长度上限。这是**给 AI 看的上下文**，不是给人看的报表：
   * 塞满 90 天历史会挤掉真正的提问，而且每个 token 都算钱。
   * 超出后砍掉最旧的历史，**并写明砍了多少** —— 不能悄悄截断，
   * 否则 AI 会以为自己看到了全部。
   */
  const MAX_CHARS = 1600;
  const HISTORY_DAYS = 5;      // 历史采集只给最近 5 次
  const MAX_NOTES = 5;         // 笔记明细最多 5 条
  const MAX_METRICS = 6;       // 账号指标最多 6 条

  /**
   * 数值解析。**'-' 与空值一律返回 null，绝不返回 0。**
   *
   * 这与 datacenter.js 的 dcNum 是同一条规矩（AGENTS.md 关键约束 5）。
   * 这里独立实现而不是 import，是因为 sidepanel 各文件都是 classic script、
   * 共享全局作用域，重复声明 const 会直接崩；而且 context.js 要能
   * 在 node 里被单独加载测，耦合越少越好。
   */
  function num(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!s || s === '-') return null;          // 平台未出数 —— 不是 0
    // 创作者中心会把大数渲染成「1.2万」「3.4亿」，不处理会差 1e4 倍
    const wan = s.match(/^([\d.]+)万$/);
    if (wan) return parseFloat(wan[1]) * 10000;
    const yi = s.match(/^([\d.]+)亿$/);
    if (yi) return parseFloat(yi[1]) * 1e8;
    const n = s.replace(/[,，\s]/g, '').replace(/[^\d.]/g, '');
    if (!n) return null;
    const out = parseFloat(n);
    return Number.isFinite(out) ? out : null;
  }

  /** 数值 → 显示文本。null 一律显示「无数据」，不显示 0。 */
  function nText(v) {
    const n = num(v);
    if (n === null) return '无数据';
    return Number.isInteger(n) ? n.toLocaleString('zh-CN') : String(n);
  }

  /** 账户是否已绑定。session 或 a1 任一存在即视为已绑（与 today.js 同判据）。 */
  function isBound(account) {
    return !!(account && (account.session || account.a1));
  }

  /** 一条采集记录里有没有可用的笔记数据。 */
  function hasNoteData(record) {
    return !!(record && Array.isArray(record.notes) && record.notes.length > 0);
  }

  /** 采集时间 → YYYY-MM-DD。解析不出来就返回空串，绝不用「今天」顶替。 */
  function dayOf(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** AI 诊断历史项 → 结论文本。取不到就返回空串，不编。 */
  function analysisText(analysis) {
    if (!analysis) return '';
    const r = analysis.result;
    if (typeof r === 'string' && r.trim()) return r.trim();
    if (r && typeof r === 'object') {
      if (typeof r.summary === 'string' && r.summary.trim()) return r.summary.trim();
      if (Array.isArray(r.items)) {
        const lines = r.items
          .filter(it => it && (it.title || it.label))
          .slice(0, 4)
          .map(it => `${it.title || it.label}：${it.read || it.verdict || it.text || '（无结论文本）'}`);
        if (lines.length) return lines.join('；');
      }
    }
    return '';
  }

  /**
   * 主体构建。
   *
   * 注意：空态必须说清**是哪一种空**：
   *    没绑账号 / 绑了没采集 / 采了没数据。
   *    三者对 AI 的意义完全不同 —— 「绑了没采集」时正确的回答是
   *    「先采一次数据」，而不是基于空气给建议。
   */
  function buildBody({ record, history, analysis, plan, account, tasks }) {
    const lines = [];
    const bound = isBound(account);
    const hist = Array.isArray(history) ? history : [];
    const hasData = hasNoteData(record);

    // ---- 账号 ----
    if (bound) {
      const nick = account.nickname ? String(account.nickname).trim() : '';
      lines.push(nick ? `已绑定账号：${nick}` : '已绑定账号（未读到昵称）');
    } else {
      lines.push('未绑定小红书账号。');
    }

    // ---- 空态分流 ----
    if (!bound && !hasData) {
      lines.push('当前没有任何采集数据，也没有绑定账号。'
        + '这次回答只能给通用建议；任何关于「你的账号表现如何」的结论都无从谈起。'
        + '应先引导用户去设置页绑定账号，或在数据中心采一次。');
    } else if (bound && !record) {
      lines.push('已绑定账号，但从未采集过。没有任何数据可供分析。'
        + '应引导用户先采集一次，不要凭空给数字。');
    } else if (record && !hasData) {
      lines.push('最近一次采集的记录里没有笔记明细'
        + (record.capturedAt ? `（采集于 ${dayOf(record.capturedAt)}）` : '')
        + '，因此本次采集没有可分析的笔记数据。');
    }

    // ---- 当前采集记录 ----
    if (record) {
      const when = dayOf(record.capturedAt);
      lines.push(when ? `最近一次采集：${when}` : '最近一次采集：时间字段缺失，无法判断新鲜度');
      const ov = record.overview || {};
      const acct = ov.account || {};
      const fans = acct['粉丝数'];
      if (num(fans) !== null) {
        lines.push(`当前粉丝数：${nText(fans)}`);
      } else if (fans !== undefined) {
        lines.push('粉丝数：平台返回「' + String(fans) + '」，未出数');
      }

      const metrics = Array.isArray(ov.metrics) ? ov.metrics : [];
      if (metrics.length) {
        const seg = metrics.slice(0, MAX_METRICS).map(m => {
          const v = nText(m && m.value);
          const d = (m && m.delta != null && String(m.delta).trim()) ? `（${String(m.delta).trim()}）` : '';
          return `${(m && m.metric) || '（无名指标）'}=${v}${d}`;
        });
        const more = metrics.length > MAX_METRICS ? `（另有 ${metrics.length - MAX_METRICS} 项未列出）` : '';
        lines.push('账号指标：' + seg.join('，') + more);
      }

      // ---- 笔记明细 ----
      const notes = Array.isArray(record.notes) ? record.notes : [];
      if (notes.length) {
        const rows = notes.slice(0, MAX_NOTES).map(n => {
          // 单篇关键指标：'-' 走 nText → 「无数据」，绝不当 0
          const imp = nText(n['曝光']);
          const like = nText(n['点赞']);
          const col = nText(n['收藏']);
          return `《${String(n['标题'] || '（无标题）').slice(0, 18)}》曝光=${imp} 点赞=${like} 收藏=${col}`;
        });
        const more = notes.length > MAX_NOTES ? `（共 ${notes.length} 篇，只列最近 ${MAX_NOTES} 篇）` : '';
        lines.push(`笔记明细（共 ${notes.length} 篇）：` + rows.join('；') + more);

        // 缺数的篇数要说清楚：**不能求和成一个看着像真实统计的数字**。
        const noImp = notes.filter(n => num(n['曝光']) === null).length;
        if (noImp > 0) {
          lines.push(`其中 ${noImp} 篇平台未出曝光数（「-」是未出数，不是 0，不参与任何求和）。`);
        }
      }
    }

    // ---- 历史采集（只给概览 + 变化，不铺开）----
    if (hist.length > 1) {
      const recent = hist.slice(-HISTORY_DAYS);
      const series = [];
      for (const h of recent) {
        const d = dayOf(h && h.capturedAt);
        const f = num(h && h.overview && h.overview.account && h.overview.account['粉丝数']);
        const cnt = (h && Array.isArray(h.notes)) ? h.notes.length : 0;
        series.push(`${d || '日期未知'}: 粉丝 ${f === null ? '无数据' : nText(f)}，笔记 ${cnt} 篇`);
      }
      const dropped = hist.length - recent.length;
      lines.push('历史采集（仅最近 ' + recent.length + ' 次）: ' + series.join('；')
        + (dropped > 0 ? `。更早的 ${dropped} 次未纳入。` : '。'));
    }

    // ---- 历史 AI 诊断 ----
    const at = analysisText(analysis);
    if (at) {
      lines.push('最近一次 AI 诊断结论（只代表那一次采集时点）：' + at.slice(0, 240));
    } else if (record && hasData) {
      lines.push('最近一次 AI 诊断：没有可用的结论文本。');
    }

    // ---- 内容计划 ----
    if (!plan) {
      lines.push('还没有生成过内容计划。');
    } else if (plan.basis === 'coldstart') {
      /* ⚠ 防骗分支。冷启动计划是**通用建议**。
         摘要若把它当作用户数据呈现，等于我们替通用建议背书。
         下面这句必须原样出现，dev/context-test.mjs 的防骗断言盯着它。

         用「注意：」而不是符号 —— 仓库禁止 emoji，注释里也不行
         （dev/emoji-sweep.py）。这段文本会进 AI 提示词，
         更是连一个装饰性符号都不该有。 */
      lines.push('注意：现有内容计划非基于你的数据'
        + (plan.sampleSize != null ? `（依据样本仅 ${plan.sampleSize} 篇，不足以判断你的账号）` : '')
        + '。回答时必须明确说明它是通用建议，不得表述为「根据你的数据显示」。');
    } else {
      const parts = [];
      if (plan.sampleSize != null) parts.push(`依据样本 ${plan.sampleSize} 篇`);
      parts.push('该计划基于用户数据');
      if (plan.todayPick && plan.todayPick.genre) {
        parts.push(`今日体裁「${plan.todayPick.genre}」`);
      }
      if (Array.isArray(plan.schedule)) {
        const undone = plan.schedule.filter(d => d && !d.done).length;
        if (plan.schedule.length) parts.push(`7 天排期中 ${undone} 篇未发`);
      }
      lines.push('内容计划：' + parts.join('，') + '。');
    }

    // ---- 定时任务 ----
    const tks = Array.isArray(tasks) ? tasks : [];
    if (tks.length) {
      const on = tks.filter(t => t && t.enabled).length;
      lines.push(`定时任务：共 ${tks.length} 个，${on} 个已启用。`);
    } else {
      lines.push('定时任务：没有配置。');
    }

    return lines.join('\n');
  }

  /**
   * 入口。
   *
   * 截断时**在末尾写明截断** —— 静默截断会让 AI 以为自己读全了，
   * 然后基于半份数据下结论，这是本项目最熟悉的那类事故。
   */
  function buildContextDigest(input) {
    const src = input || {};
    const body = buildBody({
      record: src.record || null,
      history: src.history || [],
      analysis: src.analysis || null,
      plan: src.plan || null,
      account: src.account || null,
      tasks: src.tasks || []
    });
    if (body.length <= MAX_CHARS) return body;
    return body.slice(0, MAX_CHARS) + `\n（上下文过长，已截断至 ${MAX_CHARS} 字，末尾数据未完整读入）`;
  }

  return { buildContextDigest, MAX_CHARS };
}());

if (typeof module !== 'undefined' && module.exports) module.exports = CTX;
if (typeof globalThis !== 'undefined') globalThis.CTX = CTX;
