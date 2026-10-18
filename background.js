/**
 * background.js - 账号管理 + AI API 代理 + 消息路由 + Prompt模板库v2
 * MV3 Service Worker
 */

// 加载 v2 Prompt 模板库（全局变量）
importScripts('prompts-data.js');

// 授权系统：license.js 是纯逻辑（验签/状态机），license-manager.js 负责存取与计数。
// ⚠️ 加载顺序有依赖 —— manager 用到 license.js 挂出的 XhsLicense，不能颠倒。
importScripts('license.js');
importScripts('license-manager.js');

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
    // 2026-07-24 起 deepseek-chat / deepseek-reasoner 已停用，
    // 2026-09-10 起统一为 deepseek-flash（DeepSeek-V4.1-Flash）。
    // 旧名仍会被路由到 Flash，但按 Flash 价计费且随时可能下线 —— 直接用新名。
    model: 'deepseek-flash',
    authType: 'bearer',
    apiFormat: 'openai',
    // Flash 支持思考模式；数据分析这类任务用 low 足够，省 token
    thinking: { type: 'disabled' },
    reasoningEffort: 'low',
    placeholder: '输入 DeepSeek API Key（sk-...）'
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
  // 本机代理：hermes proxy（`hermes proxy start`）是 OpenAI 兼容的本地服务，
  // 默认 127.0.0.1:8645，接受任意 bearer（它自己注入真实凭证）。
  // ⚠️ 它转发的是「Hermes 背后的云端模型」，**不是 Hermes 这个 agent 本体**。
  //    要真正调用本机 agent（带 tools / AGENTS.md / 记忆），proxy 做不到。
  hermes: {
    name: '本机 Hermes 代理',
    endpoint: 'http://127.0.0.1:8645/v1/chat/completions',
    model: 'hermes',
    authType: 'bearer',
    apiFormat: 'openai',
    placeholder: '默认无需改动；需先 hermes auth add nous，再 hermes proxy start'
  },
  custom: {
    name: '自定义 Endpoint',
    endpoint: '',
    model: '',
    authType: 'bearer',
    apiFormat: 'openai',
    placeholder: '手动填写所有字段'
  }
};

/** 模型名自愈（v2.44.1）：模型名若是**别家服务商的默认型号**（切换服务商
    残留的旧值），换成本家默认型号。
    真实事故：服务商切到 MiniMax 后 model 仍是 deepseek-flash（v2.43.1 之前的
    保存竞态留下的残局），诊断请求带着 DeepSeek 的模型名发给 MiniMax，永远跑不通。
    判据刻意收窄为「恰好等于某一家的默认型号」—— 用户自定义的模型名
    （比如在硅基流动上选 deepseek-ai/DeepSeek-V3）不等于任何一家的默认，
    原样保留。custom / 未知 provider 不动：那里 endpoint 和 model 全是手填的。 */
function healStaleModel(ai) {
  const provider = ai && ai.provider;
  if (!provider || !PROVIDERS[provider] || provider === 'custom') return ai;
  const m = String(ai.model || '').trim();
  if (!m || m === PROVIDERS[provider].model) return ai;
  for (const key of Object.keys(PROVIDERS)) {
    if (key !== provider && key !== 'custom' && PROVIDERS[key].model === m) {
      console.warn(`[XHS] 模型名自愈：${provider} 配了别家默认型号「${m}」→「${PROVIDERS[provider].model}」`);
      return { ...ai, model: PROVIDERS[provider].model };
    }
  }
  return ai;
}

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
        // 模型名自愈：storage 里可能存着「切了服务商但模型名还是旧家默认」的
        // 残局（v2.43.1 保存竞态时代留下的）。不治愈的话，每次请求都带着
        // 别家的模型名打本家的 API。只在内存里治 —— 下次 setAiConfig 自然落盘。
        CONFIG.ai = healStaleModel(CONFIG.ai);
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

// ========== agent 调用白名单 ==========
//
// ⚠️ **这是本扩展唯一的对外安全门。改动这里等于改权限。**
//
// 开放原则：**只开「读」和「触发已有功能」，不开任何「改配置」。**
//   ✗ 明确不开放：setAiConfig / setAiConfig / setCart / upsertTask /
//     deleteTask / saveBenchmarkList / activateLicense / clearLicense
//   理由：agent 调用的目的是替你省事，不是替你做决定。
//     把「改 AI Key」「改定时任务」暴露出去，等于让任何本机脚本
//     都能把你的 API Key 换成它自己的 —— 那就不是助手，是后门。
const AGENT_ACTIONS = new Set([
  // 采集（读页面）
  'scrapeProfile',
  'scrapeNoteList',
  'scrapeCreatorOverview',
  'scrapeCreatorAnalysis',
  'scrapeCreatorNoteIndex',
  'creatorCollect',
  // 读已存下来的数据
  'getCreatorHistory',
  'getNetLog',
  'getAccount',
  'getAiConfig',
  'getLicenseState',
  // 触发已有功能（不改配置）
  'analyzeLatest',
  'getTasks',
  'runTaskNow',
  'getBenchmarkList',
  'ping'
]);

