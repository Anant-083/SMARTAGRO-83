/* =========================================================================
   kisan-helper.js
   -------------------------------------------------------------------------
   Changes in this version:
     1. Every chatbot.js feature is here: toggle widget, welcome/greeting
        message, typing indicator, emoji-safe browser TTS, browser voice
        input, swipe-down-to-close, message bubbles with timestamps.
     2. Added a typewriter animation — bot replies type themselves out
        instead of appearing all at once (tap the message while it's
        typing to skip straight to the full text — handled automatically
        when a new message starts or the chat is closed).
     3. Supports all 23 languages app.py's LANG_NAMES recognizes (en, hi,
        bn, te, mr, ta, gu, kn, ml, pa, or, as, ur, mai, sat, ks, ne, sd,
        kok, mni, bodo, doi, sa) — language picker, greetings, and TTS
        voice mapping cover all of them.
     4. Mic input now shows live captions: words appear in the chat input
        box AS you speak (interim results), not just after you stop.
     5. NOTE ON SPELLING: the native-script names/greetings for Santali,
        Kashmiri, Sindhi and Manipuri are lower-confidence than the other
        19 — those four are less common training languages for me, so if
        you have a native speaker available, it's worth double-checking
        those specific four before relying on them in production.

   /api/chat contract (matches app.py's kisan_chat() route exactly):
     request:  { messages: [{role, content}, ...], lang: "hi" }
     response: { reply: "..." }  or  { error: "..." }

   Requires Font Awesome to already be loaded on the page.
   ========================================================================= */
