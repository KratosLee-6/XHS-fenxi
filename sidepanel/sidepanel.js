/**
 * sidepanel.js - 小红书运营工具箱侧边栏
 * 核心：消息流 + 统一操作反馈
 */

'use strict';

// ========== 全局状态 ==========
let currentTab = null;
let scrapedData = null;

// ========== 辅助函数：获取当前小红书标签页 ==========
async function getXhsTab() {
  const tabs = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://*.xhs.cn/*'] });
  return tabs[0] || null;
}

// 封装：找到小红书标签页再执行操作，未找到则抛错
async function withXhsTab(actionFn) {
  const tab = await getXhsTab();
  if (!tab) throw new Error('未找到小红书标签页，请确保已打开小红书页面');
  return actionFn(tab.id);
}

// ========== 工具函数 ==========
const $ = (sel, ctx = document) => (ctx || document).querySelector(sel);
const $$ = (sel, ctx = document) => [...(ctx || document).querySelectorAll(sel)];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ========== 消息流 ==========
function addMsg(role, content, type = 'text') {
  // 空状态提示先隐藏
  const hint = $('#emptyHint');
  if (hint) hint.style.display = 'none';

  const area = $('#messageArea');
  const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

  const icons = { user: '👤', assistant: '🤖', tool: '🛠', error: '⚠️', loading: '' };
  const icon = icons[role] || '•';

  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.id = id;

  const avatarHtml = icon
    ? `<div class="avatar">${icon}</div>`
    : `<div class="avatar"></div>`;

  let bubbleContent = '';
  if (type === 'loading') {
    bubbleContent = `<div class="bubble">AI 思考中<span style="display:inline-block;width:12px;height:12px;border:2px solid #ddd;border-top-color:#ff2442;border-radius:50%;animation:spin .7s linear infinite;margin-left:4px;vertical-align:middle"></span></div>`;
    div.innerHTML = `${avatarHtml}${bubbleContent}`;
    div.classList.add('loading');
  } else {
    const lines = content.split('\n');
    const formattedLines = lines.map(l => {
      // 处理 Markdown 风格的粗体和斜体
      return l
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code style="background:#f5f5f5;padding:1px 4px;border-radius:3px;font-size:11px">$1</code>');
    }).join('\n');
    div.innerHTML = `${avatarHtml}<div class="bubble">${formattedLines}</div>`;
  }

  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  return id;
}

function updateMsg(id, role, content) {
  const div = $(`#${id}`);
  if (!div) return;
  div.className = `msg ${role}`;
  const avatar = div.querySelector('.avatar');
  const icons = { user: '👤', assistant: '🤖', tool: '🛠', error: '⚠️' };
  if (avatar && icons[role]) avatar.textContent = icons[role];

  const lines = content.split('\n');
  const formattedLines = lines.map(l =>
    l.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
     .replace(/\*(.+?)\*/g, '<em>$1</em>')
  ).join('\n');

  const bubble = div.querySelector('.bubble');
  if (bubble) bubble.innerHTML = formattedLines;

  const area = $('#messageArea');
  area.scrollTop = area.scrollHeight;
}

function removeMsg(id) {
  const div = $(`#${id}`);
  if (div) div.remove();
}

function setToolMsg(id, content) {
  updateMsg(id, 'tool', content);
}

// ========== 分析车 ==========
let cartItems = [];  // { id, title, author, likes, collects, content, tags, images, url, addedAt }

async function loadCart() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getCart' });
    if (res.success && Array.isArray(res.data)) cartItems = res.data;
  } catch (_) {}
  renderCart();
}

async function saveCart() {
  try {
    await chrome.runtime.sendMessage({ action: 'setCart', payload: cartItems });
  } catch (_) {}
}

function addToCart(noteData) {
  // 避免重复
  if (cartItems.some(n => n.id === noteData.id)) {
    return false;
  }
  cartItems.push({
    id: noteData.id || Date.now().toString(),
    title: noteData.title || '(无标题)',
    author: noteData.author?.name || '',
    likes: noteData.stats?.likes || 0,
    collects: noteData.stats?.collects || 0,
    comments: noteData.stats?.comments || 0,
    content: noteData.content || '',
    tags: noteData.tags || [],
    images: noteData.images || [],
    url: noteData.url || '',
    addedAt: new Date().toLocaleString('zh-CN')
  });
  saveCart();
  renderCart();
  return true;
}