/** 需要 tabId 透传到 content script 的动作。 */
const SCRAPE_ACTIONS = new Set([
  'scrapeProfile',
  'scrapeNoteList',
  'scrapeCreatorOverview',
  'scrapeCreatorAnalysis',
  'scrapeCreatorNoteIndex'
]);

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
        return { success: false, code: 'no-cookie', error: '未检测到登录态，请先在浏览器中登录小红书' };
      }

      // 2. 确认是哪个号 —— **从已打开的小红书页面读 DOM，不调接口**。
      //
      //    ⚠️ 这里原来 fetch('edith.xiaohongshu.com/api/sns/web/v1/user/selfinfo')，
      //    那个接口需要小红书自己的 **x-s / x-t 请求签名**，扩展算不出来，
      //    调用**必然返回 406**。用户看到的是一条红色的「小红书接口返回 406」，
      //    像是绑定失败了 —— 其实 Cookie 已经存好、采集是能用的。
      //
      //    一条永远失败的调用比没有这条调用更糟：它把「已经成功的事」
      //    显示成失败。所以整个 fetch 删掉，改走 content script 读页面。
      //
      //    拿不到昵称**不是失败** —— Cookie 才是采集真正需要的东西，
      //    昵称只是给人看的。界面要说清这个区别，别让人以为绑定没成。
      let nickname = '';
      let avatar = '';
      let verified = false;
      let reason = '';
      let fatal = false;

      try {
        const [xhsTab] = await chrome.tabs.query({ url: ['*://*.xiaohongshu.com/*', '*://*.xhs.cn/*'] });
        if (xhsTab) {
          const me = await chrome.tabs.sendMessage(xhsTab.id, { action: 'scrapeMe' });
          if (me && me.ok && me.data && me.data.nickname) {
            nickname = me.data.nickname;
            avatar = me.data.avatar || '';
            verified = true;
          } else {
            reason = me && me.reason === 'not-on-xhs'
              ? '登录态已保存。打开任意一个小红书页面后点「确认账号」，就能显示账号名'
              : '登录态已保存，但没在这个页面读到账号名（不影响采集）';
          }
        } else {
          reason = '登录态已保存。打开任意一个小红书页面后点「确认账号」，就能显示账号名';
        }
      } catch (err) {
        // 读不到身份不影响绑定本身 —— Cookie 已经拿到了
        reason = '登录态已保存，但没能读到账号名（不影响采集）';
      }

      if (fatal) {
        return { success: false, code: 'expired', error: reason };
      }

      // 3. 保存。verified=false 时仍然存 —— Cookie 本身是真的，
      //    只是没确认出昵称；但会把这个事实原样带回给界面，
      //    由界面说「已保存，但未确认是哪个号」，而不是谎称绑定成功。
      const account = {
        session: webSession,
        a1: a1,
        nickname: nickname,
        avatar: avatar
      };
      CONFIG.account = account;
      await saveConfig();
      return { success: true, data: account, verified: verified, warning: verified ? '' : reason };
    }

    case 'unbindAccount':
      CONFIG.account = null;
      await saveConfig();
      return { success: true };

    // -------- agent 调用（本机脚本经页面中继进来）--------
    // ⚠️ 这是唯一的对外门。**白名单是安全边界，改这里等于改权限。**
    //    刻意只开「读」和「触发已有功能」，**不开任何写配置的**：
    //    setAiConfig / setCart / upsertTask / saveBenchmarkList 一律不开放。
    //    理由：agent 调用的目的是替你省事，不是替你做决定。
    case 'agentRequest': {
      const { id, action, args } = payload || {};
      if (!AGENT_ACTIONS.has(action)) {
        return {
          id,
          ok: false,
          error: `agent 不允许调用 ${action}`,
          allowed: [...AGENT_ACTIONS]
        };
      }
      try {
        // ⚠️ 采集类 action 需要 tabId 才能透传到 content script，
        // 而原路由是从 `sender.tab` 拿的 —— agent 来的请求没有 sender.tab
        // （它经页面中继转发，sender 已经不是那个页面了）。
        //
        // 不能依赖「当前活动标签页」：agent 触发时用户可能正在看别的标签页，
        // 那样会把消息发到一个没有 content script 的页面上，
        // 报出来的是「Could not establish connection」这种没人看得懂的错。
        // 所以显式注入一个小红书标签页。
        let injected = args;
        if (!args?.tabId && SCRAPE_ACTIONS.has(action)) {
          const [tab] = await chrome.tabs.query({ url: ['https://*.xiaohongshu.com/*', 'https://*.xhs.cn/*'] });
          if (!tab) {
            return {
              id,
              ok: false,
              error: '没有打开的小红书页面。采集能力运行在页面里，请先打开创作者中心或任意小红书页面，然后重试。'
            };
          }
          injected = { ...args, tabId: tab.id };
        }

        // 直接复用扩展自己的路由，而不是复制一份逻辑 ——
        // 复制会出现「agent 走的和用户点的行为不一致」这种最难查的 bug。
        const res = await handleMessage({ action, payload: injected }, {});
        return { id, ok: true, data: res };
      } catch (e) {
        // ⚠️ 错误必须原样带出去。agent 需要区分
        // 「没开页面」「平台改版了」「授权过期」—— 三者要采取完全不同的动作。
        return { id, ok: false, error: e.message };
      }
    }

    // -------- 授权（阶段零：邀请码激活）--------
    case 'getLicenseState':
      return { success: true, data: await getLicenseState() };

    case 'activateLicense':
      return activateLicense(payload?.code);

    case 'clearLicense':
      return clearLicense();

    // -------- AI --------
    case 'ai-complete':
      return { success: true, data: await aiComplete(payload) };

    case 'setAiConfig':
      // ⚠️ 必须先等 ensureConfig 完成**再**合并：曾经直接改 CONFIG.ai，
      //    冷启动时 ensureConfig 的异步读随后完成，用 storage 旧值
      //    把刚合并的新服务商覆盖回去（合并方向 stored 在后）——
      //    用户怎么切换服务商都「绑定死」。改完再走 saveConfig。
      await ensureConfig();
      // 合并后自愈再落盘：UI 联动只在「重新选一次服务商」时触发，
      // 残局（provider 换了、model 还是旧家默认）会从这里被永久纠正。
      CONFIG.ai = healStaleModel({ ...CONFIG.ai, ...payload });
      await saveConfig();
      return { success: true, data: CONFIG.ai };

    case 'getAiConfig':
      // ⚠️ 同一个坑的读侧：不等 ensureConfig，冷启动时设置面板
      //    回填的是默认值而不是用户存的配置。
      await ensureConfig();
      return { success: true, data: CONFIG.ai };

    case 'getProviders':
      return { success: true, data: PROVIDERS };

    // -------- 打开侧边栏 --------
    // ⚠️ 这里**不能**用 chrome.tabs.create —— 那是在标签页里开，
    //    会退回「内容被 720px 卡在正中 + 切走就没」的老形态。
    //    chrome.sidePanel.open() 受用户手势约束，只能从点击链路调。
    case 'openSidePanel':
      return openSidePanelNow();

    // -------- 页面抓取（透传到 content script）--------
    case 'scrape':
    case 'scrapeProfile':
    case 'scrapeComments':
    case 'scrapeNoteList':
    case 'scrapeCreatorOverview':
    case 'scrapeCreatorAnalysis':
    case 'scrapeCreatorNoteIndex':
    case 'creatorNextPage':
    case 'creatorGoto':
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

    /* -------- 采集诊断（一键取证）--------
       复用 openCreatorTab：它已经处理了「开标签页 + 等 content script 握手」，
       那是采集链路里唯一被真实验证过的一段。侧栏自己重写一遍只会再出一次
       「拿不到 tab.id」这类问题。 */
    case 'creatorDiag': {
      const tab = await openCreatorTab(CREATOR_ANALYSIS_URL);
      const r = await sendToTab(tab.id, 'creatorDiag');
      if (!r || !r.success) {
        return { success: false, error: (r && r.error) || '页面脚本没响应' };
      }
      return { success: true, data: r.diag };
    }

    // -------- 创作者中心完整采集（自动翻页，后台标签页执行）--------
    case 'creatorCollect':
      return await collectCreatorData({
        maxPages: payload?.maxPages || COLLECT_MAX_PAGES,
        withNoteIndex: payload?.withNoteIndex !== false
      });

    // -------- 采集历史 ----------
    case 'getCreatorHistory':
      return await getCreatorHistory();
    case 'exportHistoryCsv':
      return await exportHistoryCsv();
    case 'clearCreatorHistory':
      await chrome.storage.local.set({ xhsCreatorHistory: [] });
      return { success: true };

    // -------- 网页监听 --------
    case 'netCapture':
      await pushNetLog(payload);
      return { success: true };
    case 'getNetLog':
      return await getNetLog(payload?.filter);
    case 'clearNetLog':
      await chrome.storage.local.set({ [NET_LOG_KEY]: [] });
      return { success: true };

    // -------- AI 分析（创作者数据）--------
    case 'getAnalysisHistory':
      return await getAnalysisHistory();
    case 'analyzeLatest': {
      const { data: hist } = await getCreatorHistory();
      if (!hist.length) throw new Error('还没有采集数据，请先执行「一键采集」');
      const r = await runAutoAnalysis(hist[hist.length - 1]);
      return { success: true, data: r };
    }
    /* -------- 内容计划（今天发什么 + 7 天排期）--------
       单独一个读取动作，而不是让侧边栏去翻分析历史：
       计划有自己的生命周期（可以勾掉某天、可以单独重算），
       和「一次分析结果」不是一回事。 */
    case 'getPlan': {
      const { [PLAN_KEY]: plan } = await chrome.storage.local.get([PLAN_KEY]);
      return { success: true, data: plan || null };
    }
    /* 勾掉某天。只允许改 done 这一个字段 ——
       用户点一下「今天发完了」，不该有能力把 basis 改成 'data' 蒙混过去。 */
    case 'markPlanDay': {
      const { [PLAN_KEY]: plan } = await chrome.storage.local.get([PLAN_KEY]);
      if (!plan || !Array.isArray(plan.schedule)) return { success: false, error: '还没有计划' };
      const day = Number(payload?.day);
      const item = plan.schedule.find(d => d.day === day);
      if (!item) return { success: false, error: `计划里没有第 ${day} 天` };
      item.done = !!payload?.done;
      item.doneAt = item.done ? new Date().toISOString() : null;
      await chrome.storage.local.set({ [PLAN_KEY]: plan });
      return { success: true, data: plan };
    }
    /* 选题闭环第一段：把一条 AI 诊断建议追加进排期。
       只加不改 —— 不覆盖已有条目、不动 basis（markPlanDay 那条
       「用户不许改 basis」的纪律，对新入口同样生效）。
       查重靠 topic 精确匹配：同一条建议点两次只入一次。 */
    case 'appendPlanItem': {
      const { [PLAN_KEY]: plan } = await chrome.storage.local.get([PLAN_KEY]);
      if (!plan || !Array.isArray(plan.schedule)) {
        return { success: false, error: '还没有计划 —— 先完成一次采集和 AI 分析' };
      }
      const topic = String(payload?.topic || '').trim();
      if (!topic) return { success: false, error: '建议内容为空' };
      if (scheduleHasTopic(plan.schedule, topic)) {
        return { success: true, data: { duplicate: true, plan } };
      }
      if (plan.schedule.length >= 20) {
        return { success: false, error: '排期已满（20 条）—— 先到「今天」页发完勾掉几条' };
      }
      plan.schedule.push({
        day: choosePlanDay(plan.schedule),
        genre: '诊断建议',
        topic: topic.slice(0, 60),
        done: false
      });
      plan.schedule.sort((a, b) => a.day - b.day);
      await chrome.storage.local.set({ [PLAN_KEY]: plan });
      return { success: true, data: { plan } };
    }

    // -------- 对标账号批量监控 --------
    case 'benchmarkScan':
      return await benchmarkScan(payload?.urls || []);
    case 'getBenchmarkList':
      return await getBenchmarkList();
    case 'saveBenchmarkList':
      await saveBenchmarkList(payload?.urls || []);
      return { success: true };
    case 'getBenchmarkHistory':
      return await getBenchmarkHistory();

    // -------- 定时任务列表 --------
    case 'getTasks':
      return await getTasks();
    case 'upsertTask':
      await upsertTask(payload);
      return { success: true };
    case 'deleteTask':
      await deleteTask(payload?.id);
      return { success: true };
    case 'runTaskNow':
      return await runTaskById(payload?.id);

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
        banReport = `\n\n---\n本地违禁词预检结果：\n级别：${banResult.level}级\n命中：${banResult.hits.join('、')}\n${banResult.message}`;
        if (Object.keys(banResult.suggestions).length > 0) {
          banReport += `\n替换建议：${JSON.stringify(banResult.suggestions)}`;
        }
      } else if (banResult && banResult.level === 'C') {
        banReport = `\n\n---\n本地预检：${banResult.message}\n命中词汇：${banResult.hits.join('、')}`;
      }
      // 再用 AI 做深度检测
      const aiResult = await aiComplete({ prompt: text + banReport, systemPrompt: getCheckSystem(), mode: 'check' });
      return { success: true, data: banReport ? aiResult + '\n\n' + banReport : aiResult };
    }

    /* 模板表单「AI 帮我填」。
       用户抱怨「为什么还是需要人工来填写」—— 模板页有 5~7 个字段，
       让他一个个敲，AI 的价值就只剩最后那一下生成了。

       这里把**账号上下文 + 今天的选题方向**一起给模型，让它按字段逐项填。
       规则和对话接地一致：只能依据给到的信息填，
       缺什么就在那一项写「需要你补充：…」，**不许编**。 */
    case 'fillTemplate': {
      const fields = Array.isArray(payload?.fields) ? payload.fields : [];
      if (!fields.length) throw new Error('没有要填的字段');
      const topic = String(payload?.topicSeed || '').trim();
      const ctx = String(payload?.context || '').trim();
      /* ⚠️ 这里原来把 topicSeed 当成**硬前提**，没有就直接抛错。
         结果：数据明明采到了，只因样本不足导致 todayPick 为空、
         topicSeed 是空串，模板页就拒绝预填 —— 用户看到的是
         「明明有数据，AI 却什么都不填」。
         **一个中间字段为空，不该让整条链路停摆。**
         现在：只要有账号上下文就让模型自己出选题，一个字段都不硬缺。 */
      if (!topic && !ctx) {
        throw new Error('还没有任何账号数据 —— 先在「今天」页采集一次，这里就能自动预填');
      }

      const fieldLines = fields
        .map(f => `- ${f.key}｜${f.label}（示例：${f.placeholder || '无'}）`)
        .join('\n');

      const system = `你在为一位小红书创作者预填文案模板。
给定这个账号的真实数据背景${topic ? '和本次选题方向' : ''}，为每个字段写一句**具体、可直接用**的内容。

铁律：
1. 只用下面给到的信息。信息不够的字段，值写成「需要你补充：<缺什么>」，**不要编**。
2. ${topic
      ? '选题方向已给定，按它展开。'
      : '**没有给定选题方向** —— 你要依据账号历史数据里表现最好的那几篇，'
        + '反推出一个此刻值得发的选题，并把结论写进第一个字段。'}
3. 不要写"示例""XXX""待填"这类占位词。
4. 每项控制在 40 字以内，口语化，不要营销腔。
5. 严格输出 JSON，形如 {"field_key": "值"}，不要 markdown 代码块。`;

      const prompt = `## 账号背景
${ctx || '（没有账号数据可参考，按通用写法填，缺信息的地方标注需要补充）'}

## 本次选题方向
${topic || '（未给定 —— 请依据上面的账号数据自行判断，优先延续表现最好的内容方向）'}

## 要填的字段
${fieldLines}`;

      const raw = await aiComplete({ prompt, systemPrompt: system, mode: 'generate' });
      let filled = {};
      try {
        const s = String(raw).trim().replace(/^```(?:json)?\s*([\s\S]*?)```$/, '$1');
        const start = s.indexOf('{'), end = s.lastIndexOf('}');
        if (start >= 0 && end > start) filled = JSON.parse(s.slice(start, end + 1));
      } catch (e) {
        return { success: false, error: '模型返回的不是合法 JSON，请重试一次' };
      }
      if (!filled || typeof filled !== 'object' || !Object.keys(filled).length) {
        return { success: false, error: '模型没有填出任何内容，请重试一次' };
      }
      return { success: true, data: filled };
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

    case 'clearCart': {
      await chrome.storage.local.set({ xhsCart: [] });
      return { success: true };
    }

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

    case 'sendToQihao': {
      // 把整个 xhsCart 推送到「品牌自媒体搭建」demo 后端
      const r = await chrome.storage.local.get(['xhsCart']);
      const cart = r.xhsCart || [];
      if (cart.length === 0) {
        return { success: false, error: '分析车为空，请先在笔记页点「加入分析车」收集笔记' };
      }
      // 映射字段：stats → likes/collects/comments（与 demo 后端契约对齐）
      const items = cart.map(n => ({
        id: n.id || n.noteId,
        title: n.title,
        author: n.author,
        likes: n.likes || n.stats?.likes || 0,
        collects: n.collects || n.stats?.collects || 0,
        comments: n.comments || n.stats?.comments || 0,
        content: n.content || '',
        tags: n.tags || [],
        url: n.url,
      }));
      try {
        const resp = await fetch('http://127.0.0.1:8123/api/competitors/from-extension', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, workspace_id: 'ws-default' })
        });
        const data = await resp.json();
        return { success: resp.ok, imported: data.imported, skipped: data.skipped, total: items.length, competitors: data.competitors };
      } catch (e) {
        return { success: false, error: '无法连接 demo 后端（127.0.0.1:8123）— 请先启动 python -m uvicorn app.main:app --port 8123' };
      }
    }

    default:
      return { success: false, error: `未知动作: ${action}` };
  }
}

