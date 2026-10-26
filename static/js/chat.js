/**
 * 一轮对话的完整流程：发出 → 思考 → 回复到达 → 说话（语音 + 字幕 + 表情/动作/场景）→ 说完（照片、淡出）
 * 以及打断、超时、失败重试。
 *
 * 防过期：每轮一个 requestId，回复、语音、字幕每一步都对一下，过期的直接丢；
 * 上一轮还在路上的请求用 AbortController 取消。
 * @param {import('./types.js').Ctx} ctx
 */
export function createChat(ctx) {
  const { s, env, config, rt } = ctx;
  /** @type {any} */ let hintTimer = null;

  function generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async function sendMessage() {
    const a = ctx.api;
    const text = s.userInput.value.trim();
    if (!text) return;

    // 她在说话：先打断
    if (s.characterState.value === 'speaking') {
      interruptSpeech();
    }

    s.userInput.value = '';
    s.retryText.value = '';
    const requestId = generateRequestId();
    rt.requestId = requestId;

    // 上一轮还没回来的请求直接取消（它的 catch 会因为 requestId 过期而被忽略）
    if (rt.chatAbort) rt.chatAbort.abort();
    const controller = new AbortController();
    rt.chatAbort = controller;
    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, config.CHAT_TIMEOUT_MS);

    a.cancelFade();

    s.chatHistory.value.push({ role: 'user', content: text });
    if (s.chatHistory.value.length > 40) {
      s.chatHistory.value = s.chatHistory.value.slice(-40); // 历史不无限增长
    }

    s.characterState.value = 'thinking';
    s.currentSubtitle.value = '';
    s.displayedSubtitle.value = '';
    a.clearAction();

    try {
      const resp = await env.fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: s.chatHistory.value.slice(-20),
          request_id: requestId,
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new Error(`服务器返回 ${resp.status}`);
      }

      /** @type {import('./types.js').ChatReply} */
      const data = await resp.json();
      clearTimeout(timeoutTimer);

      // 过期（被打断 / 有了新的一轮）
      if (rt.requestId !== requestId) {
        console.log('Ignoring stale response:', requestId);
        return;
      }

      const responseText = data.text || '……抱歉，我刚走神了。';

      // fallback = 在线模式但这一轮降级成了演示回复
      s.apiMode.value = data.mode || 'mock';
      if (data.affinity) s.affinity.value = data.affinity;

      // 情绪/动作/场景一起存：后端会把她以前的回复按完整 JSON 发回给模型，模型才不会越聊格式越歪
      s.chatHistory.value.push({
        role: 'assistant',
        content: responseText,
        emotion: data.emotion || 'neutral',
        action: data.action || null,
        scene_change: data.scene_change || null,
      });

      a.applySceneChanges(data);
      // 她要给你看照片：现在就开始查生成进度（她说话这几秒刚好用来生成）
      if (rt.pendingPhotoShow) a.startPhotoJob(data.photo);
      a.applyEmotion(data.emotion || 'neutral');
      a.applyAction(data.action);
      a.startSubtitle(responseText, requestId);

      s.characterState.value = 'speaking';
      s.mouthState.value = 'speaking-mouth';

      await a.playTTS(responseText, requestId); // 说完才继续

      if (rt.requestId === requestId) {
        a.finishSubtitle();
        s.characterState.value = 'idle';
        s.mouthState.value = '';

        // 语音说完眨一下眼回 neutral，过渡更自然
        a.applyEmotion('neutral');

        // show_photo：说完话再给照片，相机动作悄悄收回
        if (rt.pendingPhotoShow) {
          a.openPhoto();
          rt.pendingPhotoShow = false;
          setTimeout(() => {
            if (s.currentAction.value === 'show_photo') {
              a.clearAction(); // 走放下阶段：先放回桌上再收手
            }
          }, 800);
        }

        a.scheduleReplyFade(requestId);
      }
    } catch (err) {
      clearTimeout(timeoutTimer);
      // 被新请求取消 / 已经过期：什么都不做
      if (rt.requestId !== requestId) return;
      console.error('Chat error:', timedOut ? `超过 ${config.CHAT_TIMEOUT_MS / 1000}s 没有回应` : err);

      // 这句没有得到回复，从历史里拿掉；点「再说一次」会重新加进去
      const last = s.chatHistory.value[s.chatHistory.value.length - 1];
      if (last && last.role === 'user' && last.content === text) {
        s.chatHistory.value.pop();
      }

      s.characterState.value = 'idle';
      s.mouthState.value = '';
      a.stopTyping();
      a.reportEvent(timedOut ? 'timeout' : 'network_error', timedOut ? '' : err && /** @type {Error} */ (err).message);
      const line = timedOut ? config.FAIL_LINES.timeout : config.FAIL_LINES.network;
      s.currentSubtitle.value = line;
      s.displayedSubtitle.value = line;
      s.retryText.value = text; // 字幕里出现「再说一次」，不会自动淡出
    } finally {
      if (rt.chatAbort === controller) rt.chatAbort = null;
    }
  }

  /** 「再说一次」：用失败的那句话重新发 */
  function retryLast() {
    if (!s.retryText.value) return;
    ctx.api.reportEvent('retry');
    s.userInput.value = s.retryText.value;
    sendMessage();
  }

  /** 打断她：停声音、停字幕、作废这一轮、收动作 */
  function interruptSpeech() {
    const a = ctx.api;
    a.reportEvent('interrupt', s.displayedSubtitle.value);

    // 历史里只记字幕已经打出来的部分，让 AI 知道自己没说完
    // （进到这里时，这一轮她的回复已经整句 push 进 chatHistory 了）
    const last = s.chatHistory.value[s.chatHistory.value.length - 1];
    if (last && last.role === 'assistant') {
      last.content = (s.displayedSubtitle.value || '') + '……（被打断）';
    }

    a.stopCurrentAudio();
    a.stopSubtitle();
    rt.requestId = generateRequestId(); // 还在路上的回复、语音、字幕全部作废

    s.characterState.value = 'idle';
    s.mouthState.value = '';
    a.clearAction();
    rt.pendingPhotoShow = false;
    // 还没给你看的照片不再给了；已经打开的照片留着，让你自己关
    if (!s.showPhoto.value) a.stopPhotoJob();
  }

  /** 输入框上方的小提示，4 秒后消失 @param {string} msg */
  function showHint(msg) {
    s.inputHint.value = msg;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { s.inputHint.value = ''; }, 4000);
  }

  async function checkStatus() {
    try {
      const resp = await env.fetch('/api/status');
      const data = await resp.json();
      s.apiMode.value = data.mode;
    } catch (e) {
      s.apiMode.value = 'mock';
    }
  }

  function dispose() {
    clearTimeout(hintTimer);
    if (rt.chatAbort) rt.chatAbort.abort();
  }

  return { generateRequestId, sendMessage, retryLast, interruptSpeech, showHint, checkStatus, dispose };
}
