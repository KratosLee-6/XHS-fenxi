/**
 * sidepanel.js — 小红书运营工具箱侧边栏
 * v2.3.0 统一入口：共享状态 + DOM 工具 + 消息流 + Tab 切换
 */

'use strict';

// ========== 全局状态 ==========
const _S = {
  currentTab: null,
  scrapedData: null,
  cartItems: [],
  _providers: null,
  _loadingHistory: false
};

// ========== DOM 工具 ==========
const $ = (sel, ctx = document) => (ctx || document).querySelector(sel);
const $$ = (sel, ctx = document) => [...(ctx || document).querySelectorAll(sel)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ========== 获取小红书标签页 ==========
async function getXhsTab() {
  const tabs = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://*.xhs.cn/*'] });
  return tabs[0] || null;
}

async function withXhsTab(actionFn) {
  const tab = await getXhsTab();
  if (!tab) throw new Error('未找到小红书标签页，请确保已打开小红书页面');
  return actionFn(tab.id);
}

// ========== Markdown 格式化 ==========
function formatMarkdown(text) {
  const lines = text.split('\n');
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    line = line
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:rgba(0,0,0,.06);padding:1px 4px;border-radius:3px;font-size:11px">$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#ff2442">$1</a>');
    if (/^### (.+)/.test(line)) { result.push(`<h3 style="font-size:14px;margin:8px 0 4px">${line.replace(/^### /, '')}</h3>`); continue; }
    if (/^[-*] (.+)/.test(line)) { result.push(`<li style="margin-left:16px">${line.replace(/^[-*] /, '')}</li>`); continue; }
    if (/^\d+\. (.+)/.test(line)) { result.push(`<li style="margin-left:16px">${line.replace(/^\d+\. /, '')}</li>`); continue; }
    if (/^> (.+)/.test(line)) { result.push(`<blockquote style="border-left:3px solid #ff2442;padding-left:8px;color:var(--text-secondary);margin:4px 0">${line.replace(/^> /, '')}</blockquote>`); continue; }
    if (/^[-_*]{3,}$/.test(line.trim())) { result.push('<hr style="border:none;border-top:1px solid var(--border-color);margin:8px 0">'); continue; }
    if (!line.trim()) { result.push('<br>'); continue; }
    result.push(line);
  }
  return result.join('\n');
}

// ========== 消息流渲染 ==========
function addMsg(role, content, type = 'text') {
  const hint = $('#emptyHint');
  if (hint) hint.style.display = 'none';
  const area = $('#messageArea');
  const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const icons = { user: '👤', assistant: '🤖', tool: '🛠', error: '⚠️', loading: '' };
  const icon = icons[role] || '•';
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.id = id;
  const avatarHtml = icon ? `<div class="avatar">${icon}</div>` : `<div class="avatar"></div>`;
  if (type === 'loading') {
    div.innerHTML = `${avatarHtml}<div class="bubble">AI 思考中<span style="display:inline-block;width:12px;height:12px;border:2px solid #ddd;border-top-color:#ff2442;border-radius:50%;animation:spin .7s linear infinite;margin-left:4px;vertical-align:middle"></span></div>`;
    div.classList.add('loading');
  } else {
    div.innerHTML = `${avatarHtml}<div class="bubble">${formatMarkdown(content)}</div>`;
  }
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  // 聊天历史自动保存
  if (type !== 'loading') saveChatHistory();
  return id;
}

function updateMsg(id, role, content) {
  const div = $(`#${id}`);
  if (!div) return;
  div.className = `msg ${role}`;
  const avatar = div.querySelector('.avatar');
  const icons = { user: '👤', assistant: '🤖', tool: '🛠', error: '⚠️' };
  if (avatar && icons[role]) avatar.textContent = icons[role];
  const bubble = div.querySelector('.bubble');
  if (bubble) bubble.innerHTML = formatMarkdown(content);
  const area = $('#messageArea');
  area.scrollTop = area.scrollHeight;
}

function removeMsg(id) {
  const div = $(`#${id}`);
  if (div) div.remove();
  saveChatHistory();
}

// ========== 聊天历史持久化 ==========
const MAX_CHAT_HISTORY = 50;

function saveChatHistory() {
  if (_S._loadingHistory) return;
  const area = $('#messageArea');
  if (!area) return;
  const messages = [];
  area.querySelectorAll('.msg').forEach(el => {
    const bubble = el.querySelector('.bubble');
    if (!bubble || el.classList.contains('loading')) return;
    const role = el.classList.contains('user') ? 'user' :
                 el.classList.contains('assistant') ? 'assistant' :
                 el.classList.contains('tool') ? 'tool' :
                 el.classList.contains('error') ? 'error' : 'assistant';
    messages.push({ role, content: bubble.innerText });
  });
  if (messages.length > MAX_CHAT_HISTORY) messages.splice(0, messages.length - MAX_CHAT_HISTORY);
  chrome.storage.local.set({ xhsChatHistory: messages }).catch(() => {});
}

function loadChatHistory() {
  chrome.storage.local.get(['xhsChatHistory'], (result) => {
    const messages = result.xhsChatHistory;
    if (!Array.isArray(messages) || !messages.length) return;
    _S._loadingHistory = true;
    const hint = $('#emptyHint');
    if (hint) hint.style.display = 'none';
    messages.forEach(m => addMsg(m.role, m.content));
    _S._loadingHistory = false;
  });
}

// ========== Tab 切换 ==========
function switchToTab(tabName) {
  $$('.tab').forEach(t => t.classList.remove('active'));
  $$('.tool-panel, .settings-panel').forEach(p => p.classList.remove('active'));
  const target = $(`[data-tab="${tabName}"]`);
  if (target) target.classList.add('active');
  const panel = $(`#panel-${tabName}`);
  if (panel) panel.classList.add('active');
}

// =====================================================================
// 对话模块
// =====================================================================

function initChat() {
  const input = $('#chatInput');
  if (!input) return;
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  });
  $('#btnSend')?.addEventListener('click', handleChatSubmit);
  $$('.tab-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) { input.placeholder = '请先输入或粘贴文案，再点击分析按钮'; return; }
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
  addMsg('user', text);
  const isTopic = text.length < 30 && !text.includes('。') && !text.includes('\n');
  await handleChatAIAction(isTopic ? 'generate' : 'analyze', text);
}

