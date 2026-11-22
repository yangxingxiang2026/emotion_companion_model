/**
 * utils/config.js —— 前端运行配置
 *
 * MODE 三选一，决定"推理发生在哪台机器上"：
 *  - 'local'：本地直连——小程序 wx.request 打到本机跑的 OpenAI 兼容模型服务。
 *            本地调测小模型用这个，不需要微信云开发、不需要部署云函数。
 *  - 'cloud'：云函数代理——走 cloudfunctions/chat，用于上线（HTTPS 备案域名 + Key 留服务端）。
 *  - 'mock' ：纯本地规则，不接任何模型（UI 壳子/无模型环境）。
 *
 * 无论哪种模式，危机话术都由 api.js 在本地硬兜底，绝不交给模型。
 */
var CONFIG = {
  MODE: 'local',

  // ===== local 模式：本机模型服务（OpenAI 兼容接口）=====
  // 开发者工具模拟器：http://127.0.0.1:11434/v1
  // 真机调试：换成电脑局域网 IP，如 http://192.168.1.10:11434/v1（手机与电脑同 WiFi）
  // Ollama 默认端口 11434；llama.cpp server 常用 8080；LM Studio 常用 1234
  LOCAL_API_BASE: 'http://127.0.0.1:11434/v1',
  LOCAL_MODEL: 'qwen2.5:3b',
  LOCAL_API_KEY: '',
  LOCAL_TIMEOUT_MS: 30000,

  // ===== cloud 模式：云开发云函数 =====
  CLOUD_ENV: '',

  // ===== 通用 =====
  // 模型调用失败时是否降级到本地 mock（建议 true，保证始终有回复）
  FALLBACK_TO_MOCK: true,
  SHOW_FALLBACK_HINT: false
};

module.exports = CONFIG;
