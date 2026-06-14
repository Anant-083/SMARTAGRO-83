/* ═══════════════════════════════════════════════
   dashboard.js — index page logic
   Handles: location → weather → crops → calendar
═══════════════════════════════════════════════ */

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

/* ── Crop Recommendations ───────────────────── */
async function loadCropRecommendations(current) {
    try {
        const res = await fetch('/api/crop-recommendations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                temp: current.temp,
                humidity: current.humidity,
                rain: current.rain || 0,
                city: current.city,
            })
        });
        const data = await res.json();
        renderCrops(data);
        renderCalendar(data.calendar);
        renderPesticides(data.pesticides);

        // Update season label
        const label = document.getElementById('seasonLabel');
        if (label) label.textContent = `Season: ${data.season} — ${current.city}`;
    } catch (err) {
        console.error('Crop API error:', err);
        showToast('Could not load crop recommendations.', 'error');
    }
}

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
          <i class="fas fa-check-circle"></i> ${crop.match} Match
        </div>
      </div>
      <div class="crop-name">${crop.name}</div>
      <div class="crop-desc">${crop.description}</div>
      <div class="crop-meta">
        <div class="cm-item">
          <span class="cm-label">Season</span>
          <span class="cm-val">${crop.season.split(' ')[0]}</span>
        </div>
        <div class="cm-item">
          <span class="cm-label">Water Need</span>
          <span class="cm-val">${crop.water}</span>
        </div>
        <div class="cm-item">
          <span class="cm-label">Expected Yield</span>
          <span class="cm-val">${crop.yield}</span>
        </div>
        <div class="cm-item">
          <span class="cm-label">Duration</span>
          <span class="cm-val">${crop.duration}</span>
        </div>
        <div class="cm-item">
          <span class="cm-label">Soil Type</span>
          <span class="cm-val">${crop.soil}</span>
        </div>
        <div class="cm-item">
          <span class="cm-label">Fertilizer</span>
          <span class="cm-val">${crop.fertilizer}</span>
        </div>
      </div>
      <div class="crop-profit">
        <i class="fas fa-indian-rupee-sign"></i>
        Estimated Profit: ${crop.profit}
      </div>
    </div>
  `).join('');

    // Stagger animations
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
          <span class="tc-week">Week ${item.week}</span>
        </div>
        <div class="tc-activity">
          <i class="${getActivityIcon(item.type)}" style="margin-right:6px;color:${getActivityColor(item.type)}"></i>
          ${item.activity}
        </div>
        <span class="tc-type ${item.type}">${capitalize(item.type)}</span>
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
        <span>🌾</span> ${p.crop} — Pest Control Plan
      </div>
      <div class="pcc-items">
        ${p.guides.map(g => `
          <div class="pcc-item">
            <div class="pcc-pest"><i class="fas fa-bug" style="color:var(--amber);margin-right:6px"></i>${g.pest}</div>
            <div class="pcc-meta">
              <span><i class="fas fa-flask"></i> ${g.pesticide}</span>
              <span><i class="fas fa-scale-balanced"></i> ${g.dose}</span>
            </div>
            <div style="font-size:0.75rem;color:var(--text-3);margin-top:4px">
              <i class="fas fa-clock"></i> ${g.timing}
            </div>
            <div class="pcc-eco eco-${g.eco}">
              ${g.eco
                ? '<i class="fas fa-leaf"></i> Eco-Friendly'
                : '<i class="fas fa-flask"></i> Chemical'}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}