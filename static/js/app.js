/**
 * Mira Scene — Interactive Character Experience
 * Vue 3 Composition API (CDN, no build step)
 */

const { createApp, ref, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

const app = createApp({
  setup() {
    // ===== Reactive State =====
    const userInput = ref('');
    const characterState = ref('idle'); // idle | listening | thinking | speaking
    const currentEmotion = ref('neutral'); // neutral | curious | happy | melancholy | surprised
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
    const showParticles = ref(false);
    const isRecording = ref(false);
    const apiMode = ref('mock'); // mock | live | fallback（在线但 DeepSeek 失败，用了演示回复）
    const chatHistory = ref([]);
    const retryText = ref('');   // 上一句发送失败的话，有值时字幕里出现「再说一次」
    const inputHint = ref('');   // 输入框上方的小提示（麦克风权限、浏览器不支持等）
    const affinity = ref(1);     // 好感度阶段 1 初识 / 2 好奇 / 3 熟络（后端按轮数算）

    // Internal tracking
    let currentRequestId = null;
    let currentAudio = null;
    let speechSynth = null;
    let recognition = null;
    let blinkInterval = null;
    let subtitleTimer = null;
    let subtitleFadeTimer = null;
    let actionTimer = null;
    let putDownTimer = null;
    let particleTimer = null;
    let pendingPhotoShow = false;
    let turnCount = 0;
    let chatAbort = null;   // 当前这轮 /api/chat 的 AbortController
    let hintTimer = null;

    const CHAT_TIMEOUT_MS = 20000; // 后端给 DeepSeek 15s，前端多留 5s 给网络

    // 字幕估算语速（浏览器语音 rate 0.9 时大约的速度，觉得快/慢就调这里）
    const SUBTITLE_MS_PER_CHAR = 220;     // 中文一个字
    const SUBTITLE_MS_PER_LATIN = 70;     // 英文字母、数字
    const SUBTITLE_PUNCT_PAUSE_MS = 300;  // 标点停顿
    const SUBTITLE_PUNCT = '，。！？、；：…,.!?;:—';
    let subtitleChars = [];
    let subtitleSchedule = [];
    let subtitleShown = 0;
    let subtitleStart = 0;
    let subtitleByBoundary = false;

    // 失败时 Mira 的台词（用角色口吻，不出戏）
    const FAIL_LINES = {
      timeout: '……抱歉，刚刚走神了。你能再说一遍吗？',
      network: '……雨声太大了，刚才没听清。你再说一遍？',
      noSpeech: '……嗯？你刚刚说什么了吗？',
    };

    // ===== Computed =====
    const statusText = computed(() => {
      const map = {
        idle: 'Mira 在看着你',
        listening: '在听…',
        thinking: '等她想一下',
        speaking: 'Mira 和你攀谈中…',
      };
      return map[characterState.value] || '';
    });

    const inputPlaceholder = computed(() => {
      if (characterState.value === 'thinking') return '她还在想…';
      if (characterState.value === 'speaking') return '你可以随时插话';
      return '向 Mira 搭话';
    });

    const modeLabel = computed(() => {
      const map = { mock: '演示', live: '在线', fallback: '离线' };
      return map[apiMode.value] || '演示';
    });

    const affinityName = computed(() => ({ 1: '初识', 2: '好奇', 3: '熟络' })[affinity.value] || '初识');

    const emotionParticle = computed(() => {
      const map = {
        happy: '✨',
        melancholy: '🌧',
        surprised: '!',
        curious: '?',
        shy: '♡',
        neutral: '·',
      };
      return map[currentEmotion.value] || '·';
    });

    // ===== Chat Logic =====
    function generateRequestId() {
      return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    async function sendMessage() {
      const text = userInput.value.trim();
      if (!text) return;

      // If speaking, interrupt first
      if (characterState.value === 'speaking') {
        interruptSpeech();
      }

      userInput.value = '';
      retryText.value = '';
      const requestId = generateRequestId();
      currentRequestId = requestId;

      // 上一轮还没回来的请求直接取消（它的 catch 会因为 requestId 过期而被忽略）
      if (chatAbort) chatAbort.abort();
      const controller = new AbortController();
      chatAbort = controller;
      let timedOut = false;
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, CHAT_TIMEOUT_MS);

      // Cancel any pending fade
      clearTimeout(subtitleFadeTimer);
      isSubtitleFading.value = false;

      // Add user message to history
      chatHistory.value.push({ role: 'user', content: text });
      // Keep history bounded to avoid unbounded memory growth
      if (chatHistory.value.length > 40) {
        chatHistory.value = chatHistory.value.slice(-40);
      }

      // Set thinking state
      characterState.value = 'thinking';
      currentSubtitle.value = '';
      displayedSubtitle.value = '';
      clearAction();

      try {
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            history: chatHistory.value.slice(-20),
            request_id: requestId,
          }),
          signal: controller.signal,
        });

        // 处理服务器错误
        if (!resp.ok) {
          throw new Error(`服务器返回 ${resp.status}`);
        }

        const data = await resp.json();
        clearTimeout(timeoutTimer);

        // Check if this response is stale (interrupted)
        if (currentRequestId !== requestId) {
          console.log('Ignoring stale response:', requestId);
          return;
        }

        // 防止 text 为空
        const responseText = data.text || '……抱歉，我刚走神了。';

        // Update API mode（fallback = 在线模式但这一轮降级成了演示回复）
        apiMode.value = data.mode || 'mock';
        if (data.affinity) affinity.value = data.affinity;

        // Add assistant message to history
        // 情绪/动作/场景一起存：后端会把她以前的回复按完整 JSON 发回给模型，模型才不会越聊格式越歪
        chatHistory.value.push({
          role: 'assistant',
          content: responseText,
          emotion: data.emotion || 'neutral',
          action: data.action || null,
          scene_change: data.scene_change || null,
        });
        turnCount++;

        // Apply scene changes
        applySceneChanges(data);

        // Apply emotion
        applyEmotion(data.emotion || 'neutral');

        // Apply action
        applyAction(data.action);

        // Start subtitle typewriter (runs in background, non-blocking)
        startSubtitle(responseText, requestId);

        // Set speaking state
        characterState.value = 'speaking';
        mouthState.value = 'speaking-mouth';

        // Play TTS audio (blocking — wait for it to finish)
        await playTTS(responseText, requestId);

        // Audio done — show full subtitle, then fade after delay
        if (currentRequestId === requestId) {
          clearInterval(subtitleTimer);
          clearTimeout(subtitleFadeTimer);
          displayedSubtitle.value = currentSubtitle.value;
          isTypingSubtitle.value = false;
          isSubtitleFading.value = false;
          characterState.value = 'idle';
          mouthState.value = '';

          // 语音说完眨一下眼回 neutral，过渡更自然
          applyEmotion('neutral');

          // show_photo: 说完话再给照片，相机动作悄悄收回
          if (pendingPhotoShow) {
            showPhoto.value = true;
            pendingPhotoShow = false;
            setTimeout(() => {
              if (currentAction.value === 'show_photo') {
                clearAction();  // 走放下阶段：先放回桌上再收手
              }
            }, 800);
          }

          // Start fade-out after 4 seconds
          subtitleFadeTimer = setTimeout(() => {
            if (currentRequestId === requestId) {
              isSubtitleFading.value = true;
              // Clear subtitle after fade animation (1.5s)
              setTimeout(() => {
                if (currentRequestId === requestId) {
                  currentSubtitle.value = '';
                  displayedSubtitle.value = '';
                  isSubtitleFading.value = false;
                }
              }, 1500);
            }
          }, 4000);
        }

      } catch (err) {
        clearTimeout(timeoutTimer);
        // 被新请求取消 / 已经过期：什么都不做
        if (currentRequestId !== requestId) return;
        console.error('Chat error:', timedOut ? `超过 ${CHAT_TIMEOUT_MS / 1000}s 没有回应` : err);

        // 这句没有得到回复，从历史里拿掉；点「再说一次」会重新加进去
        const last = chatHistory.value[chatHistory.value.length - 1];
        if (last && last.role === 'user' && last.content === text) {
          chatHistory.value.pop();
        }

        characterState.value = 'idle';
        mouthState.value = '';
        clearInterval(subtitleTimer);
        isTypingSubtitle.value = false;
        const line = timedOut ? FAIL_LINES.timeout : FAIL_LINES.network;
        currentSubtitle.value = line;
        displayedSubtitle.value = line;
        retryText.value = text;  // 字幕里出现「再说一次」，不会自动淡出
      } finally {
        if (chatAbort === controller) chatAbort = null;
      }
    }

    // 「再说一次」：用失败的那句话重新发
    function retryLast() {
      if (!retryText.value) return;
      userInput.value = retryText.value;
      sendMessage();
    }

    function showHint(msg) {
      inputHint.value = msg;
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => { inputHint.value = ''; }, 4000);
    }

    // ===== Scene Changes =====
    function applySceneChanges(data) {
      if (!data.scene_change) return;

      const { type, value } = data.scene_change;

      switch (type) {
        case 'background':
          sceneBackground.value = value;
          break;
        case 'effect':
          if (value === 'lightning') triggerLightning();
          break;
        case 'event':
          if (value === 'show_photo') pendingPhotoShow = true;
          if (value === 'lights_flicker') triggerFlicker();
          break;
      }
    }

    function triggerLightning() {
      isLightning.value = true;
      setTimeout(() => { isLightning.value = false; }, 600);
    }

    function triggerFlicker() {
      isFlickering.value = true;
      setTimeout(() => { isFlickering.value = false; }, 1500);
    }

    // ===== Emotion =====
    function applyEmotion(emotion) {
      if (currentEmotion.value === emotion) return;

      // 切换表情前眨一下眼，眼睛大小变化藏在眨眼里更自然
      isBlinking.value = true;
      setTimeout(() => {
        // 眼睛还闭着 → 先切 emotion（眼型在闭眼状态下静默切换）
        currentEmotion.value = emotion;

        // 说话中不覆盖嘴巴动画，只在非说话状态才切嘴型
        if (characterState.value !== 'speaking') {
          switch (emotion) {
            case 'happy': mouthState.value = 'smile'; break;
            case 'melancholy': mouthState.value = 'slight'; break;
            case 'surprised': mouthState.value = 'open'; break;
            default: mouthState.value = ''; break;
          }
        }

        // 下一帧再睁眼 → 新眼型已经就位，看不到过渡
        requestAnimationFrame(() => {
          isBlinking.value = false;
        });

        // Show particles briefly
        triggerParticles();
      }, 150);
    }

    function triggerParticles() {
      showParticles.value = true;
      clearTimeout(particleTimer);
      particleTimer = setTimeout(() => {
        showParticles.value = false;
      }, 1500);
    }

    // ===== Action =====
    function applyAction(action) {
      if (!action) return;
      currentAction.value = action;
      clearTimeout(actionTimer);
      // show_photo 的动作等到说完话才收回（相机举着不放）
      if (action !== 'show_photo') {
        actionTimer = setTimeout(() => {
          currentAction.value = '';
        }, 3000);
      }
    }

    function clearAction() {
      clearTimeout(actionTimer);

      // 正在放相机：让放下动画播完（计时器到了会自己清掉），中途不打断
      if (currentAction.value === 'put_down_camera') return;

      // 举着相机：不直接消失，先切到放下阶段（和 CSS 的 put-down 动画 1s 对应）
      if (currentAction.value === 'show_photo') {
        currentAction.value = 'put_down_camera';
        clearTimeout(putDownTimer);
        putDownTimer = setTimeout(() => {
          if (currentAction.value === 'put_down_camera') {
            currentAction.value = '';
          }
        }, 1000);
        return;
      }

      currentAction.value = '';
    }

    // ===== Subtitle Typewriter =====
    // Non-blocking: just starts the typewriter, doesn't return a Promise
    // 字幕跟着语音走：
    //   1. 先按估算语速出字（一个字 220ms，标点多停一下）
    //   2. 语音真正出声时（onstart），把估算的起点对齐到这一刻
    //   3. 浏览器如果报「念到第几个字」（onboundary），就改成跟着它走，不再估算
    // 打断时「只记已说出的部分」用的就是这里显示出来的字幕，所以越准越好
    function startSubtitle(text, requestId) {
      currentSubtitle.value = text;
      displayedSubtitle.value = '';
      isTypingSubtitle.value = true;

      subtitleChars = Array.from(text);           // 按字切（emoji 不会被切成两半）
      subtitleSchedule = buildSubtitleSchedule(subtitleChars);
      subtitleShown = 0;
      subtitleStart = performance.now();
      subtitleByBoundary = false;

      clearInterval(subtitleTimer);
      subtitleTimer = setInterval(() => {
        // Check if interrupted
        if (currentRequestId !== requestId) {
          clearInterval(subtitleTimer);
          return;
        }
        if (subtitleByBoundary) return; // 已经在跟着浏览器报的进度走了

        const elapsed = performance.now() - subtitleStart;
        let n = subtitleShown;
        while (n < subtitleSchedule.length && subtitleSchedule[n] <= elapsed) n++;
        revealSubtitle(n);
      }, 50);
    }

    // 每个字「出现的时间点」（相对开始，ms）：第 1 个字立刻出现
    function buildSubtitleSchedule(chars) {
      const schedule = [];
      let t = 0;
      for (const ch of chars) {
        schedule.push(t);
        t += subtitleCharMs(ch);
      }
      return schedule;
    }

    function subtitleCharMs(ch) {
      if (SUBTITLE_PUNCT.includes(ch)) return SUBTITLE_PUNCT_PAUSE_MS;
      if (/[A-Za-z0-9]/.test(ch)) return SUBTITLE_MS_PER_LATIN;
      if (/\s/.test(ch)) return 0;
      return SUBTITLE_MS_PER_CHAR;
    }

    // 估算整句念完要多久（没有语音合成时用来等）
    function estimateSpeechMs(text) {
      return Array.from(text).reduce((sum, ch) => sum + subtitleCharMs(ch), 0);
    }

    // 显示到第 n 个字（只往前走，不会把已经显示的字收回去）
    function revealSubtitle(n) {
      n = Math.min(n, subtitleChars.length);
      if (n > subtitleShown) {
        subtitleShown = n;
        displayedSubtitle.value = subtitleChars.slice(0, n).join('');
      }
      if (subtitleShown >= subtitleChars.length) {
        clearInterval(subtitleTimer);
        isTypingSubtitle.value = false;
      }
    }

    // 语音真正开始出声：估算起点对齐到现在（已显示的字保持不动）
    function syncSubtitleToSpeechStart() {
      if (subtitleByBoundary) return;
      const offset = subtitleShown > 0 ? subtitleSchedule[subtitleShown - 1] : 0;
      subtitleStart = performance.now() - offset;
    }

    // 浏览器报「念到 charIndex 了」：显示到正在念的这个词结束
    function syncSubtitleToBoundary(charIndex, charLength) {
      subtitleByBoundary = true;
      const end = charIndex + (charLength || 1);           // UTF-16 下标
      const n = Array.from(currentSubtitle.value.slice(0, end)).length;
      revealSubtitle(n);
    }

    // ===== TTS =====
    async function playTTS(text, requestId) {
      // Speaking state is already set by the caller
      if (currentRequestId !== requestId) return;

      try {
        const resp = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, request_id: requestId }),
        });

        // Check stale again after fetch
        if (currentRequestId !== requestId) return;

        const contentType = resp.headers.get('content-type') || '';

        if (contentType.includes('audio')) {
          // OpenAI TTS — play audio blob
          const blob = await resp.blob();
          if (currentRequestId !== requestId) return;

          const url = URL.createObjectURL(blob);
          await playAudioBlob(url, requestId);
          URL.revokeObjectURL(url);
        } else {
          // Browser TTS fallback
          const data = await resp.json();
          if (data.use_browser_tts) {
            await playBrowserTTS(text, requestId);
          }
        }
      } catch (err) {
        console.error('TTS error:', err);
        // Fall back to browser TTS
        if (currentRequestId === requestId) {
          await playBrowserTTS(text, requestId);
        }
      }

      // Done speaking — idle state is set by the caller after Promise.all
    }

    function playAudioBlob(url, requestId) {
      return new Promise((resolve) => {
        stopCurrentAudio();
        const audio = new Audio(url);
        currentAudio = audio;

        audio.onplaying = () => {
          if (currentRequestId === requestId) syncSubtitleToSpeechStart();
        };
        audio.onended = () => {
          currentAudio = null;
          resolve();
        };
        audio.onerror = () => {
          currentAudio = null;
          resolve();
        };

        // Check stale before playing
        if (currentRequestId !== requestId) {
          resolve();
          return;
        }

        audio.play().catch(() => resolve());
      });
    }

    function playBrowserTTS(text, requestId) {
      return new Promise((resolve) => {
        if (!window.speechSynthesis) {
          // 没有语音合成：按字幕同样的语速等，字幕打完才算她说完
          const readTime = Math.max(1500, estimateSpeechMs(text));
          setTimeout(resolve, readTime);
          return;
        }

        stopCurrentAudio();

        // Delay after cancel() to prevent browser double-speak bug
        setTimeout(() => {
          if (currentRequestId !== requestId) {
            resolve();
            return;
          }

          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 0.9;
          utterance.pitch = 1.1;
          utterance.lang = 'zh-CN';
          speechSynth = utterance;

          // Try to pick a female voice
          const voices = window.speechSynthesis.getVoices();
          const femaleVoice = voices.find(v =>
            v.name.includes('Female') ||
            v.name.includes('Samantha') ||
            v.name.includes('Karen') ||
            v.name.includes('Victoria')
          );
          if (femaleVoice) utterance.voice = femaleVoice;

          // 字幕对齐：开始出声 → 对齐起点；念到哪个词 → 字幕跟到哪
          utterance.onstart = () => {
            if (currentRequestId === requestId) syncSubtitleToSpeechStart();
          };
          utterance.onboundary = (e) => {
            if (currentRequestId !== requestId) return;
            if (e.name && e.name !== 'word') return; // 只认逐词进度，句子级的太粗
            syncSubtitleToBoundary(e.charIndex, e.charLength);
          };

          utterance.onend = () => {
            speechSynth = null;
            resolve();
          };
          utterance.onerror = () => {
            speechSynth = null;
            resolve();
          };

          window.speechSynthesis.speak(utterance);
        }, 100);
      });
    }

    function stopCurrentAudio() {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
      }
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      speechSynth = null;
    }

    // ===== Interruption =====
    function interruptSpeech() {
      // 被打断：历史里只记字幕已经打出来的部分，让 AI 知道自己没说完
      // （进到这里时，这一轮她的回复已经整句 push 进 chatHistory 了）
      const last = chatHistory.value[chatHistory.value.length - 1];
      if (last && last.role === 'assistant') {
        last.content = (displayedSubtitle.value || '') + '……（被打断）';
      }

      // Stop all audio
      stopCurrentAudio();

      // Clear subtitle animation
      clearInterval(subtitleTimer);
      clearTimeout(subtitleFadeTimer);
      isTypingSubtitle.value = false;
      isSubtitleFading.value = false;

      // Generate new request ID to invalidate pending responses
      currentRequestId = generateRequestId();

      // Reset state
      characterState.value = 'idle';
      mouthState.value = '';
      clearAction();
      pendingPhotoShow = false;
    }

    // ===== Speech Recognition (STT) =====
    function initSpeechRecognition() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) return;

      recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'zh-CN';

      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        userInput.value = transcript;
      };

      recognition.onend = () => {
        if (isRecording.value) {
          isRecording.value = false;
          // Auto-send if we got text
          if (userInput.value.trim()) {
            sendMessage();
          } else {
            // 松手了但什么都没识别到：不能一直停在「在听…」
            leaveListening();
          }
        }
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        isRecording.value = false;
        leaveListening();

        if (event.error === 'aborted') return; // 我们自己取消的，不提示
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          showHint('麦克风没有权限，用文字跟她说吧');
        } else if (event.error === 'no-speech') {
          // 没听到声音：Mira 口吻
          currentSubtitle.value = FAIL_LINES.noSpeech;
          displayedSubtitle.value = FAIL_LINES.noSpeech;
          scheduleSubtitleFade();
        } else {
          showHint('语音没识别成功，再按住说一次？');
        }
      };
    }

    // 从「在听…」退回待机（只在还停在 listening 时才改，避免覆盖已经开始的思考）
    function leaveListening() {
      if (characterState.value === 'listening') {
        characterState.value = 'idle';
      }
    }

    // 短提示字幕 4s 后淡出（和正常回复的字幕一样的冲刷效果）
    function scheduleSubtitleFade() {
      clearTimeout(subtitleFadeTimer);
      const shown = currentSubtitle.value;
      subtitleFadeTimer = setTimeout(() => {
        if (currentSubtitle.value !== shown) return;
        isSubtitleFading.value = true;
        setTimeout(() => {
          if (currentSubtitle.value === shown) {
            currentSubtitle.value = '';
            displayedSubtitle.value = '';
          }
          isSubtitleFading.value = false;
        }, 1500);
      }, 4000);
    }

    function startRecording() {
      if (!recognition) {
        initSpeechRecognition();
        if (!recognition) {
          showHint('这个浏览器不支持语音，用文字跟她说吧');
          return;
        }
      }

      // Interrupt if speaking
      if (characterState.value === 'speaking') {
        interruptSpeech();
      }

      // 她还在想（回复在路上）：这一轮作废，迟到的回复不会盖掉「在听…」
      // （sendMessage 的 catch 发现 requestId 过期，会直接忽略，不弹失败台词）
      if (characterState.value === 'thinking') {
        currentRequestId = generateRequestId();
        if (chatAbort) chatAbort.abort();
      }

      isRecording.value = true;
      characterState.value = 'listening';
      userInput.value = '';

      try {
        recognition.start();
      } catch (e) {
        console.error('Failed to start recording:', e);
        isRecording.value = false;
        characterState.value = 'idle';
      }
    }

    function stopRecording() {
      if (!recognition || !isRecording.value) return;

      try {
        recognition.stop();
      } catch (e) {
        console.error('Failed to stop recording:', e);
      }
      // onend handler will set isRecording to false and trigger send
    }

    // ===== Blink Animation =====
    function startBlinking() {
      blinkInterval = setInterval(() => {
        if (characterState.value !== 'speaking') {
          isBlinking.value = true;
          setTimeout(() => { isBlinking.value = false; }, 150);
        }
      }, 3000 + Math.random() * 2000);
    }

    // ===== Check API Status =====
    async function checkStatus() {
      try {
        const resp = await fetch('/api/status');
        const data = await resp.json();
        apiMode.value = data.mode;
      } catch (e) {
        apiMode.value = 'mock';
      }
    }

    // ===== Lifecycle =====
    onMounted(() => {
      startBlinking();
      checkStatus();
      initSpeechRecognition();

      // Pre-load voices for browser TTS
      if (window.speechSynthesis) {
        window.speechSynthesis.getVoices();
      }
    });

    onUnmounted(() => {
      clearInterval(blinkInterval);
      clearInterval(subtitleTimer);
      clearTimeout(subtitleFadeTimer);
      clearTimeout(actionTimer);
      clearTimeout(putDownTimer);
      clearTimeout(particleTimer);
      clearTimeout(hintTimer);
      if (chatAbort) chatAbort.abort();
      stopCurrentAudio();
      if (recognition) {
        try { recognition.abort(); } catch (e) {}
      }
    });

    // ===== Return =====
    return {
      // State
      userInput,
      characterState,
      currentEmotion,
      currentAction,
      sceneBackground,
      isLightning,
      isFlickering,
      isBlinking,
      mouthState,
      currentSubtitle,
      displayedSubtitle,
      isTypingSubtitle,
      isSubtitleFading,
      showPhoto,
      showParticles,
      isRecording,
      apiMode,
      retryText,
      inputHint,
      affinity,

      // Computed
      statusText,
      inputPlaceholder,
      emotionParticle,
      modeLabel,
      affinityName,

      // Methods
      sendMessage,
      retryLast,
      startRecording,
      stopRecording,
    };
  },
});

app.mount('#app');