// ========== System Prompts (v2 增强版) ==========
/* ============================================================
   对话接地（grounding）
   ============================================================
   侧栏在用户提问前面会拼一段【我的账号数据】摘要（见 sidepanel/context.js）。
   没有这段准则，模型会做两件我们最不想要的事：
     ① 拿着泛泛的运营知识硬答，像是真的在分析这个账号
     ② 把摘要里「非基于你的数据」那条限定丢掉，说成是给用户量身定制的结论

   所以这段话是**契约**，不是润色。删掉它，摘要就只是塞在用户那一轮里的一段
   没有说明来历的文字。
   ============================================================ */
function chatGrounding() {
  return `
【关于你手上的数据】
用户的问题前面可能跟着一段【我的账号数据】摘要，由扩展从本机存储里读出。
- 摘要里有，就**只依据摘要作答**，并引用其中的具体数字。
- 摘要为空、或缺少账号定位与目标时，**先问再答**：
  问清楚他做什么品类、想涨什么（粉丝/曝光/转化）、现在卡在哪。
  不要在没有这些信息时给通用建议还说得像在分析他的账号。
- **绝不编造摘要里没有的数字。** 需要某个数而摘要里没有，就说"这项数据我没有，
  采集一次就能拿到"，不要估、不要用行业均值顶替。
- 摘要若标注"非基于你的数据"，你必须在回答里**保留这个限定**，
  并且不能说成是针对他账号定制的结论。
- 不要复述摘要本身。它是事实底座，不是要说给用户听的内容。`;
}

function getAnalyzeSystem() { return chatGrounding() + '\n' + getAnalyzeSystemV2(); }
function getRewriteSystem() { return chatGrounding() + '\n' + getRewriteSystemV2(); }
function getCheckSystem()  { return chatGrounding() + '\n' + getCheckSystemV2();  }
function getGenerateSystem() { return chatGrounding() + '\n' + getGenerateSystemV2(); }

// ========== AI 调用 ==========
async function aiComplete({ prompt, systemPrompt, mode }) {
  // ---- 额度门控（先于 API Key 检查）----
  // 顺序是有意的：额度用尽时用户看到「今天用完了」，
  // 而不是被先问「你配 Key 了吗」——后者会让人以为是自己的配置问题。
  //
  // ⚠️ 只拦 AI，**不拦任何本地功能**。采集、历史、导出全部照常
  //    （设计文档 2.4：把额度用完和订阅欠费混为一谈，是最容易引发愤怒的做法）。
  const license = await getLicenseState();
  if (!license.aiAllowed) {
    const err = new Error(
      license.state === XhsLicense.STATES.EXPIRED
        ? '授权已到期，请重新激活'
        : license.state === XhsLicense.STATES.UNACTIVATED
          ? '请先在设置中激活内测授权'
          : `今日 AI 额度已用完（${license.aiUsedToday}/${license.aiLimitToday}），明天 0 点重置`
    );
    err.code = 'AI_QUOTA_EXCEEDED';
    throw err;
  }

  if (!CONFIG.ai.apiKey) {
    throw new Error('请先在设置中配置 AI API Key');
  }

  const userMessages = {
    analyze: `分析以下小红书文案，总结其成为爆款的要素：\n\n${prompt}\n\n请从：标题技巧、开头钩子、内容结构、互动引导、情感共鸣、可复用框架 这6个维度分析。`,
    rewrite: `将以下文案改写，去除AI写作痕迹，保留核心信息：\n\n${prompt}\n\n改写要求：语气自然口语化、句子长短交错、保留原意换表达、不用机械结构、不用套话。`,
    check: `检测以下文案中的违禁词和风险表述：\n\n${prompt}\n\n标注：绝对化用语、虚假夸大、敏感话题、医疗违规、金融违规。如果全部合规标注"检测通过"。`,
    generate: `主题：${prompt}\n\n生成3条小红书爆款文案，每条包含：标题 + 正文 + 标签建议。风格真实自然有温度。`
  };

  // 未知模式显式报错，不许静默回退 —— 曾用 `|| userMessages.rewrite` 兜底，
  // 新模式忘了加表项就会拿着改写提示词跑，用户只觉得「结果不对」，查不到原因。
  // （vision 目前没有实现路径：aiComplete 不收图片参数，真要支持得先补管线。）
  const userContent = userMessages[mode];
  if (!userContent) {
    throw new Error(`未知的 AI 模式：${mode}（可用：${Object.keys(userMessages).join('/')}）`);
  }

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
  // ⚠️ 必须是 let：rewrite/generate 模式在拿到结果后还要过 autoReplaceCWords
  //    再赋值。曾写成 const，所有改写/生成调用在模型返回后必抛
  //    "TypeError: Assignment to constant variable" —— node --check 查不出，
  //    因为它是运行时语义错误不是语法错误。
  let content = parseResponse(data);

  if (!content) {
    const sample = JSON.stringify(data).slice(0, 300);
    throw new Error('AI 返回内容为空，可能 API 余额不足或模型不可用。响应：' + sample);
  }

  // C级词汇自动替换（改写模式 + 生成模式）
  if ((mode === 'rewrite' || mode === 'generate') && typeof autoReplaceCWords === 'function') {
    content = autoReplaceCWords(content);
  }

  // ---- 记账：只在真正拿到内容之后记 ----
  // 失败与超时不记 —— 否则用户网络一差就被扣额度，
  // 而他什么都没拿到。那是最容易招致差评的一种设计。
  // 视觉类请求单独计数（视觉额度是专业席的分界，见设计文档 2.1）。
  try {
    await recordAiUsage(mode === 'vision' ? 'vision' : 'text');
  } catch (e) {
    // 记账失败**不能**影响本次 AI 结果 —— 用户已经拿到东西了
    console.warn('[XHS License] 记账失败：', e);
  }

  return content;
}

// =====================================================================
// 创作者中心采集编排
// ---------------------------------------------------------------------
// 移植自 RPA 采集方案（xhs-note-analytics.py）。关键差异：
//  · 不再依赖 kimi-webbridge daemon —— 扩展自己的 content script 就是采集器
//  · 在后台标签页（active:false）执行，不打断用户当前页面
//  · 自动翻页取全量（内容分析页每页 10 条，账号常超一页）
//  · 顺带解决 RPA 遗留的两个开放问题：翻页、noteId 映射
// =====================================================================

const CREATOR_ANALYSIS_URL = 'https://creator.xiaohongshu.com/statistics/data-analysis';
const CREATOR_HOME_URL = 'https://creator.xiaohongshu.com/new/home';
const CREATOR_MANAGE_URL = 'https://creator.xiaohongshu.com/new/note-manager';
const CREATOR_HISTORY_KEY = 'xhsCreatorHistory';
/**
 * 历史上限：30 → 90（约三个月）。
 *
 * 为什么涨：30 天只够看「最近有点变化」，画不出**趋势** ——
 * 而「看得出成长」正是用户要这个工具的理由。每天采一次却只看当天，
 * 等于采了不用。90 条至少能画出一条有意义的曲线。
 *
 * 代价：每条含完整逐篇明细（含 url），单条几十 KB。90 条会顶到
 * storage.local 的默认配额，所以 manifest 加了 `unlimitedStorage`。
 * 写盘完整性由 pushCreatorHistory 的回读校验兜住。
 */
const CREATOR_HISTORY_MAX = 90;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function sendToTab(tabId, action, payload) {
  return chrome.tabs.sendMessage(tabId, { action, payload });
}

/** 打开后台标签页并等待 content script 握手 */
async function openCreatorTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const r = await sendToTab(tab.id, 'ping');
      if (r && r.success) return tab;
    } catch (_) {}
    await sleep(600);
  }
  return tab;   // 返回但由调用方通过后续探测判断失败
}

/**
 * 把内容分析页的笔记行，与管理页抓到的 noteId 索引对上。
 *
 * 两侧没有共同的 id：分析页表格只有标题，索引只有锚文本 + href。
 * 所以按文本三级容错匹配，并对每条索引只认领一次（避免重复标题全指到同一篇）。
 * 匹配不上的保持原样、不补 noteId —— 宁可缺一条，也不要给一个可能是错的链接。
 */
function joinNoteIndex(notes, index) {
  if (!Array.isArray(index) || !index.length) {
    if (notes.length) {
      console.warn('[XHS bg] noteIndex 为空：内容分析页表格里没抓到任何笔记链接，'
        + notes.length + ' 条笔记都不会有 noteId。'
        + '（常见原因：小红书改版把标题单元格改成了纯文本，不再是 <a>）');
    }
    return notes;
  }
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const pool = index.map(it => ({ ...it, _label: norm(it.label), _used: false }));
  let byRow = 0;
  let byText = 0;

  const claim = (title) => {
    const t = norm(title);
    if (!t) return null;
    let found = pool.find(p => !p._used && p._label === t);
    if (!found) found = pool.find(p => !p._used && p._label && (p._label.startsWith(t) || t.startsWith(p._label)));
    if (!found) found = pool.find(p => !p._used && p._label && (p._label.includes(t) || t.includes(p._label)));
    if (!found) return null;
    found._used = true;
    return found;
  };

  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    /* 优先按行号：表格行序是确定性的，标题可能截断/改版变形，
       行号不会。比任何文本相似度都可靠。 */
    let m = pool.find(p => !p._used && p.row === i);
    if (m) { m._used = true; byRow++; }
    else {
      m = claim(n.title);
      if (m) byText++;
    }
    if (!m) continue;
    n.noteId = m.noteId;
    n.noteHref = m.href || `https://www.xiaohongshu.com/explore/${m.noteId}`;
  }
  const total = notes.length;
  const hit = byRow + byText;
  /* 命中率本身就是诊断信号。以前只打 info 一行就过去了，
     而「3/40 命中」和「40/40 命中」在界面上长得一模一样 ——
     用户看到的是空 noteId 链接，却不知道是采集没抓到还是匹配算法不行。 */
  const rate = total ? Math.round((hit / total) * 100) : 0;
  if (hit < total) {
    console.warn(`[XHS bg] noteId 关联 ${hit}/${total}（${rate}%）：`
      + `按行号 ${byRow}，按标题 ${byText}，未命中 ${total - hit}。`
      + `未命中的笔记不会有 noteId，「加入分析车」等依赖它的功能会失效。`);
  } else {
    console.info(`[XHS bg] noteId 关联 ${hit}/${total}（100%）：`
      + `按行号 ${byRow}，按标题 ${byText}`);
  }
  return notes;
}

/**
 * 采集页数上限。
 *
 * ⚠️ 原来是 5（即最多 50 篇）。但分页修好之后，这个数字就成了**真正的天花板** ——
 *    超过 50 篇的账号会被静默截断，而用户以为全采到了。
 *    提到 50 页（= 500 篇），对绝大多数账号已经等于「全量」；
 *    真超了这个数，readPager 返回的 totalPages 会兜住，界面会显示真实条数。
 */
const COLLECT_MAX_PAGES = 50;

/** web_session 是登录态的唯一指纹。绑定时存过一份，
    采集时再读一次做比对 —— 两个不一样 = 当前登录的已经不是绑定那个号。
    这比抓 DOM 昵称可靠：昵称选择器会随页面改版失效，cookie 不会。 */
function readWebSessionCookie() {
  return new Promise(resolve => {
    chrome.cookies.get({ url: 'https://www.xiaohongshu.com', name: 'web_session' }, c => resolve(c ? c.value : ''));
  });
}

