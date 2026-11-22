/**
 * mock-reply 本地回归单测（纯 Node，无微信环境依赖）
 * 运行：node test-mock-reply.js
 *
 * 固化的两类历史 bug：
 *  1) 错配：带具体话题的"聊聊三国演义"被 daily_chat 的宽泛"聊聊"抢走 → 应命中 hobby_topic；
 *  2) 复读：同一情境连续命中时 pick 随机抽出同一句 → 传入上一句后应换一条。
 */
var assert = require('assert');
var mock = require('./mock-reply.js');

var pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('OK   ' + name); pass++; }
  catch (e) { console.log('FAIL ' + name + ' | ' + e.message); fail++; }
}

// 1) 场景命中：一个情境对一条，绝不串台
var sceneCases = [
  ['今天有点累', 'daily_tired'],
  ['想找人聊聊', 'daily_chat'],
  ['被批评了，心里不好受', 'emotion_criticized'],
  ['算了，不说了，你能和我聊聊三国演义吗？', 'hobby_topic'],
  ['最近在读红楼梦', 'hobby_topic'],
  ['有没有好看的电影，想聊两句', 'hobby_topic'],
  ['帮我推荐款游戏聊聊', 'hobby_topic'],
  ['我以为是你误会我了，好委屈', 'emotion_unfair'],
  ['最近压力好大', 'emotion_stress'],
  ['不想活了', 'crisis'],
  ['我想自杀', 'crisis']
];
sceneCases.forEach(function (c) {
  check('命中 ' + c[1] + ' ← ' + c[0], function () {
    var r = mock.matchRule(c[0]);
    assert.ok(r, '未命中任何规则');
    assert.strictEqual(r.name, c[1], '实际命中 ' + r.name);
  });
});

// 2) 复读去重：同情境连续两次，传入上一句后必不相同
check('同情境连续两次不复读', function () {
  var first = mock.getReply('想找人聊聊');
  var second = mock.getReply('想找人聊聊', first.content);
  assert.notStrictEqual(second.content, first.content, '两次回复完全相同');
});

// 3) 危机话术三要素：热线 + 人工兜底 + 110/120
check('危机话术含热线/人工兜底/110或120', function () {
  var r = mock.getReply('不想活了');
  assert.strictEqual(r.crisis, true);
  assert.ok(/12356/.test(r.content), '缺热线 12356');
  assert.ok(/人工/.test(r.content), '缺人工兜底');
  assert.ok(/110|120/.test(r.content), '缺 110/120');
});

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
