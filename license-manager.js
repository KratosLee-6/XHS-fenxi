/**
 * license-manager.js — 授权状态在 background 里的落盘与判定
 *
 * 职责边界（刻意收窄）：
 *   - 租约的**密码学**在 license.js（纯逻辑，可沙箱测）
 *   - 这里只做**存取 + 每日额度计数 + 时钟水位**
 *
 * 为什么要单独一个文件：`chrome.storage` 和 `Date.now()` 都是不可测的副作用。
 * 把它们关在这里，license.js 才能在 Node 里被真跑几十条断言。
 *
 * ⚠️ 阶段零的定位必须说清楚：
 *   这套机制的作用是**让「有效期到某天」变成真会到期的东西**，
 *   而不是防破解。真正开始收费后仍需补设备密钥 challenge-response
 *   （设计文档 3.1）与在线续租（3.3 的 L2/L3）。
 */

// ========== 存储 key（AGENTS.md：xhs 前缀，集中声明）============
const LICENSE_KEY = 'xhsLicense';        // { code, payload, activatedAt }
const LICENSE_USAGE_KEY = 'xhsAiUsage';  // { '2026-10-04': { text: n, vision: n } }
const LICENSE_CLOCK_KEY = 'xhsClockMark';// { highWater: ms }

/** 单飞：避免并发消息各读一次 storage、各算一次状态。 */
let _licenseStatePromise = null;

/**
 * 取当前授权判定。
 *
 * 每次调用都**重新验签**（~1-2ms，纯 CPU）而不是信任上次结果 ——
 * 因为 storage 里的东西用户随时可能改，缓存等于把判定权交出去。
 * 单飞只是避免同一次事件循环里重复读 storage。
 */
async function getLicenseState() {
  if (_licenseStatePromise) return _licenseStatePromise;
  _licenseStatePromise = (async () => {
    try {
      // ⚠️ chrome.storage.local.get(数组) 返回的是**对象**（按 key 索引），
      //    不是数组 —— 曾经写成 `const [lic, usage, clock] = await ...get([...])`，
      //    数组解构直接抛 "not iterable"，每次状态读取都被 catch 兜成
      //    unactivated：激活明明落了盘，界面却永远「读取失败/未激活」。
      //    而 license-test 只测纯逻辑层，这个胶水 bug 漏过了全部 35 道闸 ——
      //    现在由 dev/license-glue-test.mjs 用**真形状** mock 盯着。
      const stored = await chrome.storage.local.get([
        LICENSE_KEY, LICENSE_USAGE_KEY, LICENSE_CLOCK_KEY
      ]);
      const lic = stored[LICENSE_KEY];
      const usage = stored[LICENSE_USAGE_KEY];
      const clock = stored[LICENSE_CLOCK_KEY];

      // ---- 时钟水位：先于一切判定 ----
      const now = Date.now();
      let highWater = clock?.highWater || 0;
      const rollback = XhsLicense.checkClockRollback(highWater, now);
      // 只升不降：见到更大的时间就抬高水位
      if (now > highWater) {
        highWater = now;
        await chrome.storage.local.set({ [LICENSE_CLOCK_KEY]: { highWater } });
      }

      // ---- 用量（按本地自然日）----
      const today = new Date(now).toISOString().slice(0, 10);
      const dayUsage = usage?.[today] || { text: 0, vision: 0 };

      // ---- 验签 ----
      // 没有码就是未激活，这**不是错误**：阶段零允许先看后激活。
      let payload = null;
      let verified = null;
      if (lic?.code) {
        verified = await XhsLicense.verifyLicense(lic.code);
        if (verified.ok) payload = verified.payload;
      }

      const verdict = XhsLicense.evaluateState(payload, {
        now,
        aiUsedToday: dayUsage.text,
        aiVisionUsedToday: dayUsage.vision
      });

      return {
        ...verdict,
        // 附加信息给 UI 用，不参与判定
        sub: payload?.sub || null,
        code: lic?.code || null,
        activatedAt: lic?.activatedAt || null,
        quota: payload?.quota || null,
        aiUsedToday: dayUsage.text,
        aiVisionUsedToday: dayUsage.vision,
        // ⚠️ 时钟回拨是**独立于订阅状态**的一条告警。
        //    签名在时间被调回时依然有效（密码学上做不到绑定当前时间），
        //    所以必须显式把这条边界告诉用户，而不是悄悄放行。
        clockRollback: rollback.rolledBack,
        clockDeltaMs: rollback.delta,
        verifyError: verified && !verified.ok ? verified.error : null
      };
    } catch (e) {
      console.warn('[XHS License] 状态读取失败：', e);
      // 读失败不等于没授权，但也绝不能因此当成有授权。
      // 这里保守返回未激活，并把错误如实带出去。
      return {
        state: XhsLicense.STATES.UNACTIVATED,
        plan: null, usable: false, aiAllowed: false,
        sub: null, code: null, activatedAt: null, quota: null,
        aiUsedToday: 0, aiVisionUsedToday: 0,
        clockRollback: false, clockDeltaMs: 0,
        verifyError: '授权状态读取失败'
      };
    } finally {
      _licenseStatePromise = null;
    }
  })();
  return _licenseStatePromise;
}

