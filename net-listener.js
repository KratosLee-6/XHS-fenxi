/**
 * net-listener.js — 网页监听（MAIN world）
 *
 * 以 MAIN world 注入，在页面自己的 JS 上下文里给 fetch / XMLHttpRequest 打补丁，
 * 把 XHR 响应的 URL、状态码、响应体截出来，通过 window.postMessage 交给
 * content.js（ISOLATED world）再转给 background 落盘。
 *
 * 为什么要 MAIN world：
 *   content script 跑在隔离世界里，拿不到页面自己的 fetch/XHR 引用。
 *   MV3 没有 chrome.webRequest 读响应体的能力（只有观测，没有 body），
 *   declarativeNetRequest 同样读不到 body。
 *   所以唯一可行的路子就是注入到主世界去挂钩。
 *
 * 对标价值：
 *   这是「影刀 RPA →【开始监听网页请求】/【获取网页监听结果】」的等价物。
 *   用途是拿到结构化 JSON（笔记详情、noteId、粉丝画像），
 *   比读 DOM 抗改版，也是 noteId 唯一的正规来源 ——
 *   内容分析页的表格里根本没有 noteId。
 *
 * 本文件还承载第二条链路：**agent 调用通道**（见下方 AGENT_ENDPOINT 一节），
 * 本机脚本借同一个 fetch 补丁把命令送进扩展、并拿回执行结果。
 *
 * 边界：
 *   · 只读不改，响应通过 clone() 复制，不影响页面自身逻辑
 *   · 响应体截断到 MAX_BODY，避免把大 JSON 撑爆 storage
 *   · 不打印到 console，不做任何外发
 */

