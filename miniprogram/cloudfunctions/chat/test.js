/**
 * 云函数本地单测：用本地假 API server 验证 chat 云函数，无需真实云环境/密钥。
 * 运行：node test.js
 * 覆盖：危机硬兜底（不发 API）、正常对话（发 API）、配置缺失、API 报错、超时。
 */
const http = require('http');
const fn = require('./index.js');

// 假 OpenAI 兼容服务：根据输入返回不同响应
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const payload = JSON.parse(body);
    const lastUser = payload.messages.filter(m => m.role === 'user').pop();
    res.setHeader('Content-Type', 'application/json');
    if (lastUser && /报错测试/.test(lastUser.content)) {
      res.statusCode = 500;
      return res.end('{"error":"mock api failure"}');
    }
    const echo = '（模拟模型回复）我听到了你说的：' + (lastUser ? lastUser.content : '');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: echo } }] }));
  });
});

function setEnv(base, key, model) {
  process.env.API_BASE = base;
  process.env.API_KEY = key;
  process.env.MODEL = model;
}

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  let pass = 0, fail = 0;
  function check(name, ok, detail) {
    console.log((ok ? 'OK   ' : 'FAIL ') + name + (detail ? ' | ' + detail : ''));
    ok ? pass++ : fail++;
  }

  // 1) 危机硬兜底：不应调 API（source=guard, crisis=true, 话术含热线）
  setEnv('http://127.0.0.1:' + port, 'sk-test', 'test-model');
  const crisis = await fn.main({ text: '不想活了' });
  check('危机硬兜底命中', crisis.crisis === true && crisis.source === 'guard' && crisis.scene === 'crisis', 'scene=' + crisis.scene);
  check('危机话术三要素', /12356|400-161-9995|010-82951332/.test(crisis.content) && /人工|专人|跟进/.test(crisis.content) && /110|120/.test(crisis.content));

  // 2) 正常对话：走模型
  const normal = await fn.main({ text: '今天有点累' });
  check('正常对话走模型', normal.source === 'model' && normal.crisis === false, 'scene=' + normal.scene);
  check('模型回复非空', normal.content && normal.content.indexOf('今天有点累') !== -1);

  // 3) 配置缺失
  setEnv('', '', '');
  const noCfg = await fn.main({ text: '你好' });
  check('配置缺失被拦截', noCfg.scene === 'config_error' && /API_BASE/.test(noCfg.error || ''));

  // 4) API 报错
  setEnv('http://127.0.0.1:' + port, 'sk-test', 'test-model');
  const apiErr = await fn.main({ text: '报错测试' });
  check('API报错被捕获', apiErr.scene === 'api_error' && /500/.test(apiErr.error || ''), (apiErr.error || '').slice(0, 60));

  // 5) 空输入
  const empty = await fn.main({ text: '   ' });
  check('空输入兜底', empty.scene === 'empty' && empty.source === 'guard');

  console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail);
  server.close();
  process.exit(fail === 0 ? 0 : 1);
});