async function collectCreatorData({ maxPages = COLLECT_MAX_PAGES, withNoteIndex = true } = {}) {
  const tab = await openCreatorTab(CREATOR_ANALYSIS_URL);
  const notes = [];
  let overview = null;
  let noteIndex = [];
  let pager = null;

  try {
    // 首屏渲染等待
    await sleep(2500);

    let page = await sendToTab(tab.id, 'scrapeCreatorAnalysis');
    if (!page || !page.success) {
      if (page && page.error === 'NOT_LOGGED_IN') {
        throw new Error('创作者中心未登录：请在 Chrome 中登录 creator.xiaohongshu.com 后重试');
      }
      if (page && /当前不是创作者中心/.test(page.error || '')) {
        throw new Error('创作者中心页面未就绪（content script 未注入），请刷新该页面后重试');
      }
      throw new Error('内容分析页读取失败：' + ((page && page.error) || '未知原因'));
    }

    pager = page.pager || null;
    notes.push(...page.notes);

    /* ---------- 自动翻页：不依赖任何解析，一直点到点不动 ----------
     *
     * ⚠️⚠️ 这里原来写的是：
     *     const totalPages = pager?.totalPages || 1;
     *     for (let i = 1; i < Math.min(totalPages, maxPages); i++) { … }
     *
     * 那个写法有一个致命耦合：**只要 totalPages 解析错（哪怕只错成 0 或 1），
     * 整个翻页循环一次都不进**，用户拿到 10 条却毫无提示。
     *
     * 而 totalPages 是从页面文案正则推出来的 —— 平台一改文案、
     * 用全角逗号、空格数不同，全都读不到。
     * 实测就是这样：用户 16 条 2 页，采集只拿到 10 条，
     * 而且界面上**完全看不出是分页没生效**。
     *
     * 改成**不解析也能采全**：一页一页往下点，
     * 判据是「表格首行内容变了 = 真的换页了」，
     * 变了就采，没变（点了没反应 / 到最后一页）就停。
     *
     * 这样只要「下一页」按钮能点，采全就是必然的 ——
     * 不再依赖任何文案、类名、总页数的正确性。
     * pager 只作为**上限参考**（若读到了可信的总条数），
     * 读不到就按 maxPages 兜底。
     */
    const declaredPages = pager?.totalPages || 0;
    const hardCap = Math.max(maxPages, 1);
    let pageNo = 1;
    let firstKey = page.notes.map(n => n.title).join('|');
    const pageTrace = [{ page: 1, got: page.notes.length, note: '首屏' }];

    while (pageNo < hardCap) {
      const nx = await sendToTab(tab.id, 'creatorNextPage');
      if (!nx || !nx.success) {
        pageTrace.push({
          page: pageNo + 1, got: 0,
          // 把错误码翻成人话，界面上直接能看懂
          note: '翻页按钮点不动：' + ({
            NO_PAGER_AT_ALL: '页面上找不到任何分页控件',
            NO_NEXT_BUTTON: '找到分页容器但点不到下一页',
            LAST_PAGE: '已经是最后一页',
            NOT_LOGGED_IN: '未登录',
            NO_CONTENT_SCRIPT: '内容脚本没注入',
            // v2.37.5：这是**真错误**，不是「采完了」。
            // 分页键找到了、也点过了，但内容死活不变 ——
            // 以前这种情况会被当成「已到最后一页」而静默停在 10 条。
            CLICK_NO_EFFECT: '分页键点了但页面没反应（不是已到最后一页）',
            // v2.37.10：分页键没用之后，又试了滚动加载（很多表格滚到底就加载下一页）
            SCROLL_NO_EFFECT: '分页键没反应，滚动加载也没反应'
          }[nx && nx.error] || (nx && nx.error) || '未知')
          + (nx && nx.候选 && nx.候选.length
              ? '｜候选：' + nx.候选.map(c => (c.via || '') + '=' + (c.result || '')).join('；')
              : '')
          + (nx && nx.hint ? '｜' + nx.hint : '')
        });
        break;
      }
      await sleep(2000);
      const next = await sendToTab(tab.id, 'scrapeCreatorAnalysis');
      if (!next || !next.success) {
        pageTrace.push({ page: pageNo + 1, got: 0, note: '翻页后读取失败：' + ((next && next.error) || '未知') });
        break;
      }
      if (next.notes.length === 0) {
        pageTrace.push({ page: pageNo + 1, got: 0, note: '翻页后没有任何数据（到最后一页）' });
        break;
      }

      // ⭐ 判据：**内容没变 = 没换页**，说明已经到最后一页了。
      //    这比「信任 totalPages」可靠得多 —— 它只看实际发生的事。
      const key = next.notes.map(n => n.title).join('|');
      if (key === firstKey) {
        pageTrace.push({ page: pageNo + 1, got: next.notes.length, note: '内容与上一页完全相同 → 已到最后一页' });
        break;
      }
      // 整页数据都见过 → 也是最后一页（下一页可能只是循环回来）
      const seen = new Set(notes.map(n => n.title));
      const fresh = next.notes.filter(n => !seen.has(n.title));
      if (fresh.length === 0) {
        pageTrace.push({ page: pageNo + 1, got: 0, note: '这一页的笔记全都采过了 → 停止' });
        break;
      }

      firstKey = key;
      pageNo += 1;
      notes.push(...fresh);
      pageTrace.push({ page: pageNo, got: fresh.length, note: '新增 ' + fresh.length + ' 条' });
      pager = next.pager || pager;
    }

    pager = pager || {};
    pager.pageTrace = pageTrace;
    pager.pagesCollected = pageNo;
    pager.declaredTotalPages = declaredPages;
    // ⚠️ 声明的总页数与实采页数不一致时**说清楚**，而不是静默少采。
    if (declaredPages && declaredPages > pageNo) {
      pager.mismatch = `页面声明共 ${declaredPages} 页，实际只采到 ${pageNo} 页`;
      console.warn('[XHS bg] 分页不一致：' + pager.mismatch);
    }

    // noteId 映射（RPA 遗留开放问题：内容分析页不含 noteId）
    if (withNoteIndex) {
      try {
        await sendToTab(tab.id, 'creatorGoto', { kind: 'manage' });
        await sleep(2500);
        const idx = await sendToTab(tab.id, 'scrapeCreatorNoteIndex');
        if (idx && idx.success) noteIndex = idx.items || [];
      } catch (_) {
        noteIndex = [];   // 失败不阻断主流程
      }
    }
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }

  if (!notes.length) throw new Error('未解析到任何笔记行（页面可能改版或未渲染完成）');

  // 把 noteId 映射 join 回笔记行。
  // 之前 noteIndex 只是被塞进 record 里的一个没人读的数组 —— 采到了却用不上，
  // 等于白采。join 之后每条笔记带上 noteId / href，表格标题就能直接点开原笔记。
  // 匹配用三级容错：完全相等 → 互为前缀 → 互相包含；都对不上就留空，
  // 不硬凑 —— 猜错一个 noteId 比不给更糟。
  const joined = joinNoteIndex(notes, noteIndex);

  // 账号总览：单开一次首页读（内容分析页没有关注/粉丝数）
  // 注意：这里的 catch 只能兜网络/解析异常。URL 常量若写错会抛 ReferenceError
  // 并被静默吞掉，表现为「总览恒为 null」而不报错 —— 所以常量必须在文件头声明。
  let hTab = null;
  // --- 账号戳记（v2.44.0）：这份记录到底采的是谁的号 ---
  // 背景：2026-10-13 用户反馈「样本抽到其他账号」。数据其实来自当前登录的号，
  // 但记录里没有任何账号标识，用户无从核对；若真换了登录，也不会有任何提示。
  // ① web_session 指纹比对（可靠）：绑定与采集两次读取不一致 → mismatch；
  // ② 昵称尽力读：创作者首页 DOM 读得到就带上，读不到不拦采集。
  let accountName = '';
  let accountMismatch = '';
  try {
    const bound = CONFIG.account || null;
    const sess = await readWebSessionCookie();
    if (bound && bound.session && sess && sess !== bound.session) {
      // 不一致时 bound.nickname 反而是「别人的名字」，不能当本次采集账号展示，
      // 只放进 mismatch 让界面把两个名字都摆出来。
      accountMismatch = bound.nickname || '绑定号（未读到昵称）';
    } else if (bound && bound.nickname) {
      accountName = bound.nickname;
    }
  } catch (_) { /* cookie 读不到不影响采集，只是少了比对 */ }
  try {
    hTab = await openCreatorTab(CREATOR_HOME_URL);
    await sleep(2500);
    // 页面上实测到的昵称优先于 cookie 推断的名字
    try {
      const me = await sendToTab(hTab.id, 'scrapeMe');
      if (me && me.ok && me.data && me.data.nickname) accountName = me.data.nickname.trim();
    } catch (_) { /* 读不到昵称不拦 */ }
    const ov = await sendToTab(hTab.id, 'scrapeCreatorOverview');
    if (ov && ov.success) overview = { account: ov.account, metrics: ov.metrics };
  } catch (err) {
    overview = null;
    console.warn('[XHS bg] 账号总览采集失败（不影响单篇数据）：' + (err.message || err));
  } finally {
    if (hTab) chrome.tabs.remove(hTab.id).catch(() => {});
  }

  const record = {
    id: Date.now(),
    capturedAt: new Date().toISOString(),
    source: '小红书运营工具箱 · 创作者中心采集',
    // 账号戳记：account=本次实测昵称（读不到为空串）；accountMismatch 非空 =
    // web_session 指纹与绑定时不一致，值是绑定号的昵称，界面据此出红条。
    account: accountName,
    accountMismatch,
    notes,
    noteIndex,
    pager,
    overview
  };

  await pushCreatorHistory(record);

  // AI 分析改成异步：采集结果先返回，面板立刻能看到数据，AI 结论稍后补上。
  //
  // 之前是同步 await runAutoAnalysis(record) —— DeepSeek 最长要 90 秒，
  // 表现为点「一键采集」后干等半分钟还像卡住了，用户会以为坏了。
  // 采集本身十几秒就能完成，AI 是锦上添花，不该拖住它。
  runAutoAnalysis(record).catch(() => {});

  return { success: true, data: record, analysis: { pending: true } };
}

async function pushCreatorHistory(record) {
  const { [CREATOR_HISTORY_KEY]: hist } = await chrome.storage.local.get([CREATOR_HISTORY_KEY]);
  const list = Array.isArray(hist) ? hist : [];
  list.push(record);
  while (list.length > CREATOR_HISTORY_MAX) list.shift();

  // ⚠️ storage.local 配额写满时 set() 是**静默失败**：
  //    不抛错、不丢旧数据，只是这次没写进去。
  //    表现是「明明每天都采集，历史却停在某一天不动」——
  //    而用户完全看不出是配额问题，只会觉得产品坏了。
  //    所以这里**写完立刻回读校验**。
  await chrome.storage.local.set({ [CREATOR_HISTORY_KEY]: list });
  const check = await chrome.storage.local.get([CREATOR_HISTORY_KEY]);
  const written = Array.isArray(check[CREATOR_HISTORY_KEY]) ? check[CREATOR_HISTORY_KEY].length : 0;
  if (written !== list.length) {
    console.error(`[XHS bg] 历史写入被截断：期望 ${list.length} 条，实际 ${written} 条。`
      + `配额可能已满（单条约 ${JSON.stringify(record).length} 字节）。`);
    throw new Error(
      `历史记录写入不完整（${written}/${list.length}）。`
      + `请在 chrome://extensions/ 的扩展详情里确认存储权限，或先导出历史再清理。`
    );
  }
  return list.length;
}

async function getCreatorHistory() {
  const { [CREATOR_HISTORY_KEY]: hist } = await chrome.storage.local.get([CREATOR_HISTORY_KEY]);
  return { success: true, data: Array.isArray(hist) ? hist : [] };
}

