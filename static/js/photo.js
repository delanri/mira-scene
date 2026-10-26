/**
 * 她拿相机给你看的照片。三种样子：
 *   builtin    内置的冰岛极光（没配生图 / 生成失败 / 超时）
 *   developing 照片框先出来，像拍立得在显影，「她在翻相机…」
 *   ready      生成好的照片，慢慢显影出来
 * 生成任务在她开始说话时就开始查进度，说完给你看的时候多半已经好了
 * @param {import('./types.js').Ctx} ctx
 */
export function createPhoto(ctx) {
  const { s, env, config } = ctx;

  /** @type {{ id: string, caption: string, status: string, url: string, error: string, reported: boolean } | null} */
  let photoJob = null;
  /** @type {any} */ let pollTimer = null;
  let pollStart = 0;

  function randomStarPos() {
    return { left: Math.random() * 100, top: Math.random() * 60 };
  }

  /** @returns {import('./types.js').PhotoView} */
  function builtinView() {
    return { phase: 'builtin', url: '', caption: config.BUILTIN_CAPTION };
  }

  /** 打开照片：星星位置只在这里生成一次（模板里不现算随机数，否则每次重新渲染星星都会乱跳） */
  function openPhoto() {
    s.photoStars.value = Array.from({ length: config.STAR_COUNT }, (_, id) => ({
      id,
      ...randomStarPos(),
      delay: -Math.random() * 3, // 负延迟 = 一开始就处在周期的不同位置，星星错开闪
    }));
    s.photoView.value = builtinView();
    s.showPhoto.value = true;
    syncView();
  }

  function closePhoto() {
    s.showPhoto.value = false;
    stopPhotoJob();
  }

  /** 一个闪烁周期结束（此刻完全透明）→ 换到新位置再亮起 @param {import('./types.js').PhotoStar} star */
  function moveStar(star) {
    Object.assign(star, randomStarPos());
  }

  /** 回复里带了生成任务：开始查进度；没有（没配生图）就到时候显示内置照片 @param {{ job_id: string, caption?: string } | null | undefined} photo */
  function startPhotoJob(photo) {
    stopPhotoJob();
    if (!photo || !photo.job_id) return;
    photoJob = { id: photo.job_id, caption: photo.caption || '', status: 'queued', url: '', error: '', reported: false };
    pollStart = Date.now();
    poll();
  }

  function stopPhotoJob() {
    clearTimeout(pollTimer);
    photoJob = null;
  }

  async function poll() {
    const job = photoJob;
    if (!job) return;
    try {
      const r = await env.fetch(`/api/photo/${job.id}`);
      if (r.ok) {
        const d = await r.json();
        if (photoJob !== job) return; // 查的过程中被换掉/取消了
        job.status = d.status;
        job.url = d.url || '';
        job.error = d.error || '';
      }
    } catch (e) {
      // 网络抖一下：下次再查
    }
    if (photoJob !== job) return;
    if (Date.now() - pollStart > config.PHOTO_MAX_WAIT_MS && job.status !== 'done') {
      job.status = 'failed';
      job.error = `超过 ${config.PHOTO_MAX_WAIT_MS / 1000}s`;
    }
    syncView();
    if (job.status !== 'done' && job.status !== 'failed') {
      pollTimer = setTimeout(poll, config.PHOTO_POLL_MS);
    }
  }

  /** 照片打开着的时候，把任务状态画到拍立得上 */
  function syncView() {
    const job = photoJob;
    if (!s.showPhoto.value || !job) return;
    if (job.status === 'done') {
      s.photoView.value = { phase: 'ready', url: job.url, caption: job.caption || config.BUILTIN_CAPTION };
    } else if (job.status === 'failed') {
      fallBackToBuiltin(job.error || 'failed');
    } else {
      s.photoView.value = { phase: 'developing', url: '', caption: job.caption };
    }
  }

  /** @param {string} reason */
  function fallBackToBuiltin(reason) {
    s.photoView.value = builtinView();
    if (photoJob && !photoJob.reported) {
      photoJob.reported = true;
      ctx.api.reportEvent('photo_fallback', reason);
    }
  }

  /** 生成的图片链接打不开（比如文件被删了）：也退回内置照片 */
  function onPhotoError() {
    fallBackToBuiltin('图片加载失败');
  }

  function dispose() {
    clearTimeout(pollTimer);
  }

  return { openPhoto, closePhoto, moveStar, startPhotoJob, stopPhotoJob, onPhotoError, dispose };
}
