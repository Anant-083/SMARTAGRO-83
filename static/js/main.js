/* ── Navbar scroll effect ───────────────────── */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
}, { passive: true });

/* ── Hamburger ──────────────────────────────── */
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');
if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('open');
        navLinks.classList.toggle('open');
    });
    // Close on nav item click (mobile)
    navLinks.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            hamburger.classList.remove('open');
            navLinks.classList.remove('open');
        });
    });
}

/* ── Toast notification ─────────────────────── */
let toastTimer = null;

function showToast(msg, type = 'success', duration = 3500) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

/* ── Shared weather state ───────────────────── */
window.weatherData = null;

/* ── Geolocation helper ─────────────────────── */
function requestLocation(callback) {
    const btn = document.getElementById('locationBtn') || document.getElementById('alertLocationBtn');
    if (btn) {
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>Getting location...</span>`;
        btn.disabled = true;
    }

    if (!navigator.geolocation) {
        showToast('Geolocation is not supported by your browser.', 'error');
        if (btn) {
            btn.innerHTML = `<i class="fas fa-location-crosshairs"></i> <span>Get My Location</span>`;
            btn.disabled = false;
        }
        return;
    }

    navigator.geolocation.getCurrentPosition(
        position => {
            const { latitude, longitude } = position.coords;
            if (btn) {
                btn.innerHTML = `<i class="fas fa-check"></i> <span>Location Found</span>`;
                btn.style.background = 'linear-gradient(135deg, #166534, #22c55e)';
            }
            showToast('📍 Location detected successfully!', 'success');
            if (typeof callback === 'function') callback(latitude, longitude);
        },
        err => {
            console.error('Geolocation error:', err);
            showToast('Location access denied. Using default location.', 'warning');
            if (btn) {
                btn.innerHTML = `<i class="fas fa-location-crosshairs"></i> <span>Get My Location</span>`;
                btn.disabled = false;
            }
            // Fallback: use Delhi, India as default
            if (typeof callback === 'function') callback(28.6139, 77.2090);
            // To this:
        }, {
            timeout: 15000, // Gives the browser 15 seconds to find a position
            enableHighAccuracy: false, // Desktop browsers fail high accuracy if they lack a GPS chip
            maximumAge: 60000 // Allows utilizing a recently cached location asset
        }
    );
}

/* ── Fetch weather from backend ─────────────── */
async function fetchWeather(lat, lon) {
    try {
        const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
        if (!res.ok) throw new Error('Weather API error');
        const data = await res.json();
        window.weatherData = data;
        return data;
    } catch (err) {
        console.error('fetchWeather error:', err);
        showToast('Could not load weather data.', 'error');
        return null;
    }
}

/* ── Weather icon emoji map ─────────────────── */
function getWeatherEmoji(iconCode) {
    const map = {
        '01d': '☀️',
        '01n': '🌙',
        '02d': '⛅',
        '02n': '⛅',
        '03d': '☁️',
        '03n': '☁️',
        '04d': '☁️',
        '04n': '☁️',
        '09d': '🌧️',
        '09n': '🌧️',
        '10d': '🌦️',
        '10n': '🌧️',
        '11d': '⛈️',
        '11n': '⛈️',
        '13d': '❄️',
        '13n': '❄️',
        '50d': '🌫️',
        '50n': '🌫️',
    };
    return map[iconCode] || '🌤️';
}

/* ── Format day name ────────────────────────── */
function getDayName(dateStr, short = true) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d = new Date(dateStr);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Today';
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return short ? shortDays[d.getDay()] : days[d.getDay()];
}

/* ── Capitalize ─────────────────────────────── */
function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

/* ── Animate counter ────────────────────────── */
function animateCounter(el, target, duration = 800, suffix = '') {
    if (!el) return;
    const start = 0;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(start + (target - start) * eased);
        el.textContent = current + suffix;
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

/* ── Intersection Observer for animations ───── */
function observeAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.animationPlayState = 'running';
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.crop-card, .forecast-card, .timeline-item, .alert-card, .city-card').forEach(el => {
        el.style.animationPlayState = 'paused';
        observer.observe(el);
    });
}

/* ── Ripple effect on buttons ───────────────── */
document.addEventListener('click', e => {
    const btn = e.target.closest('.btn-primary, .btn-secondary, .btn-analyze, .chart-tab, .alert-tab, .chip');
    if (!btn) return;
    const ripple = document.createElement('span');
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.cssText = `
    position:absolute; border-radius:50%;
    width:${size}px; height:${size}px;
    left:${e.clientX - rect.left - size/2}px;
    top:${e.clientY - rect.top - size/2}px;
    background:rgba(255,255,255,0.18);
    transform:scale(0); animation:ripple 0.55s linear;
    pointer-events:none;
  `;
    if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
    btn.style.overflow = 'hidden';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
});

// Ripple keyframe injection
const styleTag = document.createElement('style');
styleTag.textContent = `@keyframes ripple { to { transform: scale(2.5); opacity: 0; } }`;
document.head.appendChild(styleTag);

/* ── Update alert badge in navbar ───────────── */
function updateAlertBadge(count) {
    const badge = document.getElementById('alertBadge');
    if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
}

/* ── On page load: restore badge from session ── */
document.addEventListener('DOMContentLoaded', () => {
    const saved = sessionStorage.getItem('alert_count');
    if (saved) updateAlertBadge(parseInt(saved));
    observeAnimations();

    // ── Restore saved language and notify diagnose.js ──
    const savedLang = localStorage.getItem('smartagro_lang') || 'en';
    window.currentLang = savedLang;
    if (savedLang !== 'en') {
        document.dispatchEvent(new CustomEvent('langChanged', { detail: { lang: savedLang } }));
    }

    // ── Close lang dropdown on outside tap (mobile) ──
    document.addEventListener('click', e => {
        const sel = document.querySelector('.lang-selector');
        if (sel && !sel.contains(e.target)) {
            sel.classList.remove('open');
        }
    });
    /* ── Day / Night Theme Toggle ───────────────────────── */
    (function initTheme() {
        const btn = document.getElementById('themeToggle');
        const icon = document.getElementById('themeIcon');
        const saved = localStorage.getItem('smartagro_theme');

        function applyTheme(mode) {
            if (mode === 'light') {
                document.body.classList.add('light-theme');
                if (icon) {
                    icon.classList.remove('fa-moon');
                    icon.classList.add('fa-sun');
                }
            } else {
                document.body.classList.remove('light-theme');
                if (icon) {
                    icon.classList.remove('fa-sun');
                    icon.classList.add('fa-moon');
                }
            }
            localStorage.setItem('smartagro_theme', mode);
        }

        // Restore saved preference on load
        applyTheme(saved === 'light' ? 'light' : 'dark');

        if (btn) {
            btn.addEventListener('click', () => {
                const isLight = document.body.classList.contains('light-theme');
                applyTheme(isLight ? 'dark' : 'light');
            });
        }
    })();
});
/* ── PWA Service Worker Registration ───────── */

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/static/service-worker.js')
            .then(reg => {
                console.log('SmartAgro SW registered:', reg.scope);
                subscribeToPush(reg);
            })
            .catch(err => console.error('SW registration failed:', err));
    });
}

/* ── Push notification subscribe flow ───────── */
async function subscribeToPush(reg) {
    if (!('PushManager' in window)) {
        console.log('[Push] Not supported on this browser.');
        return;
    }

    // Ask permission only once — don't nag the farmer on every visit.
    if (localStorage.getItem('agrosmart_push_asked')) return;

    try {
        const permission = await Notification.requestPermission();
        localStorage.setItem('agrosmart_push_asked', '1');
        if (permission !== 'granted') {
            console.log('[Push] Permission denied.');
            return;
        }

        const keyRes = await fetch('/api/vapid-public-key');
        const { key } = await keyRes.json();
        if (!key) { console.log('[Push] No VAPID key configured on server.'); return; }

        const subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key),
        });

        await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription),
        });

        console.log('[Push] Subscribed successfully.');
    } catch (e) {
        console.log('[Push] Setup failed:', e);
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
}
/* ══════════════════════════════════════════════
   INSTALL APP — works on desktop & mobile,
   available from the navbar on every page.
══════════════════════════════════════════════ */
let deferredInstallPrompt = null;

function isAppStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true; // iOS Safari flag
}

function isIosDevice() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

function ensureInstallModalStyles() {
    // Styles live in main.css (.install-modal-*); nothing to inject here,
    // this hook exists in case the page loads main.js before main.css.
}

function showInstallModal({ icon, title, steps, note }) {
    let overlay = document.getElementById('installModalOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'installModalOverlay';
        overlay.className = 'install-modal-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) hideInstallModal(); });
    }
    overlay.innerHTML = `
      <div class="install-modal-box">
        <div class="install-modal-icon"><i class="fas ${icon}"></i></div>
        <h3>${title}</h3>
        <ul class="install-modal-steps">
          ${steps.map((s, i) => `<li><span class="ims-num">${i + 1}</span><span>${s}</span></li>`).join('')}
        </ul>
        ${note ? `<p class="install-modal-note">${note}</p>` : ''}
        <button class="install-modal-close" onclick="hideInstallModal()">Got it</button>
      </div>`;
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

function hideInstallModal() {
    const overlay = document.getElementById('installModalOverlay');
    if (overlay) overlay.classList.remove('visible');
}

// Chrome/Edge/Android fire this when the app is installable.
// We stash the event so it can be triggered later from our own button
// instead of the browser's own mini-infobar.
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    showToast('✅ SmartAgro installed on your device!', 'success');
    const btn = document.getElementById('installBtn');
    if (btn) btn.style.display = 'none';
});

function setupInstallButton() {
    const btn = document.getElementById('installBtn');
    if (!btn) return;

    // Already running as an installed app — nothing to offer.
    if (isAppStandalone()) {
        btn.style.display = 'none';
        return;
    }

    btn.addEventListener('click', async () => {
        // Case 1: browser has a native install prompt ready (Chrome/Edge,
        // desktop or Android).
        if (deferredInstallPrompt) {
            btn.disabled = true;
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            if (outcome !== 'accepted') {
                showToast('Installation cancelled.', 'warning');
            }
            deferredInstallPrompt = null;
            btn.disabled = false;
            return;
        }

        // Case 2: iOS Safari has no install prompt API — show manual steps.
        if (isIosDevice()) {
            showInstallModal({
                icon: 'fa-share-from-square',
                title: 'Install SmartAgro on iPhone/iPad',
                steps: [
                    'Tap the <strong>Share</strong> icon in Safari\'s toolbar.',
                    'Scroll down and tap <strong>Add to Home Screen</strong>.',
                    'Tap <strong>Add</strong> in the top-right corner.'
                ],
                note: 'SmartAgro will then open full-screen from your Home Screen, just like a native app.'
            });
            return;
        }

        // Case 3: Desktop/Android browser without beforeinstallprompt
        // support yet (e.g. Firefox), or the prompt hasn't fired.
        showInstallModal({
            icon: 'fa-circle-info',
            title: 'Install SmartAgro',
            steps: [
                'Open this site in <strong>Chrome</strong> or <strong>Edge</strong> for one-tap install.',
                'Or use your browser\'s menu (⋮ or Share) and look for <strong>Install App</strong> / <strong>Add to Home Screen</strong>.'
            ],
            note: 'Install support depends on your browser.'
        });
    });
}

document.addEventListener('DOMContentLoaded', setupInstallButton);
