/**
 * background.js - 账号管理 + AI API 代理 + 消息路由 + Prompt模板库v2
 * MV3 Service Worker
 */

// 加载 v2 Prompt 模板库（全局变量）
importScripts('prompts-data.js');

let CONFIG = {
  account: null,
  ai: {
    provider: 'minimax',
    endpoint: 'https://api.minimaxi.com/anthropic/v1/messages',
    apiKey: '',
    model: 'MiniMax-M2.7',
    temperature: 0.7,
    maxTokens: 2000
  },
  enabled: true,
  _ready: false
};

// ========== AI Provider 统一配置（单一数据源）==========
// 所有 UI 层（popup / sidepanel）通过 getProviders 消息获取此列表
const PROVIDERS = {
  minimax: {
    name: 'MiniMax',
    endpoint: 'https://api.minimaxi.com/anthropic/v1/messages',
    model: 'MiniMax-M2.7',
    authType: 'api-key',           // X-Api-Key header（Anthropic 兼容）
    apiFormat: 'anthropic',        // Anthropic 消息格式
    placeholder: '输入 MiniMax API Key（sk-cp-...）'
  },
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    authType: 'bearer',
    apiFormat: 'openai',           // OpenAI 兼容格式
    placeholder: '输入 OpenAI API Key（sk-...）'
  },
  kimi: {
    name: 'Kimi（月之暗面）',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    authType: 'bearer',
    apiFormat: 'openai',
    placeholder: '输入 Kimi API Key（sk-...）'
  },
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    authType: 'bearer',
    apiFormat: 'openai',
    placeholder: '输入 DeepSeek API Key'
  },
  siliconflow: {
    name: '硅基流动（SiliconFlow）',
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    authType: 'bearer',
    apiFormat: 'openai',
    placeholder: '输入硅基流动 API Key'
  },
  zhipu: {
    name: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash',
    authType: 'bearer',
    apiFormat: 'openai',
    placeholder: '输入智谱 API Key'
  },
  qwen: {
    name: '通义千问（Qwen）',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-turbo',
    authType: 'bearer',
    apiFormat: 'openai',
    placeholder: '输入通义千问 API Key'
  },
  custom: {
    name: '🔧 自定义 Endpoint',
    endpoint: '',
    model: '',
    authType: 'bearer',
    apiFormat: 'openai',
    placeholder: '手动填写所有字段'
  }
};

// ========== 初始化 ==========
let _initPromise = null;

async function ensureConfig() {
  if (CONFIG._ready) return;
  if (_initPromise) return _initPromise;  // 防止并发初始化
  _initPromise = (async () => {
    try {
      const result = await chrome.storage.local.get(['xhsConfig']);
      if (result.xhsConfig) {
        if (result.xhsConfig.ai) {
          CONFIG.ai = { ...CONFIG.ai, ...result.xhsConfig.ai };
        }
        if (result.xhsConfig.enabled !== undefined) {
          CONFIG.enabled = result.xhsConfig.enabled;
        }
      }
      // 账号凭证从 session 存储加载（浏览器关闭后自动清除）
      const sessionResult = await chrome.storage.session.get(['xhsAccount']);
      if (sessionResult.xhsAccount) {
        CONFIG.account = sessionResult.xhsAccount;
      }
    } catch (e) {
      console.warn('[XHS Tools] 配置加载失败:', e);
    }
    CONFIG._ready = true;
  })();
  return _initPromise;
}

// ========== 保存配置 ==========
// AI 配置存 local（持久），账号凭证存 session（浏览器关闭后清除）
async function saveConfig() {
  await ensureConfig();
  // 分离存储：AI 配置与账号分开
  const { account, ...aiConfig } = CONFIG;
  await chrome.storage.local.set({ xhsConfig: aiConfig });
  if (account) {
    await chrome.storage.session.set({ xhsAccount: account });
  } else {
    await chrome.storage.session.remove('xhsAccount');
  }
}

