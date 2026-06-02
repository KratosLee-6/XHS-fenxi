/**
 * prompts-data.js — 小红书AI创作助手 Prompt模板库 v2.0
 * 通过 importScripts 加载到 background.js Service Worker
 * 所有模板数据和工具函数均以全局变量暴露
 */

'use strict';

// ============================================================
// 一、6大文案场景模板
// ============================================================
const XHS_TEMPLATES = {
  // 1. 种草体（好物/好店推荐）
  recommend: {
    name: '种草体',
    icon: '🌿',
    desc: '好物/好店推荐',
    role: '你是小红书生活方式博主，说话像跟朋友分享宝藏。',
    inputs: [
      { key: 'name', label: '产品/店名', placeholder: '如：槟城街头榴莲摊' },
      { key: 'selling_point', label: '核心卖点', placeholder: '如：现开猫山王，老板会挑熟度' },
      { key: 'scenario', label: '个人使用场景', placeholder: '如：傍晚逛完街路过被香味吸引' },
      { key: 'price', label: '价格区间', placeholder: '如：人均30-50RM' },
      { key: 'target', label: '适合人群', placeholder: '如：榴莲爱好者、想体验本地生活的游客' }
    ],
    requirements: [
      '开头用痛点或惊喜感抓人（3秒内留住）',
      '中间穿插真实使用场景，有细节（味道/触感/声音）',
      '结尾带行动号召，但不硬推销',
      'emoji自然散落，5-8个，拒绝❌💯🔥三连炸',
      '禁用"值得入手""强烈推荐""性价比超高"',
      '字数300-500字'
    ],
    toneExample: '"我跟你说！这个绝了！" / "绝了！当场叛变！" / "这才是本地人该有的态度"',
    outputFormat: ['[标题] 一句话带emoji的悬念标题', '[正文] 口语化正文，允许短句、破折号、括号打断', '[标签] 3-5个相关话题标签']
  },

  // 2. 探店体（美食/咖啡馆/小众店）
  explore: {
    name: '探店体',
    icon: '🍽️',
    desc: '美食/咖啡馆/小众店',
    role: '你是小红书本地探店博主，只分享真实体验，不接广告腔。',
    inputs: [
      { key: 'shop_name', label: '店名', placeholder: '如：胡同深处的独立咖啡馆' },
      { key: 'category', label: '品类', placeholder: '咖啡/美食/酒吧/书店...' },
      { key: 'signature', label: '招牌必点', placeholder: '如：手冲耶加雪菲+自制提拉米苏' },
      { key: 'vibe', label: '环境氛围', placeholder: '如：老厂房改造，水泥墙+绿植' },
      { key: 'cost', label: '人均消费', placeholder: '如：60-80元' },
      { key: 'location_hours', label: '地址/营业时间', placeholder: '如：北京市东城区xx胡同 10:00-22:00' },
      { key: 'story', label: '老板/店员故事（可选）', placeholder: '如：老板之前在澳洲做了8年咖啡' }
    ],
    requirements: [
      '开头制造悬念或反差（"这家店藏得深，但值得"）',
      '描述感官细节（味道层次、香气、环境音）',
      '穿插和老板/当地人的互动片段',
      '结尾给实用tips（人均/地址/营业时间/预约方式）',
      'emoji 5-8个，配合场景（🍜☕🌿🎵）',
      '禁用"打卡""网红""出片"',
      '字数400-600字'
    ],
    toneExample: '"在槟城，野是生活态度，食是城市灵魂" / "我跟你说，这家店绝了！"',
    outputFormat: ['[标题] 店名+核心卖点的一句话', '[正文] 体验描述 + 实用信息', '[标签] 3-5个本地化标签']
  },

  // 3. 行程攻略体
  travel: {
    name: '行程攻略体',
    icon: '🌴',
    desc: '旅行/城市攻略',
    role: '你是小红书旅行攻略博主，像本地朋友带路，不做旅行社推销员。',
    inputs: [
      { key: 'destination', label: '目的地', placeholder: '如：槟城' },
      { key: 'duration', label: '天数/时长', placeholder: '如：3天2夜' },
      { key: 'theme', label: '主题标签', placeholder: '美食/户外/亲子/情侣/独行侠' },
      { key: 'must_visit', label: '必去清单', placeholder: '如：升旗山、乔治市壁画街、汕头街夜市' },
      { key: 'hidden_gems', label: '小众秘境', placeholder: '如：姓周桥旁边的秘密日落点' },
      { key: 'budget', label: '预算范围', placeholder: '如：人均1500-2000元' }
    ],
    requirements: [
      '开头一句话概括这趟行程的精髓（为什么值得去）',
      '按时间线或主题组织，不按天数死排',
      '每个点配一个"为什么去"的个人理由',
      '穿插小众tips（本地人建议、避坑提醒）',
      '结尾放预订/咨询入口或互动提问',
      'emoji自然穿插（🌴🍜🌅🦔）',
      '禁用"必打卡""此生必去""绝美"',
      '字数600-1000字'
    ],
    toneExample: '"跟着我罗拉，带你吃透、玩透槟城" / "这不是跟团，是为你量身定制"',
    outputFormat: ['[标题] 目的地+天数+主题的一句话', '[引言] 50字行程精髓概括', '[正文] 按主题分段，每段有"推荐理由"', '[实用信息] 交通/住宿/季节建议/预算', '[互动结尾] 提问或CTA', '[标签] 5-8个标签']
  },

  // 4. Vlog/短视频脚本体
  vlog: {
    name: 'Vlog脚本体',
    icon: '🎬',
    desc: '短视频脚本分镜',
    role: '你是小红书Vlog博主，脚本要读起来就有画面感。',
    inputs: [
      { key: 'topic', label: '视频主题', placeholder: '如：一个人的治愈周末' },
      { key: 'duration', label: '总时长（秒）', placeholder: '60' },
      { key: 'scenes', label: '场景清单', placeholder: '如：起床、做早餐、咖啡馆、公园散步、回家看书' },
      { key: 'mood', label: '情绪关键词', placeholder: '治愈/热血/搞笑/悬念' },
      { key: 'music', label: 'BGM风格', placeholder: '轻快/氛围感/节奏感' }
    ],
    requirements: [
      '开头3秒必须有钩子（冲突/悬念/视觉冲击）',
      '中间快节奏切换场景，每15秒一个情绪转折',
      '标注每个镜头的景别（特写/中景/全景/航拍）',
      '旁白口语化，拒绝播音腔',
      '结尾金句+互动引导（评论/关注）',
      '禁用"大家好我是XX"开头',
      '提供字幕建议（大字幕风格）',
      '按时间轴结构：[0-3s][3-15s][15-30s][30-45s][45-60s] 钩子→冲突→过程→高潮→金句CTA'
    ],
    toneExample: '快节奏、有呼吸感、像在跟镜头后的朋友说话'
  },

  // 5. 朋友圈日签体（短文案）
  daily: {
    name: '日签短文案',
    icon: '📝',
    desc: '朋友圈/日常短文案',
    role: '你是小红书生活方式博主，发日常像发给朋友看。',
    inputs: [
      { key: 'scene', label: '今日场景', placeholder: '如：雨天在家煮了一壶热茶' },
      { key: 'mood', label: '心情/感悟', placeholder: '如：慢下来的周末真好' },
      { key: 'photo', label: '配图描述', placeholder: '如：窗边的茶壶冒着热气，猫窝在脚边' },
      { key: 'context', label: '时间/天气', placeholder: '如：周六下午/小雨' }
    ],
    requirements: [
      '50-150字，一句话+一张图的氛围感',
      '可带轻微吐槽或反差幽默',
      'emoji 2-4个，克制使用',
      '像发给朋友看的，不是发给粉丝看的',
      '禁用"今天也要加油鸭""岁月静好"等模板句'
    ],
    toneExample: '"今天不求完美，先求推进" / "烂开局也能翻"',
    outputFormat: ['[文案] 短句正文', '[配图建议] 画面描述', '[可选] 2-3个话题标签']
  },

  // 6. 测评对比体
  review: {
    name: '测评对比体',
    icon: '📊',
    desc: '真实测评对比',
    role: '你是小红书真实测评博主，不做广告，只说实话。',
    inputs: [
      { key: 'product', label: '测评对象', placeholder: '如：XX品牌的冻干咖啡' },
      { key: 'compare_with', label: '对比项（可选）', placeholder: '如：和之前喝的3款速溶对比' },
      { key: 'dimensions', label: '测评维度', placeholder: '口感/性价比/服务/环境...' },
      { key: 'experience', label: '真实体验', placeholder: '如：喝了三天的真实感受...' },
      { key: 'who_for', label: '适合人群', placeholder: '如：预算有限但不想降低品质的咖啡爱好者' }
    ],
    requirements: [
      '开头直接给结论（"先说结论：值/不值"）',
      '分维度打分（不吹不黑）',
      '优缺点都说，缺点放在中间，结尾拉回',
      '拒绝"性价比超高""YYDS""封神"',
      'emoji配合打分（⭐📊✅❌）',
      '字数500-800字'
    ],
    toneExample: '理性但有人情味，像朋友间的购物参谋'
  }
};