/**
 * 激活：验签 → 通过才落盘。
 *
 * ⚠️ 失败时**不写任何东西**。半成品租约留在 storage 里
 * 只会让下一次启动读到一个既非未激活也非有效的诡异状态。
 */
async function activateLicense(code) {
  const result = await XhsLicense.verifyLicense(code);
  if (!result.ok) {
    return { success: false, code: result.code, error: result.error };
  }

  const now = Date.now();
  // 已被判定为时钟回拨时拒绝激活：否则「改时间→激活一张长码」是个可行的续命路子
  const { highWater } = (await chrome.storage.local.get([LICENSE_CLOCK_KEY]))[LICENSE_CLOCK_KEY] || {};
  const rollback = XhsLicense.checkClockRollback(highWater, now);
  if (rollback.rolledBack) {
    return {
      success: false,
      code: 'CLOCK_ROLLBACK',
      error: '检测到本机时间被调回，请先把系统时间改正确再激活'
    };
  }

  await chrome.storage.local.set({
    [LICENSE_KEY]: { code: code.trim(), payload: result.payload, activatedAt: now }
  });
  _licenseStatePromise = null;

  return { success: true, data: await getLicenseState() };
}

/** 解除激活。注意：只清租约，不清用户的采集数据与 AI 历史。 */
async function clearLicense() {
  await chrome.storage.local.remove(LICENSE_KEY);
  _licenseStatePromise = null;
  return { success: true };
}

/**
 * 记一次 AI 用量。
 *
 * ⚠️ 本地计数**只是给用户看的一个提示**，不是安全边界。
 *    设计文档 2.5 说得很直白：额度必须由服务器签名下发、
 *    扣减以服务器为准，因为「客户端本地计数」等于把校验交给可改的代码。
 *    阶段零没有服务器，所以这里只做**诚实的本地统计 + 超额时提示**。
 *
 * 视觉与文本分开计：视觉额度是专业席的分界（2.1），两者不能混算。
 */
async function recordAiUsage(kind = 'text') {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const all = (await chrome.storage.local.get([LICENSE_USAGE_KEY]))[LICENSE_USAGE_KEY] || {};

  // 顺手清掉 7 天前的记录，否则 storage 会无限增长
  const keep = {};
  for (const [day, val] of Object.entries(all)) {
    const age = (now - Date.parse(day + 'T00:00:00Z')) / 86400000;
    if (age <= 7) keep[day] = val;
  }

  const cur = keep[today] || { text: 0, vision: 0 };
  if (kind === 'vision') cur.vision += 1;
  else cur.text += 1;
  keep[today] = cur;

  await chrome.storage.local.set({ [LICENSE_USAGE_KEY]: keep });
  _licenseStatePromise = null;
  return { success: true, today: cur };
}
