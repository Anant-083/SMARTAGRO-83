/* =========================================================================
   kisan-helper.js
   -------------------------------------------------------------------------
   Same feature set as chatbot.js (toggle widget, welcome message, typing
   indicator, browser TTS with emoji-safe cleanup, browser voice input,
   swipe-down-to-close) but:

     1. Injects its own HTML + CSS (self-contained widget) so it works on
        any page just by adding <script src="kisan-helper.js"></script> —
        no matching HTML block is required in your templates.
     2. Talks to app.py's ACTUAL /api/chat contract:
          request:  { messages: [{role, content}, ...], lang: "hi" }
          response: { reply: "..." }  or  { error: "..." }
        (the old chatbot.js sent {message, weather_context, history}, which
        does not match app.py's kisan_chat() route — that mismatch is fixed
        here.)

   Requires Font Awesome (for icons) to already be loaded on the page, same
   as the original chatbot.js / kisan-helper.js did.
   ========================================================================= */
(function () {

  /* ── Inject HTML ─────────────────────────────────────────────────── */
  document.body.insertAdjacentHTML('beforeend', `
<div id="chatFab" onclick="toggleChat()" title="Chat with SmartAgro">
  <i class="fas fa-microphone"></i>
</div>

<div id="chatOverlay" style="display:none">
  <div id="chatWindow">
    <div class="chat-header">
      <div class="chat-header-left">
        <div class="chat-avatar">🌾</div>
        <div>
          <div class="chat-name">SmartAgro Assistant</div>
          <div class="chat-sub">Ask in any language</div>
        </div>
      </div>
      <div class="chat-header-right">
        <button class="chat-icon-btn" onclick="clearChat()" title="New chat">
          <i class="fas fa-plus"></i>
        </button>
        <button class="chat-icon-btn" onclick="closeChat()" title="Close">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>

    <div class="chat-messages" id="chatMessages"></div>

    <div class="chat-input-bar">
      <button class="chat-mic-btn" id="micBtn" onclick="startVoice()" title="Voice input">
        <i class="fas fa-microphone"></i>
      </button>
      <input type="text" id="chatInput" placeholder="Type or speak..." onkeydown="handleChatKey(event)" />
      <button class="chat-send-btn" onclick="sendMessage()" title="Send">
        <i class="fas fa-paper-plane"></i>
      </button>
    </div>
  </div>
</div>`);

  /* ── Styles ───────────────────────────────────────────────────────── */
  const S = document.createElement('style');
  S.textContent = `
#chatFab {
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
#chatFab:active { transform: scale(1.1); box-shadow: 0 6px 32px rgba(74,222,128,.6); }
#chatFab i { font-size: 1.4rem; color: #fff; pointer-events: none; }
#chatFab.chat-open { background: linear-gradient(135deg, #991b1b, #ef4444); }
#chatFab.listening { background: linear-gradient(135deg, #991b1b, #ef4444); animation: chatMicPulse .8s ease-in-out infinite; }
@keyframes chatMicPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.12)} }

#chatOverlay {
  position: fixed; inset: 0; z-index: 9998;
  background: rgba(0,0,0,.65); backdrop-filter: blur(4px);
  display: flex; align-items: flex-end; justify-content: center;
  opacity: 0; transition: opacity .28s ease;
}
#chatOverlay.open { opacity: 1; }

#chatWindow {
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
#chatOverlay.open #chatWindow { transform: translateY(0); }

.chat-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px;
  background: linear-gradient(135deg, #166534, #15803d);
  flex-shrink: 0;
}
.chat-header-left { display: flex; align-items: center; gap: 10px; }
.chat-avatar {
  width: 38px; height: 38px; border-radius: 50%;
  background: rgba(255,255,255,.15);
  display: flex; align-items: center; justify-content: center;
  font-size: 1.1rem; flex-shrink: 0;
}
.chat-name { font-weight: 700; font-size: .95rem; color: #fff; }
.chat-sub  { font-size: .7rem; color: rgba(255,255,255,.75); }
.chat-header-right { display: flex; align-items: center; gap: 8px; }
.chat-icon-btn {
  background: rgba(255,255,255,.15); border: none; border-radius: 50%;
  width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
  color: #fff; cursor: pointer; font-size: .85rem; transition: background .2s; flex-shrink: 0;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.chat-icon-btn:active { background: rgba(248,113,113,.4); }

.chat-messages {
  flex: 1; overflow-y: auto; padding: 14px 12px;
  display: flex; flex-direction: column; gap: 12px;
  scroll-behavior: smooth;
}
.chat-messages::-webkit-scrollbar { width: 4px; }
.chat-messages::-webkit-scrollbar-thumb { background: rgba(74,222,128,.2); border-radius: 2px; }

.chat-msg { display: flex; gap: 8px; animation: chatMsgIn .2s ease; }
@keyframes chatMsgIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
.chat-msg.bot  { align-self: flex-start; align-items: flex-end; max-width: 88%; }
.chat-msg.user { align-self: flex-end; flex-direction: row-reverse; max-width: 80%; }

.msg-avatar {
  width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
  background: rgba(74,222,128,.1); border: 1px solid rgba(74,222,128,.2);
  display: flex; align-items: center; justify-content: center; font-size: .85rem;
}
.msg-content { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.msg-bubble {
  padding: 10px 13px; border-radius: 16px;
  font-size: .84rem; line-height: 1.6; word-break: break-word;
}
.chat-msg.bot  .msg-bubble {
  background: var(--bg-3, #1a2a1c);
  border: 1px solid rgba(74,222,128,.12);
  color: var(--text, #e8f5e9);
  border-bottom-left-radius: 4px;
}
.chat-msg.user .msg-bubble {
  background: linear-gradient(135deg, #166534, #22c55e);
  color: #fff; border-bottom-right-radius: 4px;
}
.msg-actions { display: flex; align-items: center; gap: 6px; padding: 0 2px; }
.chat-msg.user .msg-actions { justify-content: flex-end; }
.msg-time { font-size: .62rem; color: var(--text-3, #6b8c6d); }
.msg-speak-btn {
  background: none; border: 1px solid rgba(74,222,128,.25); border-radius: 50%;
  width: 26px; height: 26px; min-width: 26px;
  display: flex; align-items: center; justify-content: center;
  color: rgba(74,222,128,.7); cursor: pointer; font-size: .72rem;
  transition: all .18s; flex-shrink: 0;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.msg-speak-btn:active, .msg-speak-btn.speaking {
  background: rgba(74,222,128,.15); border-color: #4ade80; color: #4ade80;
}
.msg-speak-btn.speaking { animation: chatSpeakPulse .9s ease-in-out infinite; }
@keyframes chatSpeakPulse { 0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,.35)} 50%{box-shadow:0 0 0 5px rgba(74,222,128,0)} }

.typing-dots { display: flex; gap: 4px; align-items: center; padding: 4px 0; }
.typing-dots span {
  display: inline-block; width: 7px; height: 7px;
  background: #4ade80; border-radius: 50%; animation: chatDot 1.2s infinite;
}
.typing-dots span:nth-child(2) { animation-delay: .2s; }
.typing-dots span:nth-child(3) { animation-delay: .4s; }
@keyframes chatDot { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-7px)} }

.chat-input-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid rgba(74,222,128,.1);
  background: var(--bg-2, #0e1510);
  flex-shrink: 0;
}
#chatInput {
  flex: 1; background: var(--bg-3, #1a2a1c);
  border: 1px solid rgba(74,222,128,.2); border-radius: 22px;
  padding: 9px 14px; color: var(--text, #e8f5e9);
  font-size: 16px; font-family: inherit; outline: none;
  transition: border-color .2s; min-width: 0;
}
#chatInput:focus { border-color: rgba(74,222,128,.5); }
#chatInput::placeholder { color: rgba(255,255,255,.35); }
.chat-mic-btn, .chat-send-btn {
  width: 42px; height: 42px; border-radius: 50%; border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: .95rem; flex-shrink: 0;
  transition: transform .2s, background .2s;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.chat-mic-btn {
  background: var(--bg-3, #1a2a1c);
  border: 1px solid rgba(74,222,128,.2);
  color: var(--text-2, #a7c4a8);
}
.chat-mic-btn:active { background: rgba(74,222,128,.1); color: #4ade80; }
.chat-mic-btn.listening {
  background: rgba(248,113,113,.15); border-color: #f87171; color: #f87171;
  animation: chatMicP .8s ease-in-out infinite;
}
@keyframes chatMicP { 0%,100%{transform:scale(1)} 50%{transform:scale(1.18)} }
.chat-send-btn {
  background: linear-gradient(135deg, #166534, #22c55e);
  color: #fff; box-shadow: 0 2px 8px rgba(74,222,128,.3);
}
.chat-send-btn:active { transform: scale(1.08); }

body.light-theme #chatWindow   { background: #fff; }
body.light-theme .chat-msg.bot .msg-bubble { background: #f0fdf4; color: #1a2e1c; border-color: rgba(22,101,52,.15); }
body.light-theme .chat-input-bar  { background: #f9fafb; }
body.light-theme #chatInput    { background: #fff; color: #1a2e1c; border-color: rgba(22,101,52,.2); }
body.light-theme #chatInput::placeholder { color: #9ca3af; }
body.light-theme .chat-mic-btn { background: #f0fdf4; color: #374151; border-color: rgba(22,101,52,.2); }
body.light-theme .msg-speak-btn { border-color: rgba(22,101,52,.25); color: rgba(22,101,52,.6); }

@media (max-width: 600px) {
  #chatWindow { border-radius: 16px 16px 0 0; height: min(94vh, 100dvh); }
  #chatFab {
    bottom: calc(16px + env(safe-area-inset-bottom, 0px));
    right: calc(12px + env(safe-area-inset-right, 0px));
    width: 52px; height: 52px;
  }
  .chat-msg.bot  { max-width: 92%; }
  .chat-msg.user { max-width: 88%; }
  .chat-input-bar { padding: 8px 10px; padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)); }
  #chatInput { font-size: 16px; }
  .chat-icon-btn { width: 38px; height: 38px; font-size: .95rem; }
  .chat-mic-btn, .chat-send-btn { width: 46px; height: 46px; }
  .msg-speak-btn { width: 30px; height: 30px; }
}`;
  document.head.appendChild(S);

  /* ── State ────────────────────────────────────────────────────────── */
  let chatOpen        = false;
  let recognition      = null;
  let isListening       = false;
  let chatHistory       = [];   // [{role:'user'|'assistant', content:string}, ...]
  let speakingMsgId     = null;
  let availableVoices   = [];

  const SPEECH_LANGS = {
    'hi':'hi-IN','bn':'bn-IN','ta':'ta-IN','te':'te-IN',
    'mr':'mr-IN','pa':'pa-IN','gu':'gu-IN','kn':'kn-IN',
    'ml':'ml-IN','en':'en-IN'
  };

  function getAppLang() {
    return localStorage.getItem('agrosmart_lang') || 'en';
  }

  function loadVoices() {
    availableVoices = window.speechSynthesis.getVoices();
  }
  if (window.speechSynthesis) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  function getBestVoice(langCode) {
    const speechLang = SPEECH_LANGS[langCode] || 'en-IN';
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

  /* ── Toggle fullscreen ────────────────────────────────────────────── */
  function toggleChat() {
    chatOpen = !chatOpen;
    const overlay = document.getElementById('chatOverlay');
    const fab     = document.getElementById('chatFab');
    if (!overlay) return;

    if (chatOpen) {
      overlay.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      fab.innerHTML = '<i class="fas fa-times"></i>';
      fab.classList.add('chat-open');
      setTimeout(() => overlay.classList.add('open'), 10);
      if (chatHistory.length === 0) showWelcome();
      setTimeout(() => {
        const inp = document.getElementById('chatInput');
        if (inp) inp.focus();
      }, 350);
    } else {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      fab.innerHTML = '<i class="fas fa-microphone"></i>';
      fab.classList.remove('chat-open');
      setTimeout(() => { overlay.style.display = 'none'; }, 280);
      stopSpeaking();
    }
  }

  function closeChat() { if (chatOpen) toggleChat(); }

  function showWelcome() {
    const lang = getAppLang();
    const msgs = {
      hi: 'नमस्ते किसान भाई! मैं SmartAgro सहायक हूं। पूछें:\n• फसल की बीमारी और इलाज\n• आज का मौसम\n• मंडी भाव और MSP\n• सरकारी योजनाएं (PM-KISAN)\n• खाद और कीटनाशक',
      en: 'Hello Farmer! I am SmartAgro Assistant. Ask me:\n• Crop diseases and treatment\n• Weather and farming advice\n• Mandi prices and MSP\n• Government schemes (PM-KISAN)\n• Fertilizers and pesticides',
      bn: 'নমস্কার কৃষক ভাই! আমি SmartAgro সহায়ক। জিজ্ঞাসা করুন:\n• ফসলের রোগ ও চিকিৎসা\n• আজকের আবহাওয়া\n• বাজার মূল্য ও MSP\n• সরকারি প্রকল্প',
      ta: 'வணக்கம்! நான் SmartAgro உதவியாளர். கேளுங்கள்:\n• பயிர் நோய்கள்\n• வானிலை\n• சந்தை விலைகள்\n• அரசு திட்டங்கள்',
      te: 'నమస్కారం! నేను SmartAgro సహాయకుడిని. అడగండి:\n• పంట రోగాలు\n• వాతావరణం\n• మార్కెట్ ధరలు\n• ప్రభుత్వ పథకాలు',
      mr: 'नमस्कार! मी SmartAgro सहाय्यक आहे. विचारा:\n• पीक रोग\n• हवामान\n• बाजारभाव\n• सरकारी योजना',
      pa: 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ SmartAgro ਸਹਾਇਕ ਹਾਂ। ਪੁੱਛੋ:\n• ਫਸਲ ਰੋਗ\n• ਮੌਸਮ\n• ਮੰਡੀ ਭਾਅ\n• ਸਰਕਾਰੀ ਯੋਜਨਾਵਾਂ',
    };
    addBotMsg(msgs[lang] || msgs.en);
  }

  function addBotMsg(text) {
    const list = document.getElementById('chatMessages');
    if (!list) return;
    const id  = 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
    const div = document.createElement('div');
    div.className    = 'chat-msg bot';
    div.id           = id;
    div.dataset.text = text;

    const formatted = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/•/g, '<span style="color:var(--green);margin-right:4px;font-weight:700">•</span>');

    div.innerHTML = `
      <div class="msg-avatar">🌾</div>
      <div class="msg-content">
        <div class="msg-bubble">${formatted}</div>
        <div class="msg-actions">
          <button class="msg-speak-btn" id="speak_${id}" onclick="toggleSpeak('${id}')" title="Listen">
            <i class="fas fa-volume-up"></i>
          </button>
          <span class="msg-time">${getTime()}</span>
        </div>
      </div>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  function addUserMsg(text) {
    const list = document.getElementById('chatMessages');
    if (!list) return;
    const div = document.createElement('div');
    div.className = 'chat-msg user';
    div.innerHTML = `
      <div class="msg-content">
        <div class="msg-bubble">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        <span class="msg-time">${getTime()}</span>
      </div>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  function addTyping() {
    const list = document.getElementById('chatMessages');
    if (!list) return null;
    const div = document.createElement('div');
    div.className = 'chat-msg bot typing-msg';
    div.innerHTML = `
      <div class="msg-avatar">🌾</div>
      <div class="msg-content">
        <div class="msg-bubble">
          <span class="typing-dots"><span></span><span></span><span></span></span>
        </div>
      </div>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
    return div;
  }

  function getTime() {
    return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  /* ── Send message — wired to app.py's real /api/chat contract ───────
     app.py's kisan_chat() route expects:
       { messages: [{role, content}, ...], lang: "hi" }
     and returns { reply } or { error }.                                */
  async function sendMessage() {
    const input = document.getElementById('chatInput');
    const msg   = input?.value.trim();
    if (!msg) return;
    input.value = '';

    addUserMsg(msg);
    chatHistory.push({ role: 'user', content: msg });

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
      const data = await res.json();
      if (typing) typing.remove();

      if (!res.ok || data.error) {
        addBotMsg(data.error || 'Sorry, try again.');
        return;
      }

      const reply = data.reply || 'Sorry, try again.';
      addBotMsg(reply);
      chatHistory.push({ role: 'assistant', content: reply });
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    } catch {
      if (typing) typing.remove();
      addBotMsg('Connection error. Please try again.');
    }
  }

  function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  /* ── Text to Speech — emoji cleaned ──────────────────────────────── */
  function toggleSpeak(msgId) {
    const div = document.getElementById(msgId);
    const btn = document.getElementById('speak_' + msgId);
    if (!div || !btn) return;

    if (speakingMsgId === msgId) { stopSpeaking(); return; }
    stopSpeaking();

    const rawText = div.dataset.text || '';
    const text    = cleanTextForSpeech(rawText);
    if (!text || !window.speechSynthesis) return;

    const lang       = getAppLang();
    const voice      = getBestVoice(lang);
    const speechLang = SPEECH_LANGS[lang] || 'en-IN';

    const utterance  = new SpeechSynthesisUtterance(text);
    utterance.lang   = speechLang;
    utterance.rate   = 0.88;
    utterance.pitch  = 1;
    if (voice) utterance.voice = voice;

    if (!voice && lang !== 'en' && typeof window.showToast === 'function') {
      window.showToast(`No ${lang.toUpperCase()} voice on this device. Using available voice.`, 'warning', 3000);
    }

    utterance.onstart = () => {
      speakingMsgId = msgId;
      btn.innerHTML = '<i class="fas fa-stop"></i>';
      btn.classList.add('speaking');
    };
    utterance.onend = utterance.onerror = () => {
      speakingMsgId = null;
      btn.innerHTML = '<i class="fas fa-volume-up"></i>';
      btn.classList.remove('speaking');
    };

    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (speakingMsgId) {
      const btn = document.getElementById('speak_' + speakingMsgId);
      if (btn) { btn.innerHTML = '<i class="fas fa-volume-up"></i>'; btn.classList.remove('speaking'); }
      speakingMsgId = null;
    }
  }

  /* ── Voice Input (browser SpeechRecognition, same as chatbot.js) ──── */
  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      if (typeof window.showToast === 'function') window.showToast('Voice not supported. Use Chrome browser.', 'error');
      else alert('Voice not supported. Use Chrome browser.');
      return;
    }
    if (isListening) { recognition?.stop(); return; }
    if (!chatOpen) toggleChat();

    const lang       = getAppLang();
    const speechLang = SPEECH_LANGS[lang] || 'en-IN';

    recognition = new SR();
    recognition.lang            = speechLang;
    recognition.interimResults  = false;
    recognition.maxAlternatives = 1;
    recognition.continuous      = false;

    recognition.onstart = () => {
      isListening = true;
      updateMicState(true);
      if (typeof window.showToast === 'function') window.showToast('Listening... speak now', 'success');
    };
    recognition.onresult = e => {
      const t = e.results[0][0].transcript;
      const inp = document.getElementById('chatInput');
      if (inp) inp.value = t;
      sendMessage();
    };
    recognition.onerror = e => {
      isListening = false; updateMicState(false);
      const msg = e.error === 'no-speech' ? 'No speech. Try again.'
                : e.error === 'not-allowed' ? 'Mic access denied.'
                : 'Voice error. Try again.';
      if (typeof window.showToast === 'function') window.showToast(msg, e.error === 'not-allowed' ? 'error' : 'warning');
    };
    recognition.onend = () => { isListening = false; updateMicState(false); };
    try { recognition.start(); } catch {
      if (typeof window.showToast === 'function') window.showToast('Could not start mic.', 'error');
    }
  }

  function updateMicState(listening) {
    const micBtn = document.getElementById('micBtn');
    const fab    = document.getElementById('chatFab');
    if (micBtn) {
      micBtn.classList.toggle('listening', listening);
      micBtn.innerHTML = listening ? '<i class="fas fa-stop"></i>' : '<i class="fas fa-microphone"></i>';
    }
    if (fab && !chatOpen) {
      fab.classList.toggle('listening', listening);
      fab.innerHTML = listening ? '<i class="fas fa-stop"></i>' : '<i class="fas fa-microphone"></i>';
    }
  }

  function clearChat() {
    chatHistory = [];
    const list = document.getElementById('chatMessages');
    if (list) list.innerHTML = '';
    showWelcome();
  }

  /* ── Swipe down to close ─────────────────────────────────────────── */
  let touchStartY = 0;
  document.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!chatOpen) return;
    const win = document.getElementById('chatWindow');
    if (!win) return;
    if (e.touches[0].clientY - touchStartY > 80 && win.contains(e.target)) closeChat();
  }, { passive: true });

  /* ── Expose functions used by inline onclick/onkeydown attributes ── */
  window.toggleChat    = toggleChat;
  window.closeChat     = closeChat;
  window.sendMessage   = sendMessage;
  window.handleChatKey = handleChatKey;
  window.toggleSpeak   = toggleSpeak;
  window.startVoice    = startVoice;
  window.clearChat     = clearChat;

})();