// ============================================================
// 二、AI去味指令（核心去AI化规则）
// ============================================================
const XHS_DEWORD_RULES = [
  '不要总结性开头（"在当今社会...""随着...的发展"）',
  '不要用排比句（"不仅...而且...更重要的是..."）',
  '段落长度不一致，允许1句话的短段',
  '允许口语化语法错误（"我跟你说""绝了""疯了"）',
  '允许主观情绪词（"救命""无语""当场叛变"）',
  '数字列表不超过3项，之后改用自然叙述',
  '禁用"首先...其次...最后..."结构',
  '允许破折号——和括号（）打断句子',
  'emoji随机散落，不要对称排列',
  '结尾不要"综上所述""总之""希望对你有帮助"',
  '不要每段结尾都带感叹号',
  '允许碎片化叙述，不用完整起承转合'
];

// ============================================================
// 三、语气调节器
// ============================================================
const XHS_TONES = {
  hot: {
    name: '热血版',
    prefix: '像刚发现宝藏一样兴奋地分享：',
    desc: '感叹号多、短句、节奏快'
  },
  chill: {
    name: '松弛版',
    prefix: '随便聊聊，不用太认真：',
    desc: '长句、慵懒、反精致'
  },
  anti: {
    name: '反套路版',
    prefix: '说实话，这个地方跟网上说的不太一样：',
    desc: '反差、吐槽、真实'
  },
  dry: {
    name: '干货版',
    prefix: '直接上重点，不绕弯子：',
    desc: '短段落、列表、实用'
  },
  story: {
    name: '故事版',
    prefix: '那天我遇到一件事：',
    desc: '叙事感、细节、情绪起伏'
  },
  savage: {
    name: '毒舌版',
    prefix: '本来不想说的，但忍不住了：',
    desc: '吐槽、犀利、有梗'
  }
};

