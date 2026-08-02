/* ── Dashboard Translation State ─────────────── */
window._dashTrans = {}; // holds current translations
window._lastCropData = null; // cache last API response for re-render
window._dashTranslateInProgress = false; // guards against overlapping requests

function dt(key) {
    return window._dashTrans[key] || key;
}

/* ── Native names shown in the "Translating to…" overlay ───── */
const DASH_LANG_DISPLAY_NAMES = {
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
    sat: 'ᱥᱟᱱᱛᱟᱲᱤ',
    ks: 'کٲشُر',
    ne: 'नेपाली',
    sd: 'سنڌي',
    kok: 'कोंकणी',
    mni: 'মৈতৈলোন্',
    bodo: 'बड़ो',
    doi: 'डोगरी',
    sa: 'संस्कृत',
    en: 'English',
};

/* ── Buffering / loading overlay for slow first-time translations ─────
   Translation calls an LLM on the backend and can take several seconds
   the first time a language is requested (subsequent switches hit the
   server-side cache and are fast). This overlay gives clear feedback
   instead of leaving the page looking stuck. ────────────────────────── */
function ensureDashTranslateOverlayStyles() {
    if (document.getElementById('dashTranslateOverlayStyle')) return;
    const style = document.createElement('style');
    style.id = 'dashTranslateOverlayStyle';
    style.textContent = `
    .dash-translate-overlay {
        position: fixed; inset: 0; z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        background: rgba(10, 16, 12, 0.55);
        backdrop-filter: blur(3px);
        opacity: 0; pointer-events: none;
        transition: opacity 0.2s ease;
    }
    .dash-translate-overlay.visible { opacity: 1; pointer-events: all; }
    .dash-translate-box {
        background: var(--bg-1, #102013);
        border: 1px solid var(--green, #4ade80);
        border-radius: 16px;
        padding: 28px 32px;
        max-width: 320px;
        text-align: center;
        box-shadow: 0 10px 40px rgba(0,0,0,0.35);
        animation: dashTransPopIn 0.25s ease;
    }
    @keyframes dashTransPopIn {
        from { transform: scale(0.92); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
    }
    .dash-translate-spinner {
        width: 38px; height: 38px; margin: 0 auto 14px;
        border: 3px solid rgba(74, 222, 128, 0.25);
        border-top-color: var(--green, #4ade80);
        border-radius: 50%;
        animation: dashTransSpin 0.8s linear infinite;
    }
    @keyframes dashTransSpin { to { transform: rotate(360deg); } }
    .dash-translate-title {
        color: var(--text-1, #f1f5f1);
        font-weight: 600; font-size: 0.95rem; margin-bottom: 6px;
    }
    .dash-translate-sub {
        color: var(--text-3, #94a3a0);
        font-size: 0.78rem; line-height: 1.4;
    }
    .dash-translate-dots span {
        display: inline-block; opacity: 0.3;
        animation: dashTransDot 1.2s infinite;
    }
    .dash-translate-dots span:nth-child(2) { animation-delay: 0.2s; }
    .dash-translate-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes dashTransDot { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
    `;
    document.head.appendChild(style);
}

