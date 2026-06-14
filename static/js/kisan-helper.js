/* ═══════════════════════════════════════════════
   kisan-helper.js — Kisan Helper Voice+Chat Widget
   v4: chatbot.js UI/logic merged into widget shell.
   Fullscreen overlay chat + language picker retained.
   Connects to Flask /api/chat (app.py).
   Kisan Helpline link preserved.
═══════════════════════════════════════════════ */
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
        <button class="kw-send-btn" onclick="sendKisanMessage()">
          <i class="fas fa-paper-plane"></i>
        </button>
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
  max-height: 100vh;
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
  padding: 12px 14px 8px;
  border-bottom: 1px solid rgba(74,222,128,.12);
  flex-shrink: 0;
  background: var(--bg-2, #0e1510);
}
.kw-lang-picker p {
  font-size: .8rem; color: var(--text-2, #a7c4a8);
  text-align: center; margin: 0 0 10px;
}
.kw-lang-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px;
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
.kw-send-btn {
  background: linear-gradient(135deg, #166534, #22c55e);
  color: #fff; box-shadow: 0 2px 8px rgba(74,222,128,.3);
}
.kw-send-btn:active { transform: scale(1.08); }

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

@media (max-width: 600px) {
  #kisanWindow { border-radius: 16px 16px 0 0; }
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
}`;
    document.head.appendChild(S);

    /* ── State ───────────────────────────────── */
    let chatHistory = [];
    let isOpen = false;
    let isBusy = false;
    let recognition = null;
    let isRecording = false;
    let langChosen = false;
    let chosenLang = null;
    let speakingMsgId = null;
    let availableVoices = [];

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
        hi: '🌾 Namaste kisan bhai! Main SmartAgro Kisan Sahayak hoon. Aap mujhse mausam, fasal, baazaar bhaav ya sarkari yojanaon ke baare mein pooch sakte hain.',
        bn: '🌾 Nomoshkar krishok bondhu! Ami SmartAgro Kishan Sahayak. Aabohawa, foshol, bazar mulyo ba shorkaari prokolpo shomporke jiggesh korun.',
        te: '🌾 Namaskaram raitu mitruda! Nenu SmartAgro Kisan Helper. Vaatavaranam, pantalu, market dhaaralu gurinchi adagandi.',
        mr: '🌾 Namaskar shetkari mithraa! Mi SmartAgro Kisan Sahaayyak aahe. Hawamaan, peek, baazarbhaav kiva sarkari yojanaanbaddal vicharaa.',
        ta: '🌾 Vanakkam vivasaayi nanbharE! Naan SmartAgro Kisan Udaviyaalar. Vaanilai, payirkal, sandai vilaikal pattri keelungal.',
        gu: '🌾 Namaste khedoot mitra! Hoon SmartAgro Kisan Sahayak chhun. Hawaman, paak, bazaar bhaav vishe poochho.',
        kn: '🌾 Namaskara raita mitra! Naanu SmartAgro Kisan Sahayaka. Hawaamaana, bele, maarukatte belgalu bagge keeli.',
        ml: '🌾 Namaskaram karshaka suhruthe! Njaan SmartAgro Kisan Assistant. Kaalavastha, vilakkal, vipani vila choadikhkoo.',
        pa: '🌾 Sat sri akaal kisan veere! Main SmartAgro Kisan Sahayak haan. Mausam, fasal, mandi bhaav baare puchho.',
        or: '🌾 Namaskar krushak bandhu! Mun SmartAgro Kisan Sahayak. Aabhaawa, fasal, bazaar mulya bishayare pachaara.',
        as: '🌾 Nomashkar krishhok bondhu! Moi SmartAgro Kishan Shahayak. Batar, shashyo, bazaar mulyo ba charkari aanshonir bishaye soodibo.',
        ur: '🌾 Assalaamu alaykum kisaan dost! Main SmartAgro Kisaan Madadgaar hoon. Mausam, fasal, mandi bhaao ke baare mein poochhein.',
        mai: '🌾 Pranaam kisaan bhai! Hum SmartAgro Kisaan Sahayak chhi. Mausam, fasaL, baazaar bhaav ke baare mein poochhu.',
        ne: '🌾 Namaste kisaan saathi! Ma SmartAgro Kisaan Sahayak hun. Mausam, baali, bazaar mulya vaa sarkari yojanabare sodhnus.',
        sa: '🌾 Namaste krishak mitra! Aham SmartAgro Kisan Sahayakah asmi. Krishi, vaayumanDalam, vipaNana mulya cha prichhatu.',
        kok: '🌾 Namaskar shetkari dosta! Haaov SmartAgro Kisan Sahaayyak. Hawaman, peek, baazarbhaav visheen vichaar.',
        mni: '🌾 Namashkaar chaashi nungshibaa! Ei SmartAgro Kisan Helper ni. Paangam, pambei, market tengbang bishayada haabigU.',
        bodo: '🌾 Namashkaar kheti aaro! Ang SmartAgro Kisan Sahayak. Mausam, kheti, bazaar biphaan bilaai dinthiz.',
        doi: '🌾 Namaste kisaan bhai! Main SmartAgro Kisaan Sahayak aan. Mausam, fasal, bazaar bhaav baare puchho.',
    };

    /* ── Voice helpers (from chatbot.js) ────── */
    function loadVoices() { availableVoices = window.speechSynthesis ? window.speechSynthesis.getVoices() : []; }
    if (window.speechSynthesis) {
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    function getBestVoice(langCode) {
        const speechLang = VOICE_LANGS[langCode] || 'en-IN';
        const prefix = speechLang.split('-')[0];
        return availableVoices.find(v => v.lang === speechLang) ||
            availableVoices.find(v => v.lang.startsWith(prefix)) ||
            availableVoices.find(v => v.lang === 'en-IN') ||
            availableVoices.find(v => v.lang.startsWith('en')) ||
            null;
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

    /* ── TTS — speak a message ───────────────── */
    function speakText(text, msgId, btn) {
        if (!window.speechSynthesis) return;
        stopSpeaking();

        const clean = cleanTextForSpeech(text);
        if (!clean) return;

        const lang = getAppLang();
        const voice = getBestVoice(lang);
        const utter = new SpeechSynthesisUtterance(clean);
        utter.lang = VOICE_LANGS[lang] || 'en-IN';
        utter.rate = 0.88;
        utter.pitch = 1;
        utter.volume = 1;
        if (voice) utter.voice = voice;

        utter.onstart = () => {
            speakingMsgId = msgId;
            if (btn) { btn.classList.add('speaking');
                btn.innerHTML = '<i class="fas fa-stop"></i>';
                btn.title = 'Stop'; }
            const fab = document.getElementById('kisanToggleBtn');
            if (fab) fab.innerHTML = '<i class="fas fa-volume-up" style="color:#fff;font-size:1.3rem"></i><span class="kw-pulse"></span>';
        };
        utter.onend = utter.onerror = () => {
            speakingMsgId = null;
            if (btn) { btn.classList.remove('speaking');
                btn.innerHTML = '<i class="fas fa-volume-up"></i>';
                btn.title = 'Listen'; }
            const fab = document.getElementById('kisanToggleBtn');
            if (fab && isOpen) fab.innerHTML = '<i class="fas fa-times" style="color:#fff;font-size:1.25rem"></i>';
        };

        window.speechSynthesis.speak(utter);
    }

    function stopSpeaking() {
        if (window.speechSynthesis) try { window.speechSynthesis.cancel(); } catch (e) {}
        if (speakingMsgId) {
            const btn = document.getElementById('ksb_' + speakingMsgId);
            if (btn) { btn.classList.remove('speaking');
                btn.innerHTML = '<i class="fas fa-volume-up"></i>';
                btn.title = 'Listen'; }
            speakingMsgId = null;
        }
    }

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

            btn.addEventListener('touchstart', e => { isTouched = true;
                touchScrolled = false;
                tx = e.touches[0].clientX;
                ty = e.touches[0].clientY; }, { passive: true });
            btn.addEventListener('touchmove', e => { if (Math.abs(e.touches[0].clientX - tx) > 8 || Math.abs(e.touches[0].clientY - ty) > 8) touchScrolled = true; }, { passive: true });
            btn.addEventListener('touchend', e => { if (touchScrolled) return;
                e.preventDefault();
                btn.classList.add('kl-active');
                setTimeout(() => { btn.classList.remove('kl-active');
                    pickLang(code); }, 200); }, { passive: false });
            btn.addEventListener('click', () => { if (isTouched) return;
                pickLang(code); });
            btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault();
                    pickLang(code); } });

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
        if (!text || isBusy) return;
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
        const typingEl = addTyping();

        // Detect language switch
        const msgLower = text.toLowerCase();
        for (const [kw, code] of Object.entries(LANG_KEYWORDS)) {
            if (msgLower.includes(kw)) { chosenLang = code;
                updateSubLabel(code); break; }
        }

        const lang = getAppLang();

        // Build messages with romanization rule (preserved from original)
        let messagesPayload = [...chatHistory];
        if (lang !== 'en') {
            const langName = LANG_ROMAN[lang] || lang;
            messagesPayload = [{
                role: 'user',
                content: '[SYSTEM RULE - FOLLOW FOR EVERY REPLY] ' +
                    'You must reply in ' + langName + ' language. ' +
                    'Write every word using ONLY English/Roman alphabet letters (transliteration). ' +
                    'NEVER use native script. ' +
                    'Hindi example: write "Aapki fasal achhi hai, paani dete rahein" NOT native script. ' +
                    'Bengali example: write "Aapnar fasal bhalo ache" NOT native script. ' +
                    'Tamil example: write "Ungal payir nalla irukku" NOT native script. ' +
                    'Telugu example: write "Mee panta baagundi" NOT native script. ' +
                    'Apply this rule for ALL languages — Roman letters only, every reply, no exceptions.'
            }, ...chatHistory];
        }

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

    function addBotMsg(text, autoSpeak) {
        const msgs = getMsgs();
        if (!msgs) return;

        const id = 'km_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
        const div = document.createElement('div');
        div.className = 'kw-msg bot';
        div.id = id;
        div.dataset.text = text;

        const formatted = text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>')
            .replace(/•/g, '<span style="color:#4ade80;margin-right:4px;font-weight:700">•</span>');

        div.innerHTML = `
      <div class="kw-msg-avatar">🌾</div>
      <div class="kw-msg-body">
        <div class="kw-bubble">${formatted}</div>
        <div class="kw-msg-footer">
          <button class="kw-speak-btn" id="ksb_${id}" title="Listen">
            <i class="fas fa-volume-up"></i>
          </button>
          <span class="kw-msg-time">${getTime()}</span>
        </div>
      </div>`;

        msgs.appendChild(div);
        scrollBot();

        // Wire speak button
        const btn = document.getElementById('ksb_' + id);
        if (btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (speakingMsgId === id) { stopSpeaking(); return; }
                speakText(text, id, btn);
            });
        }

        if (autoSpeak) speakText(text, id, btn);
    }

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

    /* ── Voice input (chatbot.js style) ─────── */
    window.toggleKisanMic = function() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { alert('Voice input not supported. Please use Chrome or Safari.'); return; }

        if (isRecording) { if (recognition) recognition.stop(); return; }

        const lang = getAppLang();
        recognition = new SR();
        recognition.lang = VOICE_LANGS[lang] || 'hi-IN';
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        const btn = document.getElementById('kisanMicBtn');

        recognition.onstart = () => { isRecording = true; if (btn) { btn.classList.add('recording');
                btn.innerHTML = '<i class="fas fa-stop"></i>'; } };
        recognition.onresult = e => { const t = Array.from(e.results).map(r => r[0].transcript).join(''); if (getInput()) getInput().value = t; };
        recognition.onend = () => {
            isRecording = false;
            if (btn) { btn.classList.remove('recording');
                btn.innerHTML = '<i class="fas fa-microphone"></i>'; }
            const val = getInput() ? getInput().value.trim() : '';
            if (val) sendKisanMessage();
        };
        recognition.onerror = () => {
            isRecording = false;
            if (btn) { btn.classList.remove('recording');
                btn.innerHTML = '<i class="fas fa-microphone"></i>'; }
        };

        try { recognition.start(); } catch (e) { console.error('[KisanMic]', e); }
    };

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