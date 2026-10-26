/**
 * 她说话：/api/tts 返回音频就放音频，否则用浏览器语音合成（现在后端统一让前端用浏览器语音）
 * 每一步都对一下 requestId，被打断 / 过期就不再播
 * @param {import('./types.js').Ctx} ctx
 */
export function createSpeech(ctx) {
  const { env } = ctx;
  /** @type {any} */ let currentAudio = null;

  /**
   * 说一句话，说完（或失败、被打断）才 resolve
   * @param {string} text
   * @param {string} requestId
   */
  async function playTTS(text, requestId) {
    if (ctx.rt.requestId !== requestId) return;

    try {
      const resp = await env.fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, request_id: requestId }),
      });
      if (ctx.rt.requestId !== requestId) return;

      const contentType = resp.headers.get('content-type') || '';
      const URLApi = env.URL;
      if (contentType.includes('audio') && URLApi) {
        const blob = await resp.blob();
        if (ctx.rt.requestId !== requestId) return;
        const url = URLApi.createObjectURL(blob);
        await playAudioBlob(url, requestId);
        URLApi.revokeObjectURL(url);
      } else {
        const data = await resp.json();
        if (data.use_browser_tts) {
          await playBrowserTTS(text, requestId);
        }
      }
    } catch (err) {
      console.error('TTS error:', err);
      if (ctx.rt.requestId === requestId) {
        await playBrowserTTS(text, requestId);
      }
    }
  }

  /** @param {string} url @param {string} requestId @returns {Promise<void>} */
  function playAudioBlob(url, requestId) {
    return new Promise((resolve) => {
      stopCurrentAudio();
      const audio = new env.Audio(url);
      currentAudio = audio;

      audio.onplaying = () => {
        if (ctx.rt.requestId === requestId) ctx.api.syncSubtitleToSpeechStart();
      };
      audio.onended = () => { currentAudio = null; resolve(); };
      audio.onerror = () => { currentAudio = null; resolve(); };

      if (ctx.rt.requestId !== requestId) {
        resolve();
        return;
      }
      audio.play().catch(() => resolve());
    });
  }

  /** @param {string} text @param {string} requestId @returns {Promise<void>} */
  function playBrowserTTS(text, requestId) {
    return new Promise((resolve) => {
      const synth = env.window.speechSynthesis;
      if (!synth) {
        // 没有语音合成：按字幕同样的语速等，字幕打完才算她说完
        setTimeout(resolve, Math.max(1500, ctx.api.estimateSpeechMs(text)));
        return;
      }

      stopCurrentAudio();

      // cancel() 之后稍等再 speak，避免浏览器重复念的 bug
      setTimeout(() => {
        if (ctx.rt.requestId !== requestId) {
          resolve();
          return;
        }

        const utterance = new env.SpeechSynthesisUtterance(text);
        utterance.rate = 0.9;
        utterance.pitch = 1.1;
        utterance.lang = 'zh-CN';

        // 挑中文声音：先找 Edge 的晓晓，没有就找任意 zh-CN，再没有就交给浏览器默认
        const voices = synth.getVoices();
        const isZhCN = (/** @type {{lang: string}} */ v) => /^zh[-_]CN$/i.test(v.lang);
        const zhVoice =
          voices.find((/** @type {{name: string, lang: string}} */ v) => isZhCN(v) && v.name.includes('Xiaoxiao')) ||
          voices.find(isZhCN);
        if (zhVoice) utterance.voice = zhVoice;

        // 字幕对齐：开始出声 → 对齐起点；念到哪个词 → 字幕跟到哪
        utterance.onstart = () => {
          if (ctx.rt.requestId === requestId) ctx.api.syncSubtitleToSpeechStart();
        };
        utterance.onboundary = (/** @type {{name?: string, charIndex: number, charLength?: number}} */ e) => {
          if (ctx.rt.requestId !== requestId) return;
          if (e.name && e.name !== 'word') return; // 只认逐词进度，句子级的太粗
          ctx.api.syncSubtitleToBoundary(e.charIndex, e.charLength);
        };
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();

        synth.speak(utterance);
      }, 100);
    });
  }

  function stopCurrentAudio() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    if (env.window.speechSynthesis) {
      env.window.speechSynthesis.cancel();
    }
  }

  /** 页面加载时预取一次声音列表（有些浏览器第一次取是空的） */
  function preloadVoices() {
    if (env.window.speechSynthesis) env.window.speechSynthesis.getVoices();
  }

  function dispose() {
    stopCurrentAudio();
  }

  return { playTTS, stopCurrentAudio, preloadVoices, dispose };
}