function showDashTranslateOverlay(langCode) {
    ensureDashTranslateOverlayStyles();
    let overlay = document.getElementById('dashTranslateOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'dashTranslateOverlay';
        overlay.className = 'dash-translate-overlay';
        document.body.appendChild(overlay);
    }
    const name = DASH_LANG_DISPLAY_NAMES[langCode] || langCode.toUpperCase();
    overlay.innerHTML = `
      <div class="dash-translate-box">
        <div class="dash-translate-spinner"></div>
        <div class="dash-translate-title">Translating to ${name}<span class="dash-translate-dots"><span>.</span><span>.</span><span>.</span></span></div>
        <div class="dash-translate-sub">First-time translation can take a few seconds. It'll be instant after this.</div>
      </div>`;
    // requestAnimationFrame so the transition actually animates in
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

function hideDashTranslateOverlay() {
    const overlay = document.getElementById('dashTranslateOverlay');
    if (overlay) overlay.classList.remove('visible');
}

async function applyDashboardLanguage(langCode) {
    if (window._dashTranslateInProgress) return; // ignore overlapping requests

    if (langCode === 'en') {
        window._dashTrans = {};
        retranslateStaticUI();
        if (window._lastCropData) {
            renderCrops(window._lastCropData);
            renderCalendar(window._lastCropData.calendar);
            renderPesticides(window._lastCropData.pesticides);
            const label = document.getElementById('seasonLabel');
            if (label && window._lastCropData.season) {
                label.textContent = `${dt('Season')}: ${dt(window._lastCropData.season)}`;
            }
        }
        return;
    }

    window._dashTranslateInProgress = true;
    showDashTranslateOverlay(langCode);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // generous — first-time calls can be slow

    try {
        const res = await fetch('/api/translate-dashboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lang: langCode }),
            signal: controller.signal,
        });
        const data = await res.json();
        if (data && data.translations && Object.keys(data.translations).length) {
            window._dashTrans = data.translations;
            showToast(`Dashboard translated to ${DASH_LANG_DISPLAY_NAMES[langCode] || langCode}`, 'success');
        } else {
            window._dashTrans = {};
            showToast('Translation is unavailable right now — showing English instead.', 'warning');
        }
    } catch (e) {
        console.error('Dashboard translation failed:', e);
        window._dashTrans = {};
        const msg = e && e.name === 'AbortError' ?
            'Translation took too long — showing English instead.' :
            'Translation failed — showing English instead.';
        showToast(msg, 'error');
    } finally {
        clearTimeout(timeoutId);
        hideDashTranslateOverlay();
        window._dashTranslateInProgress = false;
    }

    // Re-render everything with new language
    retranslateStaticUI();
    if (window._lastCropData) {
        renderCrops(window._lastCropData);
        renderCalendar(window._lastCropData.calendar);
        renderPesticides(window._lastCropData.pesticides);
        const label = document.getElementById('seasonLabel');
        if (label && window._lastCropData.season) {
            label.textContent = `${dt('Season')}: ${dt(window._lastCropData.season)}`;
        }
    }
}