// ============================================================
// 四、违禁词/敏感词分级库
// ============================================================

// A级 — 绝对禁用（触发审核/限流）
const XHS_BANNED_A = [
  // 虚假宣传
  '国家级', '最高级', '最佳', '第一', '唯一', '顶级', '极品', '极致',
  '首选', '首选品牌', '首家', '独家', '首发', '首选', '顶级享受',
  // 医疗功效
  '治愈', '根治', '疗效', '药品级', '药妆', '医美级', '焕肤',
  '美白针', '瘦脸针', '溶脂', '抗衰老',
  // 金融诱导
  '稳赚', '保本', '零风险', '高收益', '躺着赚钱', '财务自由',
  '内幕消息', '稳赚不赔', '暴利'
];
// A级替换建议
const XHS_BANNED_A_REPLACE = {
  '治愈': '缓解/改善',
  '根治': '解决/处理',
  '最佳': '出色/优秀',
  '第一': '领先/靠前',
  '唯一': '少有的',
  '顶级': '高品质',
  '极致': '非常',
  '首选': '优先考虑',
  '首家': '较早',
  '独家': '特有的',
  '首发': '首次推出',
  '国家级': '全国知名'
};

// B级 — 平台慎用（降低推荐/触发人工审核）
const XHS_BANNED_B = [
  // 过度营销感
  '赶紧买', '限时抢购', '手慢无', '错过等一年', '最后机会',
  '清仓', '秒杀', '囤货', '必买', '不买后悔',
  // 诱导互动
  '求赞', '求关注', '互粉', '互赞', '评论区见', '点赞过百更新',
  '关注解锁', '粉丝福利',
  // 导流词汇
  '微信号', 'QQ号', '手机号', '外部链接', '二维码',
  '私信我', '加V', '进群',
  // 对比拉踩
  '比其他家好', '吊打同行', '碾压', '完爆', '吊打'
];

