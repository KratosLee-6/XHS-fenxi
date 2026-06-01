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

  // ========== 注入「加入分析车」按钮 ==========
  function resetCartBtn(btn, delay) {
    setTimeout(() => {
      btn.textContent = '📦 加入分析车';
      btn.className = '';
      btn.style.pointerEvents = '';
    }, delay);
  }

  function injectCartButton() {
    if (document.getElementById('xhs-cart-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'xhs-cart-btn';
    btn.textContent = '📦 加入分析车';
    btn.title = '将这篇笔记加入批量分析车';
    btn.addEventListener('click', async () => {
      let data;
      try {
        data = scrapeNote();
      } catch (e) {
        btn.textContent = '❌ 抓取失败';
        btn.className = 'xhs-cart-error';
        resetCartBtn(btn, 2000);
        return;
      }
      if (!data.title && !data.content) {
        btn.textContent = '⚠️ 非笔记页';
        btn.className = 'xhs-cart-warning';
        resetCartBtn(btn, 2000);
        return;
      }
      btn.textContent = '⏳ 加入中...';
      btn.className = 'xhs-cart-loading';
      try {
        const res = await chrome.runtime.sendMessage({ action: 'addToCart', payload: data });
        if (!res.success) throw new Error(res.error || '未知错误');
        if (res.added) {
          btn.textContent = '✅ 已加入';
          btn.className = 'xhs-cart-success';
          setTimeout(() => {
            btn.textContent = '📦 加入分析车';
            btn.className = '';
            btn.style.pointerEvents = '';
          }, 1500);
        } else {
          btn.textContent = '📦 已在车内';
          btn.className = 'xhs-cart-duplicate';
          setTimeout(() => {
            btn.textContent = '📦 加入分析车';
            btn.className = '';
            btn.style.pointerEvents = '';
          }, 1500);
        }
      } catch (e) {
        console.error('[XHS Cart] 加入失败:', e);
        btn.textContent = '❌ 加入失败: ' + e.message;
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
        case 'ping':
          result = { success: true, at: Date.now(), url: window.location.href };
          break;
        default:
          result = { success: false, error: `未知动作: ${action}` };
      }
    } catch (err) {
      result = { success: false, error: err.message };
    }

    // sendResponse 必须是同步或返回 true + promise
    // 处理完成后同步返回
    try {
      sendResponse(result);
    } catch (_) {
      // 标签页可能已关闭
    }
    return true;
  });

  // 暴露调试
  window.__xhsTool = {
    scrape: scrapeNote,
    scrapeProfile: scrapeProfile,
    scrapeComments: scrapeComments,
    scrapeNoteList: scrapeNoteList
  };

})();
