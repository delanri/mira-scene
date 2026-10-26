/**
 * 字幕跟着语音走：
 *   1. 先按估算语速出字（一个字 220ms，标点多停一下）
 *   2. 语音真正出声时（onstart），把估算的起点对齐到这一刻
 *   3. 浏览器如果报「念到第几个字」（onboundary），就改成跟着它走，不再估算
 * 打断时「只记已说出的部分」用的就是这里显示出来的字幕，所以越准越好
 * @param {import('./types.js').Ctx} ctx
 */
export function createSubtitle(ctx) {
  const { s, config } = ctx;

  /** @type {any} */ let subtitleTimer = null;
  /** @type {any} */ let fadeTimer = null;
  /** @type {string[]} */ let chars = [];
  /** @type {number[]} */ let schedule = [];
  let shown = 0;
  let startedAt = 0;
  let byBoundary = false;

  /**
   * 开始逐字显示一句话（不阻塞）
   * @param {string} text
   * @param {string} requestId
   */
  function startSubtitle(text, requestId) {
    s.currentSubtitle.value = text;
    s.displayedSubtitle.value = '';
    s.isTypingSubtitle.value = true;

    chars = Array.from(text); // 按字切（emoji 不会被切成两半）
    schedule = buildSchedule(chars);
    shown = 0;
    startedAt = performance.now();
    byBoundary = false;

    clearInterval(subtitleTimer);
    subtitleTimer = setInterval(() => {
      if (ctx.rt.requestId !== requestId) { // 被打断 / 过期
        clearInterval(subtitleTimer);
        return;
      }
      if (byBoundary) return; // 已经在跟着浏览器报的进度走了

      const elapsed = performance.now() - startedAt;
      let n = shown;
      while (n < schedule.length && schedule[n] <= elapsed) n++;
      reveal(n);
    }, 50);
  }

  /** 每个字「出现的时间点」（相对开始，ms）：第 1 个字立刻出现 @param {string[]} cs */
  function buildSchedule(cs) {
    const out = [];
    let t = 0;
    for (const ch of cs) {
      out.push(t);
      t += charMs(ch);
    }
    return out;
  }

  /** @param {string} ch */
  function charMs(ch) {
    if (config.SUBTITLE_PUNCT.includes(ch)) return config.SUBTITLE_PUNCT_PAUSE_MS;
    if (/[A-Za-z0-9]/.test(ch)) return config.SUBTITLE_MS_PER_LATIN;
    if (/\s/.test(ch)) return 0;
    return config.SUBTITLE_MS_PER_CHAR;
  }

  /** 估算整句念完要多久（没有语音合成时用来等） @param {string} text */
  function estimateSpeechMs(text) {
    return Array.from(text).reduce((sum, ch) => sum + charMs(ch), 0);
  }

  /** 显示到第 n 个字（只往前走，不会把已经显示的字收回去） @param {number} n */
  function reveal(n) {
    n = Math.min(n, chars.length);
    if (n > shown) {
      shown = n;
      s.displayedSubtitle.value = chars.slice(0, n).join('');
    }
    if (shown >= chars.length) {
      clearInterval(subtitleTimer);
      s.isTypingSubtitle.value = false;
    }
  }

  /** 语音真正开始出声：估算起点对齐到现在（已显示的字保持不动） */
  function syncSubtitleToSpeechStart() {
    if (byBoundary) return;
    const offset = shown > 0 ? schedule[shown - 1] : 0;
    startedAt = performance.now() - offset;
  }

  /**
   * 浏览器报「念到 charIndex 了」：显示到正在念的这个词结束
   * @param {number} charIndex  UTF-16 下标
   * @param {number} [charLength]
   */
  function syncSubtitleToBoundary(charIndex, charLength) {
    byBoundary = true;
    const end = charIndex + (charLength || 1);
    reveal(Array.from(s.currentSubtitle.value.slice(0, end)).length);
  }

  // ---------------------------------------------------------------- 停止 / 收尾 / 淡出
  /** 停止逐字显示（字幕内容不动） */
  function stopTyping() {
    clearInterval(subtitleTimer);
    s.isTypingSubtitle.value = false;
  }

  /** 取消还没开始的淡出 */
  function cancelFade() {
    clearTimeout(fadeTimer);
    s.isSubtitleFading.value = false;
  }

  /** 打断时：停字幕、取消淡出 */
  function stopSubtitle() {
    stopTyping();
    cancelFade();
  }

  /** 她说完了：显示整句 */
  function finishSubtitle() {
    stopSubtitle();
    s.displayedSubtitle.value = s.currentSubtitle.value;
  }

  /** 说完 4 秒后"雨水冲刷"淡出（期间又开始新一轮就不淡了） @param {string} requestId */
  function scheduleReplyFade(requestId) {
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => {
      if (ctx.rt.requestId !== requestId) return;
      s.isSubtitleFading.value = true;
      setTimeout(() => { // 淡出动画 1.5s
        if (ctx.rt.requestId === requestId) {
          s.currentSubtitle.value = '';
          s.displayedSubtitle.value = '';
          s.isSubtitleFading.value = false;
        }
      }, 1500);
    }, 4000);
  }

  /** 一句短提示（比如"你刚刚说什么了吗？"）显示 4 秒后淡出 @param {string} line */
  function showShortLine(line) {
    s.currentSubtitle.value = line;
    s.displayedSubtitle.value = line;
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => {
      if (s.currentSubtitle.value !== line) return;
      s.isSubtitleFading.value = true;
      setTimeout(() => {
        if (s.currentSubtitle.value === line) {
          s.currentSubtitle.value = '';
          s.displayedSubtitle.value = '';
        }
        s.isSubtitleFading.value = false;
      }, 1500);
    }, 4000);
  }

  function dispose() {
    clearInterval(subtitleTimer);
    clearTimeout(fadeTimer);
  }

  return {
    startSubtitle, estimateSpeechMs, syncSubtitleToSpeechStart, syncSubtitleToBoundary,
    stopTyping, cancelFade, stopSubtitle, finishSubtitle, scheduleReplyFade, showShortLine, dispose,
  };
}