async function handleChatAIAction(mode, text) {
  const labels = { analyze: '🔍 分析', rewrite: '✏️ 改写', check: '⚠️ 检测', generate: '✨ 生成' };
  const label = labels[mode] || 'AI';
  const loadingId = addMsg('assistant', '', 'loading');
  try {
    let finalText = text;
    if (text.match(/https?:\/\/(www\.)?(xiaohongshu\.com|xhs\.cn)\/.*/i)) {
      addMsg('assistant', '🔗 检测到小红书链接，正在抓取内容...', '');
      try {
        const [xhsTab] = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://*.xhs.cn/*'] });
        if (!xhsTab) { updateMsg(loadingId, 'error', '⚠️ 未找到已打开的小红书页面，请先切换到小红书标签页'); return; }
        const scrapeRes = await chrome.tabs.sendMessage(xhsTab.id, { action: 'scrape' });
        if (scrapeRes?.success && scrapeRes.data?.content) {
          finalText = `[小红书笔记内容]\n标题：${scrapeRes.data.title || '无标题'}\n正文：${scrapeRes.data.content}`;
        } else {
          updateMsg(loadingId, 'error', '⚠️ 链接无法直接访问，请确保在笔记详情页打开侧边栏后，再粘贴链接重试');
          return;
        }
      } catch (scrapeErr) {
        updateMsg(loadingId, 'error', `抓取失败：${scrapeErr.message}`);
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

// =====================================================================
// 工具模块
// =====================================================================

function initTools() {
  $$('.func-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      switchToTab('chat');
      await handleToolAction(action);
    });
  });
}

async function handleToolAction(action) {
  switch (action) {
    case 'scrapePage':    await toolScrapePage(); break;
    case 'analyzePage':  await toolAnalyzePage(); break;
    case 'scrapeImages': await toolScrapeImages(); break;
    case 'scrapeText':   await toolScrapeText(); break;
    case 'viewComments': await toolViewComments(); break;
    case 'scrapeNoteList': await toolScrapeNoteList(); break;
    case 'openComposer': window.open('https://creator.xiaohongshu.com/publish/publish', '_blank'); break;
    case 'scrapeAuthor': await toolScrapeAuthor(); break;
  }
}

async function toolScrapePage() {
  const msgId = addMsg('tool', '📥 正在抓取笔记数据...');
  try {
    const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrape' }));
    if (!res.success) throw new Error(res.error);
    _S.scrapedData = res.data;
    const d = _S.scrapedData;
    const summary = [
      '✅ 抓取成功', `📌 标题：${d.title || '(无)'}`, `👤 作者：${d.author?.name || '(无)'}`,
      `❤️ 点赞：${d.stats?.likes || 0}`, `💬 评论：${d.stats?.comments || 0}`, `⭐ 收藏：${d.stats?.collects || 0}`,
      `🔗 图片：${d.images?.length || 0} 张`,
      d.tags?.length ? `🏷️ 话题：${d.tags.slice(0, 5).join(' / ')}` : ''
    ].filter(Boolean).join('\n');
    updateMsg(msgId, 'tool', summary);
  } catch (err) { updateMsg(msgId, 'error', `抓取失败：${err.message}`); }
}

async function toolAnalyzePage() {
  let msgId;
  if (!_S.scrapedData?.content) {
    msgId = addMsg('tool', '📥 正在抓取笔记内容用于分析...');
    try {
      const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrape' }));
      if (!res.success) throw new Error(res.error);
      _S.scrapedData = res.data;
      updateMsg(msgId, 'tool', `已抓取：${_S.scrapedData.title || '(无标题)'}，开始 AI 分析...`);
    } catch (err) { updateMsg(msgId, 'error', `抓取失败：${err.message}`); return; }
  } else {
    addMsg('tool', `🔍 分析笔记：${_S.scrapedData.title || '(无标题)'}`);
  }
  const text = _S.scrapedData?.content || _S.scrapedData?.title;
  if (!text) { addMsg('error', '未获取到正文内容'); return; }
  const loadingId = addMsg('assistant', '', 'loading');
  try {
    const res = await chrome.runtime.sendMessage({ action: 'analyzeText', payload: { text } });
    if (!res.success) throw new Error(res.error);
    updateMsg(loadingId, 'assistant', res.data);
  } catch (err) { updateMsg(loadingId, 'error', `分析失败：${err.message}`); }
}

async function toolScrapeImages() {
  const msgId = addMsg('tool', '🖼️ 正在抓取图片...');
  try {
    if (!_S.scrapedData?.images) {
      const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrape' }));
      if (!res.success) throw new Error(res.error);
      _S.scrapedData = res.data;
    }
    const imgs = _S.scrapedData.images || [];
    if (!imgs.length) { updateMsg(msgId, 'tool', '未找到图片'); return; }
    await navigator.clipboard.writeText(imgs.join('\n'));
    updateMsg(msgId, 'tool', `✅ 已复制 ${imgs.length} 个图片链接到剪贴板`);
  } catch (err) { updateMsg(msgId, 'error', `抓取失败：${err.message}`); }
}

async function toolScrapeText() {
  const msgId = addMsg('tool', '📝 正在抓取文案...');
  try {
    if (!_S.scrapedData) {
      const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrape' }));
      if (!res.success) throw new Error(res.error);
      _S.scrapedData = res.data;
    }
    const text = _S.scrapedData.content || _S.scrapedData.title || '';
    if (!text) { updateMsg(msgId, 'tool', '未找到正文内容'); return; }
    await navigator.clipboard.writeText(text);
    updateMsg(msgId, 'tool', `✅ 已复制 ${text.length} 字到剪贴板`);
  } catch (err) { updateMsg(msgId, 'error', `抓取失败：${err.message}`); }
}

async function toolViewComments() {
  const msgId = addMsg('tool', '💬 正在读取评论...');
  try {
    const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrapeComments' }));
    if (!res.success) throw new Error(res.error);
    const comments = res.data || [];
    if (!comments.length) { updateMsg(msgId, 'tool', '未找到评论（可能需要展开评论区）'); return; }
    const top5 = comments.slice(0, 5);
    const lines = top5.map((c, i) => `${i + 1}. 【${c.author || '匿名'}】${(c.content || '').slice(0, 50)}${c.content?.length > 50 ? '...' : ''}`).join('\n');
    const total = comments.length > 5 ? `\n…还有 ${comments.length - 5} 条` : '';
    updateMsg(msgId, 'tool', `💬 共 ${comments.length} 条（显示前5条）：\n${lines}${total}`);
  } catch (err) { updateMsg(msgId, 'error', `读取失败：${err.message}`); }
}

async function toolScrapeNoteList() {
  const msgId = addMsg('tool', '📋 正在抓取笔记列表...');
  try {
    const res = await withXhsTab((tabId) => chrome.tabs.sendMessage(tabId, { action: 'scrapeNoteList' }));
    if (!res.success) throw new Error(res.error);
    const notes = res.data || [];
    if (!notes.length) { updateMsg(msgId, 'tool', '未找到笔记卡片，请在搜索页或发现页使用此功能'); return; }
    const lines = notes.slice(0, 20).map((n, i) => `${i + 1}. ${n.title} — ${n.author || '未知'} ❤️${n.likes || 0}`).join('\n');
    const more = notes.length > 20 ? `\n…还有 ${notes.length - 20} 篇` : '';
    updateMsg(msgId, 'tool', `📋 共抓取 ${notes.length} 篇（显示前20条）：\n${lines}${more}`);
    _S.scrapedData = { noteList: notes };
  } catch (err) { updateMsg(msgId, 'error', `列表抓取失败：${err.message}`); }
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
    updateMsg(msgId, 'tool', [
      '👤 博主信息', `📛 名称：${d.name || '—'}`, `👥 粉丝：${formatNum(d.fans)}`,
      `📝 笔记：${formatNum(d.posts)}`, `➕ 关注：${formatNum(d.following)}`,
      d.intro ? `📝 简介：${d.intro}` : ''
    ].filter(Boolean).join('\n'));
  } catch (err) { updateMsg(msgId, 'error', `抓取失败：${err.message}`); }
}

