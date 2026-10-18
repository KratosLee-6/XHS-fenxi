/**
 * license.js — 授权租约的**离线**签发与验签
 *
 * ============================ 为什么没有服务器 ============================
 * 阶段零（docs/rpa/商业授权设计.md 7.0）是「邀请制免费内测」，
 * 目标是在写任何后端之前先验证「有没有人愿意用」。
 * 但「锁到某年某月」这种承诺，只有存在一套**真的会到期**的机制才成立，
 * 否则就是空头支票 —— 而这正是本文件存在的唯一理由。
 *
 * 所以这里用一套**零服务器**的方案：
 *
 *   运营者本地签发  →  用户粘贴邀请码  →  扩展用内置公钥验签  →  存本地
 *                    （dev/mint-license.mjs）      （本文件）
 *
 * 签名用 WebCrypto 的 ECDSA P-256。**不引入任何第三方密码库** ——
 * `crypto.subtle` 就是标准答案，且它在 MV3 Service Worker 里可用
 * （这正是 AGENTS.md「SW 里不能有 Node API」的正解）。
 *
 * ============================ 诚实的边界 ============================
 * 这套机制能挡的（见设计文档 0.3）：
 *   ✅ 用户手改 `chrome.storage.local` 里的租约 → 验签失败
 *   ✅ 自己伪造一张「永久专业席」      → 没有私钥，签不出来
 *   ✅ 把过期码改个日期接着用        → 签名覆盖整个 payload，改即失效
 *   ✅ 把本机时间调回过去            → 时钟水位检测（见 checkClockRollback）
 *
 * 这套机制挡不住的（**不要向用户承诺这些**）：
 *   ❌ 替换扩展里的公钥自己重新签发（0.3 已记录：挡不住）
 *   ❌ 分享邀请码给别人一起用（**码是一次性消费品，见 7.0**）
 *   ❌ 反代 Web API —— 但 Q0=A 下 AI Key 是用户自己的，反代没有价值
 *
 * 最后一条尤其重要：正因为选了「用户自带 Key」，这套系统**不需要防反代**，
 * 也就绕开了设计文档 3.4 里最重的那部分。成本因此塌到接近零。
 */

// ========== 常量 ==========

/**
 * 内置公钥（JWK, P-256 公钥）。
 *
 * ⚠️ 这是**占位公钥**，用于让流程跑通。
 *    正式发布前必须换成你自己生成的那对密钥的公钥：
 *      node dev/mint-license.mjs --keygen
 *    私钥存在 dev/license-key.json，**已在 .gitignore 中，绝不能提交**。
 *
 * 为什么公钥可以公开：公钥只能验签，不能签发。
 * 安全性完全取决于私钥不泄露（设计文档 3.2）。
 */
const LICENSE_PUBKEY_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'VuPceYrvwTOajaVcAAvQYm1vgDgPQ9oDa44ydmdhCrg',
  y: 'b4ndlo788k0Bnz_Y03g0IOK_4mjtXR24rE7WXVG2kUY'
};

/** 租约版本号。结构不兼容变更时 +1，验签时拒绝不匹配的版本。 */
const LICENSE_VERSION = 1;

/** 宽限期：到期后仍可用全功能的时长（设计文档 2.4 / 3.3：72 小时）。 */
const GRACE_MS = 72 * 60 * 60 * 1000;

/**
 * 5 个状态（设计文档 2.4 的「AI 额度耗尽」是与「订阅到期」并列的第 5 态，
 * 把两者混为一谈是最容易引发愤怒的做法）：
 *
 *   unactivated  未激活    —— 阶段零下等于「你没拿到邀请码」
 *   active       有效
 *   grace        宽限      —— 已过期但在 72h 内，功能全在
 *   expired      已过期    —— 只读，数据与导出全部保留
 *   quota_exhausted 额度用尽 —— ⚠️ 订阅有效、只有 AI 被限流
 */
const STATES = {
  UNACTIVATED: 'unactivated',
  ACTIVE: 'active',
  GRACE: 'grace',
  EXPIRED: 'expired',
  QUOTA_EXHAUSTED: 'quota_exhausted'
};

/** 时钟水位允许的回拨容差（毫秒）。人手动改时间通常会差得更多。 */
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

// ========== 编码工具 ==========

/** UTF-8 字符串 → ArrayBuffer。签名与验签两侧必须完全一致。 */
function encodeUtf8(str) {
  return new TextEncoder().encode(str);
}

/** ArrayBuffer → base64url（无 padding）。 */
function toBase64Url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → ArrayBuffer。 */
function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * 签名覆盖的**规范化字节**。
 *
 * ⚠️ 这是整个系统最容易出错的地方：签名与验签必须对**完全相同的字节**操作。
 * 所以这里只允许对 payload 做 JSON.stringify，并**按固定键序**重建对象 ——
 * 直接 stringify 原始对象会依赖插入顺序，一旦某天改了顺序，历史租约全部失效。
 */