// C级 — 建议替换（影响阅读体验/算法偏好）
const XHS_BANNED_C = {
  '最好吃': '我吃过最对味的',
  '必须去': '不去会后悔的',
  '强烈推荐': '我跟你说绝了',
  '性价比超高': '花得值',
  '赶紧收藏': '先码住',
  '史上最': '我见过的最',
  '绝美': '好看得不真实',
  '必打卡': '值得专门跑一趟',
  '网红': '人气高的',
  '出片': '拍照好看的',
  '绝绝子': '绝了',
  'YYDS': '我心中的天花板',
  'yyds': '我心中的天花板',
  '封神': '我心中的Top1',
  '性价比': '值不值',
  '安利': '分享',
  '种草': '推荐',
  '拔草': '去了/买了',
  '最好用': '我用过最顺手的',
  '最便宜': '价格最友好的',
  '最适合': '很适合'
};

// C级关键词列表（用于检测）
const XHS_BANNED_C_KEYS = Object.keys(XHS_BANNED_C);

// D级 — 平台特定语境注意
const XHS_BANNED_D = {
  patterns: [
    { words: ['微商', '代理', '货源', '批发'], risk: '易被判定营销号' },
    { words: ['免费送', '0元购', '免费领'], risk: '易被判定欺诈' },
    { words: ['教程', '步骤', '方法'], risk: '护肤/医美类需加"个人经验"免责', context: ['护肤', '医美', '美白', '抗衰'] },
    { words: ['减肥', '瘦身', '美白'], risk: '需加"个人效果因人而异"免责' },
    { words: ['投资', '理财', '赚钱'], risk: '需明确非投资建议' }
  ]
};

// ============================================================
// 五、违禁词检测工具函数
// ============================================================

/**
 * 检测文本中的违禁词
 * @param {string} text - 待检测文本
 * @returns {object} { pass: boolean, level: 'A'|'B'|'C'|'D'|null, hits: [...], suggestions: {...}, dWarnings: [...] }
 */
function checkBannedWords(text) {
  const result = {
    pass: true,
    level: null,
    hits: [],
    suggestions: {},
    dWarnings: [],
    message: ''
  };

  if (!text || !text.trim()) return result;

  // A级检测（最高优先级）
  for (const word of XHS_BANNED_A) {
    if (text.includes(word)) {
      result.hits.push(word);
      result.level = 'A';
      result.pass = false;
      if (XHS_BANNED_A_REPLACE[word]) {
        result.suggestions[word] = XHS_BANNED_A_REPLACE[word];
      }
    }
  }
  if (!result.pass) {
    result.message = '文案含A级敏感词，建议修改后再发布';
    return result;
  }

  // B级检测
  for (const word of XHS_BANNED_B) {
    if (text.includes(word)) {
      result.hits.push(word);
      result.level = 'B';
    }
  }
  if (result.level === 'B') {
    result.pass = false; // B级不过但阻断
    result.message = '存在营销感词汇，建议替换后再发布';
    return result;
  }

  // C级检测（建议替换，不阻断）
  for (const word of XHS_BANNED_C_KEYS) {
    if (text.includes(word)) {
      result.hits.push(word);
      result.suggestions[word] = XHS_BANNED_C[word];
    }
  }
  if (result.hits.length > 0) {
    result.level = 'C';
    // C级不阻断，只提醒
    result.message = '存在建议替换的词汇，已自动替换建议';
  }

  // D级检测
  for (const pattern of XHS_BANNED_D.patterns) {
    for (const word of pattern.words) {
      if (text.includes(word)) {
        let warning = `含"${word}" — ${pattern.risk}`;
        if (pattern.context) {
          const hasContext = pattern.context.some(ctx => text.includes(ctx));
          if (hasContext) {
            warning += `（当前内容涉及${pattern.context.join('/')}，风险更高）`;
          }
        }
        result.dWarnings.push(warning);
        break; // 每个pattern只报一次
      }
    }
  }
  if (result.dWarnings.length > 0 && result.level === 'C') {
    result.message += '；同时存在平台语境风险';
  } else if (result.dWarnings.length > 0) {
    result.level = 'D';
    result.message = '存在平台语境风险，建议添加免责声明';
  }

  if (result.level === null) {
    result.message = '检测通过';
  }

  return result;
}