(function () {

  /* ── Inject HTML ─────────────────────────────────────────────────── */
  document.body.insertAdjacentHTML('beforeend', `
<div id="kisanToggleBtn" onclick="toggleKisan()" title="Kisan Helper">
  <i class="fas fa-microphone"></i>
  <span class="kw-pulse"></span>
</div>

<div id="kisanOverlay" style="display:none">
  <div id="kisanWindow">
    <div class="kw-header">
      <div class="kw-header-left">
        <div class="kw-avatar"><i class="fas fa-seedling"></i></div>
        <div>
          <div class="kw-name">SmartAgro Assistant</div>
          <div class="kw-sub" id="kisanLangLabel">Ask in any language</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button class="kw-icon-btn" onclick="newKisanChat()" title="New Chat">
          <i class="fas fa-plus"></i>
        </button>
        <button class="kw-icon-btn" onclick="toggleKisan()" title="Close">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>

    <div id="kisanLangPicker" class="kw-lang-picker" style="display:none">
      <p id="kisanLangQ">Kaun si bhaasha mein baat karein? / Which language?</p>
      <div class="kw-lang-grid" id="kisanLangGrid"></div>
      <div class="kw-lang-skip" id="kisanLangSkip">Skip — use English</div>
    </div>

    <div class="kw-messages" id="kisanMessages"></div>

    <div class="kw-chips" id="kisanChips"></div>

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
  </div>
</div>`);

  /* ── Styles ───────────────────────────────────────────────────────── */
  const S = document.createElement('style');
  S.textContent = `
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
#kisanToggleBtn.listening { background: linear-gradient(135deg, #991b1b, #ef4444); }
.kw-pulse {
  position: absolute; top: -3px; right: -3px;
  width: 13px; height: 13px; background: #f87171; border-radius: 50%;
  animation: kwp 1.8s ease-in-out infinite; pointer-events: none;
}
@keyframes kwp { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.6);opacity:.4} }

#kisanOverlay {
  position: fixed; inset: 0; z-index: 9998;
  background: rgba(0,0,0,.65); backdrop-filter: blur(4px);
  display: flex; align-items: flex-end; justify-content: center;
  opacity: 0; transition: opacity .28s ease;
}
#kisanOverlay.open { opacity: 1; }

#kisanWindow {
  width: 100%; max-width: 520px;
  height: min(92vh, 100dvh);
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
.kw-name { font-weight: 700; font-size: .95rem; color: #fff; }
.kw-sub  { font-size: .7rem; color: rgba(255,255,255,.75); }
.kw-icon-btn {
  background: rgba(255,255,255,.15); border: none; border-radius: 50%;
  width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
  color: #fff; cursor: pointer; font-size: .85rem; transition: background .2s; flex-shrink: 0;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.kw-icon-btn:active { background: rgba(248,113,113,.4); }

.kw-lang-picker {
  border-top: 15px solid rgba(74,222,128,.12);
  padding: 16px 20px;
  border-bottom: 15px solid rgba(74,222,128,.12);
  flex-shrink: 0;
  background: var(--bg-2, #0e0f15);
  max-height: 46vh;
  overflow-y: auto;
}
.kw-lang-picker p {
  font-size: .8rem; color: var(--text-2, #a7c4a8);
  text-align: center; margin: 0 0 10px;
}
.kw-lang-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
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

.kw-chips {
  display: none; flex-wrap: wrap; gap: 6px; padding: 6px 12px 10px;
  flex-shrink: 0;
}
.kw-chip {
  background: rgba(74,222,128,.12); border: 1px solid rgba(74,222,128,.3);
  color: #4ade80; border-radius: 16px; padding: 6px 12px; font-size: .72rem;
  cursor: pointer; white-space: nowrap; -webkit-tap-highlight-color: transparent;
  transition: background .15s;
}
.kw-chip:active { background: rgba(74,222,128,.25); }
body.light-theme .kw-chip { background: #ecfdf5; color: #166534; border-color: rgba(22,101,52,.25); }

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
.kw-msg-footer { display: flex; align-items: center; gap: 6px; padding: 0 2px; }
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
@keyframes speakPulse { 0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,.35)} 50%{box-shadow:0 0 0 5px rgba(74,222,128,0)} }

.kw-typing { display: flex; gap: 4px; align-items: center; padding: 4px 0; }
.kw-typing span {
  display: inline-block; width: 7px; height: 7px;
  background: #4ade80; border-radius: 50%; animation: dot 1.2s infinite;
}
.kw-typing span:nth-child(2) { animation-delay: .2s; }
.kw-typing span:nth-child(3) { animation-delay: .4s; }
@keyframes dot { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-7px)} }

/* Typewriter caret */
.kw-caret {
  display: inline-block; width: 2px; height: 1em; margin-left: 1px;
  background: #4ade80; vertical-align: text-bottom;
  animation: caretBlink .85s step-end infinite;
}
@keyframes caretBlink { 50% { opacity: 0; } }

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
.kw-send-btn {
  background: linear-gradient(135deg, #166534, #22c55e);
  color: #fff; box-shadow: 0 2px 8px rgba(74,222,128,.3);
}
.kw-send-btn:active { transform: scale(1.08); }

body.light-theme #kisanWindow   { background: #fff; }
body.light-theme .kw-msg.bot .kw-bubble { background: #f0fdf4; color: #1a2e1c; border-color: rgba(22,101,52,.15); }
body.light-theme .kw-input-bar  { background: #f9fafb; }
body.light-theme #kisanInput    { background: #fff; color: #1a2e1c; border-color: rgba(22,101,52,.2); }
body.light-theme #kisanInput::placeholder { color: #9ca3af; }
body.light-theme .kw-mic-btn    { background: #f0fdf4; color: #374151; border-color: rgba(22,101,52,.2); }
body.light-theme .kw-lang-opt   { background: #f0fdf4; color: #374151; border-color: rgba(22,101,52,.2); }
body.light-theme .kw-lang-picker { background: #f9fafb; }
body.light-theme .kw-speak-btn  { border-color: rgba(22,101,52,.25); color: rgba(22,101,52,.6); }

@media (max-width: 600px) {
  #kisanWindow { border-radius: 16px 16px 0 0; height: min(94vh, 100dvh); }
  #kisanToggleBtn {
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    right: calc(12px + env(safe-area-inset-right, 0px));
    width: 52px; height: 52px;
  }
  .kw-lang-grid { grid-template-columns: repeat(3, 1fr); }
  .kw-lang-opt { min-height: 46px; font-size: .65rem; }
  .kw-msg.bot  { max-width: 92%; }
  .kw-msg.user { max-width: 88%; }
  .kw-input-bar { padding: 8px 10px; padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)); }
  #kisanInput { font-size: 16px; }
  .kw-icon-btn { width: 38px; height: 38px; font-size: .95rem; }
  .kw-mic-btn, .kw-send-btn { width: 46px; height: 46px; }
  .kw-speak-btn { width: 30px; height: 30px; }
}
@media (max-width: 360px) {
  .kw-lang-grid { grid-template-columns: repeat(2, 1fr); }
}`;
  document.head.appendChild(S);

  /* ── State ────────────────────────────────────────────────────────── */
  let isOpen          = false;
  let recognition      = null;
  let isListening      = false;
  let chatHistory       = [];   // [{role:'user'|'assistant', content:string}, ...]
  let speakingMsgId     = null;
  let availableVoices   = [];
  let langChosen        = false;
  let chosenLang        = null;
  let activeTyper       = null; // controller for the in-progress typewriter animation

  /* ── Language data — all 23 codes app.py's LANG_NAMES supports ───── */
  const LANG_NAMES = {
    en: 'English', hi: 'हिन्दी', bn: 'বাংলা', te: 'తెలుగు', mr: 'मराठी',
    ta: 'தமிழ்', gu: 'ગુજરાતી', kn: 'ಕನ್ನಡ', ml: 'മലയാളം', pa: 'ਪੰਜਾਬੀ',
    or: 'ଓଡ଼ିଆ', as: 'অসমীয়া', ur: 'اردو', mai: 'मैथिली', sat: 'ᱥᱟᱱᱛᱟᱲᱤ',
    ks: 'کٲشُر', ne: 'नेपाली', sd: 'सिन्धी', kok: 'कोंकणी', mni: 'মৈতৈলোন্',
    bodo: 'बड़ो', doi: 'डोगरी', sa: 'संस्कृतम्',
  };
  const LANG_ROMAN = {
    en: 'English', hi: 'Hindi', bn: 'Bangla', te: 'Telugu', mr: 'Marathi',
    ta: 'Tamil', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi',
    or: 'Odia', as: 'Assamese', ur: 'Urdu', mai: 'Maithili', sat: 'Santali',
    ks: 'Kashmiri', ne: 'Nepali', sd: 'Sindhi', kok: 'Konkani', mni: 'Meitei',
    bodo: 'Bodo', doi: 'Dogri', sa: 'Sanskrit',
  };
  // BCP-47 tags for speechSynthesis / SpeechRecognition. Several of these
  // low-resource languages have no dedicated installed voice on most
  // devices — getBestVoice() below always falls back gracefully (closest
  // script family, then Hindi/English) rather than staying silent.
  const VOICE_LANGS = {
    en: 'en-IN', hi: 'hi-IN', bn: 'bn-IN', te: 'te-IN', mr: 'mr-IN',
    ta: 'ta-IN', gu: 'gu-IN', kn: 'kn-IN', ml: 'ml-IN', pa: 'pa-IN',
    or: 'or-IN', as: 'as-IN', ur: 'ur-PK', mai: 'hi-IN', sat: 'hi-IN',
    ks: 'ur-PK', ne: 'ne-NP', sd: 'hi-IN', kok: 'mr-IN', mni: 'bn-IN',
    bodo: 'hi-IN', doi: 'hi-IN', sa: 'hi-IN',
  };
  const GREETINGS = {
    en: 'Hello Farmer! I am SmartAgro Assistant. Ask me:\n• Crop diseases and treatment\n• Weather and farming advice\n• Mandi prices and MSP\n• Government schemes (PM-KISAN)\n• Fertilizers and pesticides',
    hi: 'नमस्ते किसान भाई! मैं SmartAgro सहायक हूं। पूछें:\n• फसल की बीमारी और इलाज\n• आज का मौसम\n• मंडी भाव और MSP\n• सरकारी योजनाएं (PM-KISAN)\n• खाद और कीटनाशक',
    bn: 'নমস্কার কৃষক ভাই! আমি SmartAgro সহায়ক। জিজ্ঞাসা করুন:\n• ফসলের রোগ ও চিকিৎসা\n• আজকের আবহাওয়া\n• বাজার মূল্য ও MSP\n• সরকারি প্রকল্প',
    te: 'నమస్కారం! నేను SmartAgro సహాయకుడిని. అడగండి:\n• పంట రోగాలు\n• వాతావరణం\n• మార్కెట్ ధరలు\n• ప్రభుత్వ పథకాలు',
    mr: 'नमस्कार! मी SmartAgro सहाय्यक आहे. विचारा:\n• पीक रोग\n• हवामान\n• बाजारभाव\n• सरकारी योजना',
    ta: 'வணக்கம்! நான் SmartAgro உதவியாளர். கேளுங்கள்:\n• பயிர் நோய்கள்\n• வானிலை\n• சந்தை விலைகள்\n• அரசு திட்டங்கள்',
    gu: 'નમસ્તે ખેડૂત મિત્ર! હું SmartAgro સહાયક છું. પૂછો:\n• પાક રોગ\n• હવામાન\n• બજાર ભાવ\n• સરકારી યોજનાઓ',
    kn: 'ನಮಸ್ಕಾರ! ನಾನು SmartAgro ಸಹಾಯಕ. ಕೇಳಿ:\n• ಬೆಳೆ ರೋಗಗಳು\n• ಹವಾಮಾನ\n• ಮಾರುಕಟ್ಟೆ ಬೆಲೆಗಳು\n• ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು',
    ml: 'നമസ്കാരം! ഞാൻ SmartAgro സഹായി. ചോദിക്കൂ:\n• വിള രോഗങ്ങൾ\n• കാലാവസ്ഥ\n• വിപണി വില\n• സർക്കാർ പദ്ധതികൾ',
    pa: 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ SmartAgro ਸਹਾਇਕ ਹਾਂ। ਪੁੱਛੋ:\n• ਫਸਲ ਰੋਗ\n• ਮੌਸਮ\n• ਮੰਡੀ ਭਾਅ\n• ਸਰਕਾਰੀ ਯੋਜਨਾਵਾਂ',
    or: 'ନମସ୍କାର! ମୁଁ SmartAgro ସହାୟକ। ପଚାରନ୍ତୁ:\n• ଫସଲ ରୋଗ\n• ପାଣିପାଗ\n• ବଜାର ମୂଲ୍ୟ\n• ସରକାରୀ ଯୋଜନା',
    as: 'নমস্কাৰ! মই SmartAgro সহায়ক। সোধক:\n• শস্যৰ ৰোগ\n• বতৰ\n• বজাৰ দাম\n• চৰকাৰী আঁচনি',
    ur: 'السلام علیکم! میں SmartAgro مددگار ہوں۔ پوچھیں:\n• فصل کی بیماریاں\n• موسم\n• منڈی بھاؤ\n• سرکاری اسکیمیں',
    mai: 'प्रणाम किसान भाय! हम SmartAgro किसान सहायक छी। मौसम, फसल, बाजार भाव बारे पुछू।',
    sat: 'ᱡᱚᱦᱟᱨ! ᱤᱧ SmartAgro ᱜᱚᱲᱚ ᱠᱟᱱᱟᱭ। ᱟᱢᱟᱜ ᱠᱷᱮᱛ ᱨᱮᱭᱟᱜ ᱵᱟᱵᱚᱛ ᱯᱩᱪᱷᱟᱣ ᱢᱮ।',
    ks: 'اَداب! بہٕ چھُس SmartAgro مددگار۔ کھیتی، موسم یا منڈی بھاؤ باپت پوچھِو۔',
    ne: 'नमस्ते किसान साथी! म SmartAgro किसान सहायक हुँ। मौसम, बाली, बजार मूल्य वा सरकारी योजनाबारे सोध्नुहोस्।',
    sd: 'नमस्ते! मां SmartAgro सहायक आहियां. फसल, मौसम, या बाजार भाव बारे पुछो.',
    kok: 'नमस्कार शेतकरी मित्रा! हाव SmartAgro किसान सहाय्यक. हवामान, पीक, बाजारभावा बद्दल विचार.',
    mni: 'ꯀꯨꯝꯖꯥ ꯂꯧꯅꯨ ꯂꯧꯔꯤꯕ ꯃꯔꯨꯑꯣꯏꯕ! ꯑꯩ SmartAgro ꯀꯤꯁꯥꯟ ꯃꯇꯦꯡ ꯄꯥꯡꯕꯥ ꯅꯤ। ꯅꯣꯡꯁꯤꯡ, ꯂꯧꯕꯨꯀ, ꯁꯦꯟꯂꯣꯟꯒꯤ ꯃꯌꯥꯏ ꯍꯪꯕꯤꯌꯨ꯫',
    bodo: 'नमस्कार बेसो रां! आं SmartAgro किसान हेल्पार। दिनै सिथिल, फिसा, बाजार दाम बेसेबा खालामनो हागौ।',
    doi: 'नमस्ते किसान भाई! मैं SmartAgro किसान सहायक आं। मौसम, फसल, बजार भाव बारै पुच्छो।',
   sa: 'नमस्ते कृषकमित्र! अहं SmartAgro कृषकसहायकः अस्मि। वायुमण्डलं, कृषिं, विपणिमूल्यं वा सरकारीयोजनाः विषये पृच्छन्तु।',
  };

  const QUICK_CHIPS = {
    en: [['🌤️ Weather','Today\'s weather'],['💰 Mandi Prices','Mandi prices near me'],['🌱 Crop Disease','My crop looks sick'],['🏛️ Schemes','Government schemes for farmers']],
    hi: [['🌤️ मौसम','आज का मौसम'],['💰 मंडी भाव','मेरे पास मंडी भाव'],['🌱 फसल रोग','मेरी फसल बीमार लग रही है'],['🏛️ योजनाएं','किसानों के लिए सरकारी योजनाएं']],
    bn: [['🌤️ আবহাওয়া','আজকের আবহাওয়া'],['💰 বাজার দর','কাছের বাজার দর'],['🌱 ফসলের রোগ','আমার ফসল অসুস্থ দেখাচ্ছে'],['🏛️ প্রকল্প','কৃষকদের জন্য সরকারি প্রকল্প']],
    te: [['🌤️ వాతావరణం','ఈరోజు వాతావరణం'],['💰 మార్కెట్ ధరలు','నా దగ్గర మార్కెట్ ధరలు'],['🌱 పంట వ్యాధి','నా పంట అనారోగ్యంగా ఉంది'],['🏛️ పథకాలు','రైతుల కోసం ప్రభుత్వ పథకాలు']],
    mr: [['🌤️ हवामान','आजचे हवामान'],['💰 बाजारभाव','जवळचे बाजारभाव'],['🌱 पीक रोग','माझे पीक आजारी दिसत आहे'],['🏛️ योजना','शेतकऱ्यांसाठी सरकारी योजना']],
    ta: [['🌤️ வானிலை','இன்றைய வானிலை'],['💰 சந்தை விலை','அருகிலுள்ள சந்தை விலை'],['🌱 பயிர் நோய்','என் பயிர் நோய்வாய்ப்பட்டுள்ளது'],['🏛️ திட்டங்கள்','விவசாயிகளுக்கான அரசு திட்டங்கள்']],
    gu: [['🌤️ હવામાન','આજનું હવામાન'],['💰 બજાર ભાવ','નજીકના બજાર ભાવ'],['🌱 પાક રોગ','મારો પાક બીમાર દેખાય છે'],['🏛️ યોજનાઓ','ખેડૂતો માટે સરકારી યોજનાઓ']],
    kn: [['🌤️ ಹವಾಮಾನ','ಇಂದಿನ ಹವಾಮಾನ'],['💰 ಮಾರುಕಟ್ಟೆ ಬೆಲೆ','ಹತ್ತಿರದ ಮಾರುಕಟ್ಟೆ ಬೆಲೆ'],['🌱 ಬೆಳೆ ರೋಗ','ನನ್ನ ಬೆಳೆ ಅನಾರೋಗ್ಯದಿಂದ ಕಾಣುತ್ತಿದೆ'],['🏛️ ಯೋಜನೆಗಳು','ರೈತರಿಗೆ ಸರ್ಕಾರಿ ಯೋಜನೆಗಳು']],
    ml: [['🌤️ കാലാവസ്ഥ','ഇന്നത്തെ കാലാവസ്ഥ'],['💰 വിപണി വില','അടുത്തുള്ള വിപണി വില'],['🌱 വിള രോഗം','എന്റെ വിളയ്ക്ക് അസുഖം തോന്നുന്നു'],['🏛️ പദ്ധതികൾ','കർഷകർക്കുള്ള സർക്കാർ പദ്ധതികൾ']],
    pa: [['🌤️ ਮੌਸਮ','ਅੱਜ ਦਾ ਮੌਸਮ'],['💰 ਮੰਡੀ ਭਾਅ','ਨੇੜੇ ਦੇ ਮੰਡੀ ਭਾਅ'],['🌱 ਫਸਲ ਰੋਗ','ਮੇਰੀ ਫਸਲ ਬਿਮਾਰ ਲੱਗ ਰਹੀ ਹੈ'],['🏛️ ਯੋਜਨਾਵਾਂ','ਕਿਸਾਨਾਂ ਲਈ ਸਰਕਾਰੀ ਯੋਜਨਾਵਾਂ']],
    or: [['🌤️ ପାଣିପାଗ','ଆଜିର ପାଣିପାଗ'],['💰 ବଜାର ମୂଲ୍ୟ','ନିକଟସ୍ଥ ବଜାର ମୂଲ୍ୟ'],['🌱 ଫସଲ ରୋଗ','ମୋ ଫସଲ ଅସୁସ୍ଥ ଦେଖାଯାଉଛି'],['🏛️ ଯୋଜନା','କୃଷକଙ୍କ ପାଇଁ ସରକାରୀ ଯୋଜନା']],
    as: [['🌤️ বতৰ','আজিৰ বতৰ'],['💰 বজাৰ দাম','ওচৰৰ বজাৰ দাম'],['🌱 শস্যৰ ৰোগ','মোৰ শস্য অসুস্থ যেন লাগিছে'],['🏛️ আঁচনি','কৃষকৰ বাবে চৰকাৰী আঁচনি']],
    ur: [['🌤️ موسم','آج کا موسم'],['💰 منڈی بھاؤ','قریبی منڈی بھاؤ'],['🌱 فصل کی بیماری','میری فصل بیمار لگ رہی ہے'],['🏛️ اسکیمیں','کسانوں کے لیے سرکاری اسکیمیں']],
    mai: [['🌤️ मौसम','आइ के मौसम'],['💰 बजार भाव','लगिच के बजार भाव'],['🌱 फसल रोग','हमर फसल बेमार लागि रहल अछि'],['🏛️ योजना','किसान क लेल सरकारी योजना']],
    sat: [['🌤️ ᱨᱤᱢᱤᱞ','ᱛᱮᱦᱮᱸ ᱨᱤᱢᱤᱞ'],['💰 ᱦᱟᱴ ᱚᱲᱟᱜ','ᱧᱮᱲᱟᱜ ᱦᱟᱴ ᱚᱲᱟᱜ'],['🌱 ᱡᱟᱶᱨᱟ ᱨᱚᱜᱚ','ᱤᱧᱟᱜ ᱡᱟᱶᱨᱟ ᱵᱤᱨᱟᱢᱤ ᱠᱟᱱᱟ'],['🏛️ ᱦᱚᱲᱢᱚ','ᱪᱟᱥᱤ ᱞᱟᱹᱜᱤᱛ ᱥᱚᱨᱠᱟᱨᱤ ᱦᱚᱲᱢᱚ']],
    ks: [['🌤️ موسم','آجَکُن موسم'],['💰 منڈی بھاؤ','نزدیکی منڈی بھاؤ'],['🌱 فصل بیماری','میۆن فصل بیمار چھُ'],['🏛️ سکیمہٕ','دہقانَن باپت سرکاری سکیمہٕ']],
    ne: [['🌤️ मौसम','आजको मौसम'],['💰 बजार मूल्य','नजिकैको बजार मूल्य'],['🌱 बाली रोग','मेरो बाली बिरामी देखिन्छ'],['🏛️ योजना','किसानका लागि सरकारी योजना']],
    sd: [['🌤️ موسم','اڄ جو موسم'],['💰 بازار قيمتون','ويجهي بازار قيمتون'],['🌱 फसल बीमारी','मेरी फसल बीमार लग रही आहे'],['🏛️ اسڪيمون','هارين لاءِ سرڪاري اسڪيمون']],
    kok: [['🌤️ हवामान','आयचें हवामान'],['💰 बाजारभाव','लागसारचो बाजारभाव'],['🌱 पिकाचो रोग','म्हजें पीक आजारी दिसता'],['🏛️ येवजण्यो','शेतकऱ्यांखातीर सरकारी येवजण्यो']],
    mni: [['🌤️ ꯅꯣꯡꯁꯤꯡ','ꯅꯣꯡꯃꯥ ꯅꯣꯡꯁꯤꯡ'],['💰 ꯁꯦꯟꯂꯣꯟ ꯃꯌꯥꯏ','ꯅꯛꯅꯕ ꯁꯦꯟꯂꯣꯟ ꯃꯌꯥꯏ'],['🌱 ꯂꯧꯕꯨꯛ ꯀꯤ ꯓꯤ','ꯑꯩꯒꯤ ꯂꯧꯕꯨꯛ ꯅꯥꯕ ꯎꯠꯂꯤ'],['🏛️ ꯄꯂꯦꯟ','ꯂꯧꯆꯤꯡꯕꯁꯤꯡꯒꯤꯗꯃꯛ ꯁꯔꯀꯥꯔꯒꯤ ꯄꯂꯦꯟ']],
    bodo: [['🌤️ दिनै सिथिल','दिनैनि सिथिल'],['💰 बाजार दाम','हाबाथाव बाजार दाम'],['🌱 फिसा हाबि','आंनि फिसा हाबि जायो'],['🏛️ आयदा','हास्लायाव आयदा']],
    doi: [['🌤️ मौसम','अज्जै दा मौसम'],['💰 बजार भाव','नेड़्डे बजार भाव'],['🌱 फसल रोग','मेरी फसल बीमार लगदी ऐ'],['🏛️ योजनां','किसानां आस्तै सरकारी योजनां']],
    sa: [['🌤️ वायुमण्डलम्','अद्यतनम् वायुमण्डलम्'],['💰 विपणिमूल्यम्','समीपस्थं विपणिमूल्यम्'],['🌱 कृषिरोगः','मम कृषिः रुग्णा दृश्यते'],['🏛️ योजनाः','कृषकाणां कृते सरकारीयोजनाः']],
  };

  function renderQuickChips() {
    const box = document.getElementById('kisanChips');
    if (!box) return;
    const lang  = getAppLang();
    const chips = QUICK_CHIPS[lang] || QUICK_CHIPS.en;
    box.innerHTML = chips.map(([label, msg]) =>
      `<button class="kw-chip" onclick="sendKisanQuickMsg('${msg.replace(/'/g, "\\'")}')">${label}</button>`
    ).join('');
    box.style.display = 'flex';
  }

  window.sendKisanQuickMsg = function (text) {
    const input = document.getElementById('kisanInput');
    if (input) { input.value = text; window.sendKisanMessage(); }
    const box = document.getElementById('kisanChips');
    if (box) box.style.display = 'none';
  };

  function getAppLang() {
    return chosenLang || localStorage.getItem('agrosmart_lang') || 'en';
  }

  function loadVoices() {
    availableVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  }
  if (window.speechSynthesis) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  function getBestVoice(langCode) {
    const speechLang = VOICE_LANGS[langCode] || 'en-IN';
    const langPrefix = speechLang.split('-')[0];
    let voice = availableVoices.find(v => v.lang === speechLang);
    if (!voice) voice = availableVoices.find(v => v.lang.startsWith(langPrefix));
    if (!voice && langCode !== 'en') voice = availableVoices.find(v => v.lang === 'en-IN');
    if (!voice) voice = availableVoices.find(v => v.lang.startsWith('en'));
    return voice || null;
  }

  function cleanTextForSpeech(text) {
    return text
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
      .replace(/[\u{2600}-\u{27FF}]/gu, '')
      .replace(/[\u{FE00}-\u{FEFF}]/gu, '')
      .replace(/[🌾🌿🌽🍅🎋🫘🌻🧅🥔🌶️🥜☁️🌧️⛅☀️❄️⛈️🌦️🌤️🌫️]/g, '')
      .replace(/•/g, '')
      .replace(/[►▶→←↑↓]/g, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function showKisanToast(msg) {
    if (typeof window.showToast === 'function') { window.showToast(msg, 'warning', 3000); return; }
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;left:50%;bottom:calc(90px + env(safe-area-inset-bottom,0px));' +
      'transform:translateX(-50%);background:#1a2a1c;color:#e8f5e9;border:1px solid rgba(74,222,128,.3);' +
      'padding:9px 16px;border-radius:20px;font-size:.78rem;z-index:10000;max-width:86vw;text-align:center;' +
      'box-shadow:0 4px 20px rgba(0,0,0,.4);';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  /* ── Toggle fullscreen ────────────────────────────────────────────── */
  window.toggleKisan = function () {
    isOpen = !isOpen;
    const overlay = document.getElementById('kisanOverlay');
    const fab     = document.getElementById('kisanToggleBtn');
    if (!overlay) return;

    if (isOpen) {
      overlay.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      fab.innerHTML = '<i class="fas fa-times"></i><span class="kw-pulse"></span>';
      fab.classList.add('chat-open');
      setTimeout(() => overlay.classList.add('open'), 10);
      if (chatHistory.length === 0 && !langChosen) showLangPicker();
      setTimeout(() => {
        const inp = document.getElementById('kisanInput');
        if (inp) inp.focus();
      }, 350);
    } else {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      fab.innerHTML = '<i class="fas fa-microphone"></i><span class="kw-pulse"></span>';
      fab.classList.remove('chat-open');
      setTimeout(() => { overlay.style.display = 'none'; }, 280);
      stopSpeaking();
      if (activeTyper) activeTyper.finish();
      if (isListening) recognition?.stop();
    }
  };

  // Tap backdrop to close
  document.getElementById('kisanOverlay').addEventListener('click', function (e) {
    if (e.target === this) window.toggleKisan();
  });

  /* ── Language Picker ──────────────────────────────────────────────── */
  function showLangPicker() {
    const picker = document.getElementById('kisanLangPicker');
    const grid   = document.getElementById('kisanLangGrid');
    const skip   = document.getElementById('kisanLangSkip');
    if (!picker || !grid) return;

    grid.innerHTML = '';
    Object.entries(LANG_NAMES).forEach(([code, nativeName]) => {
      const btn = document.createElement('div');
      btn.className = 'kw-lang-opt';
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      btn.innerHTML = `<span>${nativeName}</span><span class="kl-sub">${LANG_ROMAN[code] || code}</span>`;
      btn.addEventListener('click', () => pickLang(code));
      btn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickLang(code); }
      });
      grid.appendChild(btn);
    });

    const savedLang = localStorage.getItem('agrosmart_lang') || 'en';
    if (skip) {
      skip.textContent = 'Skip — use ' + (LANG_ROMAN[savedLang] || 'English');
      skip.onclick = () => pickLang(savedLang);
    }
    picker.style.display = 'block';
  }

 
function pickLang(code) {
  chosenLang = code;
  langChosen = true;
  localStorage.setItem('agrosmart_lang', code);
  const picker = document.getElementById('kisanLangPicker');
  if (picker) picker.style.display = 'none';
   updateSubLabel(code);
   addBotMsg(GREETINGS[code] || GREETINGS.en);
   renderQuickChips();
}
  function updateSubLabel(lang) {
    const el = document.getElementById('kisanLangLabel');
    if (el) el.textContent = 'Answering in ' + (LANG_ROMAN[lang] || lang.toUpperCase());
  }

  /* ── Messages ─────────────────────────────────────────────────────── */
  function formatMsgText(text) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/•/g, '<span style="color:var(--green);margin-right:4px;font-weight:700">•</span>');
  }

  function addBotMsg(text) {
    const list = document.getElementById('kisanMessages');
    if (!list) return;
    const id  = 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
    const div = document.createElement('div');
    div.className    = 'kw-msg bot';
    div.id           = id;
    div.dataset.text = text;

    div.innerHTML = `
      <div class="kw-msg-avatar">🌾</div>
      <div class="kw-msg-body">
        <div class="kw-bubble" id="bubble_${id}"></div>
        <div class="kw-msg-footer">
          <button class="kw-speak-btn" id="speak_${id}" onclick="toggleSpeak('${id}')" title="Listen">
            <i class="fas fa-volume-up"></i>
          </button>
          <span class="kw-msg-time">${getTime()}</span>
        </div>
      </div>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;

    typeWriter(id, text);
    // Tap the bubble to skip straight to the full text.
    document.getElementById('bubble_' + id).addEventListener('click', () => {
      if (activeTyper) activeTyper.finish();
    });
  }

  /* ── Typewriter animation ────────────────────────────────────────── */
  function typeWriter(id, fullText) {
    const bubble = document.getElementById('bubble_' + id);
    const list   = document.getElementById('kisanMessages');
    if (!bubble) return;
    if (activeTyper) activeTyper.finish();

    let i = 0;
    // Adaptive speed: aim for ~90 ticks regardless of reply length so long
    // and short replies both finish typing in a similar, pleasant amount
    // of time (roughly 1.5–2s).
    const step = Math.max(1, Math.round(fullText.length / 90));

    const timer = setInterval(() => {
      i += step;
      if (i >= fullText.length) {
        bubble.innerHTML = formatMsgText(fullText);
        clearInterval(timer);
        activeTyper = null;
      } else {
        bubble.innerHTML = formatMsgText(fullText.slice(0, i)) + '<span class="kw-caret"></span>';
      }
      if (list) list.scrollTop = list.scrollHeight;
    }, 20);

    activeTyper = {
      finish() {
        clearInterval(timer);
        bubble.innerHTML = formatMsgText(fullText);
        activeTyper = null;
      }
    };
  }

  function addUserMsg(text) {
    const list = document.getElementById('kisanMessages');
    if (!list) return;
    const div = document.createElement('div');
    div.className = 'kw-msg user';
    div.innerHTML = `
      <div class="kw-msg-body">
        <div class="kw-bubble">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        <span class="kw-msg-time">${getTime()}</span>
      </div>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  function addTyping() {
    const list = document.getElementById('kisanMessages');
    if (!list) return null;
    const div = document.createElement('div');
    div.className = 'kw-msg bot typing-msg';
    div.innerHTML = `
      <div class="kw-msg-avatar">🌾</div>
      <div class="kw-msg-body">
        <div class="kw-bubble">
          <span class="kw-typing"><span></span><span></span><span></span></span>
        </div>
      </div>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
    return div;
  }

  function getTime() {
    return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  /* ── Send message → /api/chat (matches app.py exactly) ───────────── */
  window.sendKisanMessage = async function () {
    const input = document.getElementById('kisanInput');
    const msg   = input?.value.trim();
    if (!msg) return;
    input.value = '';
    const chipsBox = document.getElementById('kisanChips');
    if (chipsBox) chipsBox.style.display = 'none';

    if (!langChosen) {
      chosenLang = localStorage.getItem('agrosmart_lang') || 'en';
      langChosen = true;
      const picker = document.getElementById('kisanLangPicker');
      if (picker) picker.style.display = 'none';
      updateSubLabel(chosenLang);
    }

    addUserMsg(msg);
    chatHistory.push({ role: 'user', content: msg });

    const sendBtn = document.getElementById('kisanSendBtn');
    const micBtn  = document.getElementById('kisanMicBtn');
    if (sendBtn) sendBtn.disabled = true;
    if (micBtn) micBtn.disabled = true;

    const typing = addTyping();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: chatHistory.slice(-6),
          lang: getAppLang()
        })
      });
      const data = await res.json().catch(() => ({}));
      if (typing) typing.remove();

      if (!res.ok || data.error) {
        addBotMsg(data.error || 'Sorry, try again.');
      } else {
        const reply = data.reply || 'Sorry, try again.';
        addBotMsg(reply);
        chatHistory.push({ role: 'assistant', content: reply });
        if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
      }
    } catch {
      if (typing) typing.remove();
      addBotMsg('Connection error. Please try again.');
    } finally {
      if (sendBtn) sendBtn.disabled = false;
      if (micBtn) micBtn.disabled = false;
    }
  };

/* ── Text to Speech — server-side (works on every device/OS) ────────
     Falls back to browser speechSynthesis only if the server call fails
     (e.g. offline), so it degrades gracefully instead of going silent. */
  let currentAudio = null;

  window.toggleSpeak = async function (msgId) {
    const div = document.getElementById(msgId);
    const btn = document.getElementById('speak_' + msgId);
    if (!div || !btn) return;

    if (speakingMsgId === msgId) { stopSpeaking(); return; }
    stopSpeaking();
    if (activeTyper) activeTyper.finish();

    const rawText = div.dataset.text || '';
    const text    = cleanTextForSpeech(rawText);
    if (!text) return;

    const lang = getAppLang();

    speakingMsgId = msgId;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.classList.add('speaking');

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang })
      });
      if (!res.ok) throw new Error('tts-failed');

      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      currentAudio = audio;

      audio.onplay = () => {
        btn.innerHTML = '<i class="fas fa-stop"></i>';
      };
      audio.onended = audio.onerror = () => {
        speakingMsgId = null;
        btn.innerHTML = '<i class="fas fa-volume-up"></i>';
        btn.classList.remove('speaking');
      };
      await audio.play();
    } catch (err) {
      if (window.speechSynthesis) {
        const voice      = getBestVoice(lang);
        const speechLang = VOICE_LANGS[lang] || 'en-IN';
        const utterance  = new SpeechSynthesisUtterance(text);
        utterance.lang   = speechLang;
        utterance.rate   = 0.88;
        if (voice) utterance.voice = voice;
        utterance.onstart = () => { btn.innerHTML = '<i class="fas fa-stop"></i>'; };
        utterance.onend = utterance.onerror = () => {
          speakingMsgId = null;
          btn.innerHTML = '<i class="fas fa-volume-up"></i>';
          btn.classList.remove('speaking');
        };
        window.speechSynthesis.speak(utterance);
      } else {
        speakingMsgId = null;
        btn.innerHTML = '<i class="fas fa-volume-up"></i>';
        btn.classList.remove('speaking');
        showKisanToast('Voice unavailable. Check your connection.');
      }
    }
  };

  function stopSpeaking() {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (speakingMsgId) {
      const btn = document.getElementById('speak_' + speakingMsgId);
      if (btn) { btn.innerHTML = '<i class="fas fa-volume-up"></i>'; btn.classList.remove('speaking'); }
      speakingMsgId = null;
    }
  }
  /* ── Voice Input — live captions while speaking ──────────────────── */
  window.toggleKisanMic = function () {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showKisanToast('Voice not supported. Use Chrome browser.'); return; }
    if (isListening) { recognition?.stop(); return; }
    if (!isOpen) window.toggleKisan();
    if (!langChosen) {
      chosenLang = localStorage.getItem('agrosmart_lang') || 'en';
      langChosen = true;
      const picker = document.getElementById('kisanLangPicker');
      if (picker) picker.style.display = 'none';
      updateSubLabel(chosenLang);
    }

    const speechLang = VOICE_LANGS[getAppLang()] || 'en-IN';
    const input = document.getElementById('kisanInput');
    if (input) input.value = '';

    recognition = new SR();
    recognition.lang            = speechLang;
    recognition.interimResults  = true;   // show words live as they're spoken
    recognition.maxAlternatives = 1;
    recognition.continuous      = false;

    recognition.onstart = () => {
      isListening = true;
      updateMicState(true);
      showKisanToast('Listening... speak now');
    };

    // Live caption: paint every interim + final chunk into the input box
    // as it comes in, so the farmer sees their words appear while talking.
    recognition.onresult = e => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      const inp = document.getElementById('kisanInput');
      if (inp) inp.value = transcript;
    };

    recognition.onerror = e => {
      isListening = false; updateMicState(false);
      if (e.error === 'no-speech') showKisanToast('No speech. Try again.');
      else if (e.error === 'not-allowed') showKisanToast('Mic access denied.');
      else showKisanToast('Voice error. Try again.');
    };

    // Recognition has fully stopped (either naturally after a pause, or
    // because the mic button was tapped again) — send whatever ended up
    // in the input box.
    recognition.onend = () => {
      isListening = false;
      updateMicState(false);
      const inp = document.getElementById('kisanInput');
      if (inp && inp.value.trim()) window.sendKisanMessage();
    };

    try { recognition.start(); } catch { showKisanToast('Could not start mic.'); }
  };

  function updateMicState(listening) {
    const micBtn = document.getElementById('kisanMicBtn');
    const fab    = document.getElementById('kisanToggleBtn');
    if (micBtn) {
      micBtn.classList.toggle('recording', listening);
      micBtn.innerHTML = listening ? '<i class="fas fa-stop"></i>' : '<i class="fas fa-microphone"></i>';
    }
    if (fab && !isOpen) {
      fab.classList.toggle('listening', listening);
      fab.innerHTML = (listening ? '<i class="fas fa-stop"></i>' : '<i class="fas fa-microphone"></i>') + '<span class="kw-pulse"></span>';
    }
  }

  /* ── New Chat ─────────────────────────────────────────────────────── */
  window.newKisanChat = function () {
    stopSpeaking();
    if (activeTyper) activeTyper.finish();
    if (isListening) recognition?.stop();
    chatHistory = [];
    langChosen  = false;
    chosenLang  = null;
    const list = document.getElementById('kisanMessages');
    if (list) list.innerHTML = '';
    showLangPicker();
  };

  /* ── Swipe down to close ──────────────────────────────────────────── */
  let touchStartY = 0;
  const overlay = document.getElementById('kisanOverlay');
  overlay.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
  overlay.addEventListener('touchmove', e => {
    if (!isOpen) return;
    const win = document.getElementById('kisanWindow');
    if (win && win.contains(e.target) && e.touches[0].clientY - touchStartY > 80) window.toggleKisan();
  }, { passive: true });

})();
