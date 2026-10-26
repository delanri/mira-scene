/**
 * 在 Node 里跑真实的 static/js/app.js（不需要浏览器、不需要真 Vue）。
 *
 * 做法：用一个最小的「假 Vue」（ref / computed 只保留 .value），
 * 把浏览器 API（fetch、语音识别、语音合成）换成测试能控制的假对象，
 * 然后执行 app.js，拿到 setup() 返回的状态和方法直接断言。
 */
const fs = require('fs');
const path = require('path');

const APP_PATH = path.join(__dirname, '..', '..', 'static', 'js', 'app.js');

/**
 * @param {object} opts
 * @param {(url: string, init: object) => Promise} opts.fetch  /api/chat 的假实现
 * @param {number}  [opts.chatTimeoutMs]   覆盖 20s 超时，测试里缩短
 * @param {boolean} [opts.speechRecognition=true]  浏览器是否支持语音识别
 * @param {boolean} [opts.speechSynthesis=false]   是否有语音合成（有的话可以手动触发 onstart/onboundary/onend）
 * @param {boolean} [opts.speechFailsImmediately]   语音一开口就出错（测表情切换的竞态）
 */
function loadApp(opts = {}) {
  let src = fs.readFileSync(APP_PATH, 'utf8');
  if (opts.chatTimeoutMs) {
    const before = src;
    src = src.replace(/const CHAT_TIMEOUT_MS = \d+;/, `const CHAT_TIMEOUT_MS = ${opts.chatTimeoutMs};`);
    if (src === before) throw new Error('app.js 里找不到 CHAT_TIMEOUT_MS');
  }

  const ctl = { recognition: null, utterances: [], chatCalls: [] };

  let app;
  const Vue = {
    createApp: (o) => ({ mount() { app = o.setup(); } }),
    ref: (v) => ({ value: v }),
    computed: (f) => ({ get value() { return f(); } }),
    watch() {}, onMounted() {}, onUnmounted() {},
    nextTick: (f) => Promise.resolve().then(f),
  };

  // 每个实例一套自己的假浏览器（不放到 global 上，避免上一个测试还没跑完的计时器用到下一个测试的环境）
  const window = {};

  if (opts.speechRecognition !== false) {
    window.SpeechRecognition = class {
      constructor() { ctl.recognition = this; }
      start() {} stop() {} abort() {}
    };
  }

  let SpeechSynthesisUtterance;
  if (opts.speechSynthesis) {
    window.speechSynthesis = {
      speak(u) {
        ctl.utterances.push(u);
        // 模拟浏览器语音一开口就出错（一句话瞬间"说完"）
        if (opts.speechFailsImmediately) setTimeout(() => u.onerror && u.onerror(), 0);
      },
      cancel() {},
      getVoices() { return []; },
    };
    SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  }

  // fetch：/api/tts 固定让前端用浏览器语音；/api/chat 交给测试
  const fetch = (url, init) => {
    if (url === '/api/tts') {
      return Promise.resolve({ headers: { get: () => 'application/json' }, json: async () => ({ use_browser_tts: true }) });
    }
    const body = JSON.parse(init.body);
    ctl.chatCalls.push(body);
    return opts.fetch(url, init, body);
  };

  const requestAnimationFrame = (f) => setTimeout(f, 16);

  new Function('Vue', 'window', 'fetch', 'SpeechSynthesisUtterance', 'requestAnimationFrame', src)(
    Vue, window, fetch, SpeechSynthesisUtterance, requestAnimationFrame,
  );
  return { app, ctl };
}

// ---------- 常用的假 /api/chat ----------
const reply = (data) => () =>
  Promise.resolve({ ok: true, json: async () => ({ emotion: 'neutral', action: null, scene_change: null, mode: 'live', affinity: 1, ...data }) });

const networkError = () => () => Promise.reject(new TypeError('Failed to fetch'));

const httpError = (status) => () => Promise.resolve({ ok: false, status });

// 一直不回，直到被 abort
const hang = () => (url, init) =>
  new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

// 过 ms 毫秒才回（可被 abort）
const slowReply = (ms, data) => (url, init) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve({ ok: true, json: async () => ({ emotion: 'neutral', action: null, scene_change: null, mode: 'live', affinity: 1, ...data }) }), ms);
    init.signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
  });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function say(app, text) {
  app.userInput.value = text;
  return app.sendMessage();
}

module.exports = { loadApp, reply, networkError, httpError, hang, slowReply, wait, say };