function canonicalize(payload) {
  const ordered = {
    v: payload.v,
    sub: payload.sub,
    plan: payload.plan,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
    features: payload.features,
    quota: {
      aiTextDaily: payload.quota?.aiTextDaily ?? 0,
      aiVisionDaily: payload.quota?.aiVisionDaily ?? 0,
      aiConcurrency: payload.quota?.aiConcurrency ?? 1
    }
  };
  return encodeUtf8(JSON.stringify(ordered));
}

// ========== 验签 ==========

/**
 * 验签并解析租约。
 *
 * @param {string} code       用户粘贴的完整邀请码（payload.sig）
 * @param {object} [pubKey]   公钥 JWK，默认用内置公钥
 * @param {object} [subtle]   crypto.subtle，测试时可注入
 * @returns {Promise<{ok: true, payload: object} | {ok: false, code: string, error: string}>}
 *
 * 返回 `{ok:false}` 而不是抛异常：邀请码是**用户输入**，
 * 格式错误是预期内的正常分支，不该变成一个红色异常。
 */
async function verifyLicense(code, pubKey = LICENSE_PUBKEY_JWK, subtle = globalThis.crypto?.subtle) {
  if (typeof code !== 'string' || !code.trim()) {
    return { ok: false, code: 'EMPTY', error: '邀请码为空' };
  }

  const parts = code.trim().split('.');
  if (parts.length !== 2) {
    return { ok: false, code: 'MALFORMED', error: '邀请码格式不正确（应为两段，以 . 分隔）' };
  }

  const [payloadB64, sigB64] = parts;

  // 先解 payload —— 但**绝不能信任它的内容**，签名校验通过之前它只是待验证的字节。
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
  } catch {
    return { ok: false, code: 'MALFORMED', error: '邀请码内容无法解析' };
  }

  if (!subtle) {
    return { ok: false, code: 'NO_CRYPTO', error: '当前环境不支持 crypto.subtle' };
  }
  if (pubKey.x === 'REPLACE_ME_x') {
    return {
      ok: false,
      code: 'PUBKEY_PLACEHOLDER',
      error: '扩展内置的验签公钥还是占位值，需先用 dev/mint-license.mjs --keygen 生成正式密钥对'
    };
  }

  let key;
  try {
    key = await subtle.importKey('jwk', pubKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  } catch {
    return { ok: false, code: 'BAD_PUBKEY', error: '内置验签公钥不合法' };
  }

  // 关键：验签的是**规范化后的字节**，不是用户传进来的原始字节。
  // 少这一步的话，改 JSON 空白就能改变字节表示，让同一份 payload 验出不同结果。
  let valid = false;
  try {
    valid = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      fromBase64Url(sigB64),
      canonicalize(payload)
    );
  } catch {
    valid = false;
  }

  if (!valid) {
    // ⚠️ 错误文案刻意**不区分**「签名不匹配」与「被篡改」：
    //    区分开等于给攻击者一个 oracle，告诉他是哪一字节改错了。
    return { ok: false, code: 'BAD_SIGNATURE', error: '邀请码签名校验失败，可能已被改动' };
  }

  if (payload.v !== LICENSE_VERSION) {
    return { ok: false, code: 'VERSION', error: `邀请码版本不兼容（v${payload.v}）` };
  }

  return { ok: true, payload };
}

// ========== 时钟回拨 ==========

/**
 * 检测本机时间是否被调回过去。
 *
 * 设计文档 2.5 诚实地记录了这条边界：「把本地时间调回过去，签名依然有效」
 * —— 因为签名验的是内容，不绑定当前时间。**这是密码学上做不到的**。
 *
 * 能做的是**用水位线**近似挡住：记下见过的最大时间，
 * 之后一旦发现当前时间明显小于它，就判定为回拨。
 * 挡不住「回拨后一直保持在一个合法区间」的精巧做法 —— 这一点必须写进文档。
 *
 * @param {number} lastSeen  上次记录的最大时间戳（ms）。0 表示首次运行。
 * @param {number} now       当前时间戳（ms）
 * @returns {{rolledBack: boolean, delta: number}}
 */
function checkClockRollback(lastSeen, now) {
  if (!lastSeen || lastSeen <= 0) return { rolledBack: false, delta: 0 };
  const delta = now - lastSeen;
  return { rolledBack: delta < -CLOCK_TOLERANCE_MS, delta };
}

// ========== 状态判定 ==========

/**
 * 由已验签的 payload 判定当前状态。
 *
 * **纯函数**：只吃 payload + now + 用量，不碰 chrome、不碰网络。
 * 这样每一个状态分支都能被测试直接断言，不需要浏览器。
 *
 * @param {object|null} payload  已验签的 payload；null = 未激活
 * @param {object} [ctx]
 * @param {number} [ctx.now]                当前时间，默认 Date.now()
 * @param {number} [ctx.aiUsedToday]        今日已用 AI 次数
 * @param {number} [ctx.aiLimitToday]       今日额度（由 payload 决定，调用方传入已解析值）
 */