(function () {
  'use strict';

  if (window.__xhsNetHooked) return;
  window.__xhsNetHooked = true;

  // 单条响应体上限。小红书的笔记详情 JSON 通常 < 50KB，够用。
  const MAX_BODY = 200 * 1024;
  // URL 上限
  const MAX_URL = 500;

  /**
   * agent 调用用的端点。
   *
   * ⚠️ 必须是**页面上真实存在但不承载业务**的地址 ——
   *    本机脚本 fetch 它不是为了拿内容，是为了借 fetch 补丁进入扩展。
   *    选 `robots.txt` 是因为它必然存在、必然返回 200、内容无害，
   *    且不产生任何真实请求副作用。
   */
  const AGENT_ENDPOINT = 'https://www.xiaohongshu.com/robots.txt';

  // agent 调用兜底超时。采集类命令（自动翻页）可能跑几分钟，
  // 调用方 dev/xhs.mjs 对慢命令给了更长的 AbortSignal；这里是扩展侧兜底。
  // 超时也必须回合成响应 —— 让调用方拿到明确错误，而不是干等到自己断开。
  const AGENT_TIMEOUT_MS = 120000;

  // =====================================================================
  // agent 调用通道
  // ---------------------------------------------------------------------
  // 命令表见 dev/xhs.mjs（本机工具，不进扩展包）。协议：
  //
  //   本机脚本  fetch(AGENT_ENDPOINT?__xhsAgent=1&d=<JSON {id,action,args}>)
  //       │ ① 本 hook 拦下（**不真发网络**）
  //       ▼
  //   window.postMessage({__xhsAgent, type:'req', id, action, args})
  //       ▼
  //   content.js（ISOLATED）→ background 的 AGENT_ACTIONS 白名单路由执行
  //       ▼
  //   content.js 回 postMessage({__xhsAgent, type:'res', id, ok, ...})
  //       │ ② 本文件的 pending 表认领这条 res
  //       ▼
  //   用**合成 Response** 把执行结果作为响应体带回调用方
  //
  // 为什么命令放在 query 上：Request 构造器拒绝 GET 带请求体，
  // POST 又会触发 CORS 预检；query 是最简单能过的形态。
  //
  // ⚠️ 走过的弯路（别重走）：第一版 ① 用 `url === AGENT_ENDPOINT` 全等匹配，
  //    而调用方 URL 带 query，全等永远不相等 —— 通道从第一环就断了；
  //    ② 拦下后又去 res.text() 找命令 —— robots.txt 的正文当然不是 JSON；
  //    ③ 等待器挂在 ISOLATED 的 window 上，MAIN world 看不见。
  //    三处叠加，端到端断裂且完全静默。行为测试见 dev/agent-test.mjs。
  const AGENT_PENDING = new Map();   // id → 把 res 变成合成 Response 的函数

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.__xhsAgent !== true || d.type !== 'res') return;
    const pending = AGENT_PENDING.get(d.id);
    if (!pending) return;               // 迟到 / 无人认领的 res，丢弃
    AGENT_PENDING.delete(d.id);
    pending(d);
  });

  function agentResponse(answer) {
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }

  /** 拦下一条 agent 调用，返回装着执行结果的合成 Response 的 Promise。 */
  function handleAgentCall(fullUrl) {
    return new Promise(function (resolve) {
      let cmd = null;
      try {
        cmd = JSON.parse(new URL(fullUrl).searchParams.get('d') || 'null');
      } catch (_) { cmd = null; }

      const id = cmd && cmd.id ? String(cmd.id) : 'anon-' + Date.now();

      if (!cmd || !cmd.action) {
        resolve(agentResponse({
          ok: false, id: id,
          error: 'agent 命令缺失：query 需带 __xhsAgent=1 与 d=<JSON {id,action,args}>'
        }));
        return;
      }

      const timer = setTimeout(function () {
        AGENT_PENDING.delete(id);
        resolve(agentResponse({
          ok: false, id: id,
          error: '扩展执行超时（' + (AGENT_TIMEOUT_MS / 1000) + 's）——确认扩展已启用、页面仍开着'
        }));
      }, AGENT_TIMEOUT_MS);

      AGENT_PENDING.set(id, function (answer) {
        clearTimeout(timer);
        resolve(agentResponse(answer));
      });

      // req 直接发：真正的门在 background 的 AGENT_ACTIONS 白名单，
      // content.js 的中继是常驻监听，不存在「要先等它就绪」的时序问题。
      // （旧版在这里先等一个 MAIN world 永远看不见的等待器，构成死锁。）
      try {
        window.postMessage({ __xhsAgent: true, type: 'req', id: id, action: cmd.action, args: cmd.args || {} }, '*');
      } catch (e) {
        AGENT_PENDING.delete(id);
        clearTimeout(timer);
        resolve(agentResponse({ ok: false, id: id, error: 'postMessage 失败：' + (e && e.message) }));
      }
    });
  }

  function emit(entry) {
    try {
      window.postMessage({ __xhsNet: true, entry: entry }, '*');
    } catch (_) {
      // postMessage 失败不影响页面
    }
  }

  function clipUrl(url) {
    const s = String(url || '');
    return s.length > MAX_URL ? s.slice(0, MAX_URL) + '…' : s;
  }

  // ---------- fetch ----------
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function () {
      const args = arguments;

      // 请求 URL：字符串，或 Request 对象
      let url = '';
      try {
        const a0 = args[0];
        url = typeof a0 === 'string' ? a0 : (a0 && a0.url) || '';
      } catch (_) {}

      // ========== agent 调用通道 ==========
      // 两道门槛缺一不可：
      //   ① 端点**前缀**匹配 —— 调用方的命令在 query 上，全等永远不相等；
      //   ② 显式 __xhsAgent=1 旗标 —— 页面对 robots.txt 的普通请求
      //      （无旗标）原样放行，进不去这条通道。
      if (url) {
        let flagged = false;
        try {
          flagged = String(url).indexOf(AGENT_ENDPOINT) === 0
            && new URL(url).searchParams.get('__xhsAgent') === '1';
        } catch (_) {}
        if (flagged) return handleAgentCall(String(url));
      }

      const p = origFetch.apply(this, args);

      p.then(function (res) {
        try {
          const ct = (res.headers && res.headers.get('content-type')) || '';
          // 只留可能带数据的响应，图片/字体/CSS 直接丢掉不占额度
          const base = { kind: 'fetch', url: clipUrl(url), status: res.status, contentType: ct, ts: Date.now() };
          if (/json|text|javascript|xml/i.test(ct)) {
            res.clone().text().then(function (t) {
              base.body = String(t).slice(0, MAX_BODY);
              base.truncated = String(t).length > MAX_BODY;
              emit(base);
            }).catch(function () {
              emit(base);
            });
          } else {
            emit(base);
          }
        } catch (_) {}
        return res;
      }).catch(function () {});

      return p;
    };
  }

  // ---------- XMLHttpRequest ----------
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open;
    const origSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      try {
        this.__xhsMeta = { method: String(method || 'GET'), url: clipUrl(url) };
      } catch (_) {}
      return origOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      try {
        const self = this;
        this.addEventListener('load', function () {
          try {
            const m = self.__xhsMeta || {};
            let body = '';
            // responseType 为 '' 或 'text' 时 responseText 可读
            if (self.responseType === '' || self.responseType === 'text') {
              try { body = String(self.responseText || ''); } catch (_) {}
            }
            emit({
              kind: 'xhr',
              method: m.method || 'GET',
              url: m.url || '',
              status: self.status,
              contentType: (self.getResponseHeader && self.getResponseHeader('content-type')) || '',
              body: body.slice(0, MAX_BODY),
              truncated: body.length > MAX_BODY,
              ts: Date.now()
            });
          } catch (_) {}
        });
      } catch (_) {}
      return origSend.apply(this, arguments);
    };
  }

})();
