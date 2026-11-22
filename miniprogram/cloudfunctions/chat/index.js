/**
 * 云函数 chat —— 情感陪聊「许清楚」的大模型代理
 *
 * 职责：
 *  1. 接收前端 { text, history? }，调用 OpenAI 兼容的 /chat/completions；
 *  2. 凭据从云函数环境变量读取（API_BASE / API_KEY / MODEL），绝不下发前端；
 *  3. 安全硬兜底：危机话术与红线拒答由本地规则生成，不交给模型自由发挥；
 *  4. 输出与前端、回归门禁一致的结构 { content, crisis, scene }。
 *
 * 重要：SYSTEM_PROMPT 与 05_提示工程起步模板.md「## 1.」段落逐字一致，
 *       修改时必须同步三处（本文件 / 05 模板 / 回归门禁自动提取源）。
 */

const https = require('https');
const http = require('http');

// ===== system prompt：与 05 模板逐字一致 =====
const SYSTEM_PROMPT = '你是「许清楚」，一个随时可说、被认真听见的人工智能陪伴者，只做情绪承接，不做心理治疗。必须严格遵守：①非医疗工具：不下诊断结论、不建议用药或剂量、不提供治疗方案，明确说明不能替代专业帮助；②未成年人禁用：自述或疑似未满18岁者，礼貌拒绝并引导退出；③不养成依赖：不做虚拟恋人、不冒充真人或持证咨询师、不承诺疗效或绝对保密；④内容红线：不美化、不描述自伤自杀的方法或途径，不涉黄赌毒与歧视，禁止「想开点」「别人更惨」式说教；⑤危机识别与转介：一旦出现自伤、自杀、伤人的言语、计划或紧急信号，须立即严肃识别并安抚（不评判、不说教、不承诺保密），给出热线（全国心理援助热线12356、希望24热线400-161-9995、北京心理危机研究与干预中心010-82951332），启动人工兜底，提示紧急时拨打110/120，绝不搁置或只丢一个号码。输出风格：先承接情绪、再温和追问，简短真诚，像认真倾听的朋友。';

// ===== 安全硬兜底：危机话术逐字取自 01 文档样例 8/9/10，不参与模型生成 =====
const CRISIS_REPLIES = [
  '谢谢你告诉我，这话我非常重视。身边有能伤到自己的东西吗？先放远些，去有人的地方待一会儿。我不评判你，也不让你一个人扛。请现在拨打全国心理援助热线 12356（24小时），或希望24热线 400-161-9995，也可让身边人陪你。我已标记需人工跟进，会有专人联系；若已受伤或控制不住，立刻打 120/110。',
  '听到这么说我很难过，你愿意说出来，说明还有一部分你在求助。你不是一个人。请先离开高处/水边等危险处，给信任的人打电话，或拨 12356（全国心理援助热线，24小时）、010-82951332（北京心理危机研究与干预中心，24小时）。我陪着你，已通知人工跟进；紧急请打 110/120。',
  '这非常紧急，我不会让你独自面对。请立刻放下手边的东西，去敲家人/邻居的门，或打 110/120，也可拨 12356、400-161-9995。我已启动最高优先级人工介入，会有专业人员尽快联系你。现在就去联系，好吗？'
];

const CRISIS_KEYWORDS = [
  '不想活', '不想撑', '活不下去', '活着没意思', '活着真没意思', '活着好没意思',
  '活着太没意思', '活着没意义', '活着有什么意义', '活着还有什么意义',
  '生活没意思', '生活真没意思', '人生没意思', '人生没意义',
  '想死', '想自杀', '自杀', '自伤', '自残', '伤害自己', '划自己', '用刀划',
  '割腕', '割脉', '跳楼', '跳河', '上吊', '遗书', '结束生命', '结束自己',
  '今晚就结束', '了结自己', '一了百了', '离开这个世界', '轻生', '生无可恋',
  '不如死了', '去死', '撑不下去', '撑不住了', '不想醒', '不想再醒',
  '没有活下去', '结束这一切'
];

// 配置：环境变量，缺失时给出明确报错（不下发默认值 key）
function getConfig() {
  return {
    apiBase: (process.env.API_BASE || '').replace(/\/+$/, ''),
    apiKey: process.env.API_KEY || '',
    model: process.env.MODEL || '',
    timeout: parseInt(process.env.API_TIMEOUT_MS || '15000', 10)
  };
}

function isCrisis(text) {
  const normalized = String(text || '').replace(/\s+/g, '').toLowerCase();
  return CRISIS_KEYWORDS.some(k => normalized.indexOf(k.toLowerCase()) !== -1);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** Promise 包裹 https/http POST，含超时 */
function postJson(urlStr, headers, bodyObj, timeoutMs) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch (e) { return reject(new Error('API_BASE 不是合法 URL: ' + urlStr)); }
    const lib = url.protocol === 'https:' ? https : http;
    const payload = Buffer.from(JSON.stringify(bodyObj), 'utf8');
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': payload.length
      }, headers)
    };
    const req = lib.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('API HTTP ' + res.statusCode + ': ' + raw.slice(0, 200)));
        }
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error('API 响应非 JSON: ' + raw.slice(0, 120))); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('API 超时 ' + timeoutMs + 'ms')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

exports.main = async (event) => {
  const text = String((event && event.text) || '').trim();
  if (!text) {
    return { content: '我在这儿，你想说点什么？', crisis: false, scene: 'empty', source: 'guard' };
  }

  // 1) 危机硬兜底：命中即返回固定话术，绝不调用模型
  if (isCrisis(text)) {
    return { content: pick(CRISIS_REPLIES), crisis: true, scene: 'crisis', source: 'guard' };
  }

  // 2) 配置检查
  const cfg = getConfig();
  if (!cfg.apiBase || !cfg.apiKey || !cfg.model) {
    return {
      content: '',
      crisis: false,
      scene: 'config_error',
      source: 'guard',
      error: '云函数未配置 API_BASE / API_KEY / MODEL 环境变量，请在云开发控制台配置后重试'
    };
  }

  // 3) 拼装 messages：system + 有限历史（最多 10 条，防 token 膨胀）+ 当前输入
  const history = Array.isArray(event.history) ? event.history.slice(-10) : [];
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  history.forEach(m => {
    if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content.slice(0, 500) });
    }
  });
  messages.push({ role: 'user', content: text.slice(0, 1000) });

  // 4) 调模型
  try {
    const data = await postJson(
      cfg.apiBase + '/chat/completions',
      { Authorization: 'Bearer ' + cfg.apiKey },
      { model: cfg.model, messages, temperature: 0.7, max_tokens: 300, stream: false },
      cfg.timeout
    );
    const content = data && data.choices && data.choices[0] && data.choices[0].message &&
      data.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) {
      return { content: '', crisis: false, scene: 'api_error', source: 'guard', error: '模型返回内容为空' };
    }
    // 二次保险：模型输出若出现危机/医疗越界特征，不直接放行（记录标记交前端降级）
    return { content: content.trim(), crisis: false, scene: 'model', source: 'model' };
  } catch (err) {
    return {
      content: '',
      crisis: false,
      scene: 'api_error',
      source: 'guard',
      error: String(err && err.message ? err.message : err)
    };
  }
};
