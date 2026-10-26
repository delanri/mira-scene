/**
 * 页面上用到的所有响应式状态 + 计算属性
 * @typedef {import('./types.js').VueLike} VueLike
 * @typedef {import('./types.js').CharacterState} CharacterState
 * @typedef {import('./types.js').ApiMode} ApiMode
 * @typedef {import('./types.js').ChatMessage} ChatMessage
 * @typedef {import('./types.js').PhotoStar} PhotoStar
 * @typedef {import('./types.js').PhotoView} PhotoView
 */

/** @param {VueLike} Vue */
export function createState(Vue) {
  const { ref, computed } = Vue;

  const userInput = ref('');
  const characterState = ref(/** @type {CharacterState} */ ('idle'));
  const currentEmotion = ref('neutral'); // neutral | curious | happy | melancholy | surprised | shy
  const currentAction = ref('');
  const sceneBackground = ref('default');
  const isLightning = ref(false);
  const isFlickering = ref(false);
  const isBlinking = ref(false);
  const mouthState = ref(''); // '' | 'speaking-mouth' | 'smile' | 'slight' | 'open'
  const currentSubtitle = ref('');
  const displayedSubtitle = ref('');
  const isTypingSubtitle = ref(false);
  const isSubtitleFading = ref(false);
  const showPhoto = ref(false);
  const photoStars = ref(/** @type {PhotoStar[]} */ ([])); // 照片里星星的位置，打开照片时生成一次
  const photoView = ref(/** @type {PhotoView} */ ({ phase: 'builtin', url: '', caption: '' }));
  const showParticles = ref(false);
  const isRecording = ref(false);
  const apiMode = ref(/** @type {ApiMode} */ ('mock'));
  const chatHistory = ref(/** @type {ChatMessage[]} */ ([]));
  const retryText = ref('');   // 上一句发送失败的话，有值时字幕里出现「再说一次」
  const inputHint = ref('');   // 输入框上方的小提示（麦克风权限、浏览器不支持等）
  const affinity = ref(1);     // 好感度阶段 1 初识 / 2 好奇 / 3 熟络（后端按轮数算）

  const statusText = computed(() => ({
    idle: 'Mira 在看着你',
    listening: '在听…',
    thinking: '等她想一下',
    speaking: 'Mira 和你攀谈中…',
  })[characterState.value] || '');

  const inputPlaceholder = computed(() => {
    if (characterState.value === 'thinking') return '她还在想…';
    if (characterState.value === 'speaking') return '你可以随时插话';
    return '向 Mira 搭话';
  });

  const modeLabel = computed(() => ({ mock: '演示', live: '在线', fallback: '离线' })[apiMode.value] || '演示');

  const affinityName = computed(() => ({ 1: '初识', 2: '好奇', 3: '熟络' })[affinity.value] || '初识');

  const emotionParticle = computed(() => ({
    happy: '✨',
    melancholy: '🌧',
    surprised: '!',
    curious: '?',
    shy: '♡',
    neutral: '·',
  })[currentEmotion.value] || '·');

  return {
    userInput, characterState, currentEmotion, currentAction, sceneBackground,
    isLightning, isFlickering, isBlinking, mouthState,
    currentSubtitle, displayedSubtitle, isTypingSubtitle, isSubtitleFading,
    showPhoto, photoStars, photoView, showParticles, isRecording,
    apiMode, chatHistory, retryText, inputHint, affinity,
    statusText, inputPlaceholder, modeLabel, affinityName, emotionParticle,
  };
}

/** @typedef {ReturnType<typeof createState>} State */