// ========== 消息处理 ==========
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 确保配置加载完成后再处理消息
  ensureConfig().then(() => {
    handleMessage(request, sender)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
  });
  return true; // 异步响应
});

async function handleMessage({ action, payload }, sender) {
  switch (action) {
    // -------- 账号 --------
    case 'setAccount':
      CONFIG.account = payload;
      await saveConfig();
      return { success: true };

    case 'getAccount':
      return { success: true, data: CONFIG.account };

    case 'clearAccount':
      CONFIG.account = null;
      await saveConfig();
      return { success: true };

    // -------- 绑定账号 --------
    case 'bindAccount': {
      // 1. 读取 cookie
      const cookies = await new Promise(resolve => {
        chrome.cookies.get({
          url: 'https://www.xiaohongshu.com',
          name: 'web_session'
        }, c => resolve(c));
      });
      const a1Cookie = await new Promise(resolve => {
        chrome.cookies.get({
          url: 'https://www.xiaohongshu.com',
          name: 'a1'
        }, c => resolve(c));
      });
      const unreadCookie = await new Promise(resolve => {
        chrome.cookies.get({
          url: 'https://www.xiaohongshu.com',
          name: 'unread_like_count'
        }, c => resolve(c));
      });

      const webSession = cookies?.value || '';
      const a1 = a1Cookie?.value || '';

      if (!webSession && !a1) {
        return { success: false, error: '未检测到登录态，请先在浏览器中登录小红书' };
      }

      // 2. 调用 selfinfo API 获取昵称和头像
      let nickname = '';
      let avatar = '';
      const cookieStr = `web_session=${webSession}; a1=${a1}`.replace(/; a1=$/, '');

      try {
        const resp = await fetch('https://edith.xiaohongshu.com/api/sns/web/v1/user/selfinfo', {
          method: 'GET',
          headers: {
            'Cookie': cookieStr,
            'Referer': 'https://www.xiaohongshu.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        if (resp.status === 401) {
          return { success: false, error: '未检测到登录态，请先在浏览器中登录小红书' };
        }
        const data = await resp.json();
        if (data?.data?.user_info) {
          const ui = data.data.user_info;
          nickname = ui.nickname || '';
          avatar = ui.avatar || '';
        }
      } catch (_) {}

      // 3. 保存
      const account = {
        session: webSession,
        a1: a1,
        nickname: nickname,
        avatar: avatar
      };
      CONFIG.account = account;
      await saveConfig();
      return { success: true, data: account };
    }

    case 'unbindAccount':
      CONFIG.account = null;
      await saveConfig();
      return { success: true };

    // -------- AI --------
    case 'ai-complete':
      return { success: true, data: await aiComplete(payload) };

    case 'setAiConfig':
      CONFIG.ai = { ...CONFIG.ai, ...payload };
      await saveConfig();
      return { success: true };

    case 'getAiConfig':
      return { success: true, data: CONFIG.ai };

    case 'getProviders':
      return { success: true, data: PROVIDERS };

    // -------- 打开侧边栏 --------
    case 'openSidePanel':
      await chrome.tabs.create({ url: 'sidepanel/sidepanel.html', active: true });
      return { success: true };

    // -------- 页面抓取（透传到 content script）--------
    case 'scrape':
    case 'scrapeProfile':
    case 'scrapeComments':
    case 'scrapeNoteList':
    case 'ping': {
      // 从 sender.tab 获取标签页 ID，支持从 sidepanel 或 popup 发起
      const tabId = sender.tab?.id || payload?.tabId;
      if (!tabId) {
        // fallback：查询当前活动标签页
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error('无活动标签页');
        return await chrome.tabs.sendMessage(tab.id, { action, payload });
      }
      return await chrome.tabs.sendMessage(tabId, { action, payload });
    }

    // -------- AI 文案操作 --------
    case 'rewriteText': {
      const text = payload.text;
      if (!text?.trim()) throw new Error('文案内容不能为空');
      return { success: true, data: await aiComplete({ prompt: text, systemPrompt: getRewriteSystem(), mode: 'rewrite' }) };
    }

    case 'analyzeText': {
      const text = payload.text;
      if (!text?.trim()) throw new Error('文案内容不能为空');
      return { success: true, data: await aiComplete({ prompt: text, systemPrompt: getAnalyzeSystem(), mode: 'analyze' }) };
    }

    case 'checkText': {
      const text = payload.text;
      if (!text?.trim()) throw new Error('文案内容不能为空');
      // 先进行本地违禁词检测
      const banResult = typeof checkBannedWords === 'function' ? checkBannedWords(text) : null;
      let banReport = '';
      if (banResult && !banResult.pass) {
        banReport = `\n\n---\n📋 本地违禁词预检结果：\n级别：${banResult.level}级\n命中：${banResult.hits.join('、')}\n${banResult.message}`;
        if (Object.keys(banResult.suggestions).length > 0) {
          banReport += `\n替换建议：${JSON.stringify(banResult.suggestions)}`;
        }
      } else if (banResult && banResult.level === 'C') {
        banReport = `\n\n---\n📋 本地预检：${banResult.message}\n命中词汇：${banResult.hits.join('、')}`;
      }
      // 再用 AI 做深度检测
      const aiResult = await aiComplete({ prompt: text + banReport, systemPrompt: getCheckSystem(), mode: 'check' });
      return { success: true, data: banReport ? aiResult + '\n\n' + banReport : aiResult };
    }

    case 'generateText': {
      const topic = payload.topic;
      if (!topic?.trim()) throw new Error('生成主题不能为空');
      return { success: true, data: await aiComplete({ prompt: topic, systemPrompt: getGenerateSystem(), mode: 'generate' }) };
    }

    // -------- v2 模板生成 --------
    case 'generateWithTemplate': {
      const { templateType, inputs, tone } = payload || {};
      if (!templateType || !inputs) throw new Error('模板类型和输入不能为空');
      const useV2 = typeof buildGenerationPrompt === 'function';
      const { systemPrompt, userPrompt } = useV2
        ? buildGenerationPrompt(templateType, inputs, tone)
        : { systemPrompt: getGenerateSystem(), userPrompt: `主题：${inputs.topic || ''}` };
      return { success: true, data: await aiComplete({ prompt: userPrompt, systemPrompt: systemPrompt, mode: 'generate' }) };
    }

    // -------- 违禁词独立检测 --------
    case 'checkBannedWords': {
      const text = payload.text;
      if (!text?.trim()) throw new Error('文案内容不能为空');
      if (typeof checkBannedWords !== 'function') throw new Error('违禁词检测模块未加载');
      const result = checkBannedWords(text);
      return { success: true, data: result };
    }

    // -------- 获取模板/语气列表（供UI） --------
    case 'getTemplateList': {
      if (typeof getTemplateList !== 'function') return { success: true, data: [] };
      return { success: true, data: getTemplateList() };
    }
    case 'getToneList': {
      if (typeof getToneList !== 'function') return { success: true, data: [] };
      return { success: true, data: getToneList() };
    }
    case 'getTemplateDetail': {
      const tplKey = payload?.key;
      if (!tplKey || !XHS_TEMPLATES || !XHS_TEMPLATES[tplKey]) throw new Error('模板不存在');
      return { success: true, data: XHS_TEMPLATES[tplKey] };
    }

    // -------- 分析车存储 --------
    case 'getCart': {
      const result = await chrome.storage.local.get(['xhsCart']);
      return { success: true, data: result.xhsCart || [] };
    }

    case 'setCart':
      await chrome.storage.local.set({ xhsCart: payload || [] });
      return { success: true };

    case 'addToCart': {
      const result = await chrome.storage.local.get(['xhsCart']);
      const cart = result.xhsCart || [];
      const noteData = payload || {};
      const noteId = noteData.id || noteData.noteId || Date.now().toString();
      // 避免重复
      if (cart.some(n => (n.id || n.noteId) === noteId)) {
        return { success: true, added: false };
      }
      cart.push({
        id: noteId,
        title: noteData.title || '(无标题)',
        author: noteData.author?.name || '',
        likes: noteData.stats?.likes || 0,
        collects: noteData.stats?.collects || 0,
        comments: noteData.stats?.comments || 0,
        content: noteData.content || '',
        tags: noteData.tags || [],
        images: noteData.images || [],
        url: noteData.url || `https://xiaohongshu.com/discovery/item/${noteId}`,
        addedAt: new Date().toLocaleString('zh-CN')
      });
      await chrome.storage.local.set({ xhsCart: cart });
      return { success: true, added: true };
    }

    default:
      return { success: false, error: `未知动作: ${action}` };
  }
}

// ========== System Prompts (v2 增强版) ==========
function getAnalyzeSystem() { return getAnalyzeSystemV2(); }
function getRewriteSystem() { return getRewriteSystemV2(); }
function getCheckSystem()  { return getCheckSystemV2();  }
function getGenerateSystem() { return getGenerateSystemV2(); }

// ========== AI 调用 ==========
async function aiComplete({ prompt, systemPrompt, mode }) {
  if (!CONFIG.ai.apiKey) {
    throw new Error('请先在设置中配置 AI API Key');
  }

  const userMessages = {
    analyze: `分析以下小红书文案，总结其成为爆款的要素：\n\n${prompt}\n\n请从：标题技巧、开头钩子、内容结构、互动引导、情感共鸣、可复用框架 这6个维度分析。`,
    rewrite: `将以下文案改写，去除AI写作痕迹，保留核心信息：\n\n${prompt}\n\n改写要求：语气自然口语化、句子长短交错、保留原意换表达、不用机械结构、不用套话。`,
    check: `检测以下文案中的违禁词和风险表述：\n\n${prompt}\n\n标注：绝对化用语、虚假夸大、敏感话题、医疗违规、金融违规。如果全部合规标注"检测通过"。`,
    generate: `主题：${prompt}\n\n生成3条小红书爆款文案，每条包含：标题 + 正文 + 标签建议。风格真实自然有温度。`
  };

  const userContent = userMessages[mode] || userMessages.rewrite;

  const provider = CONFIG.ai.provider;

  // 使用统一 PROVIDERS 配置获取默认值
  const providerCfg = PROVIDERS[provider] || PROVIDERS['custom'];

  // 自动补全缺失的 https:// 协议头（防止用户编辑时误删）
  function normalizeEndpoint(ep) {
    if (!ep) return null;
    ep = ep.trim();
    if (!ep.startsWith('http://') && !ep.startsWith('https://')) {
      ep = 'https://' + ep;
    }
    return ep;
  }

  let endpoint = normalizeEndpoint(CONFIG.ai.endpoint?.trim())
    ? normalizeEndpoint(CONFIG.ai.endpoint.trim())
    : providerCfg.endpoint || null;

  let model = CONFIG.ai.model?.trim() || providerCfg.model || 'gpt-4o-mini';

  // SiliconFlow：若用户未手动填 endpoint，且 model 不含 /，则自动加 Qwen/ 前缀
  if (provider === 'siliconflow' && !CONFIG.ai.endpoint?.trim() && model && !model.includes('/')) {
    model = 'Qwen/' + model;
  }

  // ========== 带超时和重试的 fetch ==========
  const AI_TIMEOUT_MS = 60000;   // 60秒超时
  const AI_MAX_RETRIES = 2;      // 最多重试2次

  async function fetchWithRetry(url, fetchOpts) {
    let lastError;
    for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
      try {
        const resp = await fetch(url, { ...fetchOpts, signal: controller.signal });
        return resp;
      } catch (err) {
        lastError = err;
        // 仅重试网络错误（超时/DNS/连接），不重试 HTTP 错误
        if (attempt < AI_MAX_RETRIES && (err.name === 'AbortError' || err.name === 'TypeError')) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s
          console.warn(`[XHS Tools] AI 请求失败，${delay}ms 后重试 (${attempt + 1}/${AI_MAX_RETRIES})`, err.message);
          await new Promise(r => setTimeout(r, delay));
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  // ========== Adapter: 构建请求体 ==========
  const apiFormat = providerCfg.apiFormat || 'openai';

  function buildRequestBody() {
    if (apiFormat === 'anthropic') {
      const body = {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: CONFIG.ai.maxTokens || 2000
      };
      if (CONFIG.ai.temperature !== undefined) body.temperature = CONFIG.ai.temperature;
      return body;
    }
    // OpenAI 兼容格式
    return {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_tokens: CONFIG.ai.maxTokens || 2000,
      temperature: CONFIG.ai.temperature ?? 0.7
    };
  }

  function buildHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (apiFormat === 'anthropic') {
      headers['X-Api-Key'] = CONFIG.ai.apiKey;
    } else {
      headers['Authorization'] = `Bearer ${CONFIG.ai.apiKey}`;
    }
    return headers;
  }

  function parseResponse(data) {
    if (apiFormat === 'anthropic') {
      const textBlock = Array.isArray(data.content)
        ? data.content.find(b => b.type === 'text')
        : null;
      return textBlock?.text || null;
    }
    return data.choices?.[0]?.message?.content || null;
  }

  // ========== 发起请求 ==========
  let response;
  let fullUrl = endpoint;
  try {
    response = await fetchWithRetry(fullUrl, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(buildRequestBody())
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`AI 请求超时（${AI_TIMEOUT_MS / 1000}秒），请检查网络或尝试切换模型`);
    }
    if (err.message.includes('Failed to fetch') || err.name === 'TypeError') {
      if (!CONFIG.ai.apiKey) throw new Error('请先在设置中填写 API Key');
      if (!fullUrl || fullUrl.length < 10) throw new Error(`API Endpoint 未填写或格式异常：${fullUrl || '(空)'}`);
      throw new Error(
        `网络请求失败，请检查：\n` +
        `1. 网络连接是否正常\n` +
        `2. 是否使用了公司/校园网络（可能被代理拦截）\n` +
        `3. API Endpoint 是否可访问：${fullUrl}\n` +
        `4. API Key 是否有效`
      );
    }
    throw new Error('网络错误：' + err.message);
  }

  if (!response.ok) {
    let errMsg = `API 错误 ${response.status}`;
    try {
      const errData = await response.json();
      errMsg += '：' + (errData.error?.message || JSON.stringify(errData));
    } catch (_) {
      errMsg += '：' + (await response.text()).slice(0, 200);
    }
    throw new Error(errMsg);
  }

  const data = await response.json();
  const content = parseResponse(data);

  if (!content) {
    const sample = JSON.stringify(data).slice(0, 300);
    throw new Error('AI 返回内容为空，可能 API 余额不足或模型不可用。响应：' + sample);
  }

  // C级词汇自动替换（改写模式 + 生成模式）
  if ((mode === 'rewrite' || mode === 'generate') && typeof autoReplaceCWords === 'function') {
    content = autoReplaceCWords(content);
  }

  return content;
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[XHS Tools] 小红书运营工具箱已安装 v2.3.0');
});

// ========== 键盘快捷键 ==========
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-sidepanel') {
    await chrome.tabs.create({ url: 'sidepanel/sidepanel.html', active: true });
  }
});

// ========== 调试日志（生产可删）==========
function log(...args) {
  console.log('[XHS bg]', ...args);
}
