/**
 * 按住说话（Web Speech API）。为什么不用自动语音检测：见 README「语音交互与打断流程」
 * @param {import('./types.js').Ctx} ctx
 */
export function createListen(ctx) {
  const { s, env, config, rt } = ctx;
  /** @type {any} */ let recognition = null;

  function initSpeechRecognition() {
    const SpeechRecognition = env.window.SpeechRecognition || env.window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'zh-CN';

    recognition.onresult = (/** @type {any} */ event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      s.userInput.value = transcript;
    };

    recognition.onend = () => {
      if (s.isRecording.value) {
        s.isRecording.value = false;
        if (s.userInput.value.trim()) {
          ctx.api.sendMessage(); // 识别到了就自动发
        } else {
          leaveListening(); // 松手了但什么都没识别到：不能一直停在「在听…」
        }
      }
    };

    recognition.onerror = (/** @type {{ error: string }} */ event) => {
      console.error('Speech recognition error:', event.error);
      s.isRecording.value = false;
      leaveListening();

      if (event.error === 'aborted') return; // 我们自己取消的，不提示
      ctx.api.reportEvent('stt_error', event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        ctx.api.showHint('麦克风没有权限，用文字跟她说吧');
      } else if (event.error === 'no-speech') {
        ctx.api.showShortLine(config.FAIL_LINES.noSpeech); // 没听到声音：Mira 口吻
      } else {
        ctx.api.showHint('语音没识别成功，再按住说一次？');
      }
    };
  }

  /** 从「在听…」退回待机（只在还停在 listening 时才改，避免覆盖已经开始的思考） */
  function leaveListening() {
    if (s.characterState.value === 'listening') {
      s.characterState.value = 'idle';
    }
  }

  function startRecording() {
    if (!recognition) {
      initSpeechRecognition();
      if (!recognition) {
        ctx.api.showHint('这个浏览器不支持语音，用文字跟她说吧');
        return;
      }
    }

    // 她在说话：打断
    if (s.characterState.value === 'speaking') {
      ctx.api.interruptSpeech();
    }

    // 她还在想（回复在路上）：这一轮作废，迟到的回复不会盖掉「在听…」
    // （sendMessage 的 catch 发现 requestId 过期，会直接忽略，不弹失败台词）
    if (s.characterState.value === 'thinking') {
      rt.requestId = ctx.api.generateRequestId();
      if (rt.chatAbort) rt.chatAbort.abort();
    }

    s.isRecording.value = true;
    s.characterState.value = 'listening';
    s.userInput.value = '';

    try {
      recognition.start();
    } catch (e) {
      console.error('Failed to start recording:', e);
      s.isRecording.value = false;
      s.characterState.value = 'idle';
    }
  }

  function stopRecording() {
    if (!recognition || !s.isRecording.value) return;
    try {
      recognition.stop(); // onend 里再决定发不发
    } catch (e) {
      console.error('Failed to stop recording:', e);
    }
  }

  function dispose() {
    if (recognition) {
      try { recognition.abort(); } catch (e) { /* 忽略 */ }
    }
  }

  return { initSpeechRecognition, startRecording, stopRecording, dispose };
}