function evaluateState(payload, ctx = {}) {
  const now = ctx.now ?? Date.now();

  if (!payload) {
    return { state: STATES.UNACTIVATED, plan: null, usable: false, aiAllowed: false };
  }

  const expiresAt = payload.expiresAt;
  const graceEnd = expiresAt + GRACE_MS;

  // ---- 过期与宽限：先判时间，因为它决定「能不能用」，而额度只在能用的前提讨论 ----
  if (now > graceEnd) {
    // ⚠️ 到期只降级，**绝不删用户数据**（设计文档 2.4）。已采集的数据与导出全部保留。
    return {
      state: STATES.EXPIRED,
      plan: payload.plan,
      usable: false,
      aiAllowed: false,
      // 把这两个时间带出去，UI 才写得出来「已过期 xx 天」而不是「已过期」
      expiredAt: expiresAt,
      daysPastDue: Math.floor((now - expiresAt) / 86400000)
    };
  }

  if (now > expiresAt) {
    return {
      state: STATES.GRACE,
      plan: payload.plan,
      usable: true,      // 宽限期内功能全在，只是提醒
      aiAllowed: true,
      graceEndsAt: graceEnd,
      hoursLeftInGrace: Math.max(0, Math.floor((graceEnd - now) / 3600000))
    };
  }

  // ---- 订阅有效。接下来才轮到额度 ----
  // ⚠️ 额度耗尽**不能**降级整个产品（设计文档 2.4）：
  //    本地采集、历史、导出全部照常，只有 AI 被限流。
  //    这两件事混为一谈是最容易引发愤怒的做法。
  const used = ctx.aiUsedToday ?? 0;
  const limit = ctx.aiLimitToday ?? payload.quota?.aiTextDaily ?? 0;
  const visionUsed = ctx.aiVisionUsedToday ?? 0;
  const visionLimit = payload.quota?.aiVisionDaily ?? 0;

  let quotaHit = false;
  if (limit > 0 && used >= limit) quotaHit = true;
  if (visionLimit > 0 && visionUsed >= visionLimit) quotaHit = true;

  if (quotaHit) {
    return {
      state: STATES.QUOTA_EXHAUSTED,
      plan: payload.plan,
      usable: true,      // ← 关键：产品照常可用
      aiAllowed: false,  // ← 只有 AI 被拦
      aiUsedToday: used,
      aiLimitToday: limit
    };
  }

  const daysLeft = Math.floor((expiresAt - now) / 86400000);
  return {
    state: STATES.ACTIVE,
    plan: payload.plan,
    usable: true,
    aiAllowed: true,
    expiresAt,
    daysLeft,
    // 3 天内到期 → UI 该开始提醒了
    shouldRemind: daysLeft <= 3
  };
}

// ========== 特征门控 ==========

/**
 * 某个功能在当前状态下是否允许。
 *
 * ⚠️ 阶段零是**免费内测**，所以没有付费用户，
 * 「特征门控」暂时全部放行 —— 这里只把判定逻辑搭好，
 * 等真的开始收费时，这里就是唯一需要改的地方。
 *
 * 刻意写成数据驱动而不是散落的 if：
 * 将来加档位时改 PLAN_FEATURES 一张表，而不是去翻 20 个调用点。
 */
const PLAN_FEATURES = {
  beta: ['scrape', 'analyze', 'rewrite', 'generate', 'automation', 'benchmark', 'ai'],
  basic: ['scrape', 'analyze', 'rewrite', 'generate', 'automation', 'benchmark', 'ai'],
  pro: ['scrape', 'analyze', 'rewrite', 'generate', 'automation', 'benchmark', 'ai', 'ai_vision']
};

function hasFeature(verdict, feature) {
  // 未激活 / 已过期 → 只读：数据查看与导出仍然可用（设计文档 3.3 的 L0）
  if (verdict.state === STATES.UNACTIVATED || verdict.state === STATES.EXPIRED) {
    return feature === 'view' || feature === 'export';
  }
  const allowed = PLAN_FEATURES[verdict.plan] || PLAN_FEATURES.beta;
  if (!allowed.includes(feature)) return false;
  // AI 类特征额外受额度约束
  if (feature === 'ai' || feature === 'ai_vision') return verdict.aiAllowed;
  return true;
}

// ========== 供 background.js 挂载 ==========
// 用单个对象挂到全局，避免顶层散落几十个名字。
// 命名空间化也让测试可以只取这一个对象注入沙箱。
const XhsLicense = {
  LICENSE_PUBKEY_JWK,
  LICENSE_VERSION,
  GRACE_MS,
  CLOCK_TOLERANCE_MS,
  STATES,
  PLAN_FEATURES,
  verifyLicense,
  checkClockRollback,
  evaluateState,
  hasFeature,
  canonicalize,
  toBase64Url,
  fromBase64Url,
  encodeUtf8
};

if (typeof globalThis !== 'undefined') {
  globalThis.XhsLicense = XhsLicense;
}
