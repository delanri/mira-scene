/**
 * Mira Scene — 把各个模块组装成一个 Vue 应用。
 *
 * 浏览器能力（Vue、fetch、语音……）全部通过 env 传进来：
 *   浏览器里 main.js 传真的；测试里 tests/helpers/load_app.js 传假的，每个测试一套，互不影响。
 *
 * 模块：
 *   state.js     页面状态和计算属性
 *   chat.js      一轮对话、打断、超时、重试
 *   character.js 表情、动作、场景事件、眨眼
 *   subtitle.js  字幕跟随语音进度、淡出
 *   speech.js    她说话（浏览器语音 / 音频）
 *   listen.js    按住说话（语音识别）
 *   photo.js     拿相机给你看的照片（生成进度、显影、退回内置）
 *   events.js    前端事件上报给观测页
 */
import { DEFAULT_CONFIG } from './config.js';
import { createState } from './state.js';
import { createEvents } from './events.js';
import { createCharacter } from './character.js';
import { createSubtitle } from './subtitle.js';
import { createSpeech } from './speech.js';
import { createPhoto } from './photo.js';
import { createChat } from './chat.js';
import { createListen } from './listen.js';

/**
 * @param {import('./types.js').Env} env
 * @param {Partial<import('./config.js').Config>} [configOverrides]
 */
export function createMiraApp(env, configOverrides = {}) {
  const { Vue } = env;

  return Vue.createApp({
    setup() {
      /** @type {import('./types.js').Ctx} */
      const ctx = {
        env,
        config: { ...DEFAULT_CONFIG, ...configOverrides },
        s: createState(Vue),
        rt: { requestId: null, chatAbort: null, pendingPhotoShow: false },
        api: /** @type {any} */ ({}),
      };

      const modules = [createEvents, createCharacter, createSubtitle, createSpeech, createPhoto, createChat, createListen]
        .map((create) => create(ctx));
      Object.assign(ctx.api, ...modules);
      const a = ctx.api;

      Vue.onMounted(() => {
        a.startBlinking();
        a.checkStatus();
        a.initSpeechRecognition();
        a.preloadVoices();
      });

      Vue.onUnmounted(() => {
        modules.forEach((m) => 'dispose' in m && m.dispose());
      });

      // 模板里用到的
      return {
        ...ctx.s,
        sendMessage: a.sendMessage,
        retryLast: a.retryLast,
        startRecording: a.startRecording,
        stopRecording: a.stopRecording,
        moveStar: a.moveStar,
        closePhoto: a.closePhoto,
        onPhotoError: a.onPhotoError,
      };
    },
  });
}
