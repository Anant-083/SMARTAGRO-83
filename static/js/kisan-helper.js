(function() {

    /* ── Inject HTML ─────────────────────────── */
    document.body.insertAdjacentHTML('beforeend', `
<div id="kisanWidget">
  <div id="kisanToggleBtn" onclick="toggleKisan()" title="Kisan Helper">
    <i class="fas fa-microphone"></i>
    <span class="kw-pulse"></span>
  </div>

  <!-- Fullscreen Chat Overlay -->
  <div id="kisanOverlay" style="display:none">
    <div id="kisanWindow">
      <div class="kw-header">
        <div class="kw-header-left">
          <div class="kw-avatar"><i class="fas fa-seedling"></i></div>
          <div>
            <div class="kw-name">Kisan Helper</div>
            <div class="kw-sub" id="kisanLangLabel">Ask in any language</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="kw-icon-btn" id="kisanPauseBtn" onclick="toggleKisanTypingPause()" title="Pause reply" style="display:none">
            <i class="fas fa-pause"></i>
          </button>
          <button class="kw-icon-btn" onclick="newKisanChat()" title="New Chat">
            <i class="fas fa-plus"></i>
          </button>
          <button class="kw-icon-btn" onclick="toggleKisan()" title="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>

      <!-- Language Picker (injected here) -->
      <div id="kisanLangPicker" class="kw-lang-picker" style="display:none">
        <p id="kisanLangQ">Kaun si bhaasha mein baat karein? / Which language?</p>
        <div class="kw-lang-grid" id="kisanLangGrid"></div>
        <div class="kw-lang-skip" id="kisanLangSkip">Skip — use English</div>
      </div>

      <div class="kw-messages" id="kisanMessages"></div>

      <div class="kw-input-bar">
        <button class="kw-mic-btn" id="kisanMicBtn" onclick="toggleKisanMic()" title="Voice">
          <i class="fas fa-microphone"></i>
        </button>
        <input type="text" id="kisanInput" placeholder="Type or speak..."
               onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendKisanMessage()}"/>
        <button class="kw-send-btn" id="kisanSendBtn" onclick="sendKisanMessage()">
          <i class="fas fa-paper-plane"></i>
        </button>
      </div>
      <div class="kw-rec-banner" id="kisanRecBanner" style="display:none">
        <span class="kw-rec-dot"></span>
        <span id="kisanRecTime">Listening… 0:00</span>
        <span class="kw-rec-hint">Tap mic again to stop</span>
      </div>
    </div>
  </div>
</div>

<a id="kisanHelpline"
   href="https://www.google.com/search?q=kisan+helpline+1800-180-1551"
   target="_blank" rel="noopener">
  <i class="fas fa-phone"></i>
  <span>Kisan Helpline: <strong>1800-180-1551</strong></span>
</a>`);

    /* ── Styles ──────────────────────────────── */
    const S = document.createElement('style');
    S.textContent = `
/* Toggle FAB */
#kisanToggleBtn {
  position: fixed;
  bottom: calc(28px + env(safe-area-inset-bottom, 0px));
  right: calc(28px + env(safe-area-inset-right, 0px));
  width: 58px; height: 58px; border-radius: 50%;
  background: linear-gradient(135deg, #166534, #22c55e);
  box-shadow: 0 4px 24px rgba(74,222,128,.45);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; z-index: 9999;
  transition: transform .2s, box-shadow .2s;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
#kisanToggleBtn:active { transform: scale(1.1); box-shadow: 0 6px 32px rgba(74,222,128,.6); }
#kisanToggleBtn i { font-size: 1.4rem; color: #fff; pointer-events: none; }
#kisanToggleBtn.chat-open { background: linear-gradient(135deg, #991b1b, #ef4444); }
.kw-pulse {
  position: absolute; top: -3px; right: -3px;
  width: 13px; height: 13px; background: #f87171; border-radius: 50%;
  animation: kwp 1.8s ease-in-out infinite; pointer-events: none;
}
@keyframes kwp { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.6);opacity:.4} }

/* Fullscreen overlay */
#kisanOverlay {
  position: fixed; inset: 0; z-index: 9998;
  background: rgba(0,0,0,.65); backdrop-filter: blur(4px);
  display: flex; align-items: flex-end; justify-content: center;
  opacity: 0; transition: opacity .28s ease;
}
#kisanOverlay.open { opacity: 1; }

/* Chat window */
#kisanWindow {
  width: 100%; max-width: 520px;
  height: min(92vh, 100vh);
  height: min(92dvh, 100dvh);
  max-height: 100vh;
  max-height: 100dvh;
  background: var(--card, #111a12);
  border-radius: 20px 20px 0 0;
  display: flex; flex-direction: column;
  overflow: hidden;
  transform: translateY(40px);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1);
  box-shadow: 0 -8px 48px rgba(0,0,0,.5);
}
#kisanOverlay.open #kisanWindow { transform: translateY(0); }

/* Header */
.kw-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px;
  background: linear-gradient(135deg, #166534, #15803d);
  flex-shrink: 0;
}
.kw-header-left { display: flex; align-items: center; gap: 10px; }
.kw-avatar {
  width: 38px; height: 38px; border-radius: 50%;
  background: rgba(255,255,255,.15);
  display: flex; align-items: center; justify-content: center;
  font-size: 1.1rem; color: #fff; flex-shrink: 0;
}
.kw-name { font-weight: 700; font-size: .95rem; color: #fff; font-family: 'Syne', sans-serif; }
.kw-sub  { font-size: .7rem; color: rgba(255,255,255,.75); }
.kw-icon-btn {
  background: rgba(255,255,255,.15); border: none; border-radius: 50%;
  width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
  color: #fff; cursor: pointer; font-size: .85rem; transition: background .2s; flex-shrink: 0;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.kw-icon-btn:active { background: rgba(248,113,113,.4); }

/* Lang picker */
.kw-lang-picker {
  border-top: 15px solid rgba(74,222,128,.12);
  padding: 80px 20px 15px;
  border-bottom: 15px solid rgba(74,222,128,.12);
  flex-shrink: 0;
  background: var(--bg-2, #0e0f15);
}
.kw-lang-picker p {
  font-size: .8rem; color: var(--text-2, #a7c4a8);
  text-align: center; margin: 0 0 10px;
}
.kw-lang-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px;
}
.kw-lang-opt {
  padding: 8px 4px; border-radius: 8px; font-size: .68rem; font-weight: 600;
  background: var(--bg-3, #1a2a1c); border: 1px solid rgba(74,222,128,.2);
  color: var(--text-2, #a7c4a8); cursor: pointer; text-align: center;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px; line-height: 1.2; min-height: 44px;
  transition: all .15s;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  user-select: none; -webkit-user-select: none;
}
.kw-lang-opt .kl-sub { font-size: .56rem; font-weight: 400; opacity: .6; }
.kw-lang-opt:active, .kw-lang-opt.kl-active {
  background: rgba(74,222,128,.15); border-color: #4ade80; color: #4ade80;
  transform: scale(.96);
}
.kw-lang-skip {
  font-size: .72rem; color: var(--text-3, #6b8c6d); text-align: center;
  cursor: pointer; text-decoration: underline; padding: 8px 4px 2px;
  -webkit-tap-highlight-color: transparent;
}
.kw-lang-skip:active { color: #4ade80; }

/* Messages */
.kw-messages {
  flex: 1; overflow-y: auto; padding: 14px 12px;
  display: flex; flex-direction: column; gap: 12px;
  scroll-behavior: smooth;
}
.kw-messages::-webkit-scrollbar { width: 4px; }
.kw-messages::-webkit-scrollbar-thumb { background: rgba(74,222,128,.2); border-radius: 2px; }

.kw-msg { display: flex; gap: 8px; animation: msgIn .2s ease; }
@keyframes msgIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
.kw-msg.bot  { align-self: flex-start; align-items: flex-end; max-width: 88%; }
.kw-msg.user { align-self: flex-end; flex-direction: row-reverse; max-width: 80%; }

.kw-msg-avatar {
  width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
  background: rgba(74,222,128,.1); border: 1px solid rgba(74,222,128,.2);
  display: flex; align-items: center; justify-content: center; font-size: .85rem;
}
.kw-msg-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.kw-bubble {
  padding: 10px 13px; border-radius: 16px;
  font-size: .84rem; line-height: 1.6; word-break: break-word;
}
.kw-msg.bot  .kw-bubble {
  background: var(--bg-3, #1a2a1c);
  border: 1px solid rgba(74,222,128,.12);
  color: var(--text, #e8f5e9);
  border-bottom-left-radius: 4px;
}
.kw-msg.user .kw-bubble {
  background: linear-gradient(135deg, #166534, #22c55e);
  color: #fff; border-bottom-right-radius: 4px;
}
.kw-msg-footer {
  display: flex; align-items: center; gap: 6px;
  padding: 0 2px;
}
.kw-msg.user .kw-msg-footer { justify-content: flex-end; }
.kw-msg-time { font-size: .62rem; color: var(--text-3, #6b8c6d); }
.kw-speak-btn {
  background: none; border: 1px solid rgba(74,222,128,.25); border-radius: 50%;
  width: 26px; height: 26px; min-width: 26px;
  display: flex; align-items: center; justify-content: center;
  color: rgba(74,222,128,.7); cursor: pointer; font-size: .72rem;
  transition: all .18s; flex-shrink: 0;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.kw-speak-btn:active, .kw-speak-btn.speaking {
  background: rgba(74,222,128,.15); border-color: #4ade80; color: #4ade80;
}
.kw-speak-btn.speaking { animation: speakPulse .9s ease-in-out infinite; }
.kw-speak-btn.paused {
  background: rgba(251,191,36,.15); border-color: #fbbf24; color: #fbbf24;
}
@keyframes speakPulse { 0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,.35)} 50%{box-shadow:0 0 0 5px rgba(74,222,128,0)} }

/* Typing dots */
.kw-typing { display: flex; gap: 4px; align-items: center; padding: 4px 0; }
.kw-typing span {
  display: inline-block; width: 7px; height: 7px;
  background: #4ade80; border-radius: 50%; animation: dot 1.2s infinite;
}
.kw-typing span:nth-child(2) { animation-delay: .2s; }
.kw-typing span:nth-child(3) { animation-delay: .4s; }
@keyframes dot { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-7px)} }

/* Input bar */
.kw-input-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid rgba(74,222,128,.1);
  background: var(--bg-2, #0e1510);
  flex-shrink: 0;
}
#kisanInput {
  flex: 1; background: var(--bg-3, #1a2a1c);
  border: 1px solid rgba(74,222,128,.2); border-radius: 22px;
  padding: 9px 14px; color: var(--text, #e8f5e9);
  font-size: 16px; font-family: inherit; outline: none;
  transition: border-color .2s; min-width: 0;
}
#kisanInput:focus { border-color: rgba(74,222,128,.5); }
#kisanInput::placeholder { color: rgba(255,255,255,.35); }
.kw-mic-btn, .kw-send-btn {
  width: 42px; height: 42px; border-radius: 50%; border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: .95rem; flex-shrink: 0;
  transition: transform .2s, background .2s;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.kw-mic-btn {
  background: var(--bg-3, #1a2a1c);
  border: 1px solid rgba(74,222,128,.2);
  color: var(--text-2, #a7c4a8);
}
.kw-mic-btn:active { background: rgba(74,222,128,.1); color: #4ade80; }
.kw-mic-btn.recording {
  background: rgba(248,113,113,.15); border-color: #f87171; color: #f87171;
  animation: micP .8s ease-in-out infinite;
}
@keyframes micP { 0%,100%{transform:scale(1)} 50%{transform:scale(1.18)} }
.kw-mic-btn.processing { color: #4ade80; }
.kw-mic-btn.processing i { animation: kwspin .8s linear infinite; }
@keyframes kwspin { to { transform: rotate(360deg); } }
.kw-mic-btn:disabled, .kw-send-btn:disabled { opacity: .45; cursor: not-allowed; animation: none; }
.kw-send-btn {
  background: linear-gradient(135deg, #166534, #22c55e);
  color: #fff; box-shadow: 0 2px 8px rgba(74,222,128,.3);
}
.kw-send-btn:active { transform: scale(1.08); }

/* Recording banner */
.kw-rec-banner {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 16px 10px;
  font-size: .72rem; color: #f87171;
  background: var(--bg-2, #0e1510);
  flex-shrink: 0;
}
.kw-rec-dot {
  width: 9px; height: 9px; border-radius: 50%; background: #f87171;
  animation: kwp 1s ease-in-out infinite; flex-shrink: 0;
}
.kw-rec-hint { color: var(--text-3, #6b8c6d); margin-left: auto; }

/* Pause (stop generation) header button */
#kisanPauseBtn { background: rgba(248,113,113,.18); }
#kisanPauseBtn:active { background: rgba(248,113,113,.4); }

/* Typewriter cursor */
.kw-caret {
  display: inline-block; width: 2px; height: 1em; margin-left: 1px;
  background: #4ade80; vertical-align: text-bottom;
  animation: caretBlink .85s step-end infinite;
}
@keyframes caretBlink { 50% { opacity: 0; } }

/* Helpline */
#kisanHelpline {
  position: fixed;
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  left: calc(20px + env(safe-area-inset-left, 0px));
  display: flex; align-items: center; gap: 8px;
  background: var(--card, #111a12);
  border: 1px solid rgba(74,222,128,.25);
  border-radius: 50px; padding: 8px 16px;
  font-size: .78rem; color: var(--text-2, #a7c4a8);
  text-decoration: none; z-index: 9997;
  transition: border-color .2s, transform .2s, box-shadow .2s;
  box-shadow: 0 2px 12px rgba(0,0,0,.3);
}
#kisanHelpline:active { border-color: #4ade80; color: #4ade80; }
#kisanHelpline i { color: #4ade80; font-size: .85rem; }

/* Light theme */
body.light-theme #kisanHelpline { background: #fff; color: #374151; }
body.light-theme #kisanWindow   { background: #fff; }
body.light-theme .kw-msg.bot .kw-bubble { background: #f0fdf4; color: #1a2e1c; border-color: rgba(22,101,52,.15); }
body.light-theme .kw-input-bar  { background: #f9fafb; }
body.light-theme #kisanInput    { background: #fff; color: #1a2e1c; border-color: rgba(22,101,52,.2); }
body.light-theme #kisanInput::placeholder { color: #9ca3af; }
body.light-theme .kw-mic-btn    { background: #f0fdf4; color: #374151; border-color: rgba(22,101,52,.2); }
body.light-theme .kw-lang-opt   { background: #f0fdf4; color: #374151; border-color: rgba(22,101,52,.2); }
body.light-theme .kw-lang-picker { background: #f9fafb; }
body.light-theme .kw-speak-btn  { border-color: rgba(22,101,52,.25); color: rgba(22,101,52,.6); }
body.light-theme .kw-rec-banner { background: #f9fafb; }
body.light-theme .kw-rec-hint   { color: #9ca3af; }

@media (max-width: 600px) {
  #kisanWindow { border-radius: 16px 16px 0 0; height: min(94vh, 100dvh); }
  #kisanToggleBtn {
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    right: calc(12px + env(safe-area-inset-right, 0px));
    width: 52px; height: 52px;
  }
  #kisanHelpline {
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    left: calc(8px + env(safe-area-inset-left, 0px));
    font-size: .68rem; padding: 5px 10px;
  }
  #kisanHelpline strong { display: none; }
  .kw-lang-grid { grid-template-columns: repeat(3, 1fr); }
  .kw-lang-opt { min-height: 46px; font-size: .65rem; }
  .kw-msg.bot  { max-width: 92%; }
  .kw-msg.user { max-width: 88%; }
  .kw-input-bar { padding: 8px 10px; padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)); }
  #kisanInput { font-size: 16px; } /* keep >=16px to prevent iOS auto-zoom on focus */
  .kw-icon-btn { width: 38px; height: 38px; font-size: .95rem; } /* bigger tap target on touch */
  .kw-mic-btn, .kw-send-btn { width: 46px; height: 46px; }
  .kw-speak-btn { width: 30px; height: 30px; }
}

@media (max-width: 360px) {
  .kw-lang-grid { grid-template-columns: repeat(2, 1fr); }
}`;
    document.head.appendChild(S);

    /* ── State ───────────────────────────────── */
    let chatHistory = [];
    let isOpen = false;
    let isBusy = false;
    let langChosen = false;
    let chosenLang = null;

    // Voice input (MediaRecorder + server-side Whisper transcription —
    // works the same on iOS Safari, Android, desktop Chrome/Firefox/Edge).
    let mediaRecorder = null;
    let mediaStream = null;
    let audioChunks = [];
    let isRecording = false;
    let isTranscribing = false;
    let recordTimerInterval = null;
    let recordStartTime = 0;
    let speakingMsgId = null;
    let pausedMsgId = null;
    let availableVoices = [];
    const msgTextById = {};

    // Line-by-line typewriter animation state.
    let activeTyper = null; // controller object for the in-progress animation

    /* ── Language data (same as original) ───── */
    const LANG_NAMES = {
        en: 'English',
        hi: 'हिन्दी',
        bn: 'বাংলা',
        te: 'తెలుగు',
        mr: 'मराठी',
        ta: 'தமிழ்',
        gu: 'ગુજરાતી',
        kn: 'ಕನ್ನಡ',
        ml: 'മലയാളം',
        pa: 'ਪੰਜਾਬੀ',
        or: 'ଓଡ଼ିଆ',
        as: 'অসমীয়া',
        ur: 'اردو',
        mai: 'मैथिली',
        ne: 'नेपाली',
        sa: 'संस्कृतम्',
        kok: 'कोंकणी',
        mni: 'মৈতৈলোন্',
        bodo: 'बड़ो',
        doi: 'डोगरी',
    };
    const LANG_ROMAN = {
        en: 'English',
        hi: 'Hindi',
        bn: 'Bangla',
        te: 'Telugu',
        mr: 'Marathi',
        ta: 'Tamil',
        gu: 'Gujarati',
        kn: 'Kannada',
        ml: 'Malayalam',
        pa: 'Punjabi',
        or: 'Odia',
        as: 'Assamese',
        ur: 'Urdu',
        mai: 'Maithili',
        ne: 'Nepali',
        sa: 'Sanskrit',
        kok: 'Konkani',
        mni: 'Meitei',
        bodo: 'Bodo',
        doi: 'Dogri',
    };
    const VOICE_LANGS = {
        en: 'en-IN',
        hi: 'hi-IN',
        bn: 'bn-IN',
        te: 'te-IN',
        mr: 'mr-IN',
        ta: 'ta-IN',
        gu: 'gu-IN',
        kn: 'kn-IN',
        ml: 'ml-IN',
        pa: 'pa-IN',
        or: 'or-IN',
        as: 'as-IN',
        ur: 'ur-PK',
        mai: 'hi-IN',
        ne: 'ne-NP',
        sa: 'hi-IN',
        kok: 'mr-IN',
        mni: 'bn-IN',
        bodo: 'hi-IN',
        doi: 'hi-IN',
    };
    const GREETINGS = {
        en: '🌾 Hello farmer friend! I am SmartAgro Kisan Helper. Ask me about crops, weather, market prices, or government schemes like PM-KISAN.',
        hi: '🌾 नमस्ते किसान भाई! मैं SmartAgro किसान सहायक हूँ। आप मुझसे मौसम, फसल, बाज़ार भाव या सरकारी योजनाओं के बारे में पूछ सकते हैं।',
        bn: '🌾 নমস্কার কৃষক বন্ধু! আমি SmartAgro কিষান সহায়ক। আবহাওয়া, ফসল, বাজার দর বা সরকারি প্রকল্প সম্পর্কে জিজ্ঞাসা করুন।',
        te: '🌾 నమస్కారం రైతు మిత్రుడా! నేను SmartAgro కిసాన్ సహాయకుడు. వాతావరణం, పంటలు, మార్కెట్ ధరల గురించి అడగండి.',
        mr: '🌾 नमस्कार शेतकरी मित्र! मी SmartAgro किसान सहाय्यक आहे. हवामान, पीक, बाजारभाव किंवा सरकारी योजनांबद्दल विचारा.',
        ta: '🌾 வணக்கம் விவசாயி நண்பரே! நான் SmartAgro கிசான் உதவியாளர். வானிலை, பயிர்கள், சந்தை விலைகள் பற்றி கேளுங்கள்.',
        gu: '🌾 નમસ્તે ખેડૂત મિત્ર! હું SmartAgro કિસાન સહાયક છું. હવામાન, પાક, બજાર ભાવ વિશે પૂછો.',
        kn: '🌾 ನಮಸ್ಕಾರ ರೈತ ಮಿತ್ರ! ನಾನು SmartAgro ಕಿಸಾನ್ ಸಹಾಯಕ. ಹವಾಮಾನ, ಬೆಳೆ, ಮಾರುಕಟ್ಟೆ ಬೆಲೆಗಳ ಬಗ್ಗೆ ಕೇಳಿ.',
        ml: '🌾 നമസ്കാരം കർഷക സുഹൃത്തേ! ഞാൻ SmartAgro കിസാൻ സഹായി ആണ്. കാലാവസ്ഥ, വിളകൾ, വിപണി വില എന്നിവയെക്കുറിച്ച് ചോദിക്കൂ.',
        pa: '🌾 ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ਕਿਸਾਨ ਵੀਰ! ਮੈਂ SmartAgro ਕਿਸਾਨ ਸਹਾਇਕ ਹਾਂ। ਮੌਸਮ, ਫਸਲ, ਮੰਡੀ ਭਾਅ ਬਾਰੇ ਪੁੱਛੋ।',
        or: '🌾 ନମସ୍କାର କୃଷକ ବନ୍ଧୁ! ମୁଁ SmartAgro କିଷାନ ସହାୟକ। ପାଣିପାଗ, ଫସଲ, ବାଜାର ମୂଲ୍ୟ ବିଷୟରେ ପଚାରନ୍ତୁ।',
        as: '🌾 নমস্কার কৃষক বন্ধু! মই SmartAgro কিষান সহায়ক। বতৰ, শস্য, বজাৰ দাম বা চৰকাৰী আঁচনিৰ বিষয়ে সুধিব পাৰে।',
        ur: '🌾 السلام علیکم کسان دوست! میں SmartAgro کسان مددگار ہوں۔ موسم، فصل، منڈی بھاؤ کے بارے میں پوچھیں۔',
        mai: '🌾 प्रणाम किसान भाय! हम SmartAgro किसान सहायक छी। मौसम, फसल, बाजार भाव बारे पुछू।',
        ne: '🌾 नमस्ते किसान साथी! म SmartAgro किसान सहायक हुँ। मौसम, बाली, बजार मूल्य वा सरकारी योजनाबारे सोध्नुहोस्।',
        sa: '🌾 नमस्ते कृषकमित्र! अहं SmartAgro कृषकसहायकः अस्मि। वायुमण्डलं, कृषिं, विपणिमूल्यं वा सरकारीयोजनाः विषये पृच्छन्तु।',
        kok: '🌾 नमस्कार शेतकरी मित्रा! हाव SmartAgro किसान सहाय्यक. हवामान, पीक, बाजारभावा बद्दल विचार.',
        mni: '🌾 ꯀꯨꯝꯖꯥ ꯂꯧꯅꯨ ꯂꯧꯔꯤꯕ ꯃꯔꯨꯑꯣꯏꯕ! ꯑꯩ SmartAgro ꯀꯤꯁꯥꯟ ꯃꯇꯦꯡ ꯄꯥꯡꯕꯥ ꯅꯤ। ꯅꯣꯡꯁꯤꯡ, ꯂꯧꯕꯨꯀ, ꯁꯦꯟꯂꯣꯟꯒꯤ ꯃꯌꯥꯏ ꯍꯪꯕꯤꯌꯨ꯫',
        bodo: '🌾 नमस्कार बेसो रां! आं SmartAgro किसान हेल्पार। दिनै सिथिल, फिसा, बाजार दाम बेसेबा खालामनो हागौ।',
        doi: '🌾 नमस्ते किसान भाई! मैं SmartAgro किसान सहायक आं। मौसम, फसल, बजार भाव बारै पुच्छो।',
    };

    /* ── Voice helpers (merged from chatbot.js) ─────────────────────────
       chatbot.js's speaker worked reliably because getBestVoice() always
       falls back to *some* voice (English if nothing else) instead of
       giving up. kisan-helper's old version only checked a short list of
       exact/prefix language tags and returned null — and null meant
       "silently do nothing" for every language that isn't in
       VOICE_FALLBACK_CHAIN. That's the bug: on most desktop/Android
       browsers there's simply no installed hi-IN/bn-IN/... voice, so the
       speak button did nothing. This version guarantees a voice is always
       found (native if available, else the closest available match). ── */
    function loadVoices() { availableVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : []; }
    if (window.speechSynthesis) {
        loadVoices();
        // addEventListener (not "onvoiceschanged =") so this never gets
        // silently overwritten if any other script also listens for it.
        window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
        // Some browsers (notably iOS Safari / some Android WebViews) never
        // fire 'voiceschanged' and only populate the list a beat after
        // page load — poll briefly as a safety net.
        let voicePollTries = 0;
        const voicePoll = setInterval(() => {
            voicePollTries++;
            loadVoices();
            if (availableVoices.length || voicePollTries > 20) clearInterval(voicePoll);
        }, 250);
    }

    // Wait (briefly) for voices to be ready before the very first speak
    // attempt, instead of racing an empty list and giving up.
    function ensureVoicesReady(callback) {
        if (availableVoices.length || !window.speechSynthesis) { callback(); return; }
        let tries = 0;
        const poll = setInterval(() => {
            tries++;
            loadVoices();
            if (availableVoices.length || tries > 12) {
                clearInterval(poll);
                callback();
            }
        }, 150);
    }

    const VOICE_FALLBACK_CHAIN = {
        ur: ['ur-PK', 'ur-IN', 'ur', 'hi-IN'],
        or: ['or-IN', 'hi-IN', 'bn-IN'],
        as: ['as-IN', 'bn-IN', 'hi-IN'],
        mai: ['mai-IN', 'hi-IN'],
        ne: ['ne-NP', 'ne-IN', 'hi-IN'],
        sa: ['sa-IN', 'hi-IN'],
        kok: ['kok-IN', 'mr-IN', 'hi-IN'],
        mni: ['mni-IN', 'bn-IN', 'as-IN', 'hi-IN'],
        bodo: ['brx-IN', 'hi-IN', 'as-IN'],
        doi: ['doi-IN', 'hi-IN', 'pa-IN'],
    };

    function getBestVoice(langCode) {
        if (!availableVoices.length) return null; // truly no voices on this device at all

        const primary = VOICE_LANGS[langCode] || 'en-IN';
        const chain = VOICE_FALLBACK_CHAIN[langCode] || [primary];

        // 1) Exact tag match (e.g. 'hi-IN')
        for (const tag of chain) {
            const exact = availableVoices.find(v => v.lang === tag);
            if (exact) return exact;
        }
        // 2) Prefix match (e.g. any voice starting with 'hi')
        for (const tag of chain) {
            const prefix = tag.split('-')[0];
            const partial = availableVoices.find(v => v.lang.startsWith(prefix));
            if (partial) return partial;
        }
        // 3) chatbot.js-style universal fallback: this is the part
        //    kisan-helper was missing. Rather than returning null (and the
        //    speak button doing nothing), fall back to an Indian-English
        //    voice, then any English voice, then literally whatever voice
        //    the device has — so the speaker always plays something.
        if (langCode !== 'en') {
            const enIN = availableVoices.find(v => v.lang === 'en-IN');
            if (enIN) return enIN;
        }
        const anyEn = availableVoices.find(v => v.lang.startsWith('en'));
        if (anyEn) return anyEn;

        return availableVoices[0] || null;
    }

    // True only when a *native* voice for this language exists (used to
    // decide whether to show a "reading in English" hint, not to gate
    // whether speaking happens at all).
    function hasNativeVoice(langCode) {
        const primary = VOICE_LANGS[langCode] || 'en-IN';
        const chain = VOICE_FALLBACK_CHAIN[langCode] || [primary];
        return chain.some(tag =>
            availableVoices.some(v => v.lang === tag || v.lang.startsWith(tag.split('-')[0]))
        );
    }

    function showKisanToast(msg) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg, 'warning', 3000);
            return;
        }
        const el = document.createElement('div');
        el.textContent = msg;
        el.style.cssText = 'position:fixed;left:50%;bottom:calc(90px + env(safe-area-inset-bottom,0px));' +
            'transform:translateX(-50%);background:#1a2a1c;color:#e8f5e9;border:1px solid rgba(74,222,128,.3);' +
            'padding:9px 16px;border-radius:20px;font-size:.78rem;z-index:10000;max-width:86vw;text-align:center;' +
            'box-shadow:0 4px 20px rgba(0,0,0,.4);';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    function cleanTextForSpeech(text) {
        return text
            .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
            .replace(/[\u{2600}-\u{27FF}]/gu, '')
            .replace(/[\u{FE00}-\u{FEFF}]/gu, '')
            .replace(/[🌾🌿🌽🍅🎋🫘🌻🧅🥔🌶️🥜☁️🌧️⛅☀️❄️⛈️🌦️🌤️🌫️]/g, '')
            .replace(/•/g, '').replace(/[►▶→←↑↓]/g, '')
            .replace(/\*\*/g, '').replace(/\*/g, '')
            .replace(/\s+/g, ' ').trim();
    }


    function setSpeakBtnState(msgId, state) {
        // state: 'idle' | 'speaking' | 'paused'
        const btn = document.getElementById('ksb_' + msgId);
        if (!btn) return;
        btn.classList.remove('speaking', 'paused');
        if (state === 'speaking') {
            btn.classList.add('speaking');
            btn.innerHTML = '<i class="fas fa-pause"></i>';
            btn.title = 'Pause';
        } else if (state === 'paused') {
            btn.classList.add('paused');
            btn.innerHTML = '<i class="fas fa-play"></i>';
            btn.title = 'Resume';
        } else {
            btn.innerHTML = '<i class="fas fa-volume-up"></i>';
            btn.title = 'Listen';
        }
    }

    function updateFab(state) {
        const fab = document.getElementById('kisanToggleBtn');
        if (!fab) return;
        if (state === 'speaking') {
            fab.innerHTML = '<i class="fas fa-volume-up" style="color:#fff;font-size:1.3rem"></i><span class="kw-pulse"></span>';
        } else if (isOpen) {
            fab.innerHTML = '<i class="fas fa-times" style="color:#fff;font-size:1.25rem"></i>';
        }
    }

    // Chrome (desktop + many Android builds) silently halts a long
    // SpeechSynthesisUtterance around the ~15s mark unless it's periodically
    // nudged with pause()/resume(). Splitting the reply into sentence-level
    // chunks and running a keep-alive nudge fixes the "reading stops midway"
    // problem across languages/devices.
    let speechToken = 0;
    let speechKeepAliveTimer = null;

    function clearKeepAlive() {
        if (speechKeepAliveTimer) {
            clearInterval(speechKeepAliveTimer);
            speechKeepAliveTimer = null;
        }
    }

    function startKeepAlive() {
        clearKeepAlive();
        speechKeepAliveTimer = setInterval(() => {
            const synth = window.speechSynthesis;
            if (synth && synth.speaking && !synth.paused) {
                synth.pause();
                synth.resume();
            }
        }, 9000);
    }

    function splitIntoSpeechChunks(text) {
        // Sentence-boundary split that also understands Devanagari/Urdu punctuation.
        const parts = text.match(/[^.!?।؟]+[.!?।؟]*/g) || [text];
        const chunks = [];
        let buffer = '';
        for (const part of parts) {
            buffer += part;
            if (buffer.trim().length >= 180 || /[.!?।؟]\s*$/.test(part.trim())) {
                chunks.push(buffer.trim());
                buffer = '';
            }
        }
        if (buffer.trim()) chunks.push(buffer.trim());
        return chunks.filter(Boolean);
    }

    let voiceFallbackNoticeShown = {}; // one soft hint per language per session, not a hard failure

    function speakText(text, msgId) {
        if (!window.speechSynthesis) {
            alert('Voice playback is not supported in this browser.');
            return;
        }
        msgTextById[msgId] = text;

        // Voices sometimes aren't loaded yet on the very first tap — wait
        // briefly instead of failing outright.
        ensureVoicesReady(() => _speakTextNow(text, msgId));
    }

    function _speakTextNow(text, msgId) {
        window.speechSynthesis.cancel();
        clearKeepAlive();
        speechToken++;
        const myToken = speechToken;

        if (speakingMsgId && speakingMsgId !== msgId) setSpeakBtnState(speakingMsgId, 'idle');
        if (pausedMsgId && pausedMsgId !== msgId) setSpeakBtnState(pausedMsgId, 'idle');
        pausedMsgId = null;

        const clean = cleanTextForSpeech(text);
        if (!clean) return;

        const lang = getAppLang();
        const voice = getBestVoice(lang);

        if (!voice) {
            // Only happens if the device truly has zero TTS voices at all.
            setSpeakBtnState(msgId, 'idle');
            showKisanToast('Voice playback is not available on this device.');
            return;
        }

        if (lang !== 'en' && !hasNativeVoice(lang) && !voiceFallbackNoticeShown[lang]) {
            voiceFallbackNoticeShown[lang] = true;
            showKisanToast('No ' + (LANG_ROMAN[lang] || lang) + ' voice on this device — reading with the closest available voice.');
        }

        const chunks = splitIntoSpeechChunks(clean);
        let chunkIndex = 0;

        function speakNextChunk() {
            if (myToken !== speechToken) return; // superseded by a newer speak/stop call
            if (chunkIndex >= chunks.length) {
                clearKeepAlive();
                if (speakingMsgId === msgId) speakingMsgId = null;
                setSpeakBtnState(msgId, 'idle');
                updateFab('idle');
                return;
            }
            const utter = new SpeechSynthesisUtterance(chunks[chunkIndex]);
            utter.lang = voice.lang;
            utter.rate = 0.88;
            utter.pitch = 1;
            utter.volume = 1;
            utter.voice = voice;

            utter.onstart = () => {
                speakingMsgId = msgId;
                setSpeakBtnState(msgId, 'speaking');
                updateFab('speaking');
                startKeepAlive();
            };
            utter.onend = () => {
                chunkIndex++;
                speakNextChunk();
            };
            utter.onerror = (ev) => {
                if (myToken !== speechToken) return;
                clearKeepAlive();
                if (!utter._retried && ev.error !== 'canceled' && ev.error !== 'interrupted') {
                    // Transient engine glitch — retry this chunk once before moving on.
                    utter._retried = true;
                    setTimeout(() => { if (myToken === speechToken) window.speechSynthesis.speak(utter); }, 250);
                    return;
                }
                chunkIndex++;
                speakNextChunk();
            };
            window.speechSynthesis.speak(utter);
        }

        setTimeout(speakNextChunk, 150);
    }

    function pauseSpeaking(msgId) {
        clearKeepAlive();
        if (window.speechSynthesis) {
            try { window.speechSynthesis.pause(); } catch (e) {}
        }
        speakingMsgId = null;
        pausedMsgId = msgId;
        setSpeakBtnState(msgId, 'paused');
        updateFab('idle');
    }

    function resumeSpeaking(msgId) {
        const synth = window.speechSynthesis;
        if (!synth) return;
        try { synth.resume(); } catch (e) {}
        setSpeakBtnState(msgId, 'speaking');
        speakingMsgId = msgId;
        pausedMsgId = null;
        updateFab('speaking');
        startKeepAlive();

        setTimeout(() => {
            if (speakingMsgId === msgId && synth.paused) {
                const text = msgTextById[msgId];
                if (text !== undefined) speakText(text, msgId);
            }
        }, 350);
    }

    function stopSpeaking() {
        speechToken++;
        clearKeepAlive();
        if (window.speechSynthesis) try { window.speechSynthesis.cancel(); } catch (e) {}
        if (speakingMsgId) setSpeakBtnState(speakingMsgId, 'idle');
        if (pausedMsgId) setSpeakBtnState(pausedMsgId, 'idle');
        speakingMsgId = null;
        pausedMsgId = null;
        updateFab('idle');
    }

    function handleSpeakClick(msgId) {
        const text = msgTextById[msgId];
        if (text === undefined) return;
        if (speakingMsgId === msgId) {
            pauseSpeaking(msgId);
        } else if (pausedMsgId === msgId) {
            resumeSpeaking(msgId);
        } else {
            speakText(text, msgId);
        }
    }
    window.kisanHandleSpeakClick = handleSpeakClick;

    /* ── Helpers ─────────────────────────────── */
    function getMsgs() { return document.getElementById('kisanMessages'); }

    function getInput() { return document.getElementById('kisanInput'); }

    function scrollBot() { const m = getMsgs(); if (m) m.scrollTop = m.scrollHeight; }

    function getAppLang() { return chosenLang || localStorage.getItem('agrosmart_lang') || 'en'; }

    function getTime() { return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }

    function updateSubLabel(lang) {
        const el = document.getElementById('kisanLangLabel');
        if (el) el.textContent = 'Answering in ' + (LANG_ROMAN[lang] || lang.toUpperCase());
    }

    /* ── Toggle overlay ──────────────────────── */
    window.toggleKisan = function() {
        const overlay = document.getElementById('kisanOverlay');
        const fab = document.getElementById('kisanToggleBtn');
        isOpen = !isOpen;

        if (isOpen) {
            overlay.style.display = 'flex';
            document.body.style.overflow = 'hidden';
            fab.innerHTML = '<i class="fas fa-times" style="color:#fff;font-size:1.25rem"></i><span class="kw-pulse"></span>';
            fab.classList.add('chat-open');
            setTimeout(() => overlay.classList.add('open'), 10);
            if (chatHistory.length === 0 && !langChosen) showLangPicker();
            setTimeout(() => { const i = getInput(); if (i) i.focus(); }, 350);
        } else {
            overlay.classList.remove('open');
            document.body.style.overflow = '';
            fab.innerHTML = '<i class="fas fa-microphone"></i><span class="kw-pulse"></span>';
            fab.classList.remove('chat-open');
            setTimeout(() => { overlay.style.display = 'none'; }, 280);
            stopSpeaking();
            if (activeTyper) activeTyper.finish();
            if (isRecording) stopRecording();
        }
    };

    // Tap overlay backdrop to close
    document.getElementById('kisanOverlay').addEventListener('click', function(e) {
        if (e.target === this) toggleKisan();
    });

    /* ── Language Picker ─────────────────────── */
    function showLangPicker() {
        const picker = document.getElementById('kisanLangPicker');
        const grid = document.getElementById('kisanLangGrid');
        const skip = document.getElementById('kisanLangSkip');
        if (!picker || !grid) return;

        grid.innerHTML = '';

        Object.entries(LANG_NAMES).forEach(function([code, nativeName]) {
            const btn = document.createElement('div');
            btn.className = 'kw-lang-opt';
            btn.setAttribute('role', 'button');
            btn.setAttribute('tabindex', '0');
            btn.innerHTML = `<span>${nativeName}</span><span class="kl-sub">${LANG_ROMAN[code] || code}</span>`;

            let isTouched = false,
                touchScrolled = false,
                tx = 0,
                ty = 0;

            btn.addEventListener('touchstart', e => {
                isTouched = true;
                touchScrolled = false;
                tx = e.touches[0].clientX;
                ty = e.touches[0].clientY;
            }, { passive: true });
            btn.addEventListener('touchmove', e => { if (Math.abs(e.touches[0].clientX - tx) > 8 || Math.abs(e.touches[0].clientY - ty) > 8) touchScrolled = true; }, { passive: true });
            btn.addEventListener('touchend', e => {
                if (touchScrolled) return;
                e.preventDefault();
                btn.classList.add('kl-active');
                setTimeout(() => {
                    btn.classList.remove('kl-active');
                    pickLang(code);
                }, 200);
            }, { passive: false });
            btn.addEventListener('click', () => {
                if (isTouched) return;
                pickLang(code);
            });
            btn.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pickLang(code);
                }
            });

            grid.appendChild(btn);
        });

        const appLang = localStorage.getItem('agrosmart_lang') || 'en';
        if (skip) {
            skip.textContent = 'Skip — use ' + (LANG_ROMAN[appLang] || 'English');
            skip.onclick = () => pickLang(appLang);
        }

        picker.style.display = 'block';
    }

    function pickLang(code) {
        chosenLang = code;
        langChosen = true;
        const picker = document.getElementById('kisanLangPicker');
        if (picker) picker.style.display = 'none';
        updateSubLabel(code);
        const greet = GREETINGS[code] || GREETINGS.en;
        addBotMsg(greet);
    }

    /* ── New Chat ────────────────────────────── */
    window.newKisanChat = function() {
        stopSpeaking();
        if (activeTyper) activeTyper.finish();
        if (isRecording) stopRecording();
        const pauseBtn = document.getElementById('kisanPauseBtn');
        if (pauseBtn) pauseBtn.style.display = 'none';
        chatHistory = [];
        langChosen = false;
        chosenLang = null;
        isBusy = false;
        const msgs = getMsgs();
        if (msgs) msgs.innerHTML = '';
        showLangPicker();
        updateSubLabel(localStorage.getItem('agrosmart_lang') || 'en');
    };

    /* ── Detect language switch in message ───── */
    const LANG_KEYWORDS = {
        'english': 'en',
        'hindi': 'hi',
        'bengali': 'bn',
        'bangla': 'bn',
        'telugu': 'te',
        'marathi': 'mr',
        'tamil': 'ta',
        'gujarati': 'gu',
        'kannada': 'kn',
        'malayalam': 'ml',
        'punjabi': 'pa',
        'odia': 'or',
        'assamese': 'as',
        'urdu': 'ur',
        'nepali': 'ne',
        'maithili': 'mai',
        'sanskrit': 'sa',
        'konkani': 'kok',
        'manipuri': 'mni',
        'meitei': 'mni',
        'bodo': 'bodo',
        'dogri': 'doi',
        'हिंदी': 'hi',
        'हिन्दी': 'hi',
        'বাংলা': 'bn',
        'తెలుగు': 'te',
        'मराठी': 'mr',
        'தமிழ்': 'ta',
        'ગુજરાતી': 'gu',
        'ಕನ್ನಡ': 'kn',
        'മലയാളം': 'ml',
        'ਪੰਜਾਬੀ': 'pa',
        'ଓଡ଼ିଆ': 'or',
        'অসমীয়া': 'as',
        'اردو': 'ur',
        'मैथिली': 'mai',
        'संस्कृत': 'sa',
        'कोंकणी': 'kok',
        'डोगरी': 'doi',
    };

    /* ── Send message → /api/chat ────────────── */
    window.sendKisanMessage = async function() {
        const input = getInput();
        const text = (input ? input.value : '').trim();
        if (!text || isBusy || isRecording || isTranscribing) return;
        if (input) input.value = '';

        if (!langChosen) {
            langChosen = true;
            chosenLang = localStorage.getItem('agrosmart_lang') || 'en';
            const picker = document.getElementById('kisanLangPicker');
            if (picker) picker.style.display = 'none';
            updateSubLabel(chosenLang);
        }

        addUserMsg(text);
        chatHistory.push({ role: 'user', content: text });
        isBusy = true;
        const sendBtn = document.getElementById('kisanSendBtn');
        const micBtn = document.getElementById('kisanMicBtn');
        if (sendBtn) sendBtn.disabled = true;
        if (micBtn) micBtn.disabled = true;
        const typingEl = addTyping();

        // Detect language switch
        const msgLower = text.toLowerCase();
        for (const [kw, code] of Object.entries(LANG_KEYWORDS)) {
            if (msgLower.includes(kw)) {
                chosenLang = code;
                updateSubLabel(code);
                break;
            }
        }

        const lang = getAppLang();
        const messagesPayload = [...chatHistory];

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: messagesPayload, lang })
            });

            if (typingEl) typingEl.remove();

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                addBotMsg('Server error: ' + (err.error || res.status) + '. Please try again.');
                isBusy = false;
                if (sendBtn) sendBtn.disabled = false;
                if (micBtn) micBtn.disabled = false;
                return;
            }

            const data = await res.json();
            const reply = data.reply || data.error || 'No response received.';
            chatHistory.push({ role: 'assistant', content: reply });
            if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
            addBotMsg(reply, true);

        } catch (e) {
            if (typingEl) typingEl.remove();
            addBotMsg('Connection error. Check your internet.');
            console.error('[KisanHelper]', e);
        }
        isBusy = false;
        if (sendBtn) sendBtn.disabled = false;
        if (micBtn) micBtn.disabled = false;
    };

    /* ── Message renderers (chatbot.js style) ── */
    function addUserMsg(text) {
        const msgs = getMsgs();
        if (!msgs) return;
        const div = document.createElement('div');
        div.className = 'kw-msg user';
        div.innerHTML = `
      <div class="kw-msg-body">
        <div class="kw-bubble">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
        <div class="kw-msg-footer"><span class="kw-msg-time">${getTime()}</span></div>
      </div>`;
        msgs.appendChild(div);
        scrollBot();
    }

    function addBotMsg(text, animate) {
        const msgs = getMsgs();
        if (!msgs) return;

        const id = 'km_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
        const div = document.createElement('div');
        div.className = 'kw-msg bot';
        div.id = id;
        div.dataset.text = text;
        msgTextById[id] = text;

        const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const formatLine = line => escape(line)
            .replace(/•/g, '<span style="color:#4ade80;margin-right:4px;font-weight:700">•</span>');

        div.innerHTML = `
      <div class="kw-msg-avatar">🌾</div>
      <div class="kw-msg-body">
        <div class="kw-bubble"><span class="kw-bubble-text"></span></div>
        <div class="kw-msg-footer">
          <button class="kw-speak-btn" id="ksb_${id}" title="Listen">
            <i class="fas fa-volume-up"></i>
          </button>
          <span class="kw-msg-time">${getTime()}</span>
        </div>
      </div>`;

        msgs.appendChild(div);
        scrollBot();

        const textEl = div.querySelector('.kw-bubble-text');

        // Wire speak button to the shared pause/resume-aware handler.
        const btn = document.getElementById('ksb_' + id);
        if (btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                handleSpeakClick(id);
            });
        }

        if (animate) {
            startTypewriter(textEl, text, formatLine, id);
            speakText(text, id);
        } else {
            textEl.innerHTML = text.split('\n').map(formatLine).join('<br>');
        }
    }

    function startTypewriter(textEl, fullText, formatLine, msgId) {
        if (activeTyper) activeTyper.finish();

        const lines = fullText.split('\n');
        let lineIdx = 0;
        let paused = false;
        let done = false;
        let timer = null;

        const pauseBtn = document.getElementById('kisanPauseBtn');
        if (pauseBtn) pauseBtn.style.display = 'flex';

        function renderUpTo(idx, withCaret) {
            const shown = lines.slice(0, idx).map(formatLine).join('<br>');
            textEl.innerHTML = shown + (withCaret ? '<span class="kw-caret"></span>' : '');
            scrollBot();
        }

        function step() {
            if (paused || done) return;
            lineIdx++;
            renderUpTo(lineIdx, lineIdx < lines.length);
            if (lineIdx >= lines.length) {
                finish();
                return;
            }
            const justShown = lines[lineIdx - 1] || '';
            const delay = justShown.trim().length === 0 ? 120 :
                /[.!?]$/.test(justShown.trim()) ? 320 : 200;
            timer = setTimeout(step, delay);
        }

        function finish() {
            if (done) return;
            done = true;
            clearTimeout(timer);
            renderUpTo(lines.length, false);
            if (activeTyper && activeTyper.id === msgId) activeTyper = null;
            if (pauseBtn) pauseBtn.style.display = 'none';
        }

        activeTyper = {
            id: msgId,
            pause() {
                if (done) return;
                paused = true;
                clearTimeout(timer);
                renderUpTo(lineIdx, true); // freeze with caret showing, no spin
                if (pauseBtn) {
                    pauseBtn.innerHTML = '<i class="fas fa-play"></i>';
                    pauseBtn.title = 'Resume reply';
                }
            },
            resume() {
                if (done || !paused) return;
                paused = false;
                if (pauseBtn) {
                    pauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
                    pauseBtn.title = 'Pause reply';
                }
                step();
            },
            finish, // jump straight to the full text (used by New Chat / closing)
            isPaused: () => paused
        };

        timer = setTimeout(step, 150);
    }

    window.toggleKisanTypingPause = function() {
        if (!activeTyper) return;
        if (activeTyper.isPaused()) activeTyper.resume();
        else activeTyper.pause();
    };

    function addTyping() {
        const msgs = getMsgs();
        if (!msgs) return null;
        const div = document.createElement('div');
        div.className = 'kw-msg bot';
        div.id = 'kw-typing';
        div.innerHTML = `
      <div class="kw-msg-avatar">🌾</div>
      <div class="kw-msg-body">
        <div class="kw-bubble">
          <div class="kw-typing"><span></span><span></span><span></span></div>
        </div>
      </div>`;
        msgs.appendChild(div);
        scrollBot();
        return div;
    }

    function getRecBanner() { return document.getElementById('kisanRecBanner'); }

    function getRecTimeLabel() { return document.getElementById('kisanRecTime'); }

    function pickRecordingMimeType() {
        const candidates = [
            'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'
        ];
        for (const type of candidates) {
            if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) return type;
        }
        return '';
    }

    function setMicState(state) {
        // state: 'idle' | 'recording' | 'processing'
        const btn = document.getElementById('kisanMicBtn');
        const sendBtn = document.getElementById('kisanSendBtn');
        const banner = getRecBanner();
        if (!btn) return;
        btn.classList.remove('recording', 'processing');
        if (state === 'recording') {
            btn.classList.add('recording');
            btn.innerHTML = '<i class="fas fa-stop"></i>';
            btn.title = 'Stop recording';
            if (banner) banner.style.display = 'flex';
            if (sendBtn) sendBtn.disabled = true;
        } else if (state === 'processing') {
            btn.classList.add('processing');
            btn.innerHTML = '<i class="fas fa-circle-notch"></i>';
            btn.title = 'Transcribing…';
            if (banner) banner.style.display = 'none';
            if (sendBtn) sendBtn.disabled = true;
        } else {
            btn.innerHTML = '<i class="fas fa-microphone"></i>';
            btn.title = 'Voice';
            if (banner) banner.style.display = 'none';
            if (sendBtn) sendBtn.disabled = false;
        }
    }

    function startRecordTimer() {
        recordStartTime = Date.now();
        const label = getRecTimeLabel();
        recordTimerInterval = setInterval(() => {
            const secs = Math.floor((Date.now() - recordStartTime) / 1000);
            const m = Math.floor(secs / 60),
                s = secs % 60;
            if (label) label.textContent = 'Listening… ' + m + ':' + String(s).padStart(2, '0');
            if (secs >= 60) stopRecording(); // safety cap matches server-side limit
        }, 250);
    }

    function stopRecordTimer() {
        clearInterval(recordTimerInterval);
        recordTimerInterval = null;
    }

    /* ── Live captions while speaking (best-effort) ──
       Uses the browser's built-in SpeechRecognition to show words in the
       input box in real time as the farmer talks. The final, more accurate
       transcript still comes from the /api/stt backend call in
       handleRecordingStop() once recording stops — this only adds a live
       preview and is skipped silently if the browser/language doesn't
       support it, so the mic keeps working exactly as before either way. */
    let liveRecognition = null;

    function getRecognitionLang(langCode) {
        return VOICE_LANGS[langCode] || 'en-IN';
    }

    function startLiveCaption() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        try {
            liveRecognition = new SR();
            liveRecognition.lang = getRecognitionLang(getAppLang());
            liveRecognition.continuous = true;
            liveRecognition.interimResults = true;
            liveRecognition.onresult = (event) => {
                let transcript = '';
                for (let i = 0; i < event.results.length; i++) {
                    transcript += event.results[i][0].transcript;
                }
                const input = getInput();
                if (input) input.value = transcript;
            };
            // Best-effort only — real transcription comes from the server STT call.
            liveRecognition.onerror = () => {};
            liveRecognition.start();
        } catch (e) {
            liveRecognition = null;
        }
    }

    function stopLiveCaption() {
        if (liveRecognition) {
            try {
                liveRecognition.onresult = null;
                liveRecognition.onerror = null;
                liveRecognition.stop();
            } catch (e) {}
            liveRecognition = null;
        }
    }

    window.toggleKisanMic = function() {
        if (isRecording) { stopRecording(); return; }
        if (isTranscribing) return;
        startRecording();
    };

    async function startRecording() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('Microphone access is not supported in this browser.');
            return;
        }
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            console.error('[KisanMic]', e);
            alert('Microphone access denied. Please allow microphone permission and try again.');
            return;
        }

        const mimeType = pickRecordingMimeType();
        try {
            mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
        } catch (e) {
            console.error('[KisanMic]', e);
            alert('Could not start recording on this device.');
            mediaStream.getTracks().forEach(t => t.stop());
            return;
        }

        audioChunks = [];
        mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = handleRecordingStop;

        const input = getInput();
        if (input) input.value = '';

        mediaRecorder.start();
        isRecording = true;
        setMicState('recording');
        startRecordTimer();
        startLiveCaption();
    }

    function stopRecording() {
        if (!mediaRecorder || !isRecording) return;
        isRecording = false;
        stopRecordTimer();
        stopLiveCaption();
        try { mediaRecorder.stop(); } catch (e) { console.error('[KisanMic]', e); }
        if (mediaStream) {
            mediaStream.getTracks().forEach(t => t.stop());
            mediaStream = null;
        }
    }

    async function handleRecordingStop() {
        setMicState('processing');
        isTranscribing = true;

        const blobType = (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm';
        const blob = new Blob(audioChunks, { type: blobType });
        audioChunks = [];

        if (blob.size < 500) {
            setMicState('idle');
            isTranscribing = false;
            return;
        }

        const ext = blobType.includes('mp4') ? 'm4a' : blobType.includes('ogg') ? 'ogg' : 'webm';
        const formData = new FormData();
        formData.append('audio', blob, 'voice.' + ext);

        try {
            const res = await fetch('/api/stt', { method: 'POST', body: formData });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.error) {
                console.error('[KisanMic STT]', data.error || res.status);
                addBotMsg('Sorry, I could not hear that clearly. Please try again.');
            } else if (data.text) {
                const input = getInput();
                if (input) {
                    input.value = data.text;
                    input.focus();
                }
                await sendKisanMessage();
            }
        } catch (e) {
            console.error('[KisanMic STT]', e);
            addBotMsg('Connection error while transcribing your voice. Please check your internet and try again.');
        } finally {
            isTranscribing = false;
            setMicState('idle');
        }
    }

    /* ── Sync with app language toggle ──────── */
    const _origSetLanguage = window.setLanguage;
    window.setLanguage = function(code) {
        if (_origSetLanguage) _origSetLanguage(code);
        if (!langChosen) updateSubLabel(code);
    };

    /* ── Swipe down to close ─────────────────── */
    let swipeStartY = 0;
    const overlay = document.getElementById('kisanOverlay');
    overlay.addEventListener('touchstart', e => { swipeStartY = e.touches[0].clientY; }, { passive: true });
    overlay.addEventListener('touchmove', e => {
        if (!isOpen) return;
        const win = document.getElementById('kisanWindow');
        if (win && win.contains(e.target) && e.touches[0].clientY - swipeStartY > 80) toggleKisan();
    }, { passive: true });
})();