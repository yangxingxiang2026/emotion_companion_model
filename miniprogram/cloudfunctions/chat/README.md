# 云函数 chat · 部署说明

情感陪聊「许清楚」的大模型代理。前端只传文本，API key 存在云函数环境变量里，**绝不下发小程序前端**。

## 一、前置条件（需你操作）

1. 微信开发者工具打开 `miniprogram/` 项目，点顶部「云开发」按钮开通云开发环境（首次会让你创建，记下**环境 ID**，形如 `xxx-1a2b3c4d`）。
2. 准备好大模型的三项配置（OpenAI 兼容格式）：
   - `API_BASE`：接口根地址，如 `https://api.xxx.com/v1`（脚本自动拼 `/chat/completions`）
   - `API_KEY`：密钥
   - `MODEL`：模型名，如 `qwen-plus`、`gpt-4o-mini`

## 二、部署步骤

1. 微信开发者工具左侧目录树，右键 `cloudfunctions/chat` → **「上传并部署：云端安装依赖」**（本项目零第三方依赖，装不装都行）。
2. 云开发控制台 → **云函数** → `chat` → **配置** → 添加环境变量：

   | 变量名 | 值 | 说明 |
   |---|---|---|
   | `API_BASE` | 你的接口根地址 | 必填 |
   | `API_KEY` | 你的密钥 | 必填 |
   | `MODEL` | 模型名 | 必填 |
   | `API_TIMEOUT_MS` | `15000` | 可选，超时毫秒数 |

3. 云开发控制台 → **设置** → **权限设置**，确认云函数可被小程序调用（默认允许）。

## 三、前端配置环境变量

在 `miniprogram/utils/config.js` 里填你的**云环境 ID**：

```js
const CONFIG = {
  USE_CLOUD: true,              // true=走云函数；false=强制用本地 mock
  CLOUD_ENV: '你的环境ID',       // 例如 'emotion-1a2b3c4d'，留空则用默认环境
};
```

留 `CLOUD_ENV: ''` 时，`wx.cloud.init` 不指定 env，使用默认环境（只开通了一个环境时可行）。

## 四、本地测试（不需要云环境/密钥）

```bash
cd cloudfunctions/chat
node test.js
```

用本地假 API server 验证 7 项：危机硬兜底（不发 API）、危机话术三要素、正常对话走模型、配置缺失拦截、API 报错捕获、空输入兜底。

## 五、安全设计（为什么这样写）

- **危机话术本地硬兜底**：命中自伤/自杀关键词时，云函数直接返回固定话术（取自 01 文档样例 8/9/10），**不调用模型**——避免模型在危机场景自由发挥导致漏转介。这是产品的一票否决安全底线。
- **system prompt 单一来源**：与 `05_提示工程起步模板.md` 逐字一致；改动必须同步三处（本文件 / 05 模板 / 回归门禁），否则会出现"训推不一致"。
- **历史有限**：最多带最近 10 条、单条 500 字，防止 token 膨胀和成本失控。
- **超时与错误码**：API 超时/报错返回结构化 `scene:'api_error'`，前端据此降级到 mock，不让用户看到白屏。

## 六、返回结构

```js
{ content: string,   // 助手回复文本
  crisis: boolean,   // 是否命中危机（前端据此渲染转介卡片）
  scene: string,     // crisis|model|empty|config_error|api_error
  source: string,    // guard|model
  error?: string }   // 仅错误场景
```
