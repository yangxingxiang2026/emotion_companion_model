/**
 * utils/api.js —— 对话接口封装：三种推理位置，失败降级 mock
 *
 * MODE（见 config.js）：
 *   local —— 本地直连本机模型服务（wx.request → OpenAI 兼容接口），本地调测用，不依赖云开发
 *   cloud —— 云函数代理（cloudfunctions/chat），上线用
 *   mock  —— 纯本地规则，不接模型
 *
 * 对外只暴露 getReply(text, messages, callback)：
 *   callback({ content, crisis, scene, source })
 * 危机话术在所有模式下都先本地硬兜底，绝不交给模型。
 */
var CONFIG = require('./config.js');
var mock = require('./mock-reply.js');
var SYSTEM_PROMPT = require('./prompt.js');

var cloudReady = false;

/** 初始化云开发（幂等，只调一次） */
function initCloud() {
  if (cloudReady) return true;
  if (!wx.cloud) return false;
  try {
    var opt = CONFIG.CLOUD_ENV ? { env: CONFIG.CLOUD_ENV } : {};
    wx.cloud.init(opt);
    cloudReady = true;
    return true;
  } catch (e) {
    return false;
  }
}

/** 把页面的消息数组转成云函数/模型需要的 history（role/content） */
function toHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(function (m) { return m && !m.isWelcome && (m.role === 'user' || m.role === 'assistant'); })
    .slice(-10)
    .map(function (m) { return { role: m.role, content: String(m.content || '').slice(0, 500) }; });
}

/** 取当前会话里最近一条助手回复，供 mock 避免连续复读同一句 */
function lastAssistantContent(messages) {
  if (!Array.isArray(messages)) return '';
  for (var i = messages.length - 1; i >= 0; i--) {
    var m = messages[i];
    if (m && m.role === 'assistant' && !m.isWelcome && m.content) return String(m.content);
  }
  return '';
}

function mockResult(text, messages) {
  var r = mock.getReply(text, lastAssistantContent(messages));
  return { content: r.content, crisis: r.crisis, scene: r.scene, source: 'mock' };
}

/** 拼 OpenAI 兼容 messages：system + 历史 + 当前输入 */
function buildModelMessages(text, messages) {
  var msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
  toHistory(messages).forEach(function (m) { msgs.push(m); });
  msgs.push({ role: 'user', content: String(text || '').slice(0, 1000) });
  return msgs;
}

/** local 模式：wx.request 直连本机模型服务 */
function callLocal(text, messages, done, finish) {
  var base = String(CONFIG.LOCAL_API_BASE || '').replace(/\/+$/, '');
  var header = { 'content-type': 'application/json' };
  if (CONFIG.LOCAL_API_KEY) header.Authorization = 'Bearer ' + CONFIG.LOCAL_API_KEY;
  wx.request({
    url: base + '/chat/completions',
    method: 'POST',
    header: header,
    timeout: CONFIG.LOCAL_TIMEOUT_MS || 30000,
    data: {
      model: CONFIG.LOCAL_MODEL,
      messages: buildModelMessages(text, messages),
      temperature: 0.7,
      max_tokens: 300,
      stream: false
    },
    success: function (res) {
      var d = res && res.data;
      var content = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      if (typeof content === 'string' && content.trim()) {
        return finish({ content: content.trim(), crisis: false, scene: 'model', source: 'local-model' });
      }
      degrade(text, messages, '本地模型返回为空: ' + JSON.stringify(d).slice(0, 120), finish);
    },
    fail: function (err) {
      degrade(text, messages, '连不上本地模型: ' + (err && err.errMsg || '').slice(0, 120) +
        '（真机调试需用电脑局域网 IP，且与电脑同 WiFi）', finish);
    }
  });
}

/** cloud 模式：云函数代理 */
function callCloud(text, messages, done, finish) {
  if (!initCloud()) return degrade(text, messages, '云开发未初始化', finish);
  wx.cloud.callFunction({
    name: 'chat',
    data: { text: text, history: toHistory(messages) },
    success: function (res) {
      var r = res && res.result;
      if (r && typeof r.content === 'string' && r.content && r.scene !== 'config_error' && r.scene !== 'api_error') {
        return finish({ content: r.content, crisis: !!r.crisis, scene: r.scene, source: r.source || 'model' });
      }
      degrade(text, messages, r && r.error ? r.error : '云端返回空', finish);
    },
    fail: function () { degrade(text, messages, '云函数调用失败', finish); }
  });
}

function degrade(text, messages, reason, finish) {
  if (CONFIG.FALLBACK_TO_MOCK) {
    var r = mockResult(text, messages);
    if (CONFIG.SHOW_FALLBACK_HINT) r.content = '（模型不可用，已用本地规则回复）\n' + r.content;
    return finish(r);
  }
  finish({ content: '（模型暂不可用）' + reason, crisis: false, scene: 'error', source: 'guard' });
}

/**
 * 获取回复
 * @param {string} text 用户输入
 * @param {Array} messages 当前会话消息数组（用于 history）
 * @param {function} callback 回调，参数为结果对象
 */
function getReply(text, messages, callback) {
  var done = false;
  function finish(result) {
    if (done) return;
    done = true;
    callback(result);
  }

  // 危机本地优先硬兜底：任何模式下危机话术都不交给模型
  var local = mock.matchRule(text);
  if (local && local.crisis) return finish(mockResult(text, messages));

  var mode = CONFIG.MODE || 'mock';
  if (mode === 'local') return callLocal(text, messages, done, finish);
  if (mode === 'cloud') return callCloud(text, messages, done, finish);
  finish(mockResult(text, messages));
}

module.exports = {
  getReply: getReply,
  toHistory: toHistory,
  buildModelMessages: buildModelMessages,
  isLocalEnabled: function () { return CONFIG.MODE === 'local'; }
};