// =====================================================================
// 分析车模块
// =====================================================================

async function initCart() {
  await loadCart();
  bindCartActions();
  listenAddToCart();
}

async function loadCart() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getCart' });
    if (res && res.success && Array.isArray(res.data)) _S.cartItems = res.data;
  } catch (_) {}
  renderCart();
}

async function saveCart() {
  try { await chrome.runtime.sendMessage({ action: 'setCart', payload: _S.cartItems }); } catch (_) {}
}

function addToCart(noteData) {
  if (_S.cartItems.some(n => n.id === noteData.id)) return false;
  _S.cartItems.push({
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

function removeFromCart(index) { _S.cartItems.splice(index, 1); saveCart(); renderCart(); }
function clearCart() { _S.cartItems = []; saveCart(); renderCart(); }

function renderCart() {
  const list = $('#cartList');
  const countEl = $('#cartCount');
  const dot = $('#cartDot');
  const batchBtn = $('#btnBatchAnalyze');
  const hint = $('#cartHint');
  if (!list) return;

  countEl.textContent = `${_S.cartItems.length} 篇笔记`;
  dot.className = 'dot ' + (_S.cartItems.length > 0 ? 'ok' : '');

  if (_S.cartItems.length === 0) {
    list.innerHTML = '';
    if (batchBtn) { batchBtn.disabled = true; batchBtn.style.background = '#ccc'; batchBtn.style.cursor = 'not-allowed'; batchBtn.textContent = '📊 批量分析（需2篇以上）'; }
    if (hint) hint.textContent = '浏览笔记时点击「📦 加入分析车」即可收集';
    ['btnExportCSV','btnExportJSON','btnExportMD'].forEach(id => { const b = $('#' + id); if (b) { b.disabled = true; b.style.opacity = '0.5'; } });
    return;
  }

  list.innerHTML = _S.cartItems.map((n, i) => `
    <div style="background:var(--bg-card,#fff);border-radius:10px;padding:10px 12px;box-shadow:0 1px 4px rgba(0,0,0,.06);position:relative">
      <div style="font-size:12px;font-weight:600;color:var(--text-primary,#333);line-height:1.4;margin-bottom:4px;padding-right:20px">${n.title}</div>
      <div style="font-size:10px;color:var(--text-muted,#999);display:flex;gap:8px;flex-wrap:wrap">
        ${n.author ? `<span>👤 ${n.author}</span>` : ''}
        <span>❤️ ${n.likes || 0}</span><span>⭐ ${n.collects || 0}</span><span>💬 ${n.comments || 0}</span>
        ${n.tags?.length ? `<span>🏷️ ${n.tags.slice(0,2).join('/')}</span>` : ''}
      </div>
      <div style="font-size:10px;color:var(--text-placeholder,#bbb);margin-top:2px">${n.addedAt}</div>
      <button data-cart-index="${i}" class="cart-item-delete" style="position:absolute;top:8px;right:8px;background:none;border:none;font-size:14px;cursor:pointer;color:#ccc;padding:2px;line-height:1">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.cart-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.cartIndex, 10);
      if (!isNaN(idx)) removeFromCart(idx);
    });
  });

  if (_S.cartItems.length >= 2) {
    if (batchBtn) { batchBtn.disabled = false; batchBtn.style.background = 'linear-gradient(135deg,#ff2442,#ff6b81)'; batchBtn.style.cursor = 'pointer'; batchBtn.textContent = `📊 批量分析 ${_S.cartItems.length} 篇笔记`; }
  } else {
    if (batchBtn) { batchBtn.disabled = true; batchBtn.style.background = '#ccc'; batchBtn.style.cursor = 'not-allowed'; batchBtn.textContent = `📊 批量分析（还差 ${2 - _S.cartItems.length} 篇）`; }
  }
  if (hint) hint.textContent = `${_S.cartItems.length} 篇笔记待分析`;
  ['btnExportCSV','btnExportJSON','btnExportMD'].forEach(id => { const b = $('#' + id); if (b) { b.disabled = false; b.style.opacity = '1'; } });
}

// ========== 数据导出 ==========
function downloadFile(content, filename, mimeType) {
  const blob = new Blob(['﻿' + content], { type: mimeType + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportCSV() {
  const header = '序号,标题,作者,点赞,收藏,评论,标签,URL,添加时间';
  const rows = _S.cartItems.map((n, i) =>
    `${i + 1},"${(n.title || '').replace(/"/g, '""')}","${(n.author || '').replace(/"/g, '""')}",${n.likes || 0},${n.collects || 0},${n.comments || 0},"${(n.tags || []).join(' ')}","${n.url || ''}","${n.addedAt || ''}"`
  );
  downloadFile([header, ...rows].join('\n'), `xhs-cart-${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
}

function exportJSON() {
  const data = _S.cartItems.map(n => ({
    title: n.title, author: n.author, likes: n.likes, collects: n.collects,
    comments: n.comments, tags: n.tags, content: n.content, images: n.images,
    url: n.url, addedAt: n.addedAt
  }));
  downloadFile(JSON.stringify(data, null, 2), `xhs-cart-${new Date().toISOString().slice(0,10)}.json`, 'application/json');
}

function exportMD() {
  const lines = ['# 小红书分析车笔记导出', '', `> 导出时间：${new Date().toLocaleString('zh-CN')}`, `> 共 ${_S.cartItems.length} 篇笔记`, '', '---', ''];
  _S.cartItems.forEach((n, i) => {
    lines.push(`## ${i + 1}. ${n.title}`, '');
    lines.push(`- **作者**：${n.author || '未知'}`);
    lines.push(`- **点赞**：${n.likes || 0} / **收藏**：${n.collects || 0} / **评论**：${n.comments || 0}`);
    if (n.tags?.length) lines.push(`- **标签**：${n.tags.join(' / ')}`);
    if (n.url) lines.push(`- **链接**：${n.url}`);
    lines.push(`- **添加时间**：${n.addedAt || ''}`);
    if (n.content) { lines.push('', '### 正文', '', n.content.slice(0, 500), ''); }
    if (n.images?.length) { lines.push('', '### 图片', ''); n.images.forEach(img => lines.push(`- ${img}`)); }
    lines.push('', '---', '');
  });
  downloadFile(lines.join('\n'), `xhs-cart-${new Date().toISOString().slice(0,10)}.md`, 'text/markdown');
}

function bindCartActions() {
  $('#btnClearCart')?.addEventListener('click', () => { if (_S.cartItems.length === 0) return; if (confirm('确定清空分析车？')) clearCart(); });
  $('#btnBatchAnalyze')?.addEventListener('click', () => { if (_S.cartItems.length < 2) return; batchAnalyze(); });
  $('#btnExportCSV')?.addEventListener('click', exportCSV);
  $('#btnExportJSON')?.addEventListener('click', exportJSON);
  $('#btnExportMD')?.addEventListener('click', exportMD);
}

function listenAddToCart() {
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'addToCart') {
      const added = addToCart(req.payload || {});
      sendResponse({ success: true, added });
    }
  });
}

async function batchAnalyze() {
  switchToTab('chat');
  const noteList = _S.cartItems.map((n, i) =>
    `【笔记 ${i + 1}】\n标题：${n.title}\n作者：${n.author || '未知'}\n点赞：${n.likes} / 收藏：${n.collects} / 评论：${n.comments}\n话题：${n.tags?.join(' / ') || '无'}\n正文：${(n.content || '').slice(0, 300)}`
  ).join('\n\n' + '─'.repeat(30) + '\n\n');

  const prompt = `以下是我在小红书收集的多篇笔记，请进行横向对比分析：\n\n${noteList}\n请从以下维度分析：\n1. 各笔记的爆款共性（选题/标题/内容结构）\n2. 差异点与各自优势\n3. 适合借鉴的套路\n4. 综合建议`;

  const area = $('#messageArea');
  if (area) { const hint = $('#emptyHint'); if (hint) hint.style.display = 'none'; area.innerHTML = ''; if (hint) area.appendChild(hint); }
  addMsg('user', `📦 批量分析 ${_S.cartItems.length} 篇笔记\n\n${_S.cartItems.map(n => `• ${n.title}`).join('\n')}`);
  const loadingId = addMsg('assistant', '', 'loading');
  try {
    const res = await chrome.runtime.sendMessage({ action: 'analyzeText', payload: { text: prompt } });
    if (!res.success) throw new Error(res.error);
    updateMsg(loadingId, 'assistant', res.data);
  } catch (err) { updateMsg(loadingId, 'error', `分析失败：${err.message}`); }
}

// =====================================================================
// 设置模块
// =====================================================================

async function initSettings() {
  // Provider 切换自动填 endpoint / model
  $('#aiProvider')?.addEventListener('change', (e) => {
    const def = _S._providers ? _S._providers[e.target.value] : null;
    if (!def) return;
    const epEl = $('#aiEndpoint'); const modelEl = $('#aiModel'); const keyEl = $('#aiApiKey');
    if (epEl) epEl.value = def.endpoint || '';
    if (modelEl) modelEl.value = def.model || '';
    if (keyEl) { keyEl.value = ''; keyEl.placeholder = def.placeholder || ''; }
  });

  // Cookie 显示/隐藏切换
  $('#btnToggleCookie')?.addEventListener('click', () => {
    const input = $('#accountCookie'); const btn = $('#btnToggleCookie');
    if (!input || !btn) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.textContent = isHidden ? '\u{1F648}' : '\u{1F441}️';
  });

  $('#btnSaveSettings')?.addEventListener('click', saveSettings);
  $('#btnBindAccount')?.addEventListener('click', handleBindAccount);
  $('#btnUnbindAccount')?.addEventListener('click', handleUnbindAccount);

  renderProviderSelect('minimax');
  await loadSettings();
}

function renderProviderSelect(activeKey) {
  const sel = $('#aiProvider');
  if (!sel) return;
  if (!_S._providers) { console.warn('[XHS] Provider 列表未加载，将在 500ms 后重试'); setTimeout(() => renderProviderSelect(activeKey), 500); return; }
  sel.innerHTML = '';
  Object.keys(_S._providers).forEach(key => {
    const p = _S._providers[key];
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = p.name || key;
    if (key === activeKey) opt.selected = true;
    sel.appendChild(opt);
  });
}

async function loadSettings() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getAiConfig' });
    if (!res || !res.success) return;
    const c = res.data || {};
    const prov = c.provider || 'minimax';
    const def = _S._providers ? (_S._providers[prov] || _S._providers['minimax']) : null;

    renderProviderSelect(prov);
    $('#aiEndpoint').value = c.endpoint || (def ? def.endpoint : '');
    $('#aiApiKey').value = c.apiKey || '';
    $('#aiModel').value = c.model || (def ? def.model : '');
    $('#aiTemp').value = c.temperature ?? 0.7;
    $('#aiMaxTokens').value = c.maxTokens || 2000;
  } catch (e) { console.warn('[XHS] 加载设置失败:', e); }
  await loadAccountStatus();
}