/**
 * 自动替换C级词汇
 * @param {string} text
 * @returns {string} 替换后的文本
 */
function autoReplaceCWords(text) {
  let result = text;
  for (const [key, replacement] of Object.entries(XHS_BANNED_C)) {
    if (result.includes(key)) {
      result = result.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement);
    }
  }
  return result;
}

/**
 * 获取去味规则文本（用于拼接到 system prompt）
 */
function getDeWordText() {
  return '【去味指令】生成文案时，严格遵循以下规则：\n' +
    XHS_DEWORD_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n');
}

/**
 * 获取语气调节器文本
 * @param {string} toneKey - 语气key（hot/chill/anti/dry/story/savage）
 */
function getToneText(toneKey) {
  const tone = XHS_TONES[toneKey];
  if (!tone) return '';
  return `【语气要求】${tone.prefix} ${tone.desc}`;
}

// ============================================================
// 六、Prompt构建工具
// ============================================================

/**
 * 根据模板类型和输入构建完整生成prompt
 * @param {string} templateType - 模板类型key
 * @param {object} inputs - 输入变量 {name, selling_point, ...}
 * @param {string} toneKey - 可选语气key
 * @returns {object} { systemPrompt, userPrompt }
 */
function buildGenerationPrompt(templateType, inputs, toneKey) {
  const tpl = XHS_TEMPLATES[templateType];
  if (!tpl) {
    // fallback: 通用生成
    return {
      systemPrompt: `你是小红书爆款文案专家。根据主题生成高互动文案，风格真实自然有温度。\n${getDeWordText()}`,
      userPrompt: `主题：${inputs.topic || inputs.name || ''}\n\n生成小红书风格文案，含标题、正文、标签。`
    };
  }

  const lines = [];

  // 角色设定
  lines.push(`【角色】${tpl.role}`);

  // 输入变量
  if (tpl.inputs && tpl.inputs.length > 0) {
    lines.push('');
    lines.push('【输入信息】');
    tpl.inputs.forEach(inp => {
      const val = inputs[inp.key] || '';
      if (val) lines.push(`- ${inp.label}：${val}`);
    });
  }

  // 输出要求
  if (tpl.requirements && tpl.requirements.length > 0) {
    lines.push('');
    lines.push('【输出要求】');
    tpl.requirements.forEach(r => lines.push(`- ${r}`));
  }

  // 语气参考
  if (tpl.toneExample) {
    lines.push('');
    lines.push(`【语气参考】${tpl.toneExample}`);
  }

  // 输出格式
  if (tpl.outputFormat) {
    lines.push('');
    lines.push('【输出格式】');
    if (Array.isArray(tpl.outputFormat)) {
      tpl.outputFormat.forEach(f => lines.push(f));
    } else {
      lines.push(tpl.outputFormat);
    }
  }

  const userPrompt = lines.join('\n');

  // system prompt = 角色 + 去味规则 + 语气调节
  let systemPrompt = tpl.role;
  if (toneKey) {
    systemPrompt += '\n\n' + getToneText(toneKey);
  }
  systemPrompt += '\n\n' + getDeWordText();

  return { systemPrompt, userPrompt };
}

// ============================================================
// 七、分析/改写/检测 System Prompt（v2增强版）
// ============================================================