/**
 * 导出全部历史为 CSV。
 *
 * 为什么要它：storage 有配额、也有上限（现在 90 条），
 * 而用户可能想留更久。**导出让数据归用户所有** ——
 * 插件里存的不是你的数据，导出的文件才是。
 *
 * ⚠️ 三个必须做对的：
 * ① **BOM**：Excel 打开中文 CSV 不加 BOM 会乱码。这是国内用户最常见的投诉。
 * ② **转义**：标题里可能有逗号、引号、换行。不转义就会串列。
 * ③ **含表头**：否则导出后没人知道哪列是什么。
 */
async function exportHistoryCsv() {
  const { [CREATOR_HISTORY_KEY]: hist } = await chrome.storage.local.get([CREATOR_HISTORY_KEY]);
  const list = Array.isArray(hist) ? hist : [];
  if (!list.length) {
    return { success: false, error: '还没有采集数据可导出' };
  }

  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const rows = [['采集时间', '标题', '发布时间', '曝光', '观看', '封面点击率', '点赞', '评论', '收藏', '涨粉', '人均观看时长', '链接']];
  for (const rec of list) {
    const at = rec.capturedAt || (rec.id ? new Date(rec.id).toISOString() : '');
    const notes = Array.isArray(rec.notes) ? rec.notes : [];
    if (!notes.length) {
      rows.push([at, '', '', '', '', '', '', '', '', '', '', '']);
      continue;
    }
    // ⚠️ 字段名是**中文**（'曝光'/'点赞'…），不是 impressions/likes。
    //    写错不会报错，只会导出一堆空列 —— 这种 bug 从截图上完全看不出来。
    for (const n of notes) {
      rows.push([
        at, n.title ?? '', n.publishDate || n.publishTime || '',
        n['曝光'] ?? '', n['观看'] ?? '', n['封面点击率'] ?? '',
        n['点赞'] ?? '', n['评论'] ?? '', n['收藏'] ?? '', n['涨粉'] ?? '',
        n['人均观看时长'] ?? '', n.url ?? ''
      ]);
    }
  }

  const csv = '﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n');
  return { success: true, data: { csv, count: list.length, rows: rows.length - 1 } };
}

// =====================================================================
// ① 网页监听日志
// ---------------------------------------------------------------------
// 等价于影刀的【开始监听网页请求】+【获取网页监听结果】。
// 落盘策略：只留最近 200 条（用户选定），超出即淘汰最旧的。
// 入库前先过滤和脱敏 —— 200 条额度很宝贵，不能被图片/埋点/签名参数占掉。
// =====================================================================

const NET_LOG_KEY = 'xhsNetLog';
const NET_LOG_MAX = 200;
// 字节预算：storage.local 默认配额约 5MB，满了之后 set() 是**静默失败** ——
// 不报错、不丢前面的数据，只是这次没写进去，表现为「网页监听莫名其妙少了几条」。
// 单条正文上限 × 200 条已经能顶到 5MB 以上，所以除了条数还要卡字节。
// 留 1MB 余量给创作者历史快照等其它同处一个配额的键。
const NET_LOG_MAX_BYTES = 4 * 1024 * 1024;

function netLogBytes(list) {
  let n = 0;
  for (const e of list) n += (e.body || '').length + (e.url || '').length + 120;
  return n;
}

// 静态资源与埋点不落盘：既省额度，也让 200 条全是真数据
const NET_NOISE = [
  /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|css|mp4|webm|mp3)(\?|$)/i,
  /sentry|umeng|mmstat|growingio|google-analytics|googletagmanager|doubleclick|beacon/i
];

// URL 里这些参数是凭证/签名，落盘前抹掉
const NET_SECRET_PARAM = /^(token|access_token|sign|signature|web_session|webId|a1|_signature|sec_?.*|sid|xs|xt|timestamp)$/i;

function sanitizeNetUrl(raw) {
  try {
    const u = new URL(raw);
    const keys = [...u.searchParams.keys()];
    let touched = false;
    for (const k of keys) {
      if (NET_SECRET_PARAM.test(k)) { u.searchParams.set(k, '***'); touched = true; }
    }
    if (u.username || u.password) { u.username = '***'; u.password = ''; touched = true; }
    return { url: u.toString(), touched };
  } catch (_) {
    return { url: String(raw || '').slice(0, 500), touched: false };
  }
}

function normalizeNetEntry(e) {
  const { url, touched } = sanitizeNetUrl(e.url || '');
  return {
    kind: e.kind || 'fetch',
    method: (e.method || 'GET').toUpperCase(),
    url,
    status: typeof e.status === 'number' ? e.status : 0,
    contentType: e.contentType || '',
    body: typeof e.body === 'string' ? e.body : '',
    truncated: !!e.truncated,
    redacted: touched,
    ts: typeof e.ts === 'number' ? e.ts : Date.now()
  };
}

function isNetNoise(entry) {
  if (NET_NOISE.some(re => re.test(entry.url))) return true;
  // 状态码非 2xx 且没有响应体 —— 基本是探活/埋点，没信息量
  if (entry.status && (entry.status < 200 || entry.status >= 300) && !entry.body) return true;
  return false;
}

async function pushNetLog(raw) {
  if (!raw || !raw.url) return;
  const entry = normalizeNetEntry(raw);
  if (isNetNoise(entry)) return;
  const { [NET_LOG_KEY]: log } = await chrome.storage.local.get([NET_LOG_KEY]);
  const list = Array.isArray(log) ? log : [];
  list.push(entry);
  // 淘汰顺序：先按条数，再按字节。宁可丢最旧的，也别让 set() 静默失败。
  while (list.length > NET_LOG_MAX) list.shift();
  while (list.length > 1 && netLogBytes(list) > NET_LOG_MAX_BYTES) list.shift();
  await chrome.storage.local.set({ [NET_LOG_KEY]: list });
}

async function getNetLog(filter) {  const { [NET_LOG_KEY]: log } = await chrome.storage.local.get([NET_LOG_KEY]);
  let list = Array.isArray(log) ? log : [];
  const q = (filter || '').trim();
  let invalid = false;
  if (q) {
    // 用户输入的过滤条件一律生效。
    // 之前这里有个 /json|api|data|note/ 的前置门控：只有过滤词本身命中这几个
    // 关键字之一才真正过滤。输入「创作者」「creator」「user」全被静默忽略，
    // 列表纹丝不动，但界面上仍显示「已过滤」—— 用户以为自己筛错了，
    // 其实是根本没筛。列表最多 200 条，逐条 test 的开销可以忽略，
    // 这个门控没有任何存在价值。
    let re = null;
    try { re = new RegExp(q, 'i'); } catch (_) { re = null; }
    // 用户可能输入非法正则（单独的 '[' 等），此时不筛，别把整个面板搞崩
    if (re) list = list.filter(e => re.test(e.url));
    else invalid = true;
  }
  return {
    success: true,
    data: list.slice().reverse(),
    // filtered / invalid 如实回报，界面据此决定要不要说「已过滤」——
    // 说了却没筛，就是另一种形式的谎报。
    meta: { total: list.length, max: NET_LOG_MAX, filtered: !!q && !invalid, invalid }
  };
}

// =====================================================================
// ② 对标账号批量监控
// ---------------------------------------------------------------------
// 纯 DOM 抓取，零新基建。串行跑，后台标签页逐个开、逐个关。
// 串行而不是并发：小红书对并发请求敏感，且串行更容易看出是哪一号失败。
// =====================================================================

const BENCH_LIST_KEY = 'xhsBenchList';
const BENCH_HIST_KEY = 'xhsBenchHistory';
const BENCH_HIST_MAX = 20;

/** 接受完整 URL、裸 userId、或 @昵称 占位；统一成主页 URL */
function normalizeProfileUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z0-9]{6,}$/i.test(s)) return `https://www.xiaohongshu.com/user/profile/${s}`;
  return '';
}

async function benchmarkScan(rawUrls) {
  const urls = (Array.isArray(rawUrls) ? rawUrls : [])
    .map(normalizeProfileUrl)
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);

  if (!urls.length) throw new Error('没有有效的博主主页 URL 或 userId');

  const results = [];
  for (const url of urls) {
    let tab = null;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      // 等 content script 握手 + 主页渲染
      let ready = false;
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline && !ready) {
        try { const r = await sendToTab(tab.id, 'ping'); ready = !!(r && r.success); } catch (_) {}
        if (!ready) await sleep(600);
      }
      await sleep(1800);

      const [profileRes, listRes] = await Promise.all([
        sendToTab(tab.id, 'scrapeProfile').catch(() => null),
        sendToTab(tab.id, 'scrapeNoteList').catch(() => null)
      ]);

      const notes = (listRes && listRes.success && listRes.data) || [];
      const profile = (profileRes && profileRes.success && profileRes.data) || {};

      // 近 N 篇互动均值：只取有赞数的条目，否则均值会被 0 拉低
      const withLikes = notes.filter(n => n.likes > 0);
      results.push({
        url,
        userId: profile.userId || '',
        name: profile.name || '',
        fans: profile.fans || 0,
        following: profile.following || 0,
        posts: profile.posts || 0,
        intro: profile.intro || '',
        noteCount: notes.length,
        avgLikes: withLikes.length
          ? Math.round(withLikes.reduce((a, b) => a + b.likes, 0) / withLikes.length)
          : null,
        topLikes: withLikes.length ? Math.max(...withLikes.map(n => n.likes)) : null,
        notes: notes.slice(0, 20).map(n => ({ title: n.title, likes: n.likes, url: n.url })),
        ok: true,
        error: ''
      });
    } catch (e) {
      results.push({ url, ok: false, error: e.message || String(e), noteCount: 0, notes: [] });
    } finally {
      if (tab) chrome.tabs.remove(tab.id).catch(() => {});
    }
  }

  const record = { id: Date.now(), at: new Date().toISOString(), results };
  const { [BENCH_HIST_KEY]: hist } = await chrome.storage.local.get([BENCH_HIST_KEY]);
  const list = Array.isArray(hist) ? hist : [];
  list.push(record);
  while (list.length > BENCH_HIST_MAX) list.shift();
  await chrome.storage.local.set({ [BENCH_HIST_KEY]: list });

  return { success: true, data: record };
}

async function getBenchmarkList() {
  const { [BENCH_LIST_KEY]: urls } = await chrome.storage.local.get([BENCH_LIST_KEY]);
  return { success: true, data: Array.isArray(urls) ? urls : [] };
}

async function saveBenchmarkList(urls) {
  const clean = (Array.isArray(urls) ? urls : []).map(normalizeProfileUrl).filter(Boolean);
  await chrome.storage.local.set({ [BENCH_LIST_KEY]: clean });
}

async function getBenchmarkHistory() {
  const { [BENCH_HIST_KEY]: hist } = await chrome.storage.local.get([BENCH_HIST_KEY]);
  return { success: true, data: (Array.isArray(hist) ? hist : []).slice().reverse() };
}

// =====================================================================
// ③ 定时任务列表
// ---------------------------------------------------------------------
// 每个任务一条独立 alarm（名字 xhstask:<id>），改时间就重建对应 alarm。
// MV3 Service Worker 不常驻，chrome.alarms 是唯一可靠的定时机制。
// 任务失败只记录状态，不抛 —— 一次没跑成不该影响其他任务。
// =====================================================================

const TASKS_KEY = 'xhsTasks';

const TASK_TYPES = {
  creatorOverview: { name: '账号总览快照', run: () => collectCreatorData({ maxPages: 1, withNoteIndex: false }) },
  creatorAnalysis: { name: '单篇数据明细', run: () => collectCreatorData({ maxPages: 5 }) },
  benchmark: { name: '对标账号监控', run: async () => {
      const { data: urls } = await getBenchmarkList();
      if (!urls.length) throw new Error('监控列表为空：先在「对标」里加博主');
      return benchmarkScan(urls);
    } }
};