function removeFromCart(index) {
  cartItems.splice(index, 1);
  saveCart();
  renderCart();
}

function clearCart() {
  cartItems = [];
  saveCart();
  renderCart();
}

function renderCart() {
  const list = $('#cartList');
  const countEl = $('#cartCount');
  const dot = $('#cartDot');
  const batchBtn = $('#btnBatchAnalyze');
  const hint = $('#cartHint');

  if (!list) return;

  countEl.textContent = `${cartItems.length} 篇笔记`;
  dot.className = 'dot ' + (cartItems.length > 0 ? 'ok' : '');

  if (cartItems.length === 0) {
    list.innerHTML = '';
    batchBtn.disabled = true;
    batchBtn.style.background = '#ccc';
    batchBtn.style.cursor = 'not-allowed';
    batchBtn.textContent = '📊 批量分析（需2篇以上）';
    hint.textContent = '浏览笔记时点击「📦 加入分析车」即可收集';
    return;
  }

  list.innerHTML = cartItems.map((n, i) => `
    <div style="background:#fff;border-radius:10px;padding:10px 12px;box-shadow:0 1px 4px rgba(0,0,0,.06);position:relative">
      <div style="font-size:12px;font-weight:600;color:#333;line-height:1.4;margin-bottom:4px;padding-right:20px">${n.title}</div>
      <div style="font-size:10px;color:#999;display:flex;gap:8px;flex-wrap:wrap">
        ${n.author ? `<span>👤 ${n.author}</span>` : ''}
        <span>❤️ ${n.likes || 0}</span>
        <span>⭐ ${n.collects || 0}</span>
        <span>💬 ${n.comments || 0}</span>
        ${n.tags?.length ? `<span>🏷️ ${n.tags.slice(0,2).join('/')}</span>` : ''}
      </div>
      <div style="font-size:10px;color:#bbb;margin-top:2px">${n.addedAt}</div>
      <button data-cart-index="${i}" class="cart-item-delete" style="position:absolute;top:8px;right:8px;background:none;border:none;font-size:14px;cursor:pointer;color:#ccc;padding:2px;line-height:1">✕</button>
    </div>
  `).join('');

  // 事件委托：监听删除按钮点击（替代行内 onclick，避免 MV3 作用域问题）
  list.querySelectorAll('.cart-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.cartIndex, 10);
      if (!isNaN(idx)) removeFromCart(idx);
    });
  });

  if (cartItems.length >= 2) {
    batchBtn.disabled = false;
    batchBtn.style.background = 'linear-gradient(135deg,#ff2442,#ff6b81)';
    batchBtn.style.cursor = 'pointer';
    batchBtn.textContent = `📊 批量分析 ${cartItems.length} 篇笔记`;
  } else {
    batchBtn.disabled = true;
    batchBtn.style.background = '#ccc';
    batchBtn.style.cursor = 'not-allowed';
    batchBtn.textContent = `📊 批量分析（还差 ${2 - cartItems.length} 篇）`;
  }
  hint.textContent = `${cartItems.length} 篇笔记待分析`;
}

// 暴露给 onclick 调用
window.removeCartItem = removeFromCart;

// 监听 content script 传来的"加入分析车"请求
function listenAddToCart() {
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'addToCart') {
      const added = addToCart(req.payload || {});
      sendResponse({ success: true, added });
    }
  });
}

function bindCartActions() {
  $('#btnClearCart')?.addEventListener('click', () => {
    if (cartItems.length === 0) return;
    if (confirm(`确定清空分析车？`)) clearCart();
  });

  $('#btnBatchAnalyze')?.addEventListener('click', () => {
    if (cartItems.length < 2) return;
    batchAnalyze();
  });
}

