/**
 * 共享的类型定义（只有 JSDoc，没有运行时代码）。
 * 用 TypeScript 做类型检查：npm run typecheck（不需要构建，浏览器直接跑原文件）。
 */

/**
 * @template T
 * @typedef {{ value: T }} Ref
 */

/**
 * @template T
 * @typedef {{ readonly value: T }} ComputedRef
 */

/**
 * 只用到的那一小部分 Vue API（浏览器里是真 Vue，测试里是假的）
 * @typedef {Object} VueLike
 * @property {<T>(value: T) => Ref<T>} ref
 * @property {<T>(getter: () => T) => ComputedRef<T>} computed
 * @property {(options: { setup: () => object }) => { mount: (selector?: string) => unknown }} createApp
 * @property {(fn: () => void) => void} onMounted
 * @property {(fn: () => void) => void} onUnmounted
 */

/**
 * 浏览器能力，全部从外面传进来
 * @typedef {Object} Env
 * @property {VueLike} Vue
 * @property {any} window                         speechSynthesis / SpeechRecognition 从这里取
 * @property {(input: string, init?: RequestInit) => Promise<any>} fetch
 * @property {any} [SpeechSynthesisUtterance]
 * @property {any} [Audio]
 * @property {{ createObjectURL: (b: Blob) => string, revokeObjectURL: (u: string) => void }} [URL]
 * @property {(cb: () => void) => unknown} requestAnimationFrame
 */

/** @typedef {'idle' | 'listening' | 'thinking' | 'speaking'} CharacterState */
/** @typedef {'mock' | 'live' | 'fallback'} ApiMode */

/**
 * @typedef {Object} SceneChange
 * @property {'background' | 'effect' | 'event'} type
 * @property {string} value
 */

/**
 * 历史里的一条。她说的话连同情绪/动作/场景一起存（后端会还原成 JSON 发给模型）
 * @typedef {Object} ChatMessage
 * @property {'user' | 'assistant'} role
 * @property {string} content
 * @property {string} [emotion]
 * @property {string | null} [action]
 * @property {SceneChange | null} [scene_change]
 */

/**
 * /api/chat 的返回
 * @typedef {Object} ChatReply
 * @property {string} text
 * @property {string} [emotion]
 * @property {string | null} [action]
 * @property {SceneChange | null} [scene_change]
 * @property {{ job_id: string, caption: string } | null} [photo]
 * @property {ApiMode} [mode]
 * @property {number} [affinity]
 */

/** @typedef {{ id: number, left: number, top: number, delay: number }} PhotoStar */

/**
 * 拍立得上显示什么：builtin 内置冰岛 / developing 显影中 / ready 生成好的照片
 * @typedef {{ phase: 'builtin' | 'developing' | 'ready', url: string, caption: string }} PhotoView
 */

/**
 * 跨模块共享、但不需要显示在页面上的运行时状态
 * @typedef {Object} Runtime
 * @property {string | null} requestId     当前这一轮的 id；回复、语音、字幕每一步都对一下，过期的直接丢
 * @property {AbortController | null} chatAbort
 * @property {boolean} pendingPhotoShow    这一轮说完要给你看照片
 */

/**
 * @typedef {Object} Ctx
 * @property {Env} env
 * @property {import('./config.js').Config} config
 * @property {import('./state.js').State} s
 * @property {Runtime} rt
 * @property {Api} api
 */

/**
 * 所有模块的方法合在一起，模块之间互相调用都走这里（运行时才取，避免循环依赖）
 * @typedef {ReturnType<typeof import('./events.js').createEvents>
 *   & ReturnType<typeof import('./character.js').createCharacter>
 *   & ReturnType<typeof import('./subtitle.js').createSubtitle>
 *   & ReturnType<typeof import('./speech.js').createSpeech>
 *   & ReturnType<typeof import('./photo.js').createPhoto>
 *   & ReturnType<typeof import('./chat.js').createChat>
 *   & ReturnType<typeof import('./listen.js').createListen>} Api
 */

export {};