function retranslateStaticUI() {
    // Section headers
    const map = {
        'section_weather': 'Current Weather Conditions',
        'section_weather_sub': 'Live data from your location',
        'forecast_title': '6-Day Forecast',
        'stat_temp': 'Temperature',
        'stat_humidity': 'Humidity',
        'stat_wind': 'Wind',
        'stat_visibility': 'Visibility',
        'stat_pressure': 'Pressure',
        'section_crops': 'Crop Recommendations',
        'section_crops_sub': 'Based on your climate & location',
        'section_advisory': 'Crop Advisory Calendar',
        'section_advisory_sub': 'Week-by-week action plan for your crops',
        'section_pest': 'Pesticide & Pest Control Guide',
        'section_pest_sub': 'Safe and effective crop protection plan',
        'section_quick': 'Quick Actions',
        'quick_diagnose': 'Diagnose Crop Disease',
        'quick_diagnose_sub': 'Upload or take a photo of your crop',
        'quick_market': 'Check Market Prices',
        'quick_market_sub': 'Live mandi prices across India',
        'quick_alerts': 'View Active Alerts',
        'quick_alerts_sub': 'Weather & pest warnings for your area',
        'footer_text': 'Empowering farmers with AI-driven precision agriculture',
    };
    Object.entries(map).forEach(([key, engVal]) => {
        const el = document.querySelector(`[data-translate="${key}"]`);
        if (el) el.textContent = dt(engVal);
    });
    // Stat labels
    document.querySelectorAll('.stat-label[data-translate]').forEach(el => {
        const key = el.getAttribute('data-translate');
        if (map[key]) el.textContent = dt(map[key]);
    });
}
/* ── Entry point: Get Location ──────────────── */
function requestLocation() {
    window.requestLocation = window.requestLocation || (() => {});
    // Call the shared helper from main.js
    if (typeof window.requestLocation === 'function') {
        // already defined in main.js, call it with our callback
    }
    // Use navigator directly here for dashboard
    const btn = document.getElementById('locationBtn');
    if (btn) {
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>Getting location...</span>`;
        btn.disabled = true;
    }

    if (!navigator.geolocation) {
        showToast('Geolocation not supported. Using default location.', 'warning');
        loadWeatherAndCrops(28.6139, 77.2090); // Delhi fallback
        return;
    }

    navigator.geolocation.getCurrentPosition(
        pos => {
            showToast('📍 Location detected!', 'success');
            if (btn) {
                btn.innerHTML = `<i class="fas fa-check"></i> <span>Location Found</span>`;
                btn.style.background = 'linear-gradient(135deg,#166534,#22c55e)';
            }
            loadWeatherAndCrops(pos.coords.latitude, pos.coords.longitude);
        },
        () => {
            showToast('Using default location (Delhi).', 'warning');
            if (btn) {
                btn.innerHTML = `<i class="fas fa-location-crosshairs"></i> <span>Get My Location</span>`;
                btn.disabled = false;
            }
            loadWeatherAndCrops(28.6139, 77.2090);
            // To this:
        }, {
            timeout: 15000, // Gives the browser 15 seconds to find a position
            enableHighAccuracy: false, // Desktop browsers fail high accuracy if they lack a GPS chip
            maximumAge: 60000 // Allows utilizing a recently cached location asset
        }
    );
}

/* ── Load weather then crops ────────────────── */
async function loadWeatherAndCrops(lat, lon) {
    showHeroLoading();
    const data = await fetchWeather(lat, lon);
    if (!data) return;

    renderHeroCard(data.current);
    renderWeatherSection(data.current, data.forecast);
    renderStatBar(data.current);
    renderLocationMap(lat, lon);
    loadSowingCheck(lat, lon);
    loadCropRecommendations(data.current);
}
/* ── Hero weather card ──────────────────────── */
function showHeroLoading() {
    const card = document.getElementById('heroWeatherCard');
    if (card) card.innerHTML = `
    <div class="hwc-loading">
      <div class="loading-spinner" style="width:32px;height:32px;margin:0 auto 8px;"></div>
      <span style="color:var(--text-2);font-size:0.85rem">Fetching weather...</span>
    </div>`;
}

function renderHeroCard(w) {
    const card = document.getElementById('heroWeatherCard');
    if (!card) return;
    card.innerHTML = `
    <div class="hwc-loaded">
      <div class="hwc-city">
        <i class="fas fa-location-dot" style="color:var(--green)"></i> ${w.city}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div class="hwc-temp">${w.temp}°</div>
          <div class="hwc-desc">${capitalize(w.description)}</div>
        </div>
        <div class="hwc-icon-large">${getWeatherEmoji(w.icon)}</div>
      </div>
      <div class="hwc-stats">
        <div class="hwc-stat"><i class="fas fa-droplets"></i> ${w.humidity}% Humidity</div>
        <div class="hwc-stat"><i class="fas fa-wind"></i> ${w.wind_speed} m/s Wind</div>
        <div class="hwc-stat"><i class="fas fa-temperature-half"></i> Feels ${w.feels_like}°C</div>
        <div class="hwc-stat"><i class="fas fa-gauge-high"></i> ${w.pressure} hPa</div>
      </div>
    </div>`;
    card.style.animation = 'fadeInUp 0.5s ease';
}

/* ── Full weather section ───────────────────── */
function renderWeatherSection(current, forecast) {
    const section = document.getElementById('weatherSection');
    if (section) section.style.display = '';

    const mainEl = document.getElementById('weatherMain');
    if (mainEl) {
        mainEl.innerHTML = `
      <!-- Primary card -->
      <div class="weather-primary-card">
        <div>
          <div style="font-size:4.5rem;line-height:1">${getWeatherEmoji(current.icon)}</div>
        </div>
        <div>
          <div class="wpc-temp">${current.temp}°C</div>
          <div class="wpc-city"><i class="fas fa-location-dot" style="color:var(--green);margin-right:4px"></i>${current.city}</div>
          <div class="wpc-desc">${capitalize(current.description)}</div>
          <div class="wpc-feels">Feels like ${current.feels_like}°C</div>
        </div>
      </div>
      <!-- Stat cards -->
      <div class="weather-stat-card">
        <div class="wsc-icon"><i class="fas fa-droplets"></i></div>
        <div class="wsc-label">Humidity</div>
        <div class="wsc-val">${current.humidity}<span class="wsc-unit">%</span></div>
        <div style="margin-top:auto">
          ${getHumidityBar(current.humidity)}
        </div>
      </div>
      <div class="weather-stat-card">
        <div class="wsc-icon"><i class="fas fa-wind"></i></div>
        <div class="wsc-label">Wind Speed</div>
        <div class="wsc-val">${current.wind_speed}<span class="wsc-unit"> m/s</span></div>
        <div style="font-size:0.75rem;color:var(--text-3);margin-top:4px">${getWindDesc(current.wind_speed)}</div>
      </div>
      <div class="weather-stat-card">
        <div class="wsc-icon"><i class="fas fa-gauge-high"></i></div>
        <div class="wsc-label">Pressure</div>
        <div class="wsc-val">${current.pressure}<span class="wsc-unit"> hPa</span></div>
      </div>
      <div class="weather-stat-card">
        <div class="wsc-icon"><i class="fas fa-eye"></i></div>
        <div class="wsc-label">Visibility</div>
        <div class="wsc-val">${current.visibility.toFixed(1)}<span class="wsc-unit"> km</span></div>
      </div>
    `;
    }

    // 7-day forecast
    const forecastGrid = document.getElementById('forecastGrid');
    if (forecastGrid && forecast) {
        const todayStr = new Date().toISOString().split('T')[0];
        forecastGrid.innerHTML = forecast.map((day, i) => `
      <div class="forecast-card ${day.date === todayStr ? 'today' : ''}" style="animation-delay:${i * 0.06}s">
        <div class="fc-day">${getDayName(day.date)}</div>
        <div class="fc-icon">${getWeatherEmoji(day.icon)}</div>
        <div class="fc-desc">${capitalize(day.description)}</div>
        <div class="fc-temps">
          <span class="fc-max">${Math.round(day.temp_max)}°</span>
          <span class="fc-min">${Math.round(day.temp_min)}°</span>
        </div>
        <div style="font-size:0.68rem;color:var(--text-3);margin-top:4px">
          <i class="fas fa-droplets" style="color:#38bdf8"></i> ${day.humidity}%
        </div>
      </div>
    `).join('');
    }
}

function getHumidityBar(h) {
    const pct = Math.min(100, h);
    const color = h > 80 ? '#38bdf8' : h > 60 ? 'var(--green)' : 'var(--amber)';
    return `
    <div style="height:4px;background:var(--bg-2);border-radius:2px;overflow:hidden;margin-top:8px">
      <div style="height:100%;width:${pct}%;background:${color};border-radius:2px;transition:width 1s ease"></div>
    </div>`;
}

function getWindDesc(speed) {
    if (speed < 1) return 'Calm';
    if (speed < 6) return 'Light breeze';
    if (speed < 14) return 'Moderate breeze';
    if (speed < 25) return 'Strong breeze';
    return 'Storm warning';
}

/* ── Stats bar ──────────────────────────────── */
function renderStatBar(w) {
    const bar = document.getElementById('statsBar');
    if (bar) bar.style.display = '';

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    setVal('statTemp', `${w.temp}°C`);
    setVal('statHumidity', `${w.humidity}%`);
    setVal('statWind', `${w.wind_speed} m/s`);
    setVal('statVisibility', `${w.visibility.toFixed(1)} km`);
    setVal('statPressure', `${w.pressure} hPa`);
}
/* ── Location map (Leaflet, no API key needed) ─ */
let _locationMapInstance = null;
function renderLocationMap(lat, lon) {
    const el = document.getElementById('locationMap');
    if (!el || typeof L === 'undefined') return;

    if (_locationMapInstance) {
        _locationMapInstance.setView([lat, lon], 12);
        _locationMapInstance.eachLayer(layer => {
            if (layer instanceof L.Marker) _locationMapInstance.removeLayer(layer);
        });
    } else {
        _locationMapInstance = L.map('locationMap').setView([lat, lon], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 18,
        }).addTo(_locationMapInstance);
    }
    L.marker([lat, lon]).addTo(_locationMapInstance)
        .bindPopup(dt('Your farm location')).openPopup();
}

/* ── NASA POWER climate normals card ───────────── */
function renderClimateNormals(power) {
    const card = document.getElementById('climateNormalsCard');
    if (!card) return;
    if (!power || power.avg_temp_c === null || power.avg_temp_c === undefined) {
        card.style.display = 'none';
        return;
    }
    card.style.display = '';
    card.innerHTML = `
      <h4><i class="fas fa-satellite"></i> ${dt('Typical Climate for Your Area')} <span style="font-weight:400;font-size:0.75rem;color:var(--text-3)">(NASA POWER, long-term average)</span></h4>
      <div class="climate-normals-row">
        <div><i class="fas fa-temperature-half"></i> ${dt('Avg Temp')}: ${power.avg_temp_c}°C</div>
        <div><i class="fas fa-droplets"></i> ${dt('Avg Rainfall')}: ${power.avg_rain_mm} mm/day</div>
        <div><i class="fas fa-water"></i> ${dt('Avg Humidity')}: ${power.avg_humidity}%</div>
      </div>`;
}

/* ── Sowing Safety Check ────────────────────────── */
async function loadSowingCheck(lat, lon) {
    const card = document.getElementById('sowingCheckCard');
    if (!card) return;
    card.style.display = '';
    card.innerHTML = `<div class="loading-spinner" style="width:24px;height:24px;"></div>`;
    try {
        const res = await fetch(`/api/sowing-check?lat=${lat}&lon=${lon}`);
        const data = await res.json();
        if (data.error) { card.style.display = 'none'; return; }

        const safe = data.verdict === 'safe';
        card.innerHTML = `
          <div class="sowing-verdict ${safe ? 'safe' : 'unsafe'}">
            <i class="fas ${safe ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i>
            <div>
              <strong>${safe ? dt('Good conditions for sowing') : dt('Hold off on sowing')}</strong>
              <p>${dt(data.message)}</p>
            </div>
          </div>`;
    } catch (err) {
        console.error('Sowing check error:', err);
        card.style.display = 'none';
    }
}
/* ── Crop Recommendations ───────────────────── */
/* ── Crop Recommendations ───────────────────── */
let _lastWeatherCurrent = null;

function getSoilFormValues() {
    const val = id => {
        const el = document.getElementById(id);
        return el && el.value !== '' ? el.value : null;
    };
    return {
        n: val('soilN'), p: val('soilP'), k: val('soilK'), ph: val('soilPh'),
        land_size: val('landSize'), land_unit: (document.getElementById('landUnit') || {}).value || 'acre',
    };
}

async function loadCropRecommendations(current) {
    _lastWeatherCurrent = current;
    const soil = getSoilFormValues();
    try {
        const res = await fetch('/api/crop-recommendations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                temp: current.temp,
                humidity: current.humidity,
                rain: current.rain || 0,
                city: current.city,
                lat: current.lat,
                lon: current.lon,
                n: soil.n, p: soil.p, k: soil.k, ph: soil.ph,
                land_size: soil.land_size, land_unit: soil.land_unit,
            })
        });
        const data = await res.json();
        window._lastCropData = data; // cache for re-render on language change
        renderCrops(data);
        renderCalendar(data.calendar);
        renderPesticides(data.pesticides);
        renderClimateNormals(data.power_climate);

        const label = document.getElementById('seasonLabel');
        if (label) label.textContent = `${dt('Season')}: ${dt(data.season)} — ${current.city}`;
    } catch (err) {
        console.error('Crop API error:', err);
        showToast('Could not load crop recommendations.', 'error');
    }
}

/* ── Soil form toggle + submit ──────────────── */
document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('soilFormToggle');
    const body = document.getElementById('soilFormBody');
    if (toggle && body) {
        toggle.addEventListener('click', () => {
            body.style.display = body.style.display === 'none' ? '' : 'none';
        });
    }
    const submitBtn = document.getElementById('soilFormSubmit');
    if (submitBtn) {
        submitBtn.addEventListener('click', () => {
            if (_lastWeatherCurrent) loadCropRecommendations(_lastWeatherCurrent);
            else showToast('Please get your location first.', 'warning');
        });
    }
});

/* ── Render crop cards ──────────────────────── */
function renderCrops(data) {
    const section = document.getElementById('cropSection');
    const grid = document.getElementById('cropsGrid');
    if (!section || !grid) return;
    section.style.display = '';

    const crops = data.crops || [];
    grid.innerHTML = crops.map((crop, i) => `
    <div class="crop-card" style="animation-delay:${i * 0.07}s">
      <div class="crop-card-top">
        <div class="crop-emoji">${crop.icon}</div>
        <div class="crop-match-badge">
          <i class="fas fa-check-circle"></i> ${crop.match} ${dt('Match')}
        </div>
      </div>
      <div class="crop-name">${dt(crop.name)}</div>
      <div class="crop-desc">${dt(crop.description)}</div>
      <div class="crop-meta">
        <div class="cm-item">
          <span class="cm-label">${dt('Season')}</span>
          <span class="cm-val">${dt(crop.season.split(' ')[0])}</span>
        </div>
        <div class="cm-item">
          <span class="cm-label">${dt('Water Need')}</span>
          <span class="cm-val">${dt(crop.water)}</span>
        </div>
        <div class="cm-item">
          <span class="cm-label">${dt('Expected Yield')}</span>
          <span class="cm-val">${crop.yield}</span>
        </div>
        <div class="cm-item">
          <span class="cm-label">${dt('Duration')}</span>
          <span class="cm-val">${crop.duration}</span>
        </div>
        <div class="cm-item">
          <span class="cm-label">${dt('Soil Type')}</span>
          <span class="cm-val">${dt(crop.soil)}</span>
        </div>
        <div class="cm-item">
          <span class="cm-label">${dt('Fertilizer')}</span>
          <span class="cm-val">${crop.fertilizer}</span>
        </div>
      </div>
      <div class="crop-profit">
        <i class="fas fa-indian-rupee-sign"></i>
        ${dt('Estimated Profit')}: ${crop.profit}
      </div>
    </div>
  `).join('');

    setTimeout(() => observeAnimations(), 100);
}

/* ── Render advisory calendar ───────────────── */
function renderCalendar(calendar) {
    const section = document.getElementById('advisorySection');
    const timeline = document.getElementById('calendarTimeline');
    if (!section || !timeline) return;
    section.style.display = '';

    timeline.innerHTML = calendar.map((item, i) => `
    <div class="timeline-item" style="animation-delay:${i * 0.05}s">
      <div class="timeline-dot ${item.type}"></div>
      <div class="timeline-card">
        <div class="tc-date">
          <span>${item.date}</span>
          <span class="tc-week">${dt('Week')} ${item.week}</span>
        </div>
        <div class="tc-activity">
          <i class="${getActivityIcon(item.type)}" style="margin-right:6px;color:${getActivityColor(item.type)}"></i>
          ${dt(item.activity)}
        </div>
        <span class="tc-type ${item.type}">${dt(item.type)}</span>
      </div>
    </div>
  `).join('');
}

function getActivityIcon(type) {
    const icons = {
        preparation: 'fas fa-shovel',
        sowing: 'fas fa-seedling',
        irrigation: 'fas fa-faucet-drip',
        fertilizer: 'fas fa-flask',
        maintenance: 'fas fa-scissors',
        pesticide: 'fas fa-spray-can-sparkles',
        harvest: 'fas fa-wheat-awn',
    };
    return icons[type] || 'fas fa-circle';
}

function getActivityColor(type) {
    const colors = {
        preparation: 'var(--teal)',
        sowing: 'var(--green)',
        irrigation: '#38bdf8',
        fertilizer: 'var(--amber)',
        maintenance: 'var(--green-2)',
        pesticide: 'var(--red)',
        harvest: '#a78bfa',
    };
    return colors[type] || 'var(--text-3)';
}

/* ── Render pesticide guide ─────────────────── */
function renderPesticides(pesticides) {
    const section = document.getElementById('pestSection');
    const cards = document.getElementById('pestCards');
    if (!section || !cards || !pesticides || pesticides.length === 0) return;
    section.style.display = '';

    cards.innerHTML = pesticides.map(p => `
    <div class="pest-crop-card">
      <div class="pcc-header">
        <span>🌾</span> ${dt(p.crop)} — ${dt('Pest Control Plan')}
      </div>
      <div class="pcc-items">
        ${p.guides.map(g => `
          <div class="pcc-item">
            <div class="pcc-pest"><i class="fas fa-bug" style="color:var(--amber);margin-right:6px"></i>${dt(g.pest)}</div>
            <div class="pcc-meta">
              <span><i class="fas fa-flask"></i> ${g.pesticide}</span>
              <span><i class="fas fa-scale-balanced"></i> ${g.dose}</span>
            </div>
            <div style="font-size:0.75rem;color:var(--text-3);margin-top:4px">
              <i class="fas fa-clock"></i> ${dt('Timing')}: ${g.timing}
            </div>
            <div class="pcc-eco eco-${g.eco}">
              ${g.eco
                ? `<i class="fas fa-leaf"></i> ${dt('Eco-Friendly')}`
                : `<i class="fas fa-flask"></i> ${dt('Chemical')}`}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}