async function saveSettings() {
  const aiConfig = {
    provider: $('#aiProvider').value, endpoint: $('#aiEndpoint').value.trim(),
    apiKey: $('#aiApiKey').value.trim(), model: $('#aiModel').value.trim(),
    temperature: parseFloat($('#aiTemp').value) || 0.7, maxTokens: parseInt($('#aiMaxTokens').value) || 2000
  };
  await chrome.runtime.sendMessage({ action: 'setAiConfig', payload: aiConfig });

  const cookie = $('#accountCookie').value.trim();
  if (cookie) {
    const accRes = await chrome.runtime.sendMessage({ action: 'getAccount' });
    const existingAccount = accRes?.data;
    await chrome.runtime.sendMessage({ action: 'setAccount', payload: {
      session: cookie, a1: existingAccount?.a1 || '', nickname: existingAccount?.nickname || '', avatar: existingAccount?.avatar || ''
    }});
  }
  const btn = $('#btnSaveSettings');
  if (btn) { const orig = btn.textContent; btn.textContent = '✅ 已保存'; btn.style.background = '#00c853'; setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 1500); }
}

// ========== 账号绑定 ==========
async function loadAccountStatus() {
  const unbound = $('#accountUnbound'); const bound = $('#accountBound'); const loading = $('#accountLoading');
  if (!unbound || !bound || !loading) return;
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getAccount' });
    const account = res?.data;
    if (account?.session || account?.a1) {
      unbound.style.display = 'none'; bound.style.display = 'block'; loading.style.display = 'none';
      const nickEl = $('#boundNickname'); const avatarEl = $('#boundAvatar');
      if (nickEl) nickEl.textContent = account.nickname || '已绑定账号';
      if (avatarEl) {
        if (account.avatar) { avatarEl.innerHTML = `<img src="${account.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`; }
        else { avatarEl.textContent = '\u{1F464}'; }
      }
      const cookieEl = $('#accountCookie');
      if (cookieEl && account.session && !cookieEl.value) cookieEl.value = account.session;
    } else { unbound.style.display = 'flex'; bound.style.display = 'none'; loading.style.display = 'none'; }
  } catch (_) { unbound.style.display = 'flex'; bound.style.display = 'none'; loading.style.display = 'none'; }
}

