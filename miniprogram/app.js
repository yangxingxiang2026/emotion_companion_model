// app.js
// UI 壳子阶段：不接真实模型、不接云开发。
// 会话历史由聊天页自行用 wx.getStorageSync / wx.setStorageSync 管理。
App({
  onLaunch: function () {
    // 保持启动逻辑极简，不阻塞首屏
  },
  globalData: {
    appName: '许清楚'
  }
});
