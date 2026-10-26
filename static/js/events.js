/**
 * 只有前端知道的事（打断、重试、超时、断网、语音识别失败、照片退回）报给后端，记到观测页 /debug。
 * 发出去就不管，失败也不影响任何东西。
 * @param {import('./types.js').Ctx} ctx
 */
export function createEvents(ctx) {
  /**
   * @param {'interrupt' | 'retry' | 'timeout' | 'network_error' | 'stt_error' | 'photo_fallback'} type
   * @param {unknown} [detail]
   */
  function reportEvent(type, detail) {
    try {
      ctx.env.fetch('/api/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, request_id: ctx.rt.requestId, detail: detail ? String(detail) : '' }),
      }).catch(() => {});
    } catch (e) {
      // 忽略
    }
  }

  return { reportEvent };
}
