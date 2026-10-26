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
    const apiMode = ref('mock');
    const chatHistory = ref([]);

    // Internal tracking
    let currentRequestId = null;
    let currentAudio = null;
    let speechSynth = null;
    let recognition = null;
    let blinkInterval = null;
    let subtitleTimer = null;
    let subtitleFadeTimer = null;
    let actionTimer = null;
    let particleTimer = null;
    let turnCount = 0;

    // ===== Computed =====
    const statusText = computed(() => {
      const map = {
        idle: 'Mira 在等着谁',
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

    const emotionParticle = computed(() => {
      const map = {
        happy: '✨',
        melancholy: '🌧',
        surprised: '!',
        curious: '?',
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
      const requestId = generateRequestId();
      currentRequestId = requestId;

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
        });

        // 处理服务器错误
        if (!resp.ok) {
          throw new Error(`服务器返回 ${resp.status}`);
        }

        const data = await resp.json();

        // Check if this response is stale (interrupted)
        if (currentRequestId !== requestId) {
          console.log('Ignoring stale response:', requestId);
          return;
        }

        // 防止 text 为空
        const responseText = data.text || '……抱歉，我刚走神了。';

        // Update API mode
        apiMode.value = data.mode || 'mock';

        // Add assistant message to history
        chatHistory.value.push({ role: 'assistant', content: responseText });
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

          // 说完话后情绪渐回 neutral（眼睛恢复原样）
          setTimeout(() => {
            if (currentRequestId === requestId && characterState.value === 'idle') {
              currentEmotion.value = 'neutral';
              mouthState.value = '';
            }
          }, 3500);

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
        console.error('Chat error:', err);
        if (currentRequestId === requestId) {
          characterState.value = 'idle';
          currentSubtitle.value = '抱歉，Mira有点没听清…';
          displayedSubtitle.value = '抱歉，Mira有点没听清…';
        }
      }
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
          if (value === 'show_photo') showPhoto.value = true;
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
      currentEmotion.value = emotion;

      // Mouth shape based on emotion
      switch (emotion) {
        case 'happy': mouthState.value = 'smile'; break;
        case 'melancholy': mouthState.value = 'slight'; break;
        case 'surprised': mouthState.value = 'open'; break;
        default: mouthState.value = ''; break;
      }

      // Show particles briefly
      triggerParticles();
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
      actionTimer = setTimeout(() => {
        currentAction.value = '';
      }, 3000);
    }

    function clearAction() {
      currentAction.value = '';
      clearTimeout(actionTimer);
    }

    // ===== Subtitle Typewriter =====
    // Non-blocking: just starts the typewriter, doesn't return a Promise
    function startSubtitle(text, requestId) {
      currentSubtitle.value = text;
      displayedSubtitle.value = '';
      isTypingSubtitle.value = true;

      const chars = text.split('');
      let i = 0;

      clearInterval(subtitleTimer);
      subtitleTimer = setInterval(() => {
        // Check if interrupted
        if (currentRequestId !== requestId) {
          clearInterval(subtitleTimer);
          return;
        }

        if (i < chars.length) {
          displayedSubtitle.value += chars[i];
          i++;
        } else {
          clearInterval(subtitleTimer);
          isTypingSubtitle.value = false;
        }
      }, 35); // ~35ms per character for natural feel
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
          // No speech synthesis, just wait a bit
          const readTime = Math.max(2000, text.length * 60);
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
          }
        }
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        isRecording.value = false;
      };
    }

    function startRecording() {
      if (!recognition) {
        initSpeechRecognition();
        if (!recognition) return; // Not supported
      }

      // Interrupt if speaking
      if (characterState.value === 'speaking') {
        interruptSpeech();
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
      clearTimeout(particleTimer);
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

      // Computed
      statusText,
      inputPlaceholder,
      emotionParticle,

      // Methods
      sendMessage,
      startRecording,
      stopRecording,
    };
  },
});

app.mount('#app');