async function handleBindAccount() {
  const unbound = $('#accountUnbound'); const bound = $('#accountBound'); const loading = $('#accountLoading');
  if (!unbound || !bound || !loading) return;
  unbound.style.display = 'none'; loading.style.display = 'flex';
  try {
    const res = await chrome.runtime.sendMessage({ action: 'bindAccount' });
    if (!res || !res.success) { alert(res?.error || '绑定失败'); loading.style.display = 'none'; unbound.style.display = 'flex'; return; }
    const account = res.data;
    bound.style.display = 'block'; loading.style.display = 'none';
    const nickEl = $('#boundNickname'); const avatarEl = $('#boundAvatar');
    if (nickEl) nickEl.textContent = account.nickname || '已绑定账号';
    if (avatarEl) {
      if (account.avatar) { avatarEl.innerHTML = `<img src="${account.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`; }
      else { avatarEl.textContent = '\u{1F464}'; }
    }
    const cookieEl = $('#accountCookie');
    if (cookieEl && account.session) cookieEl.value = account.session;
  } catch (err) { alert('绑定失败：' + (err.message || '网络错误')); loading.style.display = 'none'; unbound.style.display = 'flex'; }
}

async function handleUnbindAccount() {
  if (!confirm('确定解除绑定？')) return;
  try { await chrome.runtime.sendMessage({ action: 'unbindAccount' }); } catch (_) {}
  const bound = $('#accountBound'); const unbound = $('#accountUnbound'); const cookieEl = $('#accountCookie');
  if (bound) bound.style.display = 'none';
  if (unbound) unbound.style.display = 'flex';
  if (cookieEl) cookieEl.value = '';
}