async function batchAnalyze() {
  // 切换到聊天面板
  switchToTab('chat');

  const noteList = cartItems.map((n, i) =>
    `【笔记 ${i + 1}】\n标题：${n.title}\n作者：${n.author || '未知'}\n点赞：${n.likes} / 收藏：${n.collects} / 评论：${n.comments}\n话题：${n.tags?.join(' / ') || '无'}\n正文：${(n.content || '').slice(0, 300)}`
  ).join('\n\n' + '─'.repeat(30) + '\n\n');

  const prompt = `以下是我在小红书收集的多篇笔记，请进行横向对比分析：\n\n${noteList}\n请从以下维度分析：\n1. 各笔记的爆款共性（选题/标题/内容结构）\n2. 差异点与各自优势\n3. 适合借鉴的套路\n4. 综合建议`;

  // 先清空聊天区域，发送用户消息
  const area = $('#messageArea');
  if (area) {
    const hint = $('#emptyHint');
    if (hint) hint.style.display = 'none';
    // 清掉旧的 tool 消息（保留历史对话也可以，这里选择清空）
    area.innerHTML = '';
    if (hint) area.appendChild(hint);
  }

  addMsg('user', `📦 批量分析 ${cartItems.length} 篇笔记\n\n${cartItems.map(n => `• ${n.title}`).join('\n')}`);

  const loadingId = addMsg('assistant', '', 'loading');

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'analyzeText',
      payload: { text: prompt }
    });
    if (!res.success) throw new Error(res.error);
    updateMsg(loadingId, 'assistant', res.data);
  } catch (err) {
    updateMsg(loadingId, 'error', `分析失败：${err.message}`);
  }
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  const isXhs = tab?.url?.includes('xiaohongshu.com') || tab?.url?.includes('xhs.cn');
  $('#pageInfo').textContent = isXhs
    ? `📍 ${tab.title || '小红书页面'}`
    : '⚠️ 请切换到小红书页面以使用抓取功能';

  const dot = $('#statusDot') || $('#authorStatusDot');
  if (dot) {
    dot.className = 'dot ' + (isXhs ? 'ok' : 'err');
    const txt = $('#statusText') || $('#authorStatusText');
    if (txt) txt.textContent = isXhs ? '已连接' : '非小红书页面';
  }

  bindTabs();
  bindChatInput();
  bindToolActions();
  bindSettings();
  bindCartActions();
  await loadSettings();
  await loadCart();
  // 监听来自 content script 的"加入分析车"命令
  listenAddToCart();
});

// ========== Tab 切换 ==========
function bindTabs() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const panelId = 'panel-' + tab.dataset.tab;
      $$('.tool-panel, .settings-panel').forEach(p => p.classList.remove('active'));
      const panel = $(`#${panelId}`);
      if (panel) panel.classList.add('active');
    });
  });
}

// ========== 聊天输入 ==========
function bindChatInput() {
  const input = $('#chatInput');
  if (!input) return;

  // 自动增高
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });

  // Enter 发送，Shift+Enter 换行
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  });

  $('#btnSend')?.addEventListener('click', handleChatSubmit);

  // 快捷按钮（分析/改写/检测/生成）
  $$('.tab-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) {
        input.placeholder = '请先输入或粘贴文案，再点击分析按钮';
        return;
      }
      handleChatAIAction(btn.dataset.action, text);
    });
  });
}

