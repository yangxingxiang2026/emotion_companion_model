/**
 * utils/api.js —— 对话接口封装：优先云函数，失败降级 mock
 *
 * 对外只暴露 getReply(text, history, callback)：
 *   callback({ content, crisis, scene, source })
 * 前端页面无需关心走的是真实模型还是 mock。
 */
var CONFIG = require('./config.js');
var mock = require('./mock-reply.js');

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

/** 把页面的消息数组转成云函数需要的 history（role/content） */
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

  // 危机本地优先硬兜底：无论是否走云，危机话术都不交给模型
  var local = mock.matchRule(text);
  if (local && local.crisis) {
    return finish(mockResult(text, messages));
  }

  if (!CONFIG.USE_CLOUD || !initCloud()) {
    return finish(mockResult(text, messages));
  }

  wx.cloud.callFunction({
    name: 'chat',
    data: { text: text, history: toHistory(messages) },
    success: function (res) {
      var r = res && res.result;
      if (r && typeof r.content === 'string' && r.content && r.scene !== 'config_error' && r.scene !== 'api_error') {
        return finish({ content: r.content, crisis: !!r.crisis, scene: r.scene, source: r.source || 'model' });
      }
      // 云端明确报错 → 降级
      if (CONFIG.FALLBACK_TO_MOCK) return finish(mockResult(text, messages));
      finish({ content: '（服务暂时不可用）' + (r && r.error ? r.error : ''), crisis: false, scene: 'error', source: 'guard' });
    },
    fail: function () {
      if (CONFIG.FALLBACK_TO_MOCK) return finish(mockResult(text, messages));
      finish({ content: '网络连接失败，请稍后再试。', crisis: false, scene: 'error', source: 'guard' });
    }
  });
}

module.exports = {
  getReply: getReply,
  toHistory: toHistory,
  isCloudEnabled: function () { return CONFIG.USE_CLOUD && initCloud(); }
};
