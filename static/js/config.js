/**
 * 可调的常量。测试里可以覆盖（比如把 20 秒超时改短）：createMiraApp(env, { CHAT_TIMEOUT_MS: 80 })
 */
export const DEFAULT_CONFIG = {
  /** 后端给 DeepSeek 15s，前端多留 5s 给网络 */
  CHAT_TIMEOUT_MS: 20000,

  // 字幕估算语速（浏览器语音 rate 0.9 时大约的速度，觉得快/慢就调这里）
  /** 中文一个字 */
  SUBTITLE_MS_PER_CHAR: 220,
  /** 英文字母、数字 */
  SUBTITLE_MS_PER_LATIN: 70,
  /** 标点停顿 */
  SUBTITLE_PUNCT_PAUSE_MS: 300,
  SUBTITLE_PUNCT: '，。！？、；：…,.!?;:—',

  // 照片
  PHOTO_POLL_MS: 1000,
  /** 从开始生成算，超过就退回内置照片 */
  PHOTO_MAX_WAIT_MS: 30000,
  STAR_COUNT: 12,
  BUILTIN_CAPTION: '冰岛，上个月 —— 黑沙滩上的北极光',

  /** 失败时 Mira 的台词（用角色口吻，不出戏） */
  FAIL_LINES: {
    timeout: '……抱歉，刚刚走神了。你能再说一遍吗？',
    network: '……雨声太大了，刚才没听清。你再说一遍？',
    noSpeech: '……嗯？你刚刚说什么了吗？',
  },
};

/** @typedef {typeof DEFAULT_CONFIG} Config */
