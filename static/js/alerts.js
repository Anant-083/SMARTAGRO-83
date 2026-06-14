/* ═══════════════════════════════════════════════
   alerts.js — Alerts page logic
   Handles: location → weather → alerts rendering,
            pest calendar, pesticide safety,
            harmful/safe crops, risk chart
═══════════════════════════════════════════════ */

let allAlerts = [];
let activeFilter = 'all';
let riskChartInst = null;
let currentWeather = null;

/* ── Entry point: request location ─────────── */
function requestAlertsLocation() {
    const btn = document.getElementById('alertLocationBtn');
    if (btn) {
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>Getting location...</span>`;
        btn.disabled = true;
    }

    if (!navigator.geolocation) {
        showToast('Geolocation not supported. Using default.', 'warning');
        loadAlertsData(28.6139, 77.2090);
        return;
    }

    navigator.geolocation.getCurrentPosition(
        pos => {
            showToast('📍 Location detected!', 'success');
            loadAlertsData(pos.coords.latitude, pos.coords.longitude);
        },
        () => {
            showToast('Using default location (Delhi).', 'warning');
            loadAlertsData(28.6139, 77.2090);
        }, { timeout: 10000, enableHighAccuracy: true }
    );
}

/* ── Load weather then fetch alerts ─────────── */
async function loadAlertsData(lat, lon) {
    // Hide location prompt
    const locationSection = document.getElementById('locationSection');
    if (locationSection) locationSection.style.display = 'none';

    // Show alerts section with loader
    const alertsSection = document.getElementById('alertsSection');
    if (alertsSection) alertsSection.style.display = '';

    try {
        // 1. Fetch weather
        const weatherRes = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
        const weatherData = await weatherRes.json();
        currentWeather = weatherData.current;

        // 2. Fetch alerts based on weather
        const alertsRes = await fetch('/api/alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                temp: currentWeather.temp,
                humidity: currentWeather.humidity,
                wind_speed: currentWeather.wind_speed,
                rain: currentWeather.rain || 0,
                description: currentWeather.description,
                city: currentWeather.city
            })
        });
        const alertsData = await alertsRes.json();
        allAlerts = alertsData.alerts || [];

        // Update summary bar counts
        updateSummaryCounts(allAlerts);

        // Save badge count to session
        sessionStorage.setItem('alert_count', allAlerts.length);
        updateAlertBadge(allAlerts.length);

        // Render all sections
        renderAlertsList(allAlerts);
        renderPestCalendar(currentWeather);
        renderPesticideSafety(currentWeather);
        renderHarmfulSafeCrops(currentWeather);
        renderRiskChart(currentWeather, allAlerts);

        // Show all extra sections
        ['pestCalendarSection', 'pesticideSafetySection', 'harmfulSection', 'riskChartSection'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = '';
        });

    } catch (err) {
        console.error('Alerts load error:', err);
        showToast('Could not load alert data.', 'error');
        document.getElementById('alertsList').innerHTML = `
      <div style="text-align:center;padding:60px 0;color:var(--text-3)">
        <i class="fas fa-exclamation-triangle" style="font-size:2rem;margin-bottom:12px;color:var(--amber)"></i>
        <p>Could not load alerts. Please try again.</p>
        <button class="btn-secondary" style="margin-top:16px" onclick="requestAlertsLocation()">Retry</button>
      </div>`;
    }
}

/* ── Update summary bar ─────────────────────── */
function updateSummaryCounts(alerts) {
    const danger = alerts.filter(a => a.type === 'danger').length;
    const warning = alerts.filter(a => a.type === 'warning').length;
    const info = alerts.filter(a => a.type === 'info').length;

    const setCount = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        let n = 0;
        const interval = setInterval(() => {
            n = Math.min(n + 1, val);
            el.textContent = n;
            if (n >= val) clearInterval(interval);
        }, 60);
    };

    setCount('dangerCount', danger);
    setCount('warningCount', warning);
    setCount('infoCount', info);
    setCount('totalCount', alerts.length);
}

/* ── Render alerts list ─────────────────────── */
function renderAlertsList(alerts) {
    const list = document.getElementById('alertsList');
    const none = document.getElementById('noAlerts');
    if (!list) return;

    if (alerts.length === 0) {
        list.innerHTML = '';
        if (none) none.style.display = 'block';
        return;
    }
    if (none) none.style.display = 'none';

    list.innerHTML = alerts.map((alert, i) => `
    <div class="alert-card ${alert.type}" 
         data-type="${alert.type}" 
         data-category="${alert.category}"
         style="animation-delay:${i * 0.07}s">
      <div class="alert-card-icon">${alert.icon}</div>
      <div class="alert-card-body">
        <div class="alert-card-top">
          <span class="alert-card-title">${alert.title}</span>
          <span class="alert-category ${getCatClass(alert.category)}">${alert.category}</span>
          <span class="alert-category ${getTypeClass(alert.type)}">${capitalize(alert.type)}</span>
        </div>
        <div class="alert-card-msg">${alert.message}</div>
        <div class="alert-card-action">
          <i class="fas fa-circle-right"></i>
          <span><strong>Action:</strong> ${alert.action}</span>
        </div>
      </div>
    </div>
  `).join('');
}

function getCatClass(cat) {
    const map = {
        'Weather': 'cat-weather',
        'Disease': 'cat-disease',
        'Pest': 'cat-pest',
        'Crop Advisory': 'cat-crop',
    };
    return map[cat] || 'cat-crop';
}

function getTypeClass(type) {
    const map = { danger: 'cat-disease', warning: 'cat-pest', info: 'cat-crop' };
    return map[type] || 'cat-crop';
}

/* ── Filter alerts ──────────────────────────── */
function filterAlerts(filter) {
    activeFilter = filter;

    // Update tab styles
    document.querySelectorAll('.alert-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.textContent.trim().toLowerCase().includes(filter.toLowerCase()) ||
            (filter === 'all' && tab.textContent.trim().toLowerCase() === 'all alerts')) {
            tab.classList.add('active');
        }
    });

    const cards = document.querySelectorAll('.alert-card');
    let visibleCount = 0;

    cards.forEach(card => {
        const type = card.dataset.type;
        const category = card.dataset.category;
        let show = false;

        if (filter === 'all') show = true;
        else if (filter === 'danger' || filter === 'warning' || filter === 'info') show = type === filter;
        else show = category === filter;

        card.style.display = show ? 'flex' : 'none';
        if (show) visibleCount++;
    });

    const none = document.getElementById('noAlerts');
    if (none) none.style.display = visibleCount === 0 ? 'block' : 'none';
}

/* ── Pest Calendar ──────────────────────────── */
const SEASONAL_PESTS = [{
        name: 'Brown Plant Hopper',
        icon: '🦗',
        season: 'Kharif (Jun–Oct)',
        risk: 'High',
        crops: 'Rice, Paddy',
        description: 'Feeds on rice plants causing "hopperburn". Thrives in humid conditions above 75%.',
        prevention: 'Use resistant varieties. Avoid excess nitrogen. Keep fields drained.'
    },
    {
        name: 'Aphids',
        icon: '🐜',
        season: 'Rabi (Nov–Feb)',
        risk: 'Medium',
        crops: 'Wheat, Mustard, Vegetables',
        description: 'Suck plant sap, transmit viral diseases. High risk in mild temperatures (15–25°C).',
        prevention: 'Neem oil spray. Release ladybird beetles as biocontrol.'
    },
    {
        name: 'Fall Armyworm',
        icon: '🐛',
        season: 'Kharif (Jul–Sep)',
        risk: 'High',
        crops: 'Maize, Sorghum',
        description: 'Causes significant leaf damage and can destroy entire crops within days.',
        prevention: 'Early detection critical. Bt-based bioinsecticide spray.'
    },
    {
        name: 'Whitefly',
        icon: '🦋',
        season: 'Year-round',
        risk: 'Medium',
        crops: 'Cotton, Tomato, Chilli',
        description: 'Transmits leaf curl virus to cotton. Population explosion in dry hot weather.',
        prevention: 'Yellow sticky traps. Reflective mulch. Imidacloprid at threshold level.'
    },
    {
        name: 'Red Spider Mite',
        icon: '🕷️',
        season: 'Zaid (Mar–May)',
        risk: 'High',
        crops: 'Soybean, Cotton, Brinjal',
        description: 'Causes bronzing/yellowing of leaves. Severe in hot, dry weather above 32°C.',
        prevention: 'Increase irrigation. Abamectin 1.8 EC spray. Avoid dust on leaves.'
    },
    {
        name: 'Stem Borer',
        icon: '🐞',
        season: 'Kharif (Jun–Sep)',
        risk: 'High',
        crops: 'Rice, Sugarcane, Maize',
        description: 'Bores into stems causing "dead heart" in vegetative stage and "white ear" at heading.',
        prevention: 'Pheromone traps. Chlorpyriphos 20 EC. Remove crop residues after harvest.'
    },
    {
        name: 'Thrips',
        icon: '🦟',
        season: 'Rabi & Zaid',
        risk: 'Medium',
        crops: 'Onion, Chilli, Groundnut',
        description: 'Causes silvery white patches on leaves. Severe in dry weather.',
        prevention: 'Spinosad spray. Blue sticky traps. Avoid drought stress.'
    },
    {
        name: 'Mealy Bug',
        icon: '🐝',
        season: 'Year-round',
        risk: 'Low',
        crops: 'Cotton, Grapes, Papaya',
        description: 'Forms white waxy colonies on plant parts. Excretes honeydew causing sooty mould.',
        prevention: 'Buprofezin spray. Introduce Cryptolaemus beetles as biocontrol.'
    },
];

function renderPestCalendar(weather) {
    const grid = document.getElementById('pestCalendarGrid');
    if (!grid) return;

    // Highlight high-risk pests based on weather
    const isHighRiskConditions = weather.humidity > 70 || weather.temp > 30;

    grid.innerHTML = SEASONAL_PESTS.map((pest, i) => {
        const isCurrentRisk = isHighRiskConditions && pest.risk === 'High';
        return `
      <div class="pest-cal-card ${isCurrentRisk ? 'current-risk' : ''}" 
           style="animation-delay:${i * 0.05}s;${isCurrentRisk ? 'border-color:rgba(248,113,113,0.35);' : ''}">
        <div class="pcal-header">
          <div class="pcal-icon" style="${isCurrentRisk ? 'background:rgba(248,113,113,0.12);border-color:rgba(248,113,113,0.25)' : ''}">
            ${pest.icon}
          </div>
          <div>
            <div class="pcal-name">${pest.name}</div>
            <div class="pcal-season">
              <i class="fas fa-calendar-alt" style="margin-right:4px;font-size:0.65rem"></i>${pest.season}
            </div>
          </div>
          ${isCurrentRisk ? '<span style="font-size:0.65rem;padding:2px 8px;background:rgba(248,113,113,0.1);color:var(--red);border-radius:50px;border:1px solid rgba(248,113,113,0.2)">⚠ Active Now</span>' : ''}
        </div>
        <div class="pcal-body">
          <div style="margin-bottom:6px;font-size:0.78rem;color:var(--text-3)">
            <i class="fas fa-seedling" style="color:var(--green);margin-right:4px"></i>
            <strong>Affects:</strong> ${pest.crops}
          </div>
          <div style="font-size:0.8rem;color:var(--text-2);margin-bottom:8px">${pest.description}</div>
          <div style="font-size:0.75rem;color:var(--teal)">
            <i class="fas fa-shield-halved" style="margin-right:4px"></i>${pest.prevention}
          </div>
          <span class="pcal-risk risk-${pest.risk.toLowerCase()}">
            <i class="fas fa-circle" style="font-size:0.4rem"></i> ${pest.risk} Risk
          </span>
        </div>
      </div>`;
    }).join('');
}

/* ── Pesticide Safety Guide ─────────────────── */
const PESTICIDE_DATA = [{
        name: 'Chlorpyriphos 20 EC',
        icon: '⚗️',
        targetPest: 'Stem borer, Aphids, Termites',
        safeDoze: '2.5 ml/L water',
        maxDose: '3 ml/L (never exceed)',
        interval: 'Every 14 days',
        waitingPeriod: '15 days before harvest',
        warning: 'Highly toxic to fish and bees. Do not spray near water bodies or during flowering.',
        ppeRequired: 'Gloves, Mask, Goggles, Full sleeve clothing'
    },
    {
        name: 'Imidacloprid 17.8 SL',
        icon: '🧪',
        targetPest: 'Whitefly, Aphids, Brown Plant Hopper',
        safeDoze: '0.3 ml/L water',
        maxDose: '0.5 ml/L (never exceed)',
        interval: 'Every 21 days max',
        waitingPeriod: '21 days before harvest',
        warning: 'Do NOT spray during bee activity (morning/evening). Highly toxic to pollinators.',
        ppeRequired: 'Gloves, Mask, Full body protection'
    },
    {
        name: 'Mancozeb 75 WP',
        icon: '🫙',
        targetPest: 'Leaf blight, Early blight, Rust, Downy mildew',
        safeDoze: '2.5 g/L water',
        maxDose: '3.5 g/L (never exceed)',
        interval: 'Every 7–10 days',
        waitingPeriod: '7 days before harvest',
        warning: 'Causes skin and eye irritation. Do not spray on edible parts 7 days before harvest.',
        ppeRequired: 'Gloves, Goggles, Dust Mask'
    },
    {
        name: 'Neem Oil 5% EC (Organic)',
        icon: '🌿',
        targetPest: 'Aphids, Whitefly, Mites, Fungal diseases',
        safeDoze: '5 ml/L water',
        maxDose: '10 ml/L (safe to exceed slightly)',
        interval: 'Every 5–7 days',
        waitingPeriod: 'No waiting period — organic',
        warning: 'Safe for humans and beneficial insects. May cause phytotoxicity in direct sunlight. Spray at dusk.',
        ppeRequired: 'Basic gloves recommended'
    },
    {
        name: 'Propiconazole 25 EC',
        icon: '⚗️',
        targetPest: 'Yellow rust, Brown rust, Sheath blight',
        safeDoze: '1 ml/L water',
        maxDose: '1.5 ml/L (never exceed)',
        interval: 'Max 2 sprays per season',
        waitingPeriod: '21 days before harvest',
        warning: 'Do not mix with alkaline pesticides. Causes groundwater contamination if overused.',
        ppeRequired: 'Full protective gear, closed shoes'
    },
    {
        name: 'Emamectin Benzoate 5 SG',
        icon: '🧫',
        targetPest: 'Fall Armyworm, Diamond back moth, Leaf miner',
        safeDoze: '0.4 g/L water',
        maxDose: '0.5 g/L (never exceed)',
        interval: 'Every 10–14 days',
        waitingPeriod: '14 days before harvest',
        warning: 'Highly toxic to aquatic organisms. Dispose empty containers safely. Do not reuse containers.',
        ppeRequired: 'Full PPE, respiratory protection'
    },
];

function renderPesticideSafety(weather) {
    const grid = document.getElementById('pesticideGrid');
    if (!grid) return;

    grid.innerHTML = PESTICIDE_DATA.map((p, i) => `
    <div class="pesticide-card" style="animation-delay:${i * 0.06}s">
      <div class="pc-header">
        <span>${p.icon}</span> ${p.name}
      </div>
      <div class="pc-body">
        <div class="pc-item">
          <span class="pc-item-label"><i class="fas fa-bug"></i> Target Pest</span>
          <span class="pc-item-val">${p.targetPest}</span>
        </div>
        <div class="pc-item">
          <span class="pc-item-label"><i class="fas fa-flask"></i> Safe Dose</span>
          <span class="pc-item-val" style="color:var(--green)">${p.safeDoze}</span>
        </div>
        <div class="pc-item">
          <span class="pc-item-label"><i class="fas fa-triangle-exclamation"></i> Max Limit</span>
          <span class="pc-item-val" style="color:var(--red)">${p.maxDose}</span>
        </div>
        <div class="pc-item">
          <span class="pc-item-label"><i class="fas fa-rotate"></i> Interval</span>
          <span class="pc-item-val">${p.interval}</span>
        </div>
        <div class="pc-item">
          <span class="pc-item-label"><i class="fas fa-clock"></i> Pre-Harvest</span>
          <span class="pc-item-val" style="color:var(--amber)">${p.waitingPeriod}</span>
        </div>
        <div class="pc-item">
          <span class="pc-item-label"><i class="fas fa-helmet-safety"></i> PPE Required</span>
          <span class="pc-item-val">${p.ppeRequired}</span>
        </div>
        <div class="pc-warning">
          <i class="fas fa-circle-exclamation" style="flex-shrink:0;margin-top:1px"></i>
          <span>${p.warning}</span>
        </div>
      </div>
    </div>
  `).join('');
}

/* ── Harmful & Safe Crops ───────────────────── */
const ALL_CROPS_DATA = [
    { name: 'Rice', icon: '🌾', minTemp: 20, maxTemp: 38, minHumidity: 70, waterNeed: 'Very High' },
    { name: 'Wheat', icon: '🌿', minTemp: 10, maxTemp: 25, minHumidity: 40, waterNeed: 'Medium' },
    { name: 'Maize', icon: '🌽', minTemp: 18, maxTemp: 35, minHumidity: 50, waterNeed: 'Medium' },
    { name: 'Cotton', icon: '☁️', minTemp: 25, maxTemp: 40, minHumidity: 40, waterNeed: 'Medium' },
    { name: 'Tomato', icon: '🍅', minTemp: 18, maxTemp: 30, minHumidity: 60, waterNeed: 'Medium' },
    { name: 'Sugarcane', icon: '🎋', minTemp: 24, maxTemp: 38, minHumidity: 75, waterNeed: 'Very High' },
    { name: 'Soybean', icon: '🫘', minTemp: 20, maxTemp: 32, minHumidity: 60, waterNeed: 'Medium' },
    { name: 'Mustard', icon: '🌻', minTemp: 10, maxTemp: 25, minHumidity: 40, waterNeed: 'Low' },
    { name: 'Potato', icon: '🥔', minTemp: 10, maxTemp: 22, minHumidity: 60, waterNeed: 'Medium' },
    { name: 'Onion', icon: '🧅', minTemp: 13, maxTemp: 28, minHumidity: 50, waterNeed: 'Medium' },
    { name: 'Chilli', icon: '🌶️', minTemp: 20, maxTemp: 35, minHumidity: 60, waterNeed: 'Medium' },
    { name: 'Groundnut', icon: '🥜', minTemp: 22, maxTemp: 36, minHumidity: 50, waterNeed: 'Medium' },
];

function renderHarmfulSafeCrops(weather) {
    const section = document.getElementById('harmfulSection');
    const harmfulGrid = document.getElementById('harmfulGrid');
    const safeGrid = document.getElementById('safeGrid');
    if (!section || !harmfulGrid || !safeGrid) return;
    section.style.display = '';

    const temp = weather.temp;
    const humidity = weather.humidity;

    const harmful = [];
    const safe = [];

    ALL_CROPS_DATA.forEach(crop => {
        const tempOk = temp >= crop.minTemp && temp <= crop.maxTemp;
        const humidityOk = humidity >= crop.minHumidity;

        if (!tempOk || !humidityOk) {
            const reasons = [];
            if (temp < crop.minTemp) reasons.push(`Too cold (min ${crop.minTemp}°C needed)`);
            if (temp > crop.maxTemp) reasons.push(`Too hot (max ${crop.maxTemp}°C tolerated)`);
            if (humidity < crop.minHumidity) reasons.push(`Humidity too low (min ${crop.minHumidity}% needed)`);
            harmful.push({...crop, reasons });
        } else {
            safe.push({...crop, suitability: Math.round(((tempOk ? 50 : 0) + (humidityOk ? 50 : 0))) });
        }
    });

    harmfulGrid.innerHTML = harmful.length > 0 ?
        harmful.map(c => `
        <div class="harmful-card">
          <div class="hsc-name">
            <span style="font-size:1.5rem">${c.icon}</span> ${c.name}
            <span style="margin-left:auto;font-size:0.7rem;padding:2px 8px;background:rgba(248,113,113,0.1);color:var(--red);border-radius:50px;border:1px solid rgba(248,113,113,0.2)">⚠ Risky</span>
          </div>
          <div class="hsc-reason">
            ${c.reasons.map(r => `<div><i class="fas fa-xmark" style="color:var(--red);margin-right:4px"></i>${r}</div>`).join('')}
          </div>
        </div>`)
      .join('')
    : '<p style="color:var(--text-3);font-size:0.875rem">No harmful crops identified for current conditions.</p>';

  safeGrid.innerHTML = safe.length > 0
    ? safe.map(c => `
        <div class="safe-card">
          <div class="hsc-name">
            <span style="font-size:1.5rem">${c.icon}</span> ${c.name}
            <span style="margin-left:auto;font-size:0.7rem;padding:2px 8px;background:rgba(74,222,128,0.1);color:var(--green);border-radius:50px;border:1px solid rgba(74,222,128,0.2)">✓ Safe</span>
          </div>
          <div class="hsc-reason" style="margin-top:6px">
            <div style="display:flex;align-items:center;gap:6px">
              <i class="fas fa-check-circle" style="color:var(--green)"></i>
              <span style="font-size:0.78rem;color:var(--text-2)">Suitable for ${temp}°C, ${humidity}% humidity</span>
            </div>
            <div style="margin-top:6px;height:4px;background:var(--bg-2);border-radius:2px;overflow:hidden">
              <div style="height:100%;width:${c.suitability}%;background:linear-gradient(90deg,var(--green-dark),var(--green));border-radius:2px;transition:width 1s ease"></div>
            </div>
          </div>
        </div>`)
      .join('')
    : '<p style="color:var(--text-3);font-size:0.875rem">No fully safe crops identified — check crop calendar.</p>';
}

/* ── Risk Chart ─────────────────────────────── */
function renderRiskChart(weather, alerts) {
  const section = document.getElementById('riskChartSection');
  const canvas  = document.getElementById('riskChart');
  if (!section || !canvas) return;
  section.style.display = '';

  // Calculate risk scores
  const heatRisk    = Math.min(100, Math.max(0, ((weather.temp - 20) / 25) * 100));
  const humidRisk   = Math.min(100, Math.max(0, ((weather.humidity - 40) / 60) * 100));
  const windRisk    = Math.min(100, Math.max(0, (weather.wind_speed / 30) * 100));
  const pestRisk    = alerts.filter(a => a.category === 'Pest').length * 20;
  const diseaseRisk = alerts.filter(a => a.category === 'Disease').length * 25;
  const overallRisk = Math.round((heatRisk + humidRisk + windRisk + pestRisk + diseaseRisk) / 5);

  // Radar chart
  if (riskChartInst) riskChartInst.destroy();

  riskChartInst = new Chart(canvas, {
    type: 'radar',
    data: {
      labels: ['Heat Stress', 'Humidity Risk', 'Wind Damage', 'Pest Risk', 'Disease Risk'],
      datasets: [{
        label: 'Current Risk Level (%)',
        data: [
          Math.round(heatRisk),
          Math.round(humidRisk),
          Math.round(windRisk),
          Math.min(100, pestRisk),
          Math.min(100, diseaseRisk)
        ],
        backgroundColor: 'rgba(248,113,113,0.12)',
        borderColor: 'rgba(248,113,113,0.7)',
        borderWidth: 2,
        pointBackgroundColor: '#f87171',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0, max: 100,
          beginAtZero: true,
          ticks: {
            color: 'rgba(107,140,108,0.8)',
            backdropColor: 'transparent',
            stepSize: 25,
            font: { size: 10 }
          },
          grid:         { color: 'rgba(74,222,128,0.08)' },
          angleLines:   { color: 'rgba(74,222,128,0.1)' },
          pointLabels:  { color: '#a7c4a8', font: { size: 12, weight: '600' } }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0e1510',
          borderColor: 'rgba(74,222,128,0.25)',
          borderWidth: 1,
          titleColor: '#e8f5e9',
          bodyColor: '#a7c4a8',
          callbacks: {
            label: ctx => ` ${ctx.raw}% risk`
          }
        }
      }
    }
  });

  // Risk factors list
  const factors = document.getElementById('riskFactors');
  if (!factors) return;

  const riskItems = [
    { label: 'Heat Stress',   value: Math.round(heatRisk),    color: '#f87171' },
    { label: 'Humidity Risk', value: Math.round(humidRisk),   color: '#38bdf8' },
    { label: 'Wind Damage',   value: Math.round(windRisk),    color: '#94a3b8' },
    { label: 'Pest Activity', value: Math.min(100, pestRisk), color: '#fbbf24' },
    { label: 'Disease Risk',  value: Math.min(100, diseaseRisk), color: '#f87171' },
    { label: 'Overall Risk',  value: overallRisk,             color: overallRisk > 60 ? '#f87171' : overallRisk > 35 ? '#fbbf24' : '#4ade80' },
  ];

  factors.innerHTML = riskItems.map(item => `
    <div class="risk-factor-item">
      <div class="rfi-label">
        <span>${item.label}</span>
        <span style="color:${item.color};font-weight:700">${item.value}%</span>
      </div>
      <div class="rfi-bar">
        <div class="rfi-fill" style="width:0%;background:${item.color}" 
             data-target="${item.value}"></div>
      </div>
    </div>
  `).join('');

  // Animate bars
  setTimeout(() => {
    document.querySelectorAll('.rfi-fill').forEach(bar => {
      bar.style.width = bar.dataset.target + '%';
    });
  }, 200);
}

/* ── Tab click handlers ─────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Set first tab as active
  const firstTab = document.querySelector('.alert-tab');
  if (firstTab) firstTab.classList.add('active');
});