async function handleChatSubmit() {
  const input = $('#chatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = 'auto';

  // 用户消息直接显示
  addMsg('user', text);

  // 判断是生成主题还是处理文案
  const isTopic = text.length < 30 && !text.includes('。') && !text.includes('\n');
  await handleChatAIAction(isTopic ? 'generate' : 'analyze', text);
}

async function handleChatAIAction(mode, text) {
  const labels = { analyze: '🔍 分析', rewrite: '✏️ 改写', check: '⚠️ 检测', generate: '✨ 生成' };
  const label = labels[mode] || 'AI';
  const loadingId = addMsg('assistant', '', 'loading');

  try {
    let finalText = text;

    // 如果是 URL，先尝试抓取页面内容再分析
    if (text.match(/https?:\/\/(www\.)?(xiaohongshu\.com|xhs\.cn)\/.*/i)) {
      addMsg('assistant', `🔗 检测到小红书链接，正在抓取内容...`, '');
      try {
        // 查找实际的小红书标签页（不能用 currentTab，它在 sidepanel 打开时指向 sidepanel 自身）
        const [xhsTab] = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://*.xhs.cn/*'] });
        if (!xhsTab) {
          updateMsg(loadingId, 'error', `⚠️ 未找到已打开的小红书页面，请先切换到小红书标签页`);
          return;
        }
        const scrapeRes = await chrome.tabs.sendMessage(xhsTab.id, { action: 'scrape' });
        if (scrapeRes?.success && scrapeRes.data?.content) {
          finalText = `[小红书笔记内容]\n标题：${scrapeRes.data.title || '无标题'}\n正文：${scrapeRes.data.content}`;
        } else {
          updateMsg(loadingId, 'error', `⚠️ 链接无法直接访问，请确保在笔记详情页打开侧边栏后，再粘贴链接重试`);
          return;
        }
      } catch (scrapeErr) {
        updateMsg(loadingId, 'error', `抓取失败：${scrapeErr.message}，请确保在笔记详情页打开侧边栏`);
        return;
      }
    }

    let res;
    if (mode === 'generate') {
      res = await chrome.runtime.sendMessage({ action: 'generateText', payload: { topic: finalText } });
    } else {
      res = await chrome.runtime.sendMessage({
        action: mode === 'analyze' ? 'analyzeText' : mode === 'rewrite' ? 'rewriteText' : 'checkText',
        payload: { text: finalText }
      });
    }

    if (!res.success) throw new Error(res.error);
    updateMsg(loadingId, 'assistant', res.data);
  } catch (err) {
    updateMsg(loadingId, 'error', `${label}失败：${err.message}`);
  }
}

// ========== 工具操作 ==========
function bindToolActions() {
  $$('.func-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      // 切换到聊天面板显示结果
      switchToTab('chat');
      await handleToolAction(action);
    });
  });
}

async function switchToTab(tabName) {
  $$('.tab').forEach(t => t.classList.remove('active'));
  $$('.tool-panel, .settings-panel').forEach(p => p.classList.remove('active'));
  const target = $(`[data-tab="${tabName}"]`);
  if (target) target.classList.add('active');
  const panel = $(`#panel-${tabName}`);
  if (panel) panel.classList.add('active');
}

async function handleToolAction(action) {
  switch (action) {
    case 'scrapePage':    await toolScrapePage(); break;
    case 'analyzePage':  await toolAnalyzePage(); break;
    case 'scrapeImages': await toolScrapeImages(); break;
    case 'scrapeText':   await toolScrapeText(); break;
    case 'viewComments': await toolViewComments(); break;
    case 'openComposer':
      window.open('https://creator.xiaohongshu.com/publish/publish', '_blank');
      break;
    case 'scrapeAuthor': await toolScrapeAuthor(); break;
  }
}

async function toolScrapePage() {
  const msgId = addMsg('tool', '📥 正在抓取笔记数据...');
  try {
    const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrape' }));
    if (!res.success) throw new Error(res.error);
    scrapedData = res.data;
    const d = scrapedData;
    const summary = [
      `✅ 抓取成功`,
      `📌 标题：${d.title || '(无)'}`,
      `👤 作者：${d.author?.name || '(无)'}`,
      `❤️ 点赞：${d.stats?.likes || 0}`,
      `💬 评论：${d.stats?.comments || 0}`,
      `⭐ 收藏：${d.stats?.collects || 0}`,
      `🔗 链接数：${d.images?.length || 0} 张图片`,
      d.tags?.length ? `🏷️ 话题：${d.tags.slice(0, 5).join(' / ')}` : ''
    ].filter(Boolean).join('\n');
    updateMsg(msgId, 'tool', summary);
  } catch (err) {
    updateMsg(msgId, 'error', `抓取失败：${err.message}`);
  }
}

async function toolAnalyzePage() {
  // 先抓取（复用已抓取的数据）
  if (!scrapedData?.content) {
    const msgId = addMsg('tool', '📥 正在抓取笔记内容用于分析...');
    try {
      const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrape' }));
      if (!res.success) throw new Error(res.error);
      scrapedData = res.data;
      updateMsg(msgId, 'tool', `已抓取：${scrapedData.title || '(无标题)'}，开始 AI 分析...`);
    } catch (err) {
      updateMsg(msgId, 'error', `抓取失败：${err.message}`);
      return;
    }
  } else {
    addMsg('tool', `🔍 分析笔记：${scrapedData.title || '(无标题)'}`);
  }

  if (!scrapedData?.content && !scrapedData?.title) {
    updateMsg(msgId, 'error', '未获取到正文内容，请确认当前页面是笔记详情页');
    return;
  }

  const text = scrapedData.content || scrapedData.title;
  const loadingId = addMsg('assistant', '', 'loading');

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'analyzeText',
      payload: { text }
    });
    if (!res.success) throw new Error(res.error);
    updateMsg(loadingId, 'assistant', res.data);
  } catch (err) {
    updateMsg(loadingId, 'error', `分析失败：${err.message}`);
  }
}

async function toolScrapeImages() {
  const msgId = addMsg('tool', '🖼️ 正在抓取图片...');
  try {
    if (!scrapedData?.images) {
      const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrape' }));
      if (!res.success) throw new Error(res.error);
      scrapedData = res.data;
    }
    const imgs = scrapedData.images || [];
    if (!imgs.length) {
      updateMsg(msgId, 'tool', '未找到图片，可能需要登录或页面未完全加载');
      return;
    }
    await navigator.clipboard.writeText(imgs.join('\n'));
    updateMsg(msgId, 'tool', `✅ 已复制 ${imgs.length} 个图片链接到剪贴板`);
  } catch (err) {
    updateMsg(msgId, 'error', `抓取失败：${err.message}`);
  }
}

async function toolScrapeText() {
  const msgId = addMsg('tool', '📝 正在抓取文案...');
  try {
    if (!scrapedData) {
      const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrape' }));
      if (!res.success) throw new Error(res.error);
      scrapedData = res.data;
    }
    const text = scrapedData.content || scrapedData.title || '';
    if (!text) {
      updateMsg(msgId, 'tool', '未找到正文内容');
      return;
    }
    await navigator.clipboard.writeText(text);
    updateMsg(msgId, 'tool', `✅ 已复制 ${text.length} 字到剪贴板`);
  } catch (err) {
    updateMsg(msgId, 'error', `抓取失败：${err.message}`);
  }
}

async function toolViewComments() {
  const msgId = addMsg('tool', '💬 正在读取评论...');
  try {
    const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrapeComments' }));
    if (!res.success) throw new Error(res.error);
    const comments = res.data || [];
    if (!comments.length) {
      updateMsg(msgId, 'tool', '未找到评论（可能需要展开评论区）');
      return;
    }
    const top5 = comments.slice(0, 5);
    const lines = top5.map((c, i) => `${i + 1}. 【${c.author || '匿名'}】${(c.content || '').slice(0, 50)}${c.content?.length > 50 ? '...' : ''}`).join('\n');
    const total = comments.length > 5 ? `\n…还有 ${comments.length - 5} 条评论` : '';
    updateMsg(msgId, 'tool', `💬 共 ${comments.length} 条评论（显示前5条）：\n${lines}${total}`);
  } catch (err) {
    updateMsg(msgId, 'error', `读取失败：${err.message}`);
  }
}

async function toolScrapeAuthor() {
  const msgId = addMsg('tool', '👤 正在抓取博主数据...');
  try {
    const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrapeProfile' }));
    if (!res.success) throw new Error(res.error);
    const d = res.data;
    const card = $('#authorCard');
    const formatNum = (n) => {
      if (!n) return '—';
      if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
      return n.toString();
    };
    if (card) {
      $('#authorName').textContent = d.name || '—';
      $('#authorId').textContent = d.url || '—';
      $('#authorFans').textContent = formatNum(d.fans);
      $('#authorPosts').textContent = formatNum(d.posts);
      $('#authorFollowing').textContent = formatNum(d.following);
      $('#authorIntro').textContent = d.intro || '暂无简介';
      $('#authorAvatar').textContent = d.name ? d.name[0] : '👤';
      card.style.display = 'block';
    }
    const summary = [
      `👤 博主信息`,
      `📛 名称：${d.name || '—'}`,
      `👥 粉丝：${formatNum(d.fans)}`,
      `📝 笔记：${formatNum(d.posts)}`,
      `➕ 关注：${formatNum(d.following)}`,
      d.intro ? `📝 简介：${d.intro}` : ''
    ].filter(Boolean).join('\n');
    updateMsg(msgId, 'tool', summary);
  } catch (err) {
    updateMsg(msgId, 'error', `抓取失败：${err.message}`);
  }
}

// ========== 设置 ==========
const PROVIDER_DEFAULTS = {
  minimax:    { endpoint: 'https://api.minimax.chat/v1/text/chatcompletion_v2', model: 'MiniMax-Text-01',    placeholder: '输入 MiniMax API Key' },
  kimi:       { endpoint: 'https://api.moonshot.cn/v1/chat/completions',        model: 'moonshot-v1-8k',    placeholder: '输入 Kimi API Key（sk-...）' },
  deepseek:   { endpoint: 'https://api.deepseek.com/v1/chat/completions',       model: 'deepseek-chat',      placeholder: '输入 DeepSeek API Key' },
  siliconflow:{ endpoint: 'https://api.siliconflow.cn/v1/chat/completions',      model: 'Qwen/Qwen2.5-7B-Instruct', placeholder: '输入硅基流动 API Key' },
  zhipu:      { endpoint: 'https://api.bigmodel.cn/api/paas/v4/chat/completions',model: 'glm-4-flash',        placeholder: '输入智谱 API Key' },
  qwen:       { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-turbo', placeholder: '输入通义千问 API Key' },
  openai:     { endpoint: 'https://api.openai.com/v1/chat/completions',         model: 'gpt-4o-mini',       placeholder: '输入 OpenAI API Key（sk-...）' },
  custom:     { endpoint: '',                                                   model: '',                   placeholder: '手动填写所有字段' }
};

function bindSettings() {
  // Provider 切换自动填 endpoint / model
  $('#aiProvider')?.addEventListener('change', (e) => {
    const def = PROVIDER_DEFAULTS[e.target.value];
    if (!def) return;
    const epEl = $('#aiEndpoint');
    const modelEl = $('#aiModel');
    const keyEl = $('#aiApiKey');
    if (epEl) epEl.value = def.endpoint;
    if (modelEl) modelEl.value = def.model;
    if (keyEl) { keyEl.value = ''; keyEl.placeholder = def.placeholder; }
  });

  $('#btnSaveSettings')?.addEventListener('click', saveSettings);

  // 账号绑定按钮
  $('#btnBindAccount')?.addEventListener('click', handleBindAccount);
  $('#btnUnbindAccount')?.addEventListener('click', handleUnbindAccount);
}

async function loadSettings() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getAiConfig' });
    if (!res.success) return;
    const c = res.data || {};
    const prov = c.provider || 'minimax';
    const def = PROVIDER_DEFAULTS[prov] || PROVIDER_DEFAULTS.minimax;

    $('#aiProvider').value = prov;
    $('#aiEndpoint').value = c.endpoint || def.endpoint;
    $('#aiApiKey').value = c.apiKey || '';
    $('#aiModel').value = c.model || def.model;
    $('#aiTemp').value = c.temperature ?? 0.7;
    $('#aiMaxTokens').value = c.maxTokens || 2000;
  } catch (_) {}

  // 加载账号绑定状态
  await loadAccountStatus();
}