const DEFAULT_TASKS = [
  { id: 't-overview', type: 'creatorOverview', time: '20:00', enabled: false },
  { id: 't-analysis', type: 'creatorAnalysis', time: '20:40', enabled: false },
  { id: 't-benchmark', type: 'benchmark', time: '09:00', enabled: false }
];

function taskAlarmName(id) { return 'xhstask:' + id; }

async function getTasks() {
  const { [TASKS_KEY]: tasks } = await chrome.storage.local.get([TASKS_KEY]);
  const list = Array.isArray(tasks) && tasks.length ? tasks : DEFAULT_TASKS.slice();
  const out = [];
  for (const t of list) {
    const alarm = await chrome.alarms.get(taskAlarmName(t.id));
    out.push({
      ...t,
      name: (TASK_TYPES[t.type] || {}).name || t.type,
      scheduled: !!alarm,
      nextRunAt: alarm ? alarm.scheduledTime : null
    });
  }
  return { success: true, data: out };
}

async function saveTasks(list) {
  await chrome.storage.local.set({ [TASKS_KEY]: list });
  // 重建所有 alarm：新增的建上，已删除的清掉
  for (const t of list) {
    const name = taskAlarmName(t.id);
    await chrome.alarms.clear(name);
    if (t.enabled) await createTaskAlarm(t);
  }
  // 清掉不在列表里的孤儿 alarm
  const all = await chrome.alarms.getAll();
  const known = new Set(list.map(t => taskAlarmName(t.id)));
  for (const a of all) {
    if (a.name.startsWith('xhstask:') && !known.has(a.name)) await chrome.alarms.clear(a.name);
  }
}

async function createTaskAlarm(task) {
  const [h, m] = String(task.time || '00:00').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return;
  const when = new Date();
  when.setHours(h, m, 0, 0);
  if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1);
  await chrome.alarms.create(taskAlarmName(task.id), {
    when: when.getTime(),
    periodInMinutes: 24 * 60
  });
}

async function upsertTask(patch) {
  if (!patch || !patch.id || !TASK_TYPES[patch.type]) throw new Error('无效的任务定义');
  const { data: cur } = await getTasks();
  const list = cur.map(({ name, scheduled, nextRunAt, ...t }) => t);
  const idx = list.findIndex(t => t.id === patch.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...patch };
  else list.push({ lastRunAt: null, lastStatus: '', lastError: '', ...patch });
  await saveTasks(list);
  return list;
}

async function deleteTask(id) {
  const { data: cur } = await getTasks();
  const list = cur
    .map(({ name, scheduled, nextRunAt, ...t }) => t)
    .filter(t => t.id !== id);
  await saveTasks(list);
  await chrome.alarms.clear(taskAlarmName(id));
}

async function runTaskById(id) {
  const { data: cur } = await getTasks();
  const task = cur.find(t => t.id === id);
  if (!task) throw new Error('任务不存在：' + id);
  return await executeTask(task);
}

async function executeTask(task) {
  const def = TASK_TYPES[task.type];
  if (!def) throw new Error('未知任务类型：' + task.type);
  const started = Date.now();
  try {
    const res = await def.run();
    await markTaskRun(task.id, { ok: true, at: started, ms: Date.now() - started, error: '' });
    return { success: true, data: res };
  } catch (e) {
    // 失败不抛出到 alarm 上下文，但状态必须落盘，否则用户看不到为什么没跑
    await markTaskRun(task.id, { ok: false, at: started, ms: Date.now() - started, error: e.message || String(e) });
    return { success: false, error: e.message || String(e) };
  }
}

async function markTaskRun(id, { ok, at, ms, error }) {
  const { [TASKS_KEY]: tasks } = await chrome.storage.local.get([TASKS_KEY]);
  const list = Array.isArray(tasks) && tasks.length ? tasks : DEFAULT_TASKS.slice();
  const t = list.find(x => x.id === id);
  if (t) {
    t.lastRunAt = at;
    t.lastStatus = ok ? 'ok' : 'fail';
    t.lastError = error || '';
    t.lastDurationMs = ms;
  }
  await chrome.storage.local.set({ [TASKS_KEY]: list });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('xhstask:')) return;
  const id = alarm.name.slice('xhstask:'.length);
  const { data: cur } = await getTasks();
  const task = cur.find(t => t.id === id);
  if (!task) { chrome.alarms.clear(alarm.name); return; }
  const r = await executeTask(task);
  console.log(r.success
    ? `[XHS bg] 任务完成 ${task.type} (${task.id})`
    : `[XHS bg] 任务失败 ${task.type} (${task.id})：${r.error}`);
});

// =====================================================================
// 创作者数据分析（AI 管线）
// ---------------------------------------------------------------------
// 定位：扩展不只是「把数字搬到文件里」，而是采集完直接让大模型读数据、
// 给出可执行判断。这一段取代了原先「导出 CSV → 人工拿去问 agent」的两步。
//
// 特点：
//  · 零人工 —— 定时任务触发采集后自动调 AI，无需点任何按钮
//  · 零外部依赖 —— 直接用扩展已有的 AI Provider（推荐 deepseek-flash），
//    不引入本地守护进程、inbox 监听器或额外 agent 运行时
//  · 结构化输出 —— 要求返回 JSON，落盘后可被再次消费
//  · 失败不阻断采集 —— 采集成功即算成功，分析失败只记状态
// =====================================================================

const ANALYSIS_SYSTEM = `你是一位小红书内容运营的数据分析师，服务于一个单账号创作者。

你会收到该账号最近发布的笔记明细数据，以及账号级聚合指标。

**关键口径（必须遵守，混淆会得出错误结论）：**
- 笔记明细是「近 90 天」逐篇数据；账号聚合是「近 7 日」聚合。两者不可互相推算。
  **禁止**用账号聚合做除法摊到逐篇上 —— 例如「近 7 日获赞 598 ÷ 90 天内 20 篇 = 每篇约 30」
  是错的（7 日的量摊到 90 天的篇数上，分子分母口径不同），不要写这种句子。
- 数值列出现 "-" 表示平台未出数（新发笔记未跑够样本），**不等于 0**，不要当作 0 参与计算或解读。
- 曝光量受平台分发影响极大，环比下降不一定代表内容变差。

**分析要求：**
1. 找出表现最好和最差的笔记，各说明**可复制的具体做法**，不要泛泛而谈。
2. 指出数据里**反常识的信号**（例如某项指标与直觉相反），这类最值得注意。
3. 给出 3 条**下一阶段可立即执行**的建议，每条要具体到「下一篇笔记怎么做」。
4. 如果某项指标样本太少不足以判断，直接说明"样本不足"，不要硬下结论。
5. **noteReviews 必须逐篇覆盖** notes 里前 5 条（不足 5 条就全给），
   每篇都要有 verdict 和 reason —— 报告的价值在于能直接告诉用户
   「这一篇为什么行/为什么不行」，而不只是给一个整体印象。
6. metrics 里逐项判断，**任何一项都要给 verdict**；
   没有足够样本就给 "样本不足"，不要跳过也不要硬套。
7. **genreProfile**：把每条笔记归入下列 7 种内容体裁之一，并按体裁汇总表现。
   - 种草体（好物/好店推荐）、探店体（具体店铺体验）、行程攻略体（旅行/城市攻略）、
     Vlog脚本体（短视频脚本分镜）、日签短文案（短平快的日常/朋友圈）、测评对比体（真实测评对比）、
     **经验记录体（学习/开发/踩坑/复盘等第一人称图文记录 —— 工具使用记录、项目进展、
     「我做成了什么/被什么卡住」都属于这类）**
   - 归类只依据**标题里体现的内容形态**。标题信息不足以判断时归入"无法判断"，
     **不要为了凑满 7 类硬套**。
   - **Vlog脚本体只允许归入标题里明确体现视频形态的笔记**
     （标题含"视频/vlog/分镜/镜头/拍摄"等）。第一人称经历、过程记录、
     踩坑复盘**一律是经验记录体，不是 Vlog** —— 用户没拍视频却被归成
     "Vlog脚本"，他会以为分析的是别人的账号（真实投诉，2026-10-13）。
   - 每个体裁给出 count、avgExposure（可用数据里该体裁的曝光均值）、
     verdict（good/warn/bad/样本不足）和 read（一句话读法）。
   - 判据是**该体裁在你这个账号上**的表现，不是这个体裁好不好。
8. **todayPick**：今天这一篇该发什么体裁。
   - genre 从 7 类中选。内容形态与种草/探店/攻略/Vlog/测评都不沾边时，
     给「经验记录体」并在 why 里说明这是按内容形态的兜底归类，
     **不许把图文记录硬套成 Vlog脚本体或其他与标题无关的体裁**。
   - why 必须引用具体数据 —— 例如"你 3 篇探店体平均曝光 1.2万，是种草体的 2 倍"，
     **不许写"因为探店体更受欢迎"这种放之四海皆准的空话**。
   - topicSeed 给一个具体选题方向，不要写"分享日常"这种没有信息量的词。
   - 样本不足时 why 要写明"样本不足，这是基于现有 N 篇的初步判断"。
9. **schedule**：未来 7 天的发布节奏，用 **day 表示第几天（1=明天，2=后天 …7）**。
   - **不要输出具体日期** —— 你不知道用户当地的今天是哪天，编日期一定错。
     具体日期由扩展在本地按生成日推算。
   - 每天给 genre、topic、why。节奏要有变化，不要 7 天全是同一个体裁：
     如果数据支持，就安排不同体轮换；如果数据不支持，weekday 不填、why 里说明原因。
   - 排期要参考**数据里观察到的发布规律**（哪天发数据更好），
     没有观察到规律就明说，不要假装有。
10. **诚实底线**：
   - 笔记数少于 5 条时，todayPick 和 schedule 都必须带上「样本不足」的说明，
     并且不要假装这些判断很确定。宁可说"还不确定"，也不要给一份看起来很专业、
     实际没有依据的计划 —— 用户会照着执行，错的代价是他的时间和账号。
   - 任何你无法从数据里读出来的结论，都不要写进 JSON。

**输出严格的 JSON**，不要包裹在 markdown 代码块里，结构如下：
{
  "summary": "2-3 句话总体判断",
  "healthScore": 0,
  "highlights": ["做得好的具体做法，2-3 条"],
  "concerns": ["需要警惕的问题，1-3 条"],
  "counterintuitive": ["反常识信号，0-2 条；没有就给空数组"],
  "metrics": [
    {"metric": "指标名", "verdict": "good|warn|bad|样本不足", "read": "一句话读法"}
  ],
  "noteReviews": [
    {"title": "笔记标题（与输入完全一致）", "verdict": "good|warn|bad",
     "reason": "一句话说清它凭什么拿这个判定，要引用具体数值"}
  ],
  "actions": ["可立即执行的具体建议，恰好 3 条"],
  "nextSteps": ["下 1 周的具体动作，2-3 条，要能落到发布节奏上"],
  "genreProfile": [
    {"genre": "种草体|探店体|行程攻略体|Vlog脚本体|日签短文案|测评对比体|经验记录体|无法判断",
     "count": 0, "avgExposure": "该体裁曝光均值，没有就填 '-'",
     "verdict": "good|warn|bad|样本不足", "read": "一句话读法"}
  ],
  "todayPick": {"genre": "7 类之一", "why": "必须引用具体数据", "topicSeed": "具体选题方向"},
  "schedule": [
    {"day": 1, "genre": "7 类之一", "topic": "选题", "why": "为什么这天发这个"}
  ],
  "dataQuality": {"sampleSize": 0, "notes": "样本量与可信度说明"}
}`;

