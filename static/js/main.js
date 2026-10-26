/**
 * 浏览器入口：把真的浏览器能力交给 createMiraApp。
 * Vue 是 index.html 里先加载的全局版本（static/js/vue.global.prod.js），不需要构建。
 */
import { createMiraApp } from './mira.js';

const w = /** @type {any} */ (window);

createMiraApp({
  Vue: w.Vue,
  window: w,
  fetch: (input, init) => window.fetch(input, init),
  SpeechSynthesisUtterance: w.SpeechSynthesisUtterance,
  Audio: w.Audio,
  URL: window.URL,
  requestAnimationFrame: (cb) => window.requestAnimationFrame(cb),
}).mount('#app');