// =====================================================================
// 初始化入口
// =====================================================================

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  _S.currentTab = tab;

  const isXhs = tab?.url?.includes('xiaohongshu.com') || tab?.url?.includes('xhs.cn');
  const pageInfo = $('#pageInfo');
  if (pageInfo) {
    pageInfo.textContent = isXhs ? `\u{1F4CD} ${tab.title || '小红书页面'}` : '⚠️ 请切换到小红书页面以使用抓取功能';
  }
  const dot = $('#statusDot') || $('#authorStatusDot');
  if (dot) {
    dot.className = 'dot ' + (isXhs ? 'ok' : 'err');
    const txt = $('#statusText') || $('#authorStatusText');
    if (txt) txt.textContent = isXhs ? '已连接' : '非小红书页面';
  }

  // Tab 绑定
  $$('.tab').forEach(tabEl => {
    tabEl.addEventListener('click', () => switchToTab(tabEl.dataset.tab));
  });

  // 从 background 获取 provider 列表
  try {
    const provRes = await chrome.runtime.sendMessage({ action: 'getProviders' });
    if (provRes && provRes.success) _S._providers = provRes.data;
  } catch (e) { console.warn('[XHS] 获取 Provider 列表失败:', e); }

  // 加载聊天历史
  loadChatHistory();

  // 各模块初始化
  initChat();
  initTools();
  await initCart();
  await initSettings();
});
