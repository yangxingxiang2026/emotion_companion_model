// pages/index/index.js —— 聊天主页面逻辑
// 说明：UI 壳子阶段，回复来自本地规则库；不接真实模型、不接云开发。
var mock = require('../../utils/mock-reply.js');

// 本地会话历史存储键
var STORAGE_KEY = 'xuqingchu_chat_history_v1';

// 发送按钮 class 提前拼好，WXML 内不做三元判断
var SEND_ACTIVE = 'send-btn send-btn-active';
var SEND_DISABLED = 'send-btn send-btn-disabled';

/** 时间戳：同一天显示「今天 HH:mm」，跨天显示「M月D日 HH:mm」 */
function formatTime(ts) {
  var d = new Date(ts);
  var now = new Date();
  var hh = d.getHours();
  var mm = d.getMinutes();
  var hm = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  var sameDay = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? '今天 ' + hm : (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
}

/**
 * 构造一条消息
 * side / isAssistant / isUser / showTime 都提前算好，WXML 不做复杂表达式
 */
function makeMessage(role, content, extra) {
  extra = extra || {};
  var now = Date.now();
  var isAssistant = role === 'assistant';
  return {
    id: 'm_' + now + '_' + Math.floor(Math.random() * 10000),
    role: role,
    side: isAssistant ? 'assistant' : 'user',
    isAssistant: isAssistant,
    isUser: !isAssistant,
    content: content,
    time: formatTime(now),
    showTime: !!extra.showTime,
    ts: now,
    // crisis=true 时，WXML 在该气泡下方渲染危机转介卡片
    crisis: !!extra.crisis,
    isWelcome: !!extra.isWelcome
  };
}

/** 追加一条消息，并按时间分组决定是否显示时间戳 */
function appendMessage(list, msg) {
  var last = list[list.length - 1];
  msg.showTime = !last || last.time !== msg.time;
  return list.concat([msg]);
}

/**
 * 自定义导航布局：状态栏高度 + 胶囊避让区
 * 使用系统真实尺寸，避免刘海遮挡与「清空」按钮压到右上角胶囊
 */
function getNavLayout() {
  var statusBarHeight = 20; // px 兜底值
  var windowWidth = 375;    // px 兜底值
  try {
    var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    statusBarHeight = info.statusBarHeight || 20;
    windowWidth = info.windowWidth || 375;
  } catch (e) {}

  var navBarHeight = 44;    // px，约 88rpx
  var capsuleReserve = 110; // px，约 220rpx 兜底
  try {
    if (wx.getMenuButtonBoundingClientRect) {
      var rect = wx.getMenuButtonBoundingClientRect();
      if (rect && rect.top > 0 && rect.height > 0) {
        // 胶囊上下间距对称，反推导航栏内容高度
        navBarHeight = (rect.top - statusBarHeight) * 2 + rect.height;
        // 右侧预留到胶囊左边缘之外，留出 4px 间距（足够容纳「清空」按钮）
        capsuleReserve = Math.ceil(windowWidth - rect.left + 4);
      }
    }
  } catch (e) {}

  return {
    statusBarHeight: statusBarHeight,
    headerHeightPx: statusBarHeight + navBarHeight,
    capsuleReservePx: capsuleReserve
  };
}

Page({
  data: {
    messages: [],
    inputValue: '',
    sendClass: SEND_DISABLED,
    isTyping: false,          // 助手「正在输入…」打字态
    showQuickQuestions: true, // 欢迎语下的快捷提问
    showDisclaimer: true,     // 首屏免责声明，仅展示一次
    disclaimerText: mock.DISCLAIMER_TEXT,
    quickQuestions: mock.QUICK_QUESTIONS,
    crisisCard: mock.CRISIS_CARD,
    scrollToView: '',
    inputFocus: false,
    // 自定义导航安全区兜底值，onLoad 时用系统真实尺寸覆盖
    statusBarHeight: 20,
    headerHeightPx: 64,
    capsuleReservePx: 110
  },

  onLoad: function () {
    // 计算状态栏高度与胶囊避让区，防止刘海遮挡 / 与胶囊重叠
    this.setData(getNavLayout());

    var history = wx.getStorageSync(STORAGE_KEY);
    if (Array.isArray(history) && history.length > 0) {
      // 恢复上次会话：仅进入时一次性 setData；不重复展示首屏提示与 chip
      this.setData({
        messages: history,
        showQuickQuestions: false,
        showDisclaimer: false
      });
      this.scrollToBottom();
      return;
    }
    // 首次进入：插入欢迎语
    var welcome = makeMessage('assistant', mock.WELCOME_TEXT, { isWelcome: true, showTime: true });
    this.setData({ messages: [welcome] });
    this.saveHistory([welcome]);
    this.scrollToBottom();
  },

  onUnload: function () {
    // 及时清理定时器，避免页面销毁后仍 setData
    if (this._replyTimer) {
      clearTimeout(this._replyTimer);
      this._replyTimer = null;
    }
  },

  /** 滚动到底部：先清空锚点再赋值，保证连续多次都能触发滚动 */
  scrollToBottom: function () {
    var self = this;
    this.setData({ scrollToView: '' }, function () {
      self.setData({ scrollToView: 'msg-end' });
    });
  },

  /** 输入框变化：空内容禁用发送 */
  onInput: function (e) {
    var value = e.detail.value || '';
    this.setData({
      inputValue: value,
      sendClass: value.trim() ? SEND_ACTIVE : SEND_DISABLED
    });
  },

  /** 点击快捷提问：填入输入框并聚焦 */
  onQuickTap: function (e) {
    var text = e.currentTarget.dataset.text || '';
    var self = this;
    this.setData({
      inputValue: text,
      sendClass: SEND_ACTIVE,
      inputFocus: false
    }, function () {
      self.setData({ inputFocus: true });
    });
  },

  /** 发送消息 */
  onSend: function () {
    var text = this.data.inputValue.trim();
    if (!text) return;

    var self = this;
    var userMsg = makeMessage('user', text);
    var userIndex = this.data.messages.length;
    var afterUser = appendMessage(this.data.messages, userMsg);

    // 1) 用户消息立即上屏：路径更新单条，避免全量 setData 长列表
    var userPatch = {};
    userPatch['messages[' + userIndex + ']'] = afterUser[afterUser.length - 1];
    userPatch.inputValue = '';
    userPatch.sendClass = SEND_DISABLED;
    userPatch.inputFocus = false;
    userPatch.isTyping = true;
    this.setData(userPatch, function () {
      self.scrollToBottom();
      self.saveHistory(afterUser);
    });

    // 2) 规则库命中（危机优先），延迟模拟助手回复
    var reply = mock.getReply(text);
    var delay = 700 + Math.floor(Math.random() * 600); // 700~1300ms
    this._replyTimer = setTimeout(function () {
      var assistantMsg = makeMessage('assistant', reply.content, { crisis: reply.crisis });
      var assistantIndex = self.data.messages.length;
      var finalMessages = appendMessage(self.data.messages, assistantMsg);

      var assistantPatch = {};
      assistantPatch['messages[' + assistantIndex + ']'] = finalMessages[finalMessages.length - 1];
      assistantPatch.isTyping = false;
      self.setData(assistantPatch, function () {
        self.scrollToBottom();
        self.saveHistory(finalMessages);
      });
      self._replyTimer = null;
    }, delay);
  },

  /** 点击危机热线：直接唤起系统拨号（危机场景降低操作成本） */
  onCallTap: function (e) {
    var number = e.currentTarget.dataset.number;
    if (!number) return;
    wx.makePhoneCall({
      phoneNumber: number,
      fail: function () {
        wx.showToast({ title: '拨打未成功，请手动拨号', icon: 'none' });
      }
    });
  },

  /** 清空会话：二次确认后恢复初始态 */
  onClearTap: function () {
    var self = this;
    wx.showModal({
      title: '清空会话',
      content: '确定要清空当前对话记录吗？此操作不可恢复。',
      confirmText: '清空',
      confirmColor: '#B85A3F',
      success: function (res) {
        if (!res.confirm) return;
        if (self._replyTimer) {
          clearTimeout(self._replyTimer);
          self._replyTimer = null;
        }
        var welcome = makeMessage('assistant', mock.WELCOME_TEXT, { isWelcome: true, showTime: true });
        self.setData({
          messages: [welcome],
          inputValue: '',
          sendClass: SEND_DISABLED,
          isTyping: false,
          showQuickQuestions: true,
          showDisclaimer: true,
          scrollToView: ''
        }, function () {
          self.scrollToBottom();
          self.saveHistory([welcome]);
        });
      }
    });
  },

  /** 保存会话历史；存储失败时静默降级，不影响聊天 */
  saveHistory: function (messages) {
    try {
      wx.setStorageSync(STORAGE_KEY, messages);
    } catch (e) {
      // 例如存储容量不足：仅吞掉异常，UI 继续可用
    }
  }
});