/** 把采集记录压成给模型看的紧凑表格，避免无谓 token 消耗 */
function buildAnalysisInput(record) {
  const notes = record.notes || [];
  const lines = notes.slice(0, 40).map(n =>
    [
      n.publishDate || '?',
      (n.title || '').slice(0, 24),
      `曝光${n['曝光'] ?? '-'}`,
      `观看${n['观看'] ?? '-'}`,
      `CTR${n['封面点击率'] ?? '-'}`,
      `赞${n['点赞'] ?? '-'}`,
      `评${n['评论'] ?? '-'}`,
      `藏${n['收藏'] ?? '-'}`,
      `粉${n['涨粉'] ?? '-'}`,
      `时长${n['人均观看时长'] ?? '-'}`
    ].join(' | ')
  );

  const parts = [];
  // 账号归属放第一行：模型必须知道这份表是谁的号，摘要里才不会说出
  // 「你的账号是XX领域」这种把对标账号内容当成本号的判断。
  if (record.account) parts.push(`## 数据账号：${record.account}`);
  parts.push(`## 笔记明细（近 90 天，共 ${notes.length} 条）`);
  parts.push('日期 | 标题 | 曝光 | 观看 | CTR | 赞 | 评 | 藏 | 涨粉 | 人均时长');
  parts.push(...lines);

  const ov = record.overview;
  if (ov) {
    const acct = ov.account || {};
    parts.push('', '## 账号聚合（近 7 日）');
    for (const [k, v] of Object.entries(acct)) {
      if (v) parts.push(`- ${k}: ${v}`);
    }
    for (const m of (ov.metrics || []).slice(0, 14)) {
      parts.push(`- ${m.metric}: ${m.value}${m.delta ? ` (${m.delta})` : ''}`);
    }
  }
  return parts.join('\n');
}

/**
 * 调 AI 分析采集结果。
 * 与写文案的 aiComplete 分开：这里要 JSON 输出、温度更低、允许 reasoning 档位。
 */
async function analyzeWithAI(record) {
  const provider = CONFIG.ai.provider;
  const providerCfg = PROVIDERS[provider] || PROVIDERS['custom'];
  const apiFormat = providerCfg.apiFormat || 'openai';
  const model = CONFIG.ai.model?.trim() || providerCfg.model;
  const endpoint = (CONFIG.ai.endpoint?.trim() || providerCfg.endpoint || '').trim();
  if (!endpoint) throw new Error('未配置 AI Endpoint');
  if (!/^https?:\/\//i.test(endpoint)) throw new Error(`Endpoint 缺少协议头：${endpoint}`);

  const body = {
    model,
    messages: [
      { role: 'system', content: ANALYSIS_SYSTEM },
      { role: 'user', content: buildAnalysisInput(record) }
    ],
    max_tokens: 4000,
    temperature: 0.3
  };
  // DeepSeek V4.1 Flash 专有：思考模式与思考强度
  if (providerCfg.thinking) body.thinking = providerCfg.thinking;
  if (providerCfg.reasoningEffort) body.reasoning_effort = providerCfg.reasoningEffort;

  const headers = { 'Content-Type': 'application/json' };
  if (apiFormat === 'anthropic') headers['X-Api-Key'] = CONFIG.ai.apiKey;
  else headers['Authorization'] = `Bearer ${CONFIG.ai.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  let resp;
  try {
    resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  const raw = await resp.text();
  if (!resp.ok) {
    // 把 status 带进错误对象，供 classifyAnalysisError 归类
    // 401/403 -> permission-denied，429 -> quota，404 -> bad-model
    const err = new Error(`AI ${resp.status}: ${raw.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }
  const data = JSON.parse(raw);
  const text = apiFormat === 'anthropic'
    ? (Array.isArray(data.content) ? (data.content.find(b => b.type === 'text') || {}).text : '')
    : (((data.choices || [])[0] || {}).message || {}).content;
  if (!text) throw new Error('AI 返回为空');

  return parseAnalysisJson(text);
}

/** 模型常在 JSON 外面裹 markdown 代码块或前后加话，这里做容错提取 */
function parseAnalysisJson(text) {
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);

  try {
    return JSON.parse(s);
  } catch (e) {
    /* 严格 JSON 失败后再抢救一次。
     *
     * 实测症状：模型返回的 JSON 在 line 24 有个语法错（多半是尾逗号
     * 或字符串里没转义的引号），**整份分析就全丢了** ——
     * 而 summary、healthScore、highlights 其实都已经写出来了，
     * 用户却只看到一句「模型返回的不是合法 JSON」。
     *
     * 抢救顺序（都不改内容，只修结构）：
     *   1) 去掉对象/数组里的尾逗号
     *   2) 还不行就按字段逐个抠出能抠到的，让用户至少看到结论
     *
     * 抢救成功必须标明「部分」，不能让人以为这是一份完整的报告。 */
    const repaired = s.replace(/,(\s*[}\]])/g, '$1');
    if (repaired !== s) {
      try { return JSON.parse(repaired); } catch (_) {}
    }

    const salvaged = salvageAnalysis(s);
    if (salvaged) {
      salvaged.parseError = e.message;
      salvaged._partial = true;      // 界面据此说清「只拿到一部分」
      return salvaged;
    }
    // 一点都救不回来才返回原文 —— 不吞掉，用户要看到模型到底说了什么
    return { parseError: e.message, raw: String(text).slice(0, 1500) };
  }
}

/**
 * 从坏掉的 JSON 里逐字段抠出还能读的内容。
 * 抠不出就返回 null，**绝不返回空对象冒充成功** ——
 * 那是这个项目反复栽过的坑（拿不准就给个默认，看起来像对的）。
 */
