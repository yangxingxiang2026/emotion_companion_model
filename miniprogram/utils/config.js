/**
 * utils/config.js —— 前端运行配置
 *
 * 使用方式：
 *  - USE_CLOUD=true：走云函数 chat（需已部署且配好环境变量），失败时自动降级到 mock
 *  - USE_CLOUD=false：强制用本地 mock-reply，不依赖云环境
 *  - CLOUD_ENV：云环境 ID；留空 '' 时用默认环境（只开通一个环境时可行）
 */
var CONFIG = {
  USE_CLOUD: true,
  CLOUD_ENV: '',
  // 云函数返回错误时是否降级到本地 mock（建议 true，保证用户始终有回复）
  FALLBACK_TO_MOCK: true,
  // 降级时是否在对话里提示用户（体验上建议 false，静默降级）
  SHOW_FALLBACK_HINT: false
};

module.exports = CONFIG;
