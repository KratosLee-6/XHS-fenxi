/**
 * content.js - 小红书页面 DOM 读取
 * 100% 本地读取，不拦截任何网络请求
 * 兼容：笔记详情页、博主主页、搜索页、发现页
 */

(function () {
  'use strict';

  // ========== 工具函数 ==========
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  function text(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').trim();
  }

  function attr(el, name) {
    return el ? (el.getAttribute(name) || '') : '';
  }

  function parseCount(str) {
    if (!str) return 0;
    str = str.replace(/[,，\s]/g, '');
    const wan = str.match(/^([\d.]+)万$/);
    if (wan) return Math.round(parseFloat(wan[1]) * 10000);
    const yi = str.match(/^([\d.]+)亿$/);
    if (yi) return Math.round(parseFloat(yi[1]) * 1e8);
    const n = str.match(/^[\d.]+$/);
    return n ? Math.round(parseFloat(n[0])) : 0;
  }

  // ========== 通用 DOM 查询（多选择器兼容） ==========
  function queryOne(candidates, ctx = document) {
    for (const sel of candidates) {
      try {
        const el = $(sel, ctx);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  function queryAll(candidates, ctx = document) {
    for (const sel of candidates) {
      const els = $$(sel, ctx);
      if (els.length) return els;
    }
    return [];
  }

  // ========== 笔记详情抓取 ==========
  function scrapeNote() {
    const url = window.location.href;

    // 标题
    const title =
      text(queryOne([
        'h1.title', '.note-header .title', '.detail-title',
        '[class*="title"]', 'meta[property="og:title"]'
      ])) || text($('title')).replace(/^小红书$/, '') || '';

    // 正文内容
    const content =
      text(queryOne([
        '#detail-content', '.note-content', '.rich-text', 'article',
        '[class*="content"]', '[class*="desc"]'
      ])) || '';

    // 作者信息 - 兼容多种选择器
    const authorNameEl = queryOne([
      '.author-info .name', '.user-nickname', '.author-name',
      '[class*="author"] [class*="name"]', '[class*="user"] [class*="name"]',
      'meta[property="og:author"]'
    ]);
    const authorName = authorNameEl ? text(authorNameEl) : '';

    const authorAvatarEl = queryOne([
      '.author-info img', '.user-avatar img', '[class*="avatar"] img',
      '[class*="author"] img', '[class*="user"] img'
    ]);
    const authorAvatar = attr(authorAvatarEl, 'src') || '';

    // 尝试从 URL 或元素属性获取 userId
    const userIdMatch = url.match(/\/user\/profile\/([a-z0-9]+)/i)
      || url.match(/userId=([a-z0-9]+)/i)
      || (authorNameEl ? attr(authorNameEl.closest('[data-user-id]'), 'data-user-id') : '');

    // 互动数据
    const getStat = (candidates) => {
      const el = queryOne(candidates);
      return el ? parseCount(text(el)) : 0;
    };

    const likes = getStat([
      '[class*="like"] [class*="count"]', '[class*="like-wrapper"] [class*="num"]',
      '[class*="social"] [class*="count"]', '.like-count'
    ]);

    const comments = getStat([
      '[class*="comment"] [class*="count"]', '[class*="comment-wrapper"] [class*="num"]',
      '.comment-count'
    ]);

    const collects = getStat([
      '[class*="collect"] [class*="count"]', '[class*="collect-wrapper"] [class*="num"]',
      '.collect-count'
    ]);

    const shares = getStat([
      '[class*="share"] [class*="count"]', '.share-count'
    ]);

    // 标签/话题
    const tagEls = queryAll([
      '[class*="tag"]', '[class*="topic"]', '.topic-link', '.tag-list .tag',
      '[class*="hash"]'
    ]);
    const tags = [...new Set(
      tagEls
        .map(el => text(el).replace(/^#/, '').trim())
        .filter(t => t && t.length < 40 && t.length > 0 && !/^\d+$/.test(t))
    )];

    // 图片
    const imgEls = queryAll([
      '#detail-content img', '.note-content img', '[class*="content"] img',
      'article img', '.rich-text img', '[class*="image"] img'
    ]);
    const images = [...new Set(
      imgEls
        .map(el => attr(el, 'src') || attr(el, 'data-src'))
        .filter(src => src && !src.includes('data:') && src.length > 20)
    )];

    // 笔记 ID
    const noteIdMatch = url.match(/explore\/([a-z0-9]+)/i)
      || url.match(/discovery\/item\/([a-z0-9]+)/i)
      || url.match(/note\/([a-z0-9]+)/i);

    return {
      url,
      noteId: noteIdMatch ? noteIdMatch[1] : '',
      title,
      content,
      author: {
        name: authorName,
        id: userIdMatch || '',
        avatar: authorAvatar
      },
      stats: { likes, comments, collects, shares },
      tags,
      images,
      timestamp: Date.now()
    };
  }

  // ========== 博主主页抓取 ==========
  function scrapeProfile() {
    const url = window.location.href;

    const name =
      text(queryOne([
        '.profile-name', '.user-name', '[class*="name"]',
        'meta[property="og:title"]'
      ])) || text($('title')).replace(/ - 小红书$/, '').replace(/^小红书 个人主页/, '') || '';

    const getStat = (candidates) => {
      const el = queryOne(candidates);
      return el ? parseCount(text(el)) : 0;
    };

    const fans = getStat([
      '[class*="fans"] [class*="count"]', '[class*="fans"] [class*="num"]',
      '[class*="follower"] [class*="count"]', '.fans-count',
      '[class*="fansCount"]'
    ]);

    const following = getStat([
      '[class*="follow"] [class*="count"]', '[class*="following"] [class*="num"]',
      '.following-count'
    ]);

    const posts = getStat([
      '[class*="note"] [class*="count"]', '[class*="note"] [class*="num"]',
      '[class*="post"] [class*="count"]', '.note-count'
    ]);

    const intro =
      text(queryOne([
        '[class*="intro"]', '[class*="desc"]', '[class*="about"]',
        '[class*="signature"]', '[class*="bio"]'
      ])) || '';

    // 尝试从 URL 提取 userId
    const userIdMatch = url.match(/\/user\/profile\/([a-z0-9]+)/i);

    return {
      url,
      userId: userIdMatch ? userIdMatch[1] : '',
      name,
      fans,
      following,
      posts,
      intro,
      timestamp: Date.now()
    };
  }

  // ========== 评论抓取 ==========
  function scrapeComments() {
    // 等待评论加载（动态渲染）
    const commentContainers = queryAll([
      '[class*="comment-list"]', '[class*="commentList"]',
      '[class*="comments"]', '.comment-wrapper'
    ]);

    if (!commentContainers.length) return [];

    const commentEls = queryAll([
      '[class*="comment-item"]', '[class*="commentItem"]',
      '[class*="comment"] [class*="item"]', '[class*="comment-list"] [class*="comment"]'
    ], commentContainers[0]);

    return commentEls.map(el => ({
      author: text(queryOne(['[class*="user"] [class*="name"]', '[class*="nick"]'], el)) || '',
      content: text(queryOne(['[class*="content"]', '[class*="text"]'], el)) || '',
      time: text(queryOne(['[class*="time"]', '[class*="date"]'], el)) || '',
      likes: (() => {
        const likeEl = queryOne(['[class*="like"] [class*="count"]', '[class*="liked"]'], el);
        return likeEl ? parseCount(text(likeEl)) : 0;
      })()
    })).filter(c => c.content);
  }

  // ========== 笔记列表项抓取（搜索/发现页） ==========
  function scrapeNoteList() {
    const noteCards = queryAll([
      '[class*="note-item"]', '[class*="noteItem"]',
      '[class*="feeds"] [class*="item"]', '[class*="card"]',
      '[class*="explore"] [class*="note"]'
    ]);

    return noteCards.map(card => {
      const titleEl = queryOne([
        '[class*="title"]', '[class*="desc"]', 'h1', 'h2', '[class*="name"]'
      ], card);
      const authorEl = queryOne([
        '[class*="author"] [class*="name"]', '[class*="user"] [class*="name"]',
        '[class*="nick"]'
      ], card);
      const likesEl = queryOne([
        '[class*="like"] [class*="count"]', '[class*="liked"]'
      ], card);

      return {
        title: titleEl ? text(titleEl).slice(0, 100) : '',
        author: authorEl ? text(authorEl) : '',
        likes: likesEl ? parseCount(text(likesEl)) : 0,
        url: attr(queryOne(['a[href*="explore"]', 'a[href*="note"]'], card), 'href') || ''
      };
    }).filter(n => n.title);
  }

  // ========== 创作者中心抓取（数据看板）============
  // 2026-10-03 实测：单篇笔记数据在「数据看板 → 内容分析」页的前端渲染表格里，
  // 不走 API。此前 2026-06-18「桌面 web 不支持单篇数据」的结论是错的 ——
  // 当时用猜的 URL 找页面（/statistics/note、/data-board…）全部 404，
  // 正确路径 /statistics/data-analysis 从未试过。
  // 本模块由 RPA 采集方案移植而来，列序与 RPA 脚本保持一致。

  const CREATOR_ANALYSIS_URL = 'https://creator.xiaohongshu.com/statistics/data-analysis';
  const CREATOR_HOME_URL = 'https://creator.xiaohongshu.com/new/home';
  const CREATOR_MANAGE_URL = 'https://creator.xiaohongshu.com/new/note-manager';

  // 与 td[1]..td[10] 一一对应（2026-10-03 实测列序，勿随意调整）
  const CREATOR_METRIC_COLS = ['曝光', '观看', '封面点击率', '点赞', '评论', '收藏', '涨粉', '分享', '人均观看时长', '弹幕'];

  function isCreatorPage() {
    return /(^|\.)creator\.xiaohongshu\.com$/i.test(window.location.hostname);
  }

  /** 登录墙检测：创作者中心未登录时页面出现「登录」字样但没有「创作服务」 */
  function creatorLoginWall() {
    const head = (document.body.innerText || '').slice(0, 400);
    return /登录|扫码|手机号/.test(head) && !/创作服务/.test(head);
  }

  /** 读取页面上所有表格行，统一为 [[cell, cell, ...], ...] */
  function readAllTableRows() {
    const rows = [];
    for (const tr of $$('tr')) {
      const tds = [...tr.querySelectorAll('td,th')].map(td =>
        (td.innerText || td.textContent || '').trim().replace(/\s+/g, ' '));
      if (tds.length) rows.push(tds);
    }
    return rows;
  }

  /**
   * 只取**内容分析那张表**的行。
   *
   * ⚠️ 原来用的是 readAllTableRows()，它扫**全页所有 tr**。
   *    创作者中心一个页面里有好几张表（数据总览、热门活动…），
   *    混进来之后：
   *      · 表头定位失败 → 列全部对不上 → 曝光显示「—」
   *      · 「哪一行算数据行」也判错
   *
   * 现在按**「这张表里有我们认识的列名」**来认表：
   * 含「曝光」「点赞」「评论」中的任意两个 → 就是它。
   * 找不到才退回全页（宁可多读也不要什么都不读）。
   */
  function readAnalysisTableRows() {
    const MARKERS = ['曝光', '点赞', '评论', '观看', '封面点击率', '涨粉', '收藏', '分享'];
    const tables = $$('table');
    for (const t of tables) {
      const trs = [...t.querySelectorAll('tr')];
      if (!trs.length) continue;
      // 先看表头行
      const head = [...(trs[0].querySelectorAll('th,td') || [])]
        .map(c => (c.innerText || c.textContent || '').trim());
      const hit = MARKERS.filter(m => head.some(h => h.indexOf(m) >= 0)).length;
      if (hit >= 2) {
        const rows = [];
        for (const tr of trs) {
          const tds = [...tr.querySelectorAll('td,th')].map(td =>
            (td.innerText || td.textContent || '').trim().replace(/\s+/g, ' '));
          if (tds.length) rows.push(tds);
        }
        return { rows, tableCount: tables.length, matched: hit, scope: 'marker-head' };
      }
    }
    // 退化：全页扫（原来那种），但**如实标明**是退化路径
    return { rows: readAllTableRows(), tableCount: tables.length, matched: 0, scope: 'fallback-all' };
  }

  /**
   * 读取账号级四个标签（关注数/粉丝数/获赞与收藏/笔记数）。
   *
   * ⚠️⚠️ 这里原来是**正则扫整页 innerText**：
   *     bodyText.match(/粉丝数\s*([\d,.]+)/)
   *     那个写法在页面上「粉丝数」出现多次时，**取到的一定是第一个匹配**，
   *     而第一个很可能不是你的账号数据。
   *     用户实测就撞上了：显示 558，真实值 72。
   *
   *     那种错法最坏的地方是**它不报错** —— 数字照样显示，
   *     用户只会以为平台数据有问题，而不是工具读错了。
   *     运营工具给错数字，比不给数字危险得多。
   *
   * 现在改成**按结构定位**：找标签元素本身，取它同一父容器里的数字。
   * 依据是 dev/probe.js 在真实页面上的记录（标签与数字是 sibling，
   * 且账号级标签带中文单位如「1.2万」）。
   *
   * 拿不准时**宁可取不到**，也不返回可能错的数 ——
   * `account` 里没有这个键，界面会显示「—」，那是诚实的。
   */
  function readAccountLabels() {
    const LABELS = ['关注数', '粉丝数', '获赞与收藏', '笔记数'];
    const out = {};
    const skipped = [];

    /**
     * ⚠️⚠️⚠️ 这里错了**三次**，全部是「按自己想象的 DOM 写代码，从不验证」。
     * 下面是**用户 2026-10-05 真机 Console 探针的实测输出**，不是推测：
     *
     *   A 账号区结构：
     *     账号区 class = "static description-text"
     *     账号区 HTML 里有： class="numerical">72<
     *
     *   B 文本恰好等于「粉丝数」的元素：共 1 个
     *     class = ""（无 class）
     *     父 class = ""（无 class）
     *     父文本 = "72 粉丝数"      ← **数字在前**，标签在后
     *
     *   C 「4万」在哪：
     *     class = "statics"
     *     父文本 = "硅谷101 近期有爆款笔记 粉丝数：4万 创作方向：科技数码"
     *     ↑ **这是「成长榜样」里别人的账号**，不是用户自己的数据
     *
     * 三次错法：
     *   ① 扫整页 innerText 取第一个匹配            → 558
     *   ② 找「以标签开头的元素」（方向反了）        → 4万
     *   ③ 加「容器里只剩一个数字」的互证            → 仍然 4万
     *      （「statics」那个区块也恰好独占一个容器，
     *       「唯一」不等于「正确」）
     *
     * ============================ 现在的取法 ============================
     * 依据实测结构，**优先走 `.numerical`** —— 那是平台自己标出来的数字元素。
     * 找不到才退回「标签同级/父容器的数字」，且**必须排除带冒号的形态**
     *（「粉丝数：4万」是别人账号卡片里的写法，与本账号的「72 粉丝数」不同）。
     * 都不成立 → **留空**，绝不猜。
     */

    // 收集所有 .numerical —— 账号区三个数（关注/粉丝/获赞）都在这里
    const numericals = $$('.numerical')
      .map(el => (el.textContent || '').trim().replace(/\s+/g, ''))
      .filter(t => /^\d[\d,.]*[万亿]?$/.test(t));

    for (const label of LABELS) {
      let value = null;

      // ---- 路 1：结构化 —— 标签元素所在那一格里的 .numerical ----
      const labelEl = $$('div,span,p,td,li,strong,em,h1,h2,h3,h4,a')
        .find(el => (el.textContent || '').replace(/\s/g, '') === label);

      if (labelEl) {
        // 1a) 标签自身或紧邻几层里有 .numerical
        let scope = labelEl;
        for (let d = 0; d < 3 && scope && !value; d++) {
          const n = scope.querySelector && scope.querySelector('.numerical');
          if (n) {
            const t = (n.textContent || '').trim().replace(/\s+/g, '');
            if (/^\d[\d,.]*[万亿]?$/.test(t)) value = t;
          }
          scope = scope.parentElement;
        }

        // 1b) 没有 .numerical → 看标签的父容器文本
        if (!value) {
          const p = labelEl.parentElement;
          if (p) {
            const pt = (p.innerText || p.textContent || '').replace(/\s+/g, ' ').trim();
            // ⚠️ 必须排除「粉丝数：4万」这种带冒号的形态 ——
            //    那是别人账号卡片的写法（实测证据 C）。
            if (pt.indexOf(label + '：') < 0 && pt.indexOf(label + ':') < 0) {
              const m = pt.match(new RegExp('(\\d[\\d,.]*\\s*[万亿]?)'));
              // 只信「紧邻标签」的那个数：前 3 个字符内出现
              if (m && pt.indexOf(m[0]) - pt.indexOf(label) < 4) {
                value = m[0].replace(/\s+/g, '');
              }
            }
          }
        }
      }

      // ---- 路 2：账号区兜底 —— 三个 .numerical 按顺序对应 关注/粉丝/获赞 ----
      if (!value && numericals.length >= 3) {
        const idx = { '关注数': 0, '粉丝数': 1, '获赞与收藏': 2 }[label];
        if (idx !== undefined) value = numericals[idx];
      }

      if (value) out[label] = value;
      else skipped.push(label);
    }

    if (skipped.length) {
      // 说清「为什么没取到」，别让用户对着「—」猜
      console.info('[XHS] 账号标签未可靠定位：' + skipped.join('、') +
        '（宁可留空也不给可能错的数 —— 之前错取过别人的账号数据）');
    }
    return { values: out, missing: skipped };
  }

  /** 读取分页状态（内容分析页固定每页 10 条） */
  /**
   * 读分页。
   *
   * ⚠️⚠️ 原来靠 CSS 类名找分页控件（`[class*="pager"] [class*="total"]` 等），
   * 平台改版后类名变了 → 找不到 → 退化到「数分页按钮」→ **数出 0**
   * → background.js 的 `Math.min(totalPages, maxPages)` = 0
   * → 翻页循环一次都不跑 → **永远只有第一页 10 篇**。
   * 用户 2026-10-05 报的「只能采集最近十篇」就是这个。
   *
   * 现在改成**先读页面上的中文文案**（小红书自己写的文案比类名稳定得多）：
   *   「共 16 条, 2 页」/「共 16 条」「2 页」
   * 类名选择器只作为最后兜底。
   *
   * ⚠️ 还是那句：拿不到就返回 0，**绝不猜**。
   * 猜错的后果是「静默只采第一页」—— 用户以为数据全采到了。
   */
  function readPager() {
    const bodyText = document.body.innerText || '';
    const P = 10;   // 「10 条/页」是固定值，但下面会尝试从文案解析

    // ---- 1) 每页条数：优先找「N 条/页」----
    let perPage = P;
    const pm = bodyText.match(/(\d+)\s*条\s*\/\s*页/);
    if (pm) {
      const n = parseInt(pm[1], 10);
      if (n > 0) perPage = n;
    }

    // ---- 2) 总条数：「共 N 条」----
    let total = 0;
    const tm = bodyText.match(/共\s*([\d,]+)\s*条/);
    if (tm) {
      total = parseInt(String(tm[1]).replace(/,/g, ''), 10) || 0;
    }

    // ---- 3) 总页数 ----
    let totalPages = 0;
    // 3a) 显式「共 N 条, M 页」
    const pm2 = bodyText.match(/共\s*[\d,]+\s*条\s*[,，]\s*(\d+)\s*页/);
    // 3b) 单独一句「M 页」
    const pm3 = pm2 || bodyText.match(/(\d+)\s*页/);
    if (pm3) totalPages = parseInt(pm3[1], 10) || 0;

    // 3c) 都没有就按总数反推
    if (!totalPages && total > 0) totalPages = Math.ceil(total / perPage);

    // 3d) 最后的兜底：数「纯数字」的页码按钮
    if (!totalPages) {
      totalPages = $$('[class*="pager"] li, [class*="pagination"] li')
        .filter(li => /^\d+$/.test(text(li).trim())).length;
    }

    // 当前页
    // ⚠️ 原来这里有个 `/(\d+)\s*(?:\/\s*\d+\s*页|页)/` 直接扫全文，
    // 它会去匹配「共 16 条, **2 页**」里的 2 —— 把**总页数当成当前页**。
    // 全文扫描碰上任何一句带数字+「页」的话都会误判，
    // 而当前页是判断「点击是否真的翻页了」的依据，算错就等于没有依据。
    // 所以：只信 DOM 上的高亮项，其次才信明确带「当前」二字的写法。
    let cur = 1;
    const curEl = queryOne([
      '[class*="pager"] [class*="current"]', '[class*="pagination"] [class*="active"]',
      '.d-pager .active', 'li.ant-pagination-item-active'
    ]);
    if (curEl) {
      const n = parseInt(text(curEl).replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(n) && n > 0) cur = n;
    } else {
      // 只认「当前第 N 页」/「第 N 页 / 共 M 页」这类**带限定词**的写法，
      // 裸的「N 页」一律不采 —— 它更可能是总数。
      const cm = bodyText.match(/(?:当前|第)\s*(\d+)\s*页/)
             || bodyText.match(/第\s*(\d+)\s*\/\s*\d+\s*页/);
      if (cm) {
        const n = parseInt(cm[1], 10);
        if (Number.isFinite(n) && n > 0) cur = n;
      }
    }

    return { currentPage: cur, totalPages, perPage, totalRows: total };
  }

  /** 账号总览（近 7 日聚合）：关注/粉丝/获赞 + 指标表 */
  function scrapeCreatorOverview() {
    if (!isCreatorPage()) return { success: false, error: '当前不是创作者中心页面' };
    if (creatorLoginWall()) return { success: false, error: 'NOT_LOGGED_IN', url: window.location.href };

    // ⚠️ readAccountLabels 返回 { values, missing } —— 诊断信息要一起带出去，
    //    否则界面上只有「—」，用户分不清是「取不到」还是「那个数真的不存在」。
    const accountRes = readAccountLabels();
    const account = accountRes.values;
    if (accountRes.missing && accountRes.missing.length) {
      console.info('[XHS] 本次账号总览未取到：' + accountRes.missing.join('、'));
    }

    // 指标表：3 列 = 指标 / 数值 / 环比
    const metrics = [];
    for (const tds of readAllTableRows()) {
      if (tds.length !== 3) continue;
      if (tds[0] === '指标' || tds[0] === '笔记基础信息') continue;
      if (!/^(-|[\d,.]+%?)$/.test(tds[1])) continue;
      metrics.push({ metric: tds[0], value: tds[1], delta: tds[2] });
    }

    return {
      success: true,
      url: window.location.href,
      account,
      metrics,
      scrapedAt: Date.now()
    };
  }

  /** 单篇笔记明细（内容分析页，近 90 天口径） */
  function scrapeCreatorAnalysis() {
    if (!isCreatorPage()) return { success: false, error: '当前不是创作者中心页面' };
    if (creatorLoginWall()) return { success: false, error: 'NOT_LOGGED_IN', url: window.location.href };

    const notes = [];
    // ⚠️ 只取「内容分析」那张表 —— 页面上还有数据总览、热门活动等别的表，
    //    混进来会让表头定位失败（表现：所有列取不到，界面全是「—」）
    const tbl = readAnalysisTableRows();
    const rows = tbl.rows;
    if (tbl.scope === 'fallback-all') {
      console.warn('[XHS] 没认出内容分析表，退回全页扫描（' + tbl.tableCount + ' 张表混在一起）');
    }

    /* ⚠️⚠️ 列必须**按表头名称定位**，不能按下标。
     *
     * 原来用 CREATOR_METRIC_COLS 的顺序去取 tds[i+1]，
     * 那是 2026-10-03 记录的一次列序。平台一改版就会**静默取错**：
     * 用户 2026-10-05 的真机上，列已经是
     *   笔记基础信息 / 曝光 / 观看 / 封面点击率 / 点赞 / 评论 / 操作
     * 少了「收藏 / 涨粉 / 分享 / 人均观看时长」，
     * 于是 tds[7]（代码以为是「涨粉」）拿到的是**「分析详情」链接**。
     *
     * 那种错法不报错 —— 界面照样显示一列数字，
     * 用户只会以为平台数据就是这样。
     * 诊断工具给错数比不给数危险得多。
     *
     * 现在改成：先读表头建立「列名 → 下标」映射，再按名字取值。
     * 表头里没有的列一律写 '-'（并在 console 说明），
     * **不拿别的列来顶替**。
     */
    let colIndex = null;
    for (const tds of rows) {
      const first = (tds[0] || '').trim();
      if (first.startsWith('笔记基础信息') || first === '笔记' || first === '笔记标题') {
        colIndex = {};
        tds.forEach((h, i) => {
          const name = (h || '').trim();
          if (name && name !== '操作') colIndex[name] = i;
        });
        break;
      }
    }

    const missing = [];
    if (!colIndex) {
      // 兜底：整张表都没有可识别的表头行。宁可全给 '-'，
      // 也不要退回按下标硬取 —— 那正是错数的来源。
      console.warn('[XHS] 内容分析页未找到表头行，本轮指标全部留空（宁可空着也不取错）');
    } else {
      for (const col of CREATOR_METRIC_COLS) {
        if (col === '弹幕') continue;                 // 已不在当前表头里
        if (colIndex[col] === undefined) missing.push(col);
      }
    }
    if (missing.length) {
      console.info('[XHS] 当前表头没有这些列，本轮按缺失处理：' + missing.join('、'));
    }

    for (const tds of rows) {
      if (tds.length < 2) continue;
      const first = tds[0];
      if (first.startsWith('笔记基础信息')) continue;          // 表头行
      // 首格形如「标题 发布于 2026-10-01 19:01」
      const m = first.match(/^(.*?)\s*发布于\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
      const rec = {
        title: (m ? m[1] : first).trim(),
        publishDate: m ? m[2] : '',
        publishTime: m ? m[3] : ''
      };
      // 缺失值原样保留 '-'，不要当 0 处理（新发笔记常见）
      for (const col of CREATOR_METRIC_COLS) {
        if (col === '弹幕') continue;
        const idx = colIndex ? colIndex[col] : undefined;
        rec[col] = (idx !== undefined && tds[idx] !== undefined) ? tds[idx] : '-';
      }
      notes.push(rec);
    }

    return {
      success: true,
      url: window.location.href,
      notes,
      // 带上「这张表是怎么认出来的」，界面与排查都能看到 ——
      // 「读到了几列」比「没数据」有用得多
      tableScope: { scope: tbl.scope, matched: tbl.matched, tableCount: tbl.tableCount, rows: rows.length },
      pager: readPager(),
      scrapedAt: Date.now()
    };
  }

  /** 笔记管理页读 noteId 映射（内容分析页只给标题和日期，不含 noteId） */
  function scrapeCreatorNoteIndex() {
    if (!isCreatorPage()) return { success: false, error: '当前不是创作者中心页面' };
    if (creatorLoginWall()) return { success: false, error: 'NOT_LOGGED_IN', url: window.location.href };

    const map = [];
    const seen = new Set();

    /* 主来源：**表格行内的链接**。
       旧实现只扫全局 a[href]，而内容分析页的表格单元格是纯文本
       （首格形如「标题 发布于 2026-10-01 19:01」），整页几乎找不到
       笔记链接 —— 于是 noteIndex 基本是空的，joinNoteIndex 自然全不命中。
       这就是「noteId 匹配率低」最可能的原因，不是匹配算法不行，
       是候选池本身就没东西。

       改成按行扫：每行取行内所有 a[href] 里的 noteId，
       并记下行号与首格标题，joinNoteIndex 可以按行号直接对上，
       文本匹配只作为跨页/排序变化时的兜底。 */
    let rowIndex = 0;
    for (const tr of $$('tr')) {
      const tds = [...tr.querySelectorAll('td,th')];
      if (!tds.length) continue;
      const firstText = (tds[0].innerText || tds[0].textContent || '').trim();
      if (firstText.startsWith('笔记基础信息')) continue;

      // 行内所有链接，可能是标题链接也可能是操作列
      for (const a of tds[0].querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/(?:explore|discovery\/item|note)\/([a-z0-9]{8,})/i);
        if (!m) continue;
        const noteId = m[1];
        if (seen.has(noteId)) continue;
        seen.add(noteId);
        const linkText = (a.innerText || a.textContent || '').trim();
        map.push({
          noteId,
          label: linkText || firstText,
          href: href.startsWith('http') ? href : 'https://www.xiaohongshu.com' + href,
          // 行号是跨页累加的稳定序号，joinNoteIndex 会优先用它
          row: rowIndex
        });
      }
      rowIndex++;
    }

    /* 兜底：表格之外的卡片式链接（改版后如果表格没了 a 标签，
       页面上仍可能有可点的笔记卡片）。只在主来源为空时才启用 ——
       否则会混入大量与本次表格无关的历史链接，反而降低命中率。 */
    if (!map.length) {
      for (const a of $$('a[href]')) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/(?:explore|discovery\/item|note)\/([a-z0-9]{8,})/i);
        if (!m) continue;
        const t = (a.innerText || a.textContent || '').trim();
        if (!t || t.length > 60) continue;
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        map.push({
          noteId: m[1], label: t, href,
          row: -1  // -1 = 无行号，只能靠文本匹配
        });
      }
    }

    return { success: true, url: window.location.href, items: map, scrapedAt: Date.now() };
  }

  /** 点击「下一页」；返回是否成功推进（以首行标题变化为判据） */
  /**
   * 点「下一页」。
   *
   * ⚠️⚠️ 这里原来只认 5 个固定类名
   *     （'.d-pager .next' / '[class*="pager"] [class*="next"]' / …）。
   *     平台一改类名就**找不到按钮** → 返回 NO_NEXT_BUTTON →
   *     background 直接 break → 用户只拿到第一页 10 条，
   *     而且**界面上完全看不出是翻页失败**。
   *
   *     实测踩了三次就是这个形状（558 → 4万 → 永远 10 条）。
   *
   * 现在的策略：**按「元素在表格下方 + 文本像翻页符」找**，不依赖类名。
   * 再退一步：找纯数字的页码按钮，点「当前页 +1」那个。
   * 都找不到才返回 NO_NEXT_BUTTON，并且**把候选列出来**，
   * 让排查有据可依，而不是一句「找不到」。
   */
  /**
   * 采集诊断：把「为什么只采到一页」这件事一次说清，并支持一键复制。
   *
   * 为什么需要这个：翻页问题已经反复三轮，每次都要用户去开 F12 跑探针、
   * 手工粘贴 —— 那道门槛太高，事实上一道都过不去。
   * **诊断的获取成本必须低于用户放弃的阈值。**
   * 所以改成：界面上一个按钮，点一下诊断进剪贴板，用户只要粘贴给我。
   */
  function creatorDiag() {
    const L = [];
    const p = (s) => L.push(s);
    const txt = (el) => (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();

    p('===== 1. 页面 =====');
    p('URL: ' + location.href);
    p('标题: ' + document.title);

    p('');
    p('===== 2. 分页文案 =====');
    const body = document.body.innerText || '';
    p('「N 条/页」: ' + JSON.stringify(body.match(/[\d,]+\s*条\s*\/\s*页/g) || []));
    p('「共 N 条」: ' + JSON.stringify(body.match(/共\s*[\d,]+\s*条/g) || []));
    p('「N 页」  : ' + JSON.stringify(body.match(/[\d,]+\s*页/g) || []));
    p('readPager(): ' + JSON.stringify(readPager()));

    p('');
    p('===== 3. 所有可能像翻页键的元素（最多 25 个）=====');
    /* 标出「是否住在分页容器里」。
       v2.37.9 的根因就是表格里的数字单元格被当成页码键，
       而这一列能一眼看出候选到底是不是真分页器。 */
    const near = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (/pager|pagin|page-?list|page-?nav/i.test(String(n.className || ''))) return n.className.slice(0, 30);
      }
      return '';
    };
    let n = 0;
    document.querySelectorAll('button,a,li,span,i,div,[role="button"]').forEach(el => {
      const t = txt(el);
      const c = String(el.className || '');
      const aria = el.getAttribute ? (el.getAttribute('aria-label') || '') : '';
      const title = el.getAttribute ? (el.getAttribute('title') || '') : '';
      const looks = t.length <= 6 || /\b(next|forward|arrow-?right|pager-?next|page-?next|next-?page)\b/i.test(c + ' ' + aria + ' ' + title);
      if (!looks || n >= 25) return;
      const r = el.getBoundingClientRect();
      const box = near(el);
      const inTable = !!(el.closest && el.closest('table'));
      p('  <' + el.tagName + '> class="' + c.slice(0, 44) + '" aria="' + aria.slice(0, 26) + '"'
        + ' text="' + t.slice(0, 10) + '" ' + Math.round(r.width) + 'x' + Math.round(r.height)
        + (el.disabled ? ' [disabled]' : '')
        + (inTable ? ' 【在表格里 —— 大概率是数据格，不是翻页键】' : '')
        + (box ? ' 【分页容器:' + box + '】' : ''));
      n++;
    });
    if (n === 0) p('  （一个都没找到）');

    p('');
    p('===== 4. 带 pager/pagination 类名的容器 =====');
    let m = 0;
    document.querySelectorAll('*').forEach(el => {
      if (m >= 8) return;
      if (!/pager|pagin/i.test(String(el.className || ''))) return;
      m++;
      p('  <' + el.tagName + '> class="' + String(el.className).slice(0, 60)
        + '" 子=' + el.children.length + ' 文本="' + txt(el).slice(0, 60) + '"');
    });
    if (m === 0) p('  （没有）');

    p('');
    p('===== 5. 表格行数 =====');
    p('全页 tr 数: ' + document.querySelectorAll('tr').length);
    p('读到的笔记行: ' + readAnalysisTableRows().rows.length
    + '（表头命中 ' + readAnalysisTableRows().matched + ' 个标记，认表方式 ' + readAnalysisTableRows().scope + '）');

    const out = L.join('\n');
    try { copy(out); p('\n\n已复制到剪贴板'); } catch (e) { p('\n（自动复制失败，请手动全选上面内容）'); }
    return { success: true, diag: out };
  }

  async function creatorNextPage() {
    /* ============ 这一版重写了「点击」的整段逻辑 ============
     *
     * 旧版三个致命问题（都直接导致「只采到 10 条」）：
     *
     * ① 第一个候选被判禁用就 `return LAST_PAGE`。
     *    页面上常有多个像翻页键的元素（上一页/下一页的图标副本、隐藏副本），
     *    第 1 页上「上一页」本来就是禁用的 —— 撞上它就直接宣布
     *    「已是最后一页」，后面三条路一条都不再走。
     *    **禁用只该跳过这个候选，不能终止整个函数。**
     *
     * ② 只调 `.click()`。
     *    不少 UI 库把翻页绑在 pointerdown / mousedown 上，
     *    纯 `.click()` 根本不触发，handler 一行都没跑 ——
     *    而旧版还乐观地 return success:true，调用方等 2 秒后
     *    发现内容没变，反推成「已到最后一页」。
     *    **一次没生效的点击，被当成了「数据采完了」。**
     *
     * ③ 从不验证点击是否真的生效。
     *    现在每次点击后都复核「页码变了 / 首行内容变了」，
     *    没变就换下一种点击方式，全都不行才报 CLICK_NO_EFFECT ——
     *    那是一个**真错误**，不是「采完了」。
     */
    const snapshot = () => {
      const pgr = readPager();
      return {
        page: pgr.currentPage || 1,
        row: readAllTableRows()[1]?.[0] || ''
      };
    };
    const before = snapshot();

    const looksDisabled = (el) => {
      if (!el) return true;
      if (el.disabled === true) return true;
      if (el.getAttribute && el.getAttribute('disabled') !== null) return true;
      if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true;
      const c = String(el.className || '');
      if (/disabled|is-disabled|ant-pagination-disabled/.test(c)) return true;
      return false;
    };

    /** 内容/页码有没有真的变了 */
    const advanced = (snap0) => {
      const now = snapshot();
      return now.page !== snap0.page || (!!snap0.row && now.row !== snap0.row);
    };

    /** 三种点击方式依次尝试；哪一种生效就停。
     *  ⚠️ 这里**必须真的 await 等渲染**。表格重渲染是异步的，
     *     点击后同步立刻检查必然读到「没变」——
     *     那样三种机制会全部被判失败，又变成「点不动」。
     *     这是我第一版就写错的地方：判断是否生效的时机必须晚于重渲染。
     *
     *  ⚠️⚠️ 但**不能等太久**。这是 v2.37.5 引入的第二个回归：
     *     「每种机制等 1.2 秒 × 3 种 × 候选数」在候选多时能到几十秒，
     *     Chrome 的消息端口等不到就断，**整个采集直接挂掉**（用户看到的是「无法采集」）。
     *     所以：每个机制最多 600ms，整个函数有 8 秒硬上限，
     *     候选最多取 6 个 —— 宁可能够翻一页，也不能把整条链路拖死。 */
    const DEADLINE = Date.now() + 8000;
    const tryClick = async (el, snap0) => {
      const mechanisms = [
        ['native', () => el.click()],
        /* 完整指针事件序列：给绑在 pointerdown/mousedown 上的框架用 */
        ['pointer', () => {
          ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
            const Ev = type.startsWith('pointer')
              ? (window.PointerEvent || MouseEvent)
              : MouseEvent;
            el.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, view: window }));
          });
        }],
        /* 事件绑在父节点上的情况：点父元素 */
        ['parent', () => { if (el.parentElement) el.parentElement.click(); }]
      ];
      for (const [via, fire] of mechanisms) {
        if (Date.now() >= DEADLINE) return null;
        try {
          el.scrollIntoView && el.scrollIntoView({ block: 'center' });
          fire();
        } catch (e) { /* 继续试下一种 */ }
        // 4 次 × 150ms = 600ms。小表格切换很快，
        // 真的慢的页面上这一下会失败，但**宁可翻不过也不要卡死整条链路**。
        for (let w = 0; w < 4; w++) {
          await new Promise(r => setTimeout(r, 150));
          if (advanced(snap0)) return via;
        }
      }
      return null;
    };

    /* ---- 收集候选，按「像翻页键」的把握程度排序 ---- */
    const PAGER_TEXTS = ['下一页', '下页', 'next', '>', '›', '»', '→'];
    /* 是不是分页容器内部：真实页码键几乎总是住在某个
       带 pager/pagination 类名的容器里，而**表格里的数字不在**。
       上一轮没有这个判断，于是笔记表格里每一个数字单元格
       （曝光 4 / 观看 101 / 赞 5 …）都被当成「页码按钮」，
       排在真翻页键后面把 6 个候选名额占满 ——
       点它们当然没反应，最后统一报「点了但页面没反应」。
       用户实测：18 条笔记、2 页，翻页键被表格数字挤掉了。 */
    const inPagerBox = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const c = String(n.className || '');
        if (/pager|pagin|page-?list|page-?nav/i.test(c)) return true;
        // 最多往上找 4 层，再高就多半是外层容器而不是分页器了
        if (n.tagName === 'BODY') break;
      }
      return false;
    };

    const cands = [];
    document.querySelectorAll('button, a, li, span, i, div, [role="button"]').forEach(el => {
      const t = (el.innerText || el.textContent || '').trim();
      const c = String(el.className || '');
      const aria = el.getAttribute ? (el.getAttribute('aria-label') || '') : '';
      const title = el.getAttribute ? (el.getAttribute('title') || '') : '';
      const blob = c + ' ' + aria + ' ' + title;

      // 路 A：明确文字
      if (t && t.length <= 6 && (PAGER_TEXTS.includes(t) || /下一页|下\s*页/.test(t))) {
        cands.push({ el, t, why: 'text:' + t });
        return;
      }
      /* 路 B：纯数字页码。
         必须要求「住在分页容器里」—— 不加这一条时，
            表格里的每个数字都是候选（详见上面 inPagerBox 的注释）。 */
      if (t && /^\d{1,3}$/.test(t)) {
        if (inPagerBox(el)) cands.push({ el, t, why: 'num:' + t });
        return;
      }
      // 路 C：class/aria 语义（纯图标按钮 innerText 是空的，只能靠这里）
      // ⚠️ 这里原来含一个裸的 `right` —— 它会匹配 `align-right` / `text-right`
      //    / `pull-right` 一大堆无关类名，候选轻松上百个。
      //    候选一多，配合「每候选最多等 1.8 秒」直接把整条采集拖死。
      if (/\b(next|forward|arrow-?right|pager-?next|page-?next|next-?page)\b/i.test(blob)
          || /下一页|下页|向后|后一页/.test(blob)) {
        cands.push({ el, t, why: 'sem:' + (c || aria || title).slice(0, 40) });
      }
    });

    if (!cands.length) {
      return {
        success: false, error: 'NO_PAGER_AT_ALL',
        hint: '页面上找不到任何可点的分页控件',
        候选数: 0, before
      };
    }

    /* ---- 候选排序：先按类别，再按「是不是当前页+1」 ----
     *
     * v2.37.11 的实测证据（用户回传的候选清单）：
     *     num:1=点了但内容没变；num:1=超时未试；num:2=超时未试；num:2=超时未试
     *
     * 三个事实：
     *   ① 分页容器找到了（候选通过了「必须住在分页容器里」这道判据）
     *   ② 翻页器**没有「下一页」文字，也没有 next 相关的 class/aria**
     *   ③ 候选全是纯数字页码 1 / 2
     *
     * 也就是说小红书创作者中心的翻页器是「纯数字页码」形态，
     * 唯一能翻过去的方式就是**点当前页 +1 那个数字按钮**。
     *
     * 而旧排序是 text → sem → num，num 内部按 DOM 顺序，
     * 于是先点「1」（当前页，点它必然无变化）→ 耗尽 8 秒预算 → 轮不到「2」。
     * 现在：num 类里 current+1 直接排到最前，且当前页本身跳过（点了必然无效）。
     */
    const curPage = before.page || 1;
    const order = (x) => {
      const w = x.why || '';
      if (w.startsWith('text')) return 0;
      if (w.startsWith('sem')) return 1;
      // 纯数字：正好是「下一页」的那个排最前，其余排后
      const n = parseInt(String(w.slice(4)), 10);
      return Number.isFinite(n) && n === curPage + 1 ? 2 : 3;
    };
    cands.sort((a, b) => order(a) - order(b));

    /* 候选上限 6 个。理由同上：候选越多总耗时越长，
       而这里真正像「下一页」的无非就一两个。
       多出来的候选是为了兜底，不是为了穷举。 */
    const usable = cands.slice(0, 6);
    if (cands.length > usable.length) {
      // 记一笔，让排查时知道「本来找到了很多」而不是「页面结构没认出来」
      console.warn('[XHS] 分页候选过多，仅试前 6 个：', cands.length);
    }

    const tried = [];
    for (const c of usable) {
      if (Date.now() >= DEADLINE) {
        tried.push({ via: c.why, result: '超时未试' });
        continue;
      }
      if (looksDisabled(c.el)) {          // ← 只跳过这个候选，不再 return
        tried.push({ via: c.why, result: 'disabled-跳过' });
        continue;
      }
      /* 已经在当前页上的数字按钮**直接跳过** ——
         点它按定义就不会有任何变化，纯属浪费 8 秒预算里的 1.8 秒。
         旧实现就是被这个耗光的：候选是 1、1、2、2，
         先在「1」上白白花掉两次机会，8 秒到点退出，2 根本没轮到。 */
      if ((c.why || '').startsWith('num') && parseInt(String(c.why).slice(4), 10) === curPage) {
        tried.push({ via: c.why, result: '就在当前页，跳过' });
        continue;
      }
      const snap0 = snapshot();
      const via = await tryClick(c.el, snap0);
      if (via) {
        return { success: true, before: snap0.row, via: c.why + '|' + via, tried };
      }
      tried.push({ via: c.why, result: '点了但内容没变' });
    }

    /* 全部候选都点不动。**这不是「已到最后一页」，这是一个真错误。**
       只有在能确凿判断「没有更大的页码」时才报 LAST_PAGE。 */
    const nums = cands.filter(c => (c.why || '').startsWith('num')).map(c => Number(c.t));
    const cur = before.page;
    if (nums.length && !nums.some(n => n > cur)) {
      return { success: false, error: 'LAST_PAGE', before: before.row, tried };
    }

    /* ---- 路 5：滚动加载 ----
     * 很多数据表根本没有可点的分页键，滚到底就自动加载下一页。
     * 这种情况下路 1~4 必然全部失败（找到了也没用，或者根本没分页容器），
     * 而**滚动是唯一可行的方式**。
     * 找表格最近的、真正能滚的祖先（scrollHeight > clientHeight），
     * 滚到底，等一次渲染，再看内容变没变。 */
    const rowsBefore = readAnalysisTableRows().rows.length;
    // ⚠️ readAnalysisTableRows() 返回的是 { rows, tableCount, matched, scope }，
    //    **没有 table 字段** —— 写 tbl.table 会拿到 undefined，
    //    滚动容器自然找不到，然后报「找不到可滚动的容器」。
    //    这类「以为某个函数返回 A、实际返回 B」的错，写完必须立刻量一次。
    const scroller = (() => {
      const tbl = document.querySelector('table');
      for (let n = tbl && tbl.parentElement; n && n !== document.body; n = n.parentElement) {
        if (n.scrollHeight > n.clientHeight + 8) return n;
      }
      // 退一步：任何可滚的祖先都行
      for (let n = tbl && tbl.parentElement; n && n !== document.body; n = n.parentElement) {
        if (n.scrollHeight > 40 && n.clientHeight > 40) return n;
      }
      return null;
    })();
    if (scroller) {
      for (let round = 0; round < 4 && Date.now() < DEADLINE; round++) {
        const r = scroller.getBoundingClientRect();
        scroller.scrollTop = scroller.scrollHeight;
        // 有些表格要滚到视口中心才触发懒加载
        scroller.scrollTo && scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
        for (let w = 0; w < 4; w++) {
          await new Promise(r => setTimeout(r, 150));
          const grew = readAnalysisTableRows().rows.length > rowsBefore || advanced(before);
          if (grew) {
            return { success: true, before: before.row, via: 'scroll:' + Math.round(r.height) + 'px 容器', tried };
          }
        }
      }
      return {
        success: false, error: 'SCROLL_NO_EFFECT',
        hint: '分页键点了没用，滚动加载也试过了',
        before: before.row, 候选: tried.slice(0, 6)
      };
    }

    return {
      success: false,
      error: 'CLICK_NO_EFFECT',
      hint: '找到 ' + cands.length + ' 个分页候选，点下去内容都没变；也找不到可滚动的容器',
      before: before.row,
      当前页: cur,
      // ⚠️ 候选清单要能直接显示在界面上，不能只进剪贴板 ——
      // 前几轮全靠剪贴板往返，而那一步的门槛高到一直没走通。
      候选: tried.slice(0, 6)
    };
  }

  /** 侧边栏点菜单用：切到数据看板的某个子页 */
  function creatorGoto(kind) {
    const url = kind === 'analysis' ? CREATOR_ANALYSIS_URL
      : kind === 'manage' ? CREATOR_MANAGE_URL
      : CREATOR_HOME_URL;
    window.location.href = url;
    return { success: true, url };
  }

  // ========== 网页监听中继（MAIN world → ISOLATED world → background）============
  // net-listener.js 跑在主世界里，只能靠 postMessage 把捕获的响应递出来。
  // 这里做一次校验后转给 background 落盘。校验不严的话，页面上任何脚本都能
  // 伪造 __xhsNet 消息往 storage 里灌数据。
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.__xhsNet !== true || !d.entry) return;
    const e = d.entry;
    if (typeof e.url !== 'string' || !/^https?:\/\//i.test(e.url)) return;
    try {
      chrome.runtime.sendMessage({ action: 'netCapture', payload: e });
    } catch (_) {
      // background 正在重启（MV3 常态），丢弃本次不影响页面
    }
  });

  // ========== agent 调用中继（本机脚本 → 页面 → background）============
  //
  // 为什么需要：MV3 的 Service Worker 不能监听端口（没有 Node 的 http），
  // 所以外部程序没法直接给扩展发消息。唯一能通的路是借页面做跳板：
  // 本机脚本往页面 fetch「端点 + __xhsAgent=1 旗标 + d=<命令 JSON>」的请求
  // → MAIN world（net-listener）拦下并转成 window.postMessage
  // → 这里接住 → 转给 background → 结果 postMessage 回 MAIN world，
  // 由它用合成 Response 交给调用方。
  //
  // ⚠️ 安全边界（不要假装它更严）：
  //   任何本机程序都能往页面发消息，所以任何本机程序都能触发采集。
  //   但**结果只回给发起方**，不落到别处；而且能读你本机文件的人
  //   本来就能读你采集到的任何东西 —— 所以这没有引入新的暴露面，
  //   它和「本机用户权限」是同一个层级。
  //
  // 真正的门在 background 侧的 AGENT_ACTIONS 白名单：那里只开采集类，
  // 改配置（setAiConfig 之类）一律不开。
  //
  // ⚠️ 这里只做 req 中继，**不维护等待器**：响应由 MAIN world 的
  //    pending 表认领。曾经在 ISOLATED 的 window 上挂 __xhsAgentWait
  //    给 MAIN world 调 —— 两个世界的全局对象互相隔离，MAIN 里它永远是
  //    undefined，加上「先等 res 再发 req」的时序构成死锁，通道因此半通。
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.__xhsAgent !== true) return;

    if (d.type === 'req' && d.id && d.action) {
      chrome.runtime.sendMessage(
        { action: 'agentRequest', payload: { id: d.id, action: d.action, args: d.args } },
        (res) => {
          // 扩展正在重启时 sendMessage 的回调可能拿到 undefined，
          // 那也要回一句，否则调用方会一直等到超时。
          const answer = chrome.runtime.lastError
            ? { ok: false, error: '扩展后台正在重启，请重试' }
            : (res || { ok: false, error: '扩展无响应' });
          window.postMessage({ __xhsAgent: true, type: 'res', id: d.id, ...answer }, '*');
        }
      );
    }
  });

  // ========== 注入「加入分析车」按钮 ==========
  function resetCartBtn(btn, delay) {
    setTimeout(() => {
      btn.textContent = '加入分析车';
      btn.className = '';
      btn.style.pointerEvents = '';
    }, delay);
  }

  function injectCartButton() {
    if (document.getElementById('xhs-cart-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'xhs-cart-btn';
    btn.textContent = '加入分析车';
    btn.title = '将这篇笔记加入批量分析车';
    btn.addEventListener('click', async () => {
      let data;
      try {
        data = scrapeNote();
      } catch (e) {
        btn.textContent = '抓取失败';
        btn.className = 'xhs-cart-error';
        resetCartBtn(btn, 2000);
        return;
      }
      if (!data.title && !data.content) {
        btn.textContent = '不在笔记页';
        btn.className = 'xhs-cart-warning';
        resetCartBtn(btn, 2000);
        return;
      }
      btn.textContent = '加入中…';
      btn.className = 'xhs-cart-loading';
      try {
        const res = await chrome.runtime.sendMessage({ action: 'addToCart', payload: data });
        if (!res.success) throw new Error(res.error || '未知错误');
        if (res.added) {
          btn.textContent = '已加入';
          btn.className = 'xhs-cart-success';
          setTimeout(() => {
            btn.textContent = '加入分析车';
            btn.className = '';
            btn.style.pointerEvents = '';
          }, 1500);
        } else {
          btn.textContent = '已在车内';
          btn.className = 'xhs-cart-duplicate';
          setTimeout(() => {
            btn.textContent = '加入分析车';
            btn.className = '';
            btn.style.pointerEvents = '';
          }, 1500);
        }
      } catch (e) {
        console.error('[XHS Cart] 加入失败:', e);
        btn.textContent = '加入失败：' + e.message;
        btn.className = 'xhs-cart-error';
        resetCartBtn(btn, 2500);
      }
    });
    document.body.appendChild(btn);
  }

  // 页面加载后等 DOM 稳定再注入
  function tryInject() {
    if (window.__xhsCartInjected) return;
    window.__xhsCartInjected = true;
    if (window.location.href.includes('explore') || window.location.href.includes('discovery/item')) {
      injectCartButton();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryInject, 800));
  } else {
    setTimeout(tryInject, 800);
  }

  // ========== 消息入口 ==========
  /**
   * 读「当前登录的是哪个号」。
   *
   * ⚠️ 为什么读 DOM 而不是调接口：
   *    edith.xiaohongshu.com 的 selfinfo 需要小红书自己的 x-s / x-t 请求签名，
   *    扩展算不出来，调用只会拿到 **406**。重写签名算法还会每次他们更新就失效。
   *    所以账号身份和其余数据一样，**从页面 DOM 读** —— 这也是本产品
   *    「100% 本地读取，不爬虫不封号」定位的一部分。
   *
   * ⚠️ 候选选择器是**未核验**的：没有真实登录页面的 DOM 证据，
   *    只能按常见结构多给几路。全部落空时返回 { ok:false } 并说明，
   *    **绝不返回空字符串冒充成功** —— 那是这个项目反复出过事的坑。
   *    拿到真实页面证据后用 dev/probe-me.js 确认并收敛候选。
   */
  function scrapeMe() {
    const host = location.hostname;
    if (!/(^|\.)xiaohongshu\.com$/.test(host) && !/(^|\.)xhs\.cn$/.test(host)) {
      return { ok: false, reason: 'not-on-xhs', url: host };
    }

    const name =
      text(queryOne([
        '.user .nickname', '.nickname', '[class*="nickname"]',
        '.author-wrapper [class*="name"]', '.user-info [class*="name"]',
        'header [class*="name"]', '.author-info [class*="name"]'
      ])) || '';

    const avatarEl = queryOne([
      '.user img[class*="avatar"]', 'img[class*="avatar"]',
      '.reds-avatar img', '.user .avatar img', 'img.avatar'
    ]);

    if (!name) {
      return { ok: false, reason: 'no-name-found', url: host };
    }
    return { ok: true, data: { nickname: name, avatar: avatarEl ? (avatarEl.src || '') : '' } };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const { action, payload } = request;

    let result;
    try {
      switch (action) {
        case 'scrape':
          result = { success: true, data: scrapeNote() };
          break;
        case 'scrapeProfile':
          result = { success: true, data: scrapeProfile() };
          break;
        case 'scrapeComments':
          result = { success: true, data: scrapeComments() };
          break;
        case 'scrapeNoteList':
          result = { success: true, data: scrapeNoteList() };
          break;
        // ---- 创作者中心（数据看板）----
        case 'scrapeCreatorOverview':
          result = scrapeCreatorOverview();
          break;
        case 'scrapeCreatorAnalysis':
          result = scrapeCreatorAnalysis();
          break;
        case 'scrapeCreatorNoteIndex':
          result = scrapeCreatorNoteIndex();
          break;
        case 'creatorNextPage':
          result = creatorNextPage();
          break;
        case 'creatorGoto':
          result = creatorGoto(payload && payload.kind);
          break;
        case 'ping':
          result = { success: true, at: Date.now(), url: window.location.href };
          break;
        case 'creatorDiag':
          result = { success: true, ...creatorDiag() };
          break;
        case 'scrapeMe':
          result = { success: true, ...scrapeMe() };
          break;
        default:
          result = { success: false, error: `未知动作: ${action}` };
      }
    } catch (err) {
      result = { success: false, error: err.message };
    }

    // sendResponse 必须是同步或返回 true + promise
    // 处理完成后同步返回
    // handler 可能是 async（creatorNextPage 需要等渲染才能判断点击是否生效），
    // 这里统一 Promise.resolve 包一层，
    Promise.resolve(result).then(
      (r) => { try { sendResponse(r); } catch (_) {} },
      (e) => { try { sendResponse({ success: false, error: e.message }); } catch (_) {} }
    );
    return true;
  });

  // 暴露调试
  window.__xhsTool = {
    scrape: scrapeNote,
    scrapeProfile: scrapeProfile,
    scrapeComments: scrapeComments,
    scrapeNoteList: scrapeNoteList,
    creator: {
      overview: scrapeCreatorOverview,
      analysis: scrapeCreatorAnalysis,
      noteIndex: scrapeCreatorNoteIndex,
      nextPage: creatorNextPage
    }
  };

})();