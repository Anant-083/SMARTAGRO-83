/* ── Simple translation passthrough for this page (English by default;
   follows the same dt() pattern dashboard.js uses so it's easy to wire
   into the full translation system later) ─────────────────────────── */
window._farmMapTrans = {};
function dt(key) {
    return window._farmMapTrans[key] || key;
}

let _farmLat = null;
let _farmLon = null;
let _farmMapInstance = null;

/* ── Location button ────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('farmMapLocationBtn');
    if (btn) {
        btn.addEventListener('click', () => {
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> <span>${dt('Locating...')}</span>`;
            btn.disabled = true;
            requestLocation((lat, lon) => {
                _farmLat = lat;
                _farmLon = lon;
                btn.innerHTML = `<i class="fas fa-check"></i> <span>${dt('Location Found')}</span>`;
                showToast('📍 ' + dt('Location detected!'), 'success');
                initFarmFlow(lat, lon);
            });
        });
    }

    const soilSubmit = document.getElementById('soilFormSubmit');
    if (soilSubmit) {
        soilSubmit.addEventListener('click', () => {
            if (_farmLat === null || _farmLon === null) {
                showToast(dt('Please show your farm location first.'), 'warning');
                return;
            }
            loadFarmCropRecommendations();
        });
    }
});

/* ── Orchestrates the whole page once we have a location ───────── */
async function initFarmFlow(lat, lon) {
    renderSatelliteMap(lat, lon);

    document.getElementById('areaDetailsSection').style.display = '';
    document.getElementById('soilSection').style.display = '';

    await loadAreaDetails(lat, lon);
    await loadFarmCropRecommendations(); // first pass without soil data; refined once farmer fills the form
}

/* ── Satellite basemap (Esri World Imagery — free, no API key) ──── */
function renderSatelliteMap(lat, lon) {
    const el = document.getElementById('farmSatelliteMap');
    if (!el || typeof L === 'undefined') return;
    el.style.display = '';

    if (_farmMapInstance) {
        _farmMapInstance.setView([lat, lon], 15);
        _farmMapInstance.eachLayer(layer => {
            if (layer instanceof L.Marker) _farmMapInstance.removeLayer(layer);
        });
    } else {
        _farmMapInstance = L.map('farmSatelliteMap').setView([lat, lon], 15);
        L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            {
                attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics',
                maxZoom: 19,
            }
        ).addTo(_farmMapInstance);
    }
    L.marker([lat, lon]).addTo(_farmMapInstance)
        .bindPopup(dt('Your farm location')).openPopup();
}

/* ── Vegetation health + climate normals ─────────────────────────── */
async function loadAreaDetails(lat, lon) {
    const vegCard = document.getElementById('vegetationCard');
    const climateCard = document.getElementById('climateCard');

    try {
        const res = await fetch(`/api/area-details?lat=${lat}&lon=${lon}`);
        const data = await res.json();

        renderVegetationCard(data.vegetation);
        renderClimateCard(data.power_climate);
    } catch (err) {
        console.error('Area details error:', err);
        if (vegCard) vegCard.innerHTML = `<p>${dt('Vegetation data unavailable right now.')}</p>`;
        if (climateCard) climateCard.innerHTML = `<p>${dt('Climate data unavailable right now.')}</p>`;
    }
}

function renderVegetationCard(veg) {
    const card = document.getElementById('vegetationCard');
    if (!card) return;
    if (!veg || veg.ndvi === null || veg.ndvi === undefined) {
        card.innerHTML = `
          <div class="area-card-icon"><i class="fas fa-seedling"></i></div>
          <h4>${dt('Vegetation Health')}</h4>
          <p class="area-card-empty">${dt('No recent satellite reading available for this exact point.')}</p>`;
        return;
    }
    const pct = Math.max(0, Math.min(100, Math.round((veg.ndvi + 0.2) / 1.0 * 100)));
    card.innerHTML = `
      <div class="area-card-icon"><i class="fas fa-seedling"></i></div>
      <h4>${dt('Vegetation Health')} <span class="area-card-source">(NASA MODIS NDVI)</span></h4>
      <div class="ndvi-value">${veg.ndvi}</div>
      <div class="ndvi-label">${dt(veg.health_label)}</div>
      <div class="ndvi-bar"><div class="ndvi-bar-fill" style="width:${pct}%"></div></div>
      <p class="area-card-date">${dt('Last observed')}: ${veg.date || '—'}</p>
      <p class="area-card-note">${dt(veg.note)}</p>`;
}

