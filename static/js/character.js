/**
 * 角色表演：表情（眨眼里切换）、动作（含拿相机/放下）、场景事件、待机眨眼、情绪小粒子
 * @param {import('./types.js').Ctx} ctx
 */
export function createCharacter(ctx) {
  const { s, env } = ctx;

  /** @type {any} */ let actionTimer = null;
  /** @type {any} */ let putDownTimer = null;
  /** @type {any} */ let particleTimer = null;
  /** @type {any} */ let emotionTimer = null;
  /** @type {any} */ let blinkInterval = null;
  let targetEmotion = 'neutral'; // 正要切成的表情（眨眼 150ms 后才真正落到 currentEmotion）

  // ---------------------------------------------------------------- 场景
  /** @param {import('./types.js').ChatReply} data */
  function applySceneChanges(data) {
    if (!data.scene_change) return;
    const { type, value } = data.scene_change;
    switch (type) {
      case 'background':
        s.sceneBackground.value = value;
        break;
      case 'effect':
        if (value === 'lightning') triggerLightning();
        break;
      case 'event':
        if (value === 'show_photo') ctx.rt.pendingPhotoShow = true;
        if (value === 'lights_flicker') triggerFlicker();
        break;
    }
  }

  function triggerLightning() {
    s.isLightning.value = true;
    setTimeout(() => { s.isLightning.value = false; }, 600);
  }

  function triggerFlicker() {
    s.isFlickering.value = true;
    setTimeout(() => { s.isFlickering.value = false; }, 1500);
  }

  // ---------------------------------------------------------------- 表情
  /** @param {string} emotion */
  function applyEmotion(emotion) {
    // 跟「正要切成的表情」比，而不是跟当前显示的比：
    // 上一个表情还在 150ms 眨眼里没落地时，又要切回原表情，不能被当成"已经是了"跳过（否则脸红会卡住）
    if (targetEmotion === emotion) return;
    targetEmotion = emotion;

    // 切换表情前眨一下眼，眼睛大小变化藏在眨眼里更自然
    s.isBlinking.value = true;
    clearTimeout(emotionTimer); // 上一个还没落地的切换作废，只认最新的
    emotionTimer = setTimeout(() => {
      // 眼睛还闭着 → 先切 emotion（眼型在闭眼状态下静默切换）
      s.currentEmotion.value = emotion;

      // 说话中不覆盖嘴巴动画，只在非说话状态才切嘴型
      if (s.characterState.value !== 'speaking') {
        switch (emotion) {
          case 'happy': s.mouthState.value = 'smile'; break;
          case 'melancholy': s.mouthState.value = 'slight'; break;
          case 'surprised': s.mouthState.value = 'open'; break;
          default: s.mouthState.value = ''; break;
        }
      }

      // 下一帧再睁眼 → 新眼型已经就位，看不到过渡
      env.requestAnimationFrame(() => {
        s.isBlinking.value = false;
      });

      triggerParticles();
    }, 150);
  }

  function triggerParticles() {
    s.showParticles.value = true;
    clearTimeout(particleTimer);
    particleTimer = setTimeout(() => {
      s.showParticles.value = false;
    }, 1500);
  }

  // ---------------------------------------------------------------- 动作
  /** @param {string | null | undefined} action */
  function applyAction(action) {
    if (!action) return;
    s.currentAction.value = action;
    clearTimeout(actionTimer);
    // show_photo 的动作等到说完话才收回（相机举着不放）
    if (action !== 'show_photo') {
      actionTimer = setTimeout(() => {
        s.currentAction.value = '';
      }, 3000);
    }
  }

  function clearAction() {
    clearTimeout(actionTimer);

    // 正在放相机：让放下动画播完（计时器到了会自己清掉），中途不打断
    if (s.currentAction.value === 'put_down_camera') return;

    // 举着相机：不直接消失，先切到放下阶段（和 CSS 的 put-down 动画 1s 对应）
    if (s.currentAction.value === 'show_photo') {
      s.currentAction.value = 'put_down_camera';
      clearTimeout(putDownTimer);
      putDownTimer = setTimeout(() => {
        if (s.currentAction.value === 'put_down_camera') {
          s.currentAction.value = '';
        }
      }, 1000);
      return;
    }

    s.currentAction.value = '';
  }

  // ---------------------------------------------------------------- 待机眨眼
  function startBlinking() {
    blinkInterval = setInterval(() => {
      if (s.characterState.value !== 'speaking') {
        s.isBlinking.value = true;
        setTimeout(() => { s.isBlinking.value = false; }, 150);
      }
    }, 3000 + Math.random() * 2000);
  }

  function dispose() {
    clearInterval(blinkInterval);
    clearTimeout(actionTimer);
    clearTimeout(putDownTimer);
    clearTimeout(particleTimer);
    clearTimeout(emotionTimer);
  }

  return { applySceneChanges, applyEmotion, applyAction, clearAction, startBlinking, dispose };
}
