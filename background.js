/**
 * background.js - 账号管理 + AI API 代理 + 消息路由
 * MV3 Service Worker
 */

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

// ========== 初始化 ==========
async function ensureConfig() {
  if (CONFIG._ready) return;
  try {
    const result = await chrome.storage.local.get(['xhsConfig']);
    if (result.xhsConfig) {
      // 深合并，不覆盖未保存的字段
      if (result.xhsConfig.ai) {
        CONFIG.ai = { ...CONFIG.ai, ...result.xhsConfig.ai };
      }
      if (result.xhsConfig.account !== undefined) {
        CONFIG.account = result.xhsConfig.account;
      }
      if (result.xhsConfig.enabled !== undefined) {
        CONFIG.enabled = result.xhsConfig.enabled;
      }
    }
  } catch (e) {
    console.warn('[XHS Tools] 配置加载失败:', e);
  }
  CONFIG._ready = true;
}

// ========== 保存配置 ==========
async function saveConfig() {
  await ensureConfig();
  await chrome.storage.local.set({ xhsConfig: CONFIG });
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

    // -------- 打开侧边栏 --------
    case 'openSidePanel':
      await chrome.tabs.create({ url: 'sidepanel/sidepanel.html', active: true });
      return { success: true };

    // -------- 页面抓取（透传到 content script）--------
    case 'scrape':
    case 'scrapeProfile':
    case 'scrapeComments':
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
      return { success: true, data: await aiComplete({ prompt: text, systemPrompt: getCheckSystem(), mode: 'check' }) };
    }

    case 'generateText': {
      const topic = payload.topic;
      if (!topic?.trim()) throw new Error('生成主题不能为空');
      return { success: true, data: await aiComplete({ prompt: topic, systemPrompt: getGenerateSystem(), mode: 'generate' }) };
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

// ========== System Prompts ==========
function getAnalyzeSystem() {
  return '你是一位专业的小红书内容分析师，擅长拆解爆款文案的底层逻辑。用emoji标出重点，语言简洁专业。';
}

function getRewriteSystem() {
  return '你是一位资深内容编辑，擅长将AI味明显的文案改写成自然、真实、有温度的人类写作风格。语气自然口语化，有轻微不完美感；句子长短交错；保留原意但换表达；不用"首先...其次...最后"这种机械结构；不用"值得注意的是"这种套话。';
}

function getCheckSystem() {
  return '你是一位内容安全审核专家，检测文案中的违禁词和风险表述，标注清晰，给出修改建议。';
}

function getGenerateSystem() {
  return '你是小红书爆款文案专家。根据主题生成3条高互动文案，每条包含：标题 + 正文 + 标签建议。风格真实自然，有温度。';
}

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

  // 各厂商 endpoint 映射（用户手动填了 endpoint 则优先用用户的）
  const DEFAULT_ENDPOINTS = {
    minimax:    'https://api.minimaxi.com/anthropic/v1/messages',  // Token Plan (Anthropic 兼容)
    kimi:       'https://api.moonshot.cn/v1/chat/completions',
    deepseek:   'https://api.deepseek.com/v1/chat/completions',
    siliconflow:'https://api.siliconflow.cn/v1/chat/completions',
    zhipu:      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    qwen:       'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    openai:     'https://api.openai.com/v1/chat/completions',
    custom:     null  // custom 无默认值，全靠用户填
  };

  // SiliconFlow 模型名格式（endpoint 为空时，后台自动加 Qwen/ 前缀）
  const SILICONFLOW_PREFIX = 'Qwen/';

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
    : DEFAULT_ENDPOINTS[provider];

  let model = CONFIG.ai.model?.trim() || 'gpt-4o-mini';

  // SiliconFlow：若用户未手动填 endpoint，且 model 不含 /，则自动加 Qwen/ 前缀
  if (provider === 'siliconflow' && !CONFIG.ai.endpoint?.trim() && model && !model.includes('/')) {
    model = 'Qwen/' + model;
  }

  let response;
  let fullUrl = endpoint;  // 提前定义，try 和 catch 都要用到
  try {
    // MiniMax Token Plan：Anthropic 兼容格式
    if (provider === 'minimax') {
      const minimaxBody = {
        model: CONFIG.ai.model?.trim() || 'MiniMax-M2.7',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: CONFIG.ai.maxTokens || 2000
      };
      if (CONFIG.ai.temperature !== undefined) {
        minimaxBody.temperature = CONFIG.ai.temperature;
      }
      response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': CONFIG.ai.apiKey
        },
        body: JSON.stringify(minimaxBody)
      });
    } else {
      // 其他厂商：OpenAI 兼容格式
      const body = {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: CONFIG.ai.maxTokens || 2000,
        temperature: CONFIG.ai.temperature ?? 0.7
      };
      response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.ai.apiKey}`
        },
        body: JSON.stringify(body)
      });
    }
  } catch (err) {
    // 细化网络层错误诊断
    if (err.message.includes('Failed to fetch') || err.name === 'TypeError') {
      if (!CONFIG.ai.apiKey) {
        throw new Error('请先在设置中填写 API Key');
      }
      // CORS / 网络 / 代理 问题
      if (!fullUrl || fullUrl.length < 10) {
        throw new Error(`API Endpoint 未填写或格式异常：${fullUrl || '(空)'}`);
      }
      // CORS / 网络 / 代理 问题
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

  // MiniMax Token Plan (Anthropic 兼容) 响应格式
  let content;
  if (provider === 'minimax') {
    // MiniMax content 是数组：{type:"thinking",...} 或 {type:"text",text:"..."}，取 text 类型
    const textBlock = Array.isArray(data.content)
      ? data.content.find(b => b.type === 'text')
      : null;
    content = textBlock?.text || null;
  } else {
    // OpenAI 兼容格式：data.choices[0].message.content
    content = data.choices?.[0]?.message?.content || null;
  }

  if (!content) {
    // 提供更详细的错误信息帮助调试
    const sample = JSON.stringify(data).slice(0, 300);
    throw new Error('AI 返回内容为空，可能 API 余额不足或模型不可用。响应：' + sample);
  }
  return content;
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[XHS Tools] 小红书运营工具箱已安装 v2.1.0');
});

// ========== 调试日志（生产可删）==========
function log(...args) {
  console.log('[XHS bg]', ...args);
}