function renderClimateCard(power) {
    const card = document.getElementById('climateCard');
    if (!card) return;
    if (!power || power.avg_temp_c === null || power.avg_temp_c === undefined) {
        card.innerHTML = `
          <div class="area-card-icon"><i class="fas fa-satellite"></i></div>
          <h4>${dt('Typical Climate')}</h4>
          <p class="area-card-empty">${dt('Climate data unavailable right now.')}</p>`;
        return;
    }
    card.innerHTML = `
      <div class="area-card-icon"><i class="fas fa-satellite"></i></div>
      <h4>${dt('Typical Climate for This Month')} <span class="area-card-source">(NASA POWER)</span></h4>
      <div class="climate-row"><i class="fas fa-temperature-half"></i> ${dt('Avg Temp')}: <strong>${power.avg_temp_c}°C</strong></div>
      <div class="climate-row"><i class="fas fa-droplets"></i> ${dt('Avg Rainfall')}: <strong>${power.avg_rain_mm} mm/day</strong></div>
      <div class="climate-row"><i class="fas fa-water"></i> ${dt('Avg Humidity')}: <strong>${power.avg_humidity}%</strong></div>
      <p class="area-card-note">${dt('Long-term normal for this location, not today\'s forecast.')}</p>`;
}

/* ── Crop recommendations (reuses the same backend endpoint as Dashboard,
   just also sends soil + land-size fields when available) ─────────── */
function getFarmSoilValues() {
    const val = id => {
        const el = document.getElementById(id);
        return el && el.value !== '' ? el.value : null;
    };
    return {
        n: val('soilN'), p: val('soilP'), k: val('soilK'), ph: val('soilPh'),
        land_size: val('landSize'), land_unit: (document.getElementById('landUnit') || {}).value || 'acre',
    };
}

async function loadFarmCropRecommendations() {
    if (_farmLat === null || _farmLon === null) return;
    const section = document.getElementById('farmCropSection');
    const grid = document.getElementById('farmCropsGrid');
    if (section) section.style.display = '';
    if (grid) grid.innerHTML = `<div class="loading-spinner" style="width:24px;height:24px;"></div>`;

    const soil = getFarmSoilValues();
    // Pull a quick current-weather reading so the recommendation prompt has
    // live temp/humidity/rain context too, same as the Dashboard flow.
    let current = { temp: 27, humidity: 60, rain: 0, city: '' };
    try {
        const w = await fetchWeather(_farmLat, _farmLon);
        if (w && w.current) current = w.current;
    } catch (e) { /* fall back to defaults above */ }

    try {
        const res = await fetch('/api/crop-recommendations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                temp: current.temp, humidity: current.humidity, rain: current.rain || 0,
                city: current.city, lat: _farmLat, lon: _farmLon,
                n: soil.n, p: soil.p, k: soil.k, ph: soil.ph,
                land_size: soil.land_size, land_unit: soil.land_unit,
            })
        });
        const data = await res.json();
        renderFarmCrops(data);

        const label = document.getElementById('farmSeasonLabel');
        if (label) label.textContent = `${dt('Season')}: ${dt(data.season)}${data.soil_used ? ' — ' + dt('using your soil data') : ''}`;
    } catch (err) {
        console.error('Farm crop API error:', err);
        showToast(dt('Could not load crop recommendations.'), 'error');
    }
}

function renderFarmCrops(data) {
    const grid = document.getElementById('farmCropsGrid');
    if (!grid) return;
    const crops = data.crops || [];
    grid.innerHTML = crops.map((crop, i) => `
    <div class="crop-card" style="animation-delay:${i * 0.07}s">
      <div class="crop-card-top">
        <div class="crop-emoji">${crop.icon}</div>
        <div class="crop-match-badge"><i class="fas fa-check-circle"></i> ${crop.match} ${dt('Match')}</div>
      </div>
      <div class="crop-name">${dt(crop.name)}</div>
      <div class="crop-desc">${dt(crop.description)}</div>
      <div class="crop-meta">
        <div class="cm-item"><span class="cm-label">${dt('Season')}</span><span class="cm-val">${dt(crop.season.split(' ')[0])}</span></div>
        <div class="cm-item"><span class="cm-label">${dt('Water Need')}</span><span class="cm-val">${dt(crop.water)}</span></div>
        <div class="cm-item"><span class="cm-label">${dt('Expected Yield')}</span><span class="cm-val">${crop.yield}</span></div>
        <div class="cm-item"><span class="cm-label">${dt('Duration')}</span><span class="cm-val">${crop.duration}</span></div>
        <div class="cm-item"><span class="cm-label">${dt('Soil Type')}</span><span class="cm-val">${dt(crop.soil)}</span></div>
        <div class="cm-item"><span class="cm-label">${dt('Fertilizer')}</span><span class="cm-val">${crop.fertilizer}</span></div>
      </div>
      ${crop.your_land_estimate ? `<div class="crop-land-note"><i class="fas fa-ruler-combined"></i> ${crop.your_land_estimate.note}</div>` : ''}
      <div class="crop-profit"><i class="fas fa-indian-rupee-sign"></i> ${dt('Estimated Profit')}: ${crop.profit}</div>
    </div>
  `).join('');
    setTimeout(() => { if (typeof observeAnimations === 'function') observeAnimations(); }, 100);
}