// ========== 账号绑定 ==========
async function loadAccountStatus() {
  const unbound = $('#accountUnbound');
  const bound = $('#accountBound');
  const loading = $('#accountLoading');
  if (!unbound || !bound || !loading) return;

  try {
    const res = await chrome.runtime.sendMessage({ action: 'getAccount' });
    const account = res?.data;

    if (account?.session || account?.a1) {
      // 已绑定
      unbound.style.display = 'none';
      bound.style.display = 'block';
      loading.style.display = 'none';

      const nickEl = $('#boundNickname');
      const avatarEl = $('#boundAvatar');
      if (nickEl) nickEl.textContent = account.nickname || '已绑定账号';
      if (avatarEl) {
        if (account.avatar) {
          avatarEl.innerHTML = `<img src="${account.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
        } else {
          avatarEl.textContent = '👤';
        }
      }
      // 自动填入 cookie 字段
      const cookieEl = $('#accountCookie');
      if (cookieEl && account.session && !cookieEl.value) {
        cookieEl.value = account.session;
      }
    } else {
      // 未绑定
      unbound.style.display = 'flex';
      bound.style.display = 'none';
      loading.style.display = 'none';
    }
  } catch (_) {
    unbound.style.display = 'flex';
    bound.style.display = 'none';
    loading.style.display = 'none';
  }
}

async function handleBindAccount() {
  const unbound = $('#accountUnbound');
  const bound = $('#accountBound');
  const loading = $('#accountLoading');
  if (!unbound || !bound || !loading) return;

  unbound.style.display = 'none';
  loading.style.display = 'flex';

  try {
    const res = await chrome.runtime.sendMessage({ action: 'bindAccount' });
    if (!res.success) {
      alert(res.error || '绑定失败');
      loading.style.display = 'none';
      unbound.style.display = 'flex';
      return;
    }

    const account = res.data;
    bound.style.display = 'block';
    loading.style.display = 'none';

    const nickEl = $('#boundNickname');
    const avatarEl = $('#boundAvatar');
    if (nickEl) nickEl.textContent = account.nickname || '已绑定账号';
    if (avatarEl) {
      if (account.avatar) {
        avatarEl.innerHTML = `<img src="${account.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
      } else {
        avatarEl.textContent = '👤';
      }
    }

    // 自动填入 cookie
    const cookieEl = $('#accountCookie');
    if (cookieEl && account.session) cookieEl.value = account.session;

  } catch (err) {
    alert('绑定失败：' + err.message);
    loading.style.display = 'none';
    unbound.style.display = 'flex';
  }
}

async function handleUnbindAccount() {
  if (!confirm('确定解除绑定？')) return;
  try {
    await chrome.runtime.sendMessage({ action: 'unbindAccount' });
  } catch (_) {}
  const bound = $('#accountBound');
  const unbound = $('#accountUnbound');
  const cookieEl = $('#accountCookie');
  if (bound) bound.style.display = 'none';
  if (unbound) unbound.style.display = 'flex';
  if (cookieEl) cookieEl.value = '';
}

async function saveSettings() {
  const aiConfig = {
    provider:    $('#aiProvider').value,
    endpoint:    $('#aiEndpoint').value.trim(),
    apiKey:      $('#aiApiKey').value.trim(),
    model:       $('#aiModel').value.trim(),
    temperature: parseFloat($('#aiTemp').value) || 0.7,
    maxTokens:   parseInt($('#aiMaxTokens').value) || 2000
  };
  await chrome.runtime.sendMessage({ action: 'setAiConfig', payload: aiConfig });

  const cookie = $('#accountCookie').value.trim();
  // 只有手动输入了 cookie 才更新账号，手动解绑或绑定操作由独立按钮处理
  // 这里只做兼容性：如果 cookie 有值则同步到账号
  const accRes = await chrome.runtime.sendMessage({ action: 'getAccount' });
  const existingAccount = accRes?.data;
  if (cookie) {
    await chrome.runtime.sendMessage({
      action: 'setAccount',
      payload: {
        session: cookie,
        a1: existingAccount?.a1 || '',
        nickname: existingAccount?.nickname || '',
        avatar: existingAccount?.avatar || ''
      }
    });
  }

  // 保存成功反馈
  const btn = $('#btnSaveSettings');
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = '✅ 已保存';
    btn.style.background = '#00c853';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.background = '';
    }, 1500);
  }
}