function salvageAnalysis(s) {
  const pickString = (key) => {
    const m = s.match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
    return m ? m[1] : null;
  };
  const pickStringArray = (key) => {
    const m = s.match(new RegExp('"' + key + '"\\s*:\\s*\\[([\\s\\S]*?)\\]'));
    if (!m) return null;
    const out = [];
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let it;
    while ((it = re.exec(m[1]))) out.push(it[1]);
    return out.length ? out : null;
  };
  const pickNumber = (key) => {
    const m = s.match(new RegExp('"' + key + '"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)'));
    return m ? Number(m[1]) : null;
  };

  const out = {};
  const summary = pickString('summary');
  if (summary) out.summary = summary;
  const hs = pickNumber('healthScore');
  if (hs !== null) out.healthScore = hs;
  for (const k of ['highlights', 'concerns', 'actions', 'nextSteps', 'counterintuitive']) {
    const v = pickStringArray(k);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

const ANALYSIS_KEY = 'xhsCreatorAnalysis';

/** 记录本次分析实际用的模型，便于回溯结论出自哪一版 */
function currentModelName() {
  return CONFIG.ai.model?.trim()
    || (PROVIDERS[CONFIG.ai.provider] || {}).model
    || 'unknown';
}

/**
 * 把 AI 分析的失败归类成**可判别的状态码**，而不是一句裸字符串。
 *
 * 依据 design-to-product/references/component-states.md「AI 任务」一行：
 *   idle / validating / queued / running / success / error / cancelled /
 *   timeout / offline / permission-denied
 * 「来自业务事实，不靠动画假装接通」—— 所以状态由真实失败原因推导，
 * 每种都带**明确的恢复路径**，而不是只说「失败」。
 */
function classifyAnalysisError(e) {
  const msg = String((e && e.message) || e || '');
  const status = Number((e && e.status) || 0);

  if (status === 401 || status === 403 || /api\s*key|unauthorized|forbidden|没有配置|未配置|请先在设置/i.test(msg)) {
    return { code: 'permission-denied', hint: '账号无此权限或未配置密钥' };
  }
  if (status === 429 || /余额|额度|quota|rate.?limit|too many/i.test(msg)) {
    return { code: 'quota', hint: '额度不足或触发限流' };
  }
  if (status === 404 || /模型|model.*not|不存在/i.test(msg)) {
    return { code: 'bad-model', hint: '模型名不被服务端接受' };
  }
  if (/timeout|超时|aborted/i.test(msg)) {
    // 规范原文：超时 ≠ 已取消。「尚未确认任务是否结束，检查状态，避免重复请求」
    return { code: 'timeout', hint: '等待超时，尚未确认任务是否结束' };
  }
  if (/fetch|network|网络|failed to fetch|ENOTFOUND|ECONNREFUSED/i.test(msg)) {
    return { code: 'offline', hint: '连不上服务端' };
  }
  if (/json|parse/i.test(msg)) {
    return { code: 'bad-json', hint: '模型返回的不是合法 JSON' };
  }
  return { code: 'error', hint: '未完成这一步' };
}

/** 扩展自带的内容体裁。必须与模板页的 key 语义一致，
    否则「今天发种草体」点进模板页会找不到对应模板。
    v2.44.0 新增「经验记录体」：6 类白名单全是典型运营号体裁，
    学习/开发/踩坑类图文记录哪类都装不下 —— 模型被强迫 6 选 1
    时硬套了「Vlog脚本体」，用户以为分析的是别人的账号。 */
const GENRES = [
  { name: '种草体', key: 'recommend' },
  { name: '探店体', key: 'explore' },
  { name: '行程攻略体', key: 'travel' },
  { name: 'Vlog脚本体', key: 'vlog' },
  { name: '日签短文案', key: 'daily' },
  { name: '测评对比体', key: 'review' },
  { name: '经验记录体', key: 'record' },
];

/** 少于这么多篇笔记，「基于你的数据」这句话就是假的。 */
const PLAN_MIN_SAMPLE = 5;

const _genreByName = new Map(GENRES.map(g => [g.name, g]));
/** 模型可能写「种草」「测评」这类简称，容忍一次后缀缺失 */
function matchGenre(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (_genreByName.has(s)) return _genreByName.get(s);
  for (const g of GENRES) if (s.includes(g.name) || g.name.includes(s)) return g;
  return null;   // 编出来的体裁一律丢掉，不进计划
}

/**
 * 把模型返回的「今天发什么 / 7 天排期」收拾成一份**可以直接展示的计划**。
 *
 * ============================ 为什么必须由代码判定 ============================
 * 「这份计划基于你的数据吗」是整个功能里最不能出错的一句话。
 * 如果让模型自己标 basis，它在只有 1 篇笔记时同样会写出一份
 * 自信满满的 7 天计划并标成「基于数据」—— 而用户会照着执行。
 * 错的代价是他的时间和他的账号，不是我们少一个功能。
 *
 * 所以 sampleSize 由**本地记录数**算，basis 由阈值决定，
 * 模型没有投票权。模型只负责「写什么」，不负责「凭什么」。
 */
/**
 * 把模型给的「第几天」解析成 1..7 的整数。
 *
 * 为什么不能直接 Number()：提示词写的是「day 表示第几天（1=明天…）」，
 * 但模型经常回**字符串** —— "第3天" / "3" / "明天" / "D3"。
 * Number("第3天") 是 NaN，于是那一行被静默丢掉。
 *
 * 实测症状：7 天排期只剩两行（用户截图里只剩第 3 天和第 7 天）。
 * **七分之五在界面上没有任何提示** —— 用户只会以为「就排了两天」。
 *
 * 返回 null 表示确实解析不出来，那一行丢掉是对的（宁可少排也不要排错日期）。
 */
function parseDayOffset(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 1 && raw <= 7 ? raw : null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  // 文字相对日：今天=1 的话，明天=2 后天=3；这里 day=1 就是明天
  if (/大后天/.test(s)) return 3;
  if (/后天/.test(s)) return 2;
  if (/明天|明日/.test(s)) return 1;
  // "第3天" / "D3" / "第 3 天" / "3" / "3天"
  const m = s.match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return n >= 1 && n <= 7 ? n : null;
}

function normalizePlan(result, record) {
  const notes = (record && record.notes) || [];
  const sampleSize = notes.length;
  const basis = sampleSize >= PLAN_MIN_SAMPLE ? 'data' : 'coldstart';
  const generatedAt = new Date();
  const reasons = [];

  if (basis === 'coldstart') {
    reasons.push(`只有 ${sampleSize} 篇笔记，低于 ${PLAN_MIN_SAMPLE} 篇的判断门槛`);
  }

  // ---- 体裁画像 ----
  const profile = [];
  for (const g of Array.isArray(result?.genreProfile) ? result.genreProfile : []) {
    const hit = matchGenre(g && g.genre);
    if (!hit) continue;                      // 模型编的体裁，丢掉
    profile.push({
      genre: hit.name, key: hit.key,
      count: Number(g.count) || 0,
      avgExposure: g.avgExposure == null ? '-' : String(g.avgExposure),
      verdict: ['good', 'warn', 'bad', '样本不足'].includes(g.verdict) ? g.verdict : '样本不足',
      read: String(g.read || '').slice(0, 120)
    });
  }
  profile.sort((a, b) => b.count - a.count);

  // ---- 今天发什么 ----
  let todayPick = null;
  const tp = result?.todayPick;
  if (tp) {
    const hit = matchGenre(tp.genre);
    if (hit) {
      todayPick = {
        genre: hit.name, key: hit.key,
        why: String(tp.why || '').slice(0, 200),
        topicSeed: String(tp.topicSeed || '').slice(0, 120)
      };
      // 冷启动时给不出「基于数据」的理由，这句话必须补上
      if (basis === 'coldstart' && !/样本不足|还不确定|初步/.test(todayPick.why)) {
        todayPick.why = `样本不足（${sampleSize} 篇），暂不构成结论：` + todayPick.why;
      }
    }
  }

  // ---- 7 天排期 ----
  const schedule = [];
  for (const s of Array.isArray(result?.schedule) ? result.schedule : []) {
    const day = parseDayOffset(s && s.day);
    const hit = matchGenre(s && s.genre);
    // day 必须落在 1..7；模型写 0 或 8 时宁可丢掉也不要排错
    if (day === null) continue;
    if (!hit) continue;
    // 日期在这里算，不让模型编 —— 它不知道用户当地今天是几号
    const d = new Date(generatedAt.getTime() + day * 86400000);
    schedule.push({
      day,
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      weekday: '日一二三四五六'[d.getDay()],
      genre: hit.name, key: hit.key,
      topic: String(s.topic || '').slice(0, 120),
      why: String(s.why || '').slice(0, 200),
      done: false
    });
  }
  schedule.sort((a, b) => a.day - b.day);

  return {
    basis, sampleSize, reasons,
    note: basis === 'coldstart'
      ? `通用建议 · 非基于你的数据（现有 ${sampleSize} 篇笔记，不足以判断你的账号适合什么）`
      : `基于你最近 ${sampleSize} 篇笔记的表现`,
    generatedAt: generatedAt.toISOString(),
    profile, todayPick, schedule,
    // 计划本身也要能在侧边栏独立存一份，不依赖分析历史
    model: currentModelName()
  };
}

const PLAN_KEY = 'xhsPlan';

/**
 * 选题闭环：排期里「条目最少的一天」，并列取最早 ——
 * 纯代码决定，模型没有投票权（与 normalizePlan 的 basis 纪律同源）。
 */
function choosePlanDay(schedule) {
  const counts = {};
  for (const it of schedule || []) counts[it.day] = (counts[it.day] || 0) + 1;
  let best = 1;
  for (let day = 2; day <= 7; day++) {
    if ((counts[day] || 0) < (counts[best] || 0)) best = day;
  }
  return best;
}

/** 查重（去首尾空白比较）—— 同一条建议点两次只入排期一次。 */
function scheduleHasTopic(schedule, topic) {
  const t = String(topic || '').trim();
  return (schedule || []).some(it => String(it.topic || '').trim() === t);
}

/** 采集完自动调 AI，结果存本地供侧边栏展示 */
async function runAutoAnalysis(record) {
  try {
    const result = await analyzeWithAI(record);
    const plan = normalizePlan(result, record);
    const { [ANALYSIS_KEY]: hist } = await chrome.storage.local.get([ANALYSIS_KEY]);
    const list = Array.isArray(hist) ? hist : [];
    list.push({
      id: Date.now(),
      at: new Date().toISOString(),
      noteCount: (record.notes || []).length,
      provider: CONFIG.ai.provider,
      model: currentModelName(),
      result
    });
    while (list.length > 20) list.shift();
    await chrome.storage.local.set({ [ANALYSIS_KEY]: list, [PLAN_KEY]: plan });
    return { ok: true, result, plan };
  } catch (e) {
    const info = classifyAnalysisError(e);
    console.warn('[XHS bg] AI 分析失败（不影响采集结果）：' + info.code + ' / ' + (e.message || e));
    return { ok: false, code: info.code, hint: info.hint, error: e.message || String(e) };
  }
}

async function getAnalysisHistory() {
  const { [ANALYSIS_KEY]: hist } = await chrome.storage.local.get([ANALYSIS_KEY]);
  return { success: true, data: Array.isArray(hist) ? hist.slice().reverse() : [] };
}

/* ------------------------------------------------------------------
   浏览器启动时恢复定时任务
   ------------------------------------------------------------------
   以前只在 onInstalled 里重建 alarm，而 onInstalled **只在首次安装/
   版本更新时触发**。Chrome 日常重启不会触发它 ——
   于是「每天自动采集」这个承诺在用户重启浏览器后就悄悄失效了，
   而界面上还显示「已开启」。这正是「还需要人工操作」的最后一块：
   不是开关没点，是开关点完之后**它自己会掉**。

   两种恢复点，都要：
     onStartup  —— Chrome 启动时（用户重启浏览器）
     onInstalled —— 首次安装 / 扩展更新（onStartup 不覆盖）
   另有 chrome.alarms 自身的持久化不可靠：扩展被浏览器回收重载后
   alarm 会全部消失，这条路径同样要能重建。

   另外补一条即时补偿：onStartup 触发时机不确定（可能在 alarm
   已经错过之后），所以恢复完成后主动检查一次「本该跑但没跑」的任务，
   迟到的也补跑，而不是只等下一个周期。
   ------------------------------------------------------------------ */

/** alarm 名字里带日期 → 说明它属于「已经过去的那一天」，属于漏跑 */
function taskAlarmMissedWindow(t) {
  if (!t.time || !/^\d{1,2}:\d{2}$/.test(t.time)) return null;
  const [h, m] = t.time.split(':').map(Number);
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  // 迟到窗口：今天过了 2 小时仍算漏跑。超过 23 小时就不补了 ——
  // 补昨天晚上的采集没有意义，数据早就被新数据覆盖。
  const lateMs = now.getTime() - due.getTime();
  const MAX_LATE = 23 * 3600 * 1000;
  if (lateMs > 0 && lateMs < MAX_LATE) return due;
  return null;
}

async function restoreTaskAlarms(reason) {
  try {
    const { data: list } = await getTasks();
    const raw = list.map(({ name, scheduled, nextRunAt, ...t }) => t);
    await saveTasks(raw);

    // 补偿：已开启、但今天已过点且没有 alarm 的任务，立刻跑一次
    const after = (await getTasks()).data || [];
    for (const t of after) {
      if (!t.enabled) continue;
      if (await chrome.alarms.get(taskAlarmName(t.id))) continue;
      const missed = taskAlarmMissedWindow(t);
      if (missed) {
        console.log(`[XHS bg] ${reason}：补跑「${t.name || t.id}」（原定 ${t.time}，已过 ${Math.round((Date.now() - missed.getTime()) / 60000)} 分钟）`);
        try { await runTaskById(t.id); } catch (e) {
          console.warn('[XHS bg] 补跑失败：' + e.message);
        }
      }
    }
  } catch (e) {
    console.warn('[XHS bg] ' + reason + ' 恢复定时任务失败：' + e.message);
  }
}

// ========== 真侧边栏（不是标签页）============
//
// ⚠️ 这一整段的起因：以前 `openSidePanel` 用的是 `chrome.tabs.create`，
//    也就是**在标签页里打开 sidepanel.html**。后果是：
//    · 内容被 720px 上限卡在屏幕正中，右边一大片空白
//    · 切标签页就「没了」，因为它其实是个网页
//    · 顶部导航被迫横排，而不是侧栏该有的竖排
//    也就是说，**用户从来没见到过真正的侧栏形态**。
//
//    MV3 有专门的 `chrome.sidePanel` API。要点：
//    ① manifest 里**不能有** `action.default_popup` ——
//       有的话点图标只会弹 popup，侧栏永远不会被打开（已删）
//    ② 必须显式 `setPanelBehavior({openPanelOnActionClick:true})`，
//       否则点图标什么都不会发生
//    ③ `chrome.sidePanel.open()` 受**用户手势**约束 ——
//       必须在点击事件里同步调用，中间不能 await 别的异步操作，
//       否则 Chrome 判定为非用户触发而拒绝
let _lastWindowId = null;

chrome.windows?.onFocusChanged?.addListener?.((winId) => {
  if (winId !== chrome.windows.WINDOW_ID_NONE) _lastWindowId = winId;
});

chrome.tabs.onActivated.addListener(({ windowId }) => { _lastWindowId = windowId; });

/** 打开真侧边栏。必须在用户手势的同步调用栈里。 */
async function openSidePanelNow() {
  // 先同步取 windowId —— windowId 拿不到时 open() 会直接失败
  let winId = _lastWindowId;
  if (winId == null) {
    const win = await chrome.windows.getCurrent();
    winId = win?.id;
  }
  if (winId == null) return { success: false, error: '无法确定当前窗口' };
  await chrome.sidePanel.open({ windowId: winId });
  return { success: true };
}

/** 激活「点图标直接开侧栏」这个行为。 */
function enablePanelBehavior() {
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      .catch(e => console.warn('[XHS Tools] setPanelBehavior 失败：', e.message));
  } catch (e) {
    console.warn('[XHS Tools] 当前 Chrome 不支持 sidePanel API：', e.message);
  }
}

chrome.runtime.onStartup.addListener(() => {
  console.log('[XHS Tools] 浏览器启动，恢复定时任务');
  restoreTaskAlarms('onStartup');
  // Service Worker 会被回收重启，行为设置不会自动恢复 —— 每次启动都要重设
  enablePanelBehavior();
});

chrome.runtime.onInstalled.addListener(async () => {
  // 版本号从 manifest 读，不要在这里再写一份 ——
  // 硬编码过一次就再没同步过（日志里长期停在 v2.6.0，实际已经 2.16）。
  const v = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '?';
  console.log('[XHS Tools] 小红书运营工具箱已安装 v' + v);
  // 首次安装/更新后重建 alarm（alarms 会随浏览器重启丢失）。
  // 走 restoreTaskAlarms 而不是裸 saveTasks：顺带做一次漏跑补偿。
  await restoreTaskAlarms('onInstalled');
  enablePanelBehavior();
});

// ========== 键盘快捷键 ==========
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-sidepanel') {
    await openSidePanelNow();
  }
});

// ========== 调试日志（生产可删）==========
function log(...args) {
  console.log('[XHS bg]', ...args);
}