function getAnalyzeSystemV2() {
  return `你是小红书爆款内容分析师，兼具数据思维和创作者视角。

分析维度：
1. 标题技巧：是否用了数字/悬念/反差/情绪词
2. 开头钩子：前3行能不能留住人
3. 内容结构：段落节奏、信息密度、可读性
4. 互动引导：有没有埋互动点（提问/投票/共鸣）
5. 情感共鸣：读者看完的感受（羡慕/被理解/学到东西/想收藏）
6. 可复用框架：提炼成通用模板

输出要求：
- 用emoji标重点，结构清晰
- 不仅说"好"，要说"为什么好"
- 指出可改进的地方
- 结尾给出3条具体优化建议`;
}

function getRewriteSystemV2() {
  return `你是资深内容编辑，擅长将AI写作痕迹改写成自然、真实、有温度的人类写作风格。

改写规则：
${XHS_DEWORD_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}

额外规则：
- 保留原文核心信息和关键细节
- 只改表达方式，不改内容
- 加入口头禅和语气词（如"我跟你说""救命""绝了"）
- 允许轻微语法不严谨
- 句子长短交错，不要对称结构
- emoji自然穿插，不要每段都有

禁用转换对照：
- "性价比" → "花得值"
- "强烈推荐" → "我跟你说绝了"
- "值得入手" → "这个真的可以"
- "必打卡" → "不去会后悔"
- "绝美" → "好看得不真实"
- "YYDS" → "我心中的天花板"

输出格式：
直接输出改写后的文案，不要加"改写后如下"等说明文字。`;
}

function getCheckSystemV2() {
  return `你是小红书内容安全审核专家。按以下分级标准检测文案：

A级 — 绝对禁用（触发审核/限流）：
虚假宣传：国家级、最高级、最佳、第一、唯一、顶级、极品、极致、首选、首家、独家、首发
医疗功效：治愈、根治、疗效、药品级、药妆、医美级、焕肤
金融诱导：稳赚、保本、零风险、高收益、财务自由、暴利

B级 — 平台慎用（降低推荐）：
营销感：赶紧买、限时抢购、手慢无、错过等一年、秒杀、囤货
诱导互动：求赞、求关注、互粉、互赞
导流：微信号、QQ号、二维码、私信我、加V
对比拉踩：吊打同行、碾压、完爆

C级 — 建议替换：
最好吃→我吃过最对味的 | 必须去→不去会后悔的 | 强烈推荐→我跟你说绝了
绝美→好看得不真实 | 必打卡→值得专门跑一趟 | 网红→人气高的
YYDS→我心中的天花板 | 封神→我心中的Top1

检测输出格式：
1. 总体判定：通过 / 需修改 / 不建议发布
2. 风险词汇清单（标注A/B/C/D级）
3. 替换建议
4. 其他风险提示

如果全部合规，输出"✅ 检测通过，文案合规"。`;
}

function getGenerateSystemV2() {
  return `你是小红书爆款文案创作专家，深谙平台流量逻辑和用户心理。

${getDeWordText()}

创作原则：
- 开头3秒决定生死：用痛点、惊喜、悬念或反差抓人
- 正文像跟朋友说话：口语化、有细节、不端着
- 结尾让人想互动：提问、选择题、引发共鸣
- emoji是调味料不是主菜：5-10个，自然散落

标题公式参考：
- "在{{地点}}，{{反常行为}}是一种什么体验"
- "{{数字}}家{{品类}}，{{结果}}"
- "说实话，{{事物}}跟网上说的不一样"
- "{{时间}}去了{{地点}}，{{意外发现}}"

输出格式：
每条文案包含 [标题] + [正文] + [标签]，直接输出成品。`;
}

// ============================================================
// 八、辅助函数：获取模板列表（供UI使用）
// ============================================================

function getTemplateList() {
  return Object.entries(XHS_TEMPLATES).map(([key, tpl]) => ({
    key,
    name: tpl.name,
    icon: tpl.icon,
    desc: tpl.desc,
    inputs: tpl.inputs
  }));
}

function getToneList() {
  return Object.entries(XHS_TONES).map(([key, tone]) => ({
    key,
    name: tone.name,
    desc: tone.desc
  }));
}
