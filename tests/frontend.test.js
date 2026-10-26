/**
 * 前端测试：在 Node 里跑真实的 static/js/app.js（见 helpers/load_app.js）。
 *
 * 运行（在项目根目录）：node --test
 * 需要 Node 18+，不需要安装任何依赖。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, reply, networkError, httpError, hang, slowReply, wait, say } = require('./helpers/load_app');

const FAIL_NETWORK = '……雨声太大了，刚才没听清。你再说一遍？';
const FAIL_TIMEOUT = '……抱歉，刚刚走神了。你能再说一遍吗？';
const NO_SPEECH = '……嗯？你刚刚说什么了吗？';

// 失败测试里 app.js 会 console.error，测试输出里不需要看到
test.beforeEach(() => { test.mock.method(console, 'error', async () => {}); });

// ================================================================ 请求失败
test('断网：回到待机，Mira 说没听清，出现「再说一次」，这句从历史里拿掉', async () => {
  const { app } = await loadApp({ fetch: networkError() });
  await say(app, '你好');
  assert.equal(app.characterState.value, 'idle');
  assert.equal(app.displayedSubtitle.value, FAIL_NETWORK);
  assert.equal(app.retryText.value, '你好');
});

test('服务器 500：和断网一样处理', async () => {
  const { app } = await loadApp({ fetch: httpError(500) });
  await say(app, '你好');
  assert.equal(app.displayedSubtitle.value, FAIL_NETWORK);
  assert.equal(app.retryText.value, '你好');
});

test('卡住不回：超时后放弃，Mira 说走神了', async () => {
  const { app } = await loadApp({ fetch: hang(), chatTimeoutMs: 80 });
  const p = say(app, '你好');
  await wait(30);
  assert.equal(app.characterState.value, 'thinking');
  await p;
  assert.equal(app.characterState.value, 'idle');
  assert.equal(app.displayedSubtitle.value, FAIL_TIMEOUT);
  assert.equal(app.retryText.value, '你好');
});

test('「再说一次」：同一句只发一遍，失败过的句子不会留在历史里', async () => {
  let fail = true;
  const { app, ctl } = await loadApp({ fetch: (...a) => (fail ? networkError() : reply({ text: '嗯。' }))(...a) });
  await say(app, '第一句');
  await say(app, '第二句');
  fail = false;
  app.retryLast(); // 重发「第二句」
  await wait(20);
  const sent = ctl.chatCalls.at(-1);
  assert.equal(sent.message, '第二句');
  assert.deepEqual(sent.history.map((h) => h.content), ['第二句']);
  assert.equal(app.retryText.value, '');
});

test('她说过的话连同情绪、动作、场景一起存进历史（后端会还原成 JSON 发给模型）', async () => {
  const { app, ctl } = await loadApp({ fetch: reply({ text: '啊……你好。', emotion: 'surprised', action: 'hand_to_mouth' }) });
  say(app, '你好');
  await wait(20);
  await say(app, '你在想什么'); // 打断并发下一句
  const sent = ctl.chatCalls.at(-1).history;
  assert.equal(sent[1].role, 'assistant');
  assert.equal(sent[1].emotion, 'surprised');
  assert.equal(sent[1].action, 'hand_to_mouth');
  assert.equal(sent[1].scene_change, null);
});

// ================================================================ 降级 / 好感度
test('DeepSeek 失败降级：照样回话，右下角显示「离线」', async () => {
  const { app } = await loadApp({ fetch: reply({ text: '嗯。', mode: 'fallback' }) });
  say(app, '你好');
  await wait(20);
  assert.equal(app.characterState.value, 'speaking');
  assert.equal(app.modeLabel.value, '离线');
});

test('好感度跟着后端返回的阶段变', async () => {
  const { app } = await loadApp({ fetch: reply({ text: '嗯。', affinity: 3 }) });
  assert.equal(app.affinityName.value, '初识');
  say(app, '你好');
  await wait(20);
  assert.equal(app.affinity.value, 3);
  assert.equal(app.affinityName.value, '熟络');
});

// ================================================================ 打断
test('打断：历史里只记字幕已经显示的部分，并标上（被打断）', async () => {
  const full = '我叫 Mira，旅行摄影师。';
  const { app, ctl } = await loadApp({ fetch: reply({ text: full }), speechSynthesis: true });
  say(app, '你叫什么');
  await wait(500); // 按估算语速，只显示了前面几个字
  const shown = app.displayedSubtitle.value;
  assert.ok(shown.length > 0 && shown.length < full.length, `显示了：${shown}`);

  say(app, '等一下'); // 她还在说，直接打断
  await wait(10);
  // 下一次请求带的 history 里，上一轮她的话被改成「已显示部分……（被打断）」
  const history = ctl.chatCalls.at(-1).history;
  assert.equal(history[1].role, 'assistant');
  assert.equal(history[1].content, `${shown}……（被打断）`);
});

test('她还在想时按住麦克风：这一轮作废，迟到的回复不会盖掉「在听…」', async () => {
  const { app } = await loadApp({ fetch: slowReply(100, { text: '迟到的回复' }) });
  say(app, '你在等谁');
  await wait(20);
  assert.equal(app.characterState.value, 'thinking');
  app.startRecording();
  assert.equal(app.characterState.value, 'listening');
  await wait(200);
  assert.equal(app.characterState.value, 'listening');
  assert.equal(app.displayedSubtitle.value, '');
  assert.equal(app.retryText.value, '', '被我们自己取消的，不算失败');
});

// ================================================================ 语音识别
test('语音识别：没听到声音 → 回到待机，Mira 问你刚说什么', async () => {
  const { app, ctl } = await loadApp({ fetch: reply({}) });
  app.startRecording();
  assert.equal(app.characterState.value, 'listening');
  ctl.recognition.onerror({ error: 'no-speech' });
  ctl.recognition.onend();
  assert.equal(app.characterState.value, 'idle');
  assert.equal(app.displayedSubtitle.value, NO_SPEECH);
});

test('语音识别：麦克风没权限 → 回到待机，输入框上方提示', async () => {
  const { app, ctl } = await loadApp({ fetch: reply({}) });
  app.startRecording();
  ctl.recognition.onerror({ error: 'not-allowed' });
  assert.equal(app.characterState.value, 'idle');
  assert.match(app.inputHint.value, /麦克风没有权限/);
});

test('语音识别：按下马上松手什么都没说 → 不会卡在「在听…」', async () => {
  const { app, ctl } = await loadApp({ fetch: reply({}) });
  app.startRecording();
  app.stopRecording();
  ctl.recognition.onend();
  assert.equal(app.characterState.value, 'idle');
});

test('浏览器不支持语音识别 → 提示用文字', async () => {
  const { app } = await loadApp({ fetch: reply({}), speechRecognition: false });
  app.startRecording();
  assert.equal(app.characterState.value, 'idle');
  assert.match(app.inputHint.value, /不支持语音/);
});

// ================================================================ 字幕和语音对齐
test('字幕按语速出字，不会一下子全打完', async () => {
  const text = '刚拍完照回来，在这儿歇一会儿。';
  const { app } = await loadApp({ fetch: reply({ text }), speechSynthesis: true });
  say(app, '你在干嘛');
  await wait(400);
  const n = app.displayedSubtitle.value.length;
  assert.ok(n >= 1 && n <= 4, `400ms 只该出 1–4 个字，实际 ${n}：${app.displayedSubtitle.value}`);
});

test('浏览器报念到哪个词，字幕就跟到哪', async () => {
  const text = '刚拍完照回来，在这儿歇一会儿。';
  const { app, ctl } = await loadApp({ fetch: reply({ text }), speechSynthesis: true });
  say(app, '你在干嘛');
  await wait(150); // 等语音开始（app.js 里 cancel 后延迟 100ms 才 speak）
  const u = ctl.utterances.at(-1);
  assert.ok(u, '应该已经开始念了');
  u.onstart();
  u.onboundary({ name: 'word', charIndex: 7, charLength: 2 }); // 念到「在这」
  assert.equal(app.displayedSubtitle.value, '刚拍完照回来，在这');
  await wait(300); // 有逐词进度后不再按估算往前跑
  assert.equal(app.displayedSubtitle.value, '刚拍完照回来，在这');
  u.onend();
  await wait(20);
  assert.equal(app.displayedSubtitle.value, text, '说完显示整句');
});

// ================================================================ 表情
test('一句话瞬间说完（语音出错）：害羞也会正常退回平常表情，不会卡住', async () => {
  const { app } = await loadApp({ fetch: reply({ text: '……谢谢。', emotion: 'shy' }), speechSynthesis: true, speechFailsImmediately: true });
  say(app, '你好漂亮');
  await wait(600);
  assert.equal(app.characterState.value, 'idle');
  assert.equal(app.currentEmotion.value, 'neutral');
});

// ================================================================ 照片（生图）
const photoReply = (photo) => reply({
  text: '要看吗？',
  action: 'show_photo',
  scene_change: { type: 'event', value: 'show_photo' },
  photo,
});

test('照片：她说话时就开始查进度，说完给你看时还没好 → 显影中，生成好 → 显示新照片', async () => {
  const { app, ctl } = await loadApp({
    fetch: photoReply({ job_id: 'j1', caption: '雨夜，刚才 —— 路灯下的水洼' }),
    // 前 3 次查询还在生成，之后完成
    photo: (id, n) => (n <= 3 ? { status: 'running' } : { status: 'done', url: '/generated/abc.png' }),
  });
  say(app, '给我看看你拍的');
  await wait(1700); // 没有语音合成时按字数等（最少 1.5 秒），说完打开照片
  assert.equal(app.showPhoto.value, true);
  assert.equal(app.photoView.value.phase, 'developing');
  assert.equal(app.photoView.value.caption, '雨夜，刚才 —— 路灯下的水洼');
  await wait(2500);
  assert.equal(app.photoView.value.phase, 'ready');
  assert.equal(app.photoView.value.url, '/generated/abc.png');
  assert.ok(ctl.photoPolls >= 4);
});

test('照片：生成失败 → 退回内置的冰岛照片，并上报一次', async () => {
  const { app, ctl } = await loadApp({
    fetch: photoReply({ job_id: 'j2', caption: '' }),
    photo: () => ({ status: 'failed', error: 'ComfyUI 没开' }),
  });
  say(app, '给我看看你拍的');
  await wait(1700);
  assert.equal(app.photoView.value.phase, 'builtin');
  assert.match(app.photoView.value.caption, /冰岛/);
  const fallbacks = ctl.events.filter((e) => e.type === 'photo_fallback');
  assert.equal(fallbacks.length, 1);
  assert.match(fallbacks[0].detail, /ComfyUI 没开/);
});

test('照片：没配生图（photo 为 null）→ 直接显示内置照片，不查进度', async () => {
  const { app, ctl } = await loadApp({ fetch: photoReply(null) });
  say(app, '给我看看你拍的');
  await wait(1700);
  assert.equal(app.showPhoto.value, true);
  assert.equal(app.photoView.value.phase, 'builtin');
  assert.equal(ctl.photoPolls, 0);
});

test('照片：图片链接打不开 → 退回内置照片', async () => {
  const { app } = await loadApp({
    fetch: photoReply({ job_id: 'j3', caption: 'x' }),
    photo: () => ({ status: 'done', url: '/generated/missing.png' }),
  });
  say(app, '给我看看你拍的');
  await wait(1700);
  assert.equal(app.photoView.value.phase, 'ready');
  app.onPhotoError();
  assert.equal(app.photoView.value.phase, 'builtin');
});

// ================================================================ 观测：前端事件上报
test('打断、重试、断网都会上报给观测页', async () => {
  let fail = true;
  const { app, ctl } = await loadApp({
    fetch: (...a) => (fail ? networkError() : reply({ text: '我叫 Mira，旅行摄影师。' }))(...a),
    speechSynthesis: true,
  });
  await say(app, '你好');            // 断网
  fail = false;
  app.retryLast();                   // 重试
  await wait(400);
  say(app, '等一下');                // 她还在说 → 打断（不等这一句说完：假语音不会自己结束）
  await wait(20);
  const types = ctl.events.map((e) => e.type);
  assert.ok(types.includes('network_error'), types.join());
  assert.ok(types.includes('retry'), types.join());
  assert.ok(types.includes('interrupt'), types.join());
});

// ================================================================ 相机
test('举着相机时清动作：先进入放下阶段，1 秒后才清掉', async () => {
  const { app } = await loadApp({ fetch: reply({ text: '嗯。' }) });
  app.currentAction.value = 'show_photo';
  say(app, '下一句'); // 发新消息会清动作
  assert.equal(app.currentAction.value, 'put_down_camera');
  await wait(1100);
  assert.equal(app.currentAction.value, '');
});
