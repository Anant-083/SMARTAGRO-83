/* ── State ──────────────────────────────────── */
let allMarketData = {};
let allLocations = [];
let marketChart = null;
let activeChartType = 'line';
let activeFilter = 'all';
let currentChartCity = 'Delhi';

let _translations = {};
const _translationCache = {};
let _translationInProgress = false;

function setTranslations(data) {
    _translations = data || {};
}

function _t(key) {
    if (!key) return '';
    return _translations[key] || key;
}

/** Translate a crop name */
function tCrop(name) {
    return _translations[name] || name;
}

/** Translate a demand label */
function tDemand(demand) {
    return _translations[demand] || demand;
}

/* ══════════════════════════════════════════════
   HARDCODED FALLBACK DATA
   Only used when /api/market cannot be reached at all
   (server down, network error, unexpected 5xx that even
   the backend's own try/except didn't manage to catch).
   The backend already has its own MSP fallback for when
   the live Agmarknet feed is empty — this is the client's
   last line of defense so the dashboard never goes blank.
══════════════════════════════════════════════ */
const FALLBACK_CITIES = [
    'Delhi', 'Mumbai', 'Kolkata', 'Chennai', 'Hyderabad', 'Pune', 'Ahmedabad',
    'Lucknow', 'Jaipur', 'Bhopal', 'Patna', 'Nagpur', 'Indore', 'Surat',
    'Kanpur', 'Coimbatore', 'Visakhapatnam', 'Bhubaneswar', 'Guwahati', 'Amritsar',
];

const FALLBACK_CROPS = [
    { crop: 'Wheat',                 price: 2275,  unit: 'Rs/quintal' },
    { crop: 'Rice',                  price: 2183,  unit: 'Rs/quintal' },
    { crop: 'Maize (Corn)',          price: 2090,  unit: 'Rs/quintal' },
    { crop: 'Mustard',               price: 5650,  unit: 'Rs/quintal' },
    { crop: 'Groundnut',             price: 6377,  unit: 'Rs/quintal' },
    { crop: 'Onion',                 price: 1800,  unit: 'Rs/quintal' },
    { crop: 'Potato',                price: 1200,  unit: 'Rs/quintal' },
    { crop: 'Tomato',                price: 2500,  unit: 'Rs/quintal' },
    { crop: 'Chilli',                price: 12000, unit: 'Rs/quintal' },
    { crop: 'Sugarcane',             price: 340,   unit: 'Rs/quintal' },
    { crop: 'Arhar (Tur)',           price: 7000,  unit: 'Rs/quintal' },
    { crop: 'Moong',                 price: 8558,  unit: 'Rs/quintal' },
    { crop: 'Urad',                  price: 6950,  unit: 'Rs/quintal' },
    { crop: 'Soybean',               price: 4600,  unit: 'Rs/quintal' },
    { crop: 'Cotton',                price: 7121,  unit: 'Rs/quintal' },
    { crop: 'Jowar (Sorghum)',       price: 3180,  unit: 'Rs/quintal' },
    { crop: 'Bajra (Pearl Millet)',  price: 2500,  unit: 'Rs/quintal' },
    { crop: 'Bengal Gram (Chana)',   price: 5440,  unit: 'Rs/quintal' },
    { crop: 'Garlic',                price: 8000,  unit: 'Rs/quintal' },
    { crop: 'Ginger',                price: 6000,  unit: 'Rs/quintal' },
    { crop: 'Turmeric',              price: 14000, unit: 'Rs/quintal' },
    { crop: 'Cumin (Jeera)',         price: 25000, unit: 'Rs/quintal' },
    { crop: 'Coriander',             price: 7000,  unit: 'Rs/quintal' },
    { crop: 'Banana',                price: 1500,  unit: 'Rs/quintal' },
    { crop: 'Mango',                 price: 4000,  unit: 'Rs/quintal' },
];

/** Tiny deterministic string hash -> seeded PRNG (mulberry32-style), so the
 * fallback series looks the same on every reload instead of jumping around,
 * but still varies sensibly city-to-city and crop-to-crop. */
function _fallbackRng(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) {
        h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return function next() {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    };
}

/** 30-day history + today's price + change% for one (city, crop) pair. */
function generateFallbackSeries(city, cropName, basePrice, days = 30) {
    const rnd = _fallbackRng(`${city}:${cropName}`);
    const cityFactor = 0.95 + rnd() * 0.10;      // ±5% city-to-city variation
    const todayPrice = Math.max(1, Math.round(basePrice * cityFactor));

    const history = [todayPrice];
    let price = todayPrice;
    for (let i = 1; i < days; i++) {
        const drift = (rnd() - 0.5) * 0.04;       // ±2% daily drift
        price = Math.max(Math.round(price / (1 + drift)), Math.round(basePrice * 0.5));
        history.push(price);
    }
    history.reverse(); // oldest -> newest, last entry === todayPrice

    const prev   = history.length > 1 ? history[history.length - 2] : todayPrice;
    const change = prev ? Math.round(((todayPrice - prev) / prev) * 1000) / 10 : 0;

    return { history, price: todayPrice, change };
}

function getDemandFallback(change) {
    if (change > 2)  return 'Very High';
    if (change > 0)  return 'High';
    if (change > -2) return 'Medium';
    return 'Low';
}

/** Builds a full {markets, locations, ...} payload shaped exactly like a
 * real /api/market response, entirely from the hardcoded basket above. */
function buildFallbackMarketData() {
    const markets = {};
    FALLBACK_CITIES.forEach(city => {
        const crops = FALLBACK_CROPS.map(fb => {
            const { history, price, change } = generateFallbackSeries(city, fb.crop, fb.price);
            return {
                crop: fb.crop,
                crop_key: fb.crop,
                price,
                change,
                history,
                unit: fb.unit,
                demand: getDemandFallback(change),
                source: 'client_fallback',
            };
        });
        crops.sort((a, b) => {
            const rank = { 'Very High': 3, High: 2, Medium: 1, Low: 0 };
            return (rank[b.demand] - rank[a.demand]) || (b.price - a.price);
        });
        markets[city] = crops;
    });
    return {
        markets,
        locations: FALLBACK_CITIES,
        live_count: 0,
        static_count: FALLBACK_CITIES.length * FALLBACK_CROPS.length,
    };
}

/* ══════════════════════════════════════════════
   LANGUAGE DISPLAY NAMES (for overlay label)
══════════════════════════════════════════════ */
const MARKET_LANG_DISPLAY_NAMES = {
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
    sat: 'ᱥᱟᱱᱛᱟᱴ',
    ks: 'کڲشُر',
    ne: 'नेपाली',
    sd: 'سنڈی',
    kok: 'कोंकणी',
    mni: 'মৈতৈলোন্',
    bodo: 'बड़ो',
    doi: 'डोगरी',
    sa: 'संस्कृत',
    en: 'English',
};

/* ══════════════════════════════════════════════
   TRANSLATE OVERLAY
══════════════════════════════════════════════ */
function ensureMarketTranslateOverlayStyles() {
    if (document.getElementById('marketTranslateOverlayStyle')) return;
    const style = document.createElement('style');
    style.id = 'marketTranslateOverlayStyle';
    style.textContent = `
    .market-translate-overlay {
        position: fixed; inset: 0; z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        background: rgba(10, 16, 12, 0.55);
        backdrop-filter: blur(3px);
        opacity: 0; pointer-events: none;
        transition: opacity 0.2s ease;
    }
    .market-translate-overlay.visible { opacity: 1; pointer-events: all; }
    .market-translate-box {
        background: var(--bg-1, #102013);
        border: 1px solid var(--green, #4ade80);
        border-radius: 16px;
        padding: 28px 32px;
        max-width: 320px;
        text-align: center;
        box-shadow: 0 10px 40px rgba(0,0,0,0.35);
        animation: marketTransPopIn 0.25s ease;
    }
    @keyframes marketTransPopIn {
        from { transform: scale(0.92); opacity: 0; }
        to   { transform: scale(1);    opacity: 1; }
    }
    .market-translate-spinner {
        width: 38px; height: 38px; margin: 0 auto 14px;
        border: 3px solid rgba(74, 222, 128, 0.25);
        border-top-color: var(--green, #4ade80);
        border-radius: 50%;
        animation: marketTransSpin 0.8s linear infinite;
    }
    @keyframes marketTransSpin { to { transform: rotate(360deg); } }
    .market-translate-title {
        color: var(--text-1, #f1f5f1);
        font-weight: 600; font-size: 0.95rem; margin-bottom: 6px;
    }
    .market-translate-sub {
        color: var(--text-3, #94a3a0);
        font-size: 0.78rem; line-height: 1.4;
    }
    .market-translate-dots span {
        display: inline-block; opacity: 0.3;
        animation: marketTransDot 1.2s infinite;
    }
    .market-translate-dots span:nth-child(2) { animation-delay: 0.2s; }
    .market-translate-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes marketTransDot { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
    `;
    document.head.appendChild(style);
}

function showMarketTranslateOverlay(langCode) {
    ensureMarketTranslateOverlayStyles();
    let overlay = document.getElementById('marketTranslateOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'marketTranslateOverlay';
        overlay.className = 'market-translate-overlay';
        document.body.appendChild(overlay);
    }
    const name = MARKET_LANG_DISPLAY_NAMES[langCode] || langCode.toUpperCase();
    overlay.innerHTML = `
      <div class="market-translate-box">
        <div class="market-translate-spinner"></div>
        <div class="market-translate-title">Translating to ${name}<span class="market-translate-dots"><span>.</span><span>.</span><span>.</span></span></div>
        <div class="market-translate-sub">First-time translation can take a few seconds. It\'ll be instant after this.</div>
      </div>`;
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

function hideMarketTranslateOverlay() {
    const overlay = document.getElementById('marketTranslateOverlay');
    if (overlay) overlay.classList.remove('visible');
}

async function loadTranslations(lang) {
    if (!lang || lang === 'en') {
        setTranslations({});
        reRenderMarket();
        return;
    }
    if (_translationInProgress) return;
    _translationInProgress = true;

    if (_translationCache[lang]) {
        setTranslations(_translationCache[lang]);
        reRenderMarket();
        _translationInProgress = false;
        return;
    }

    showMarketTranslateOverlay(lang);

    try {
        const res = await fetch('/api/translate-market', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lang }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const tx = data.translations || {};
        _translationCache[lang] = tx; // cache for instant future switches
        setTranslations(tx);
        console.log(`[Market] Translations loaded for ${data.lang_name || lang}: ${Object.keys(_translations).length} terms`);
    } catch (err) {
        console.warn('[Market] Translation load failed, using English:', err);
        setTranslations({});
    }

    // Re-render fully, THEN lift overlay so there's zero gap
    reRenderMarket();
    hideMarketTranslateOverlay();
    _translationInProgress = false;
}

/* ══════════════════════════════════════════════
   INIT
══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    loadAllMarkets();
    setupSearchEnterKey();
});

/* ══════════════════════════════════════════════
   DATA LOADING
══════════════════════════════════════════════ */
async function loadAllMarkets() {
    try {
        const res = await fetch('/api/market');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        allMarketData = data.markets || {};
        allLocations = data.locations || Object.keys(allMarketData);

        if (Object.keys(allMarketData).length === 0)
            throw new Error('Empty market data');

        const liveCount = data.live_count || 0;
        const staticCount = data.static_count || 0;
        console.log(`[Market] Live: ${liveCount} | MSP fallback: ${staticCount}`);

        // Show data source badge
        updateDataSourceBadge(liveCount, staticCount);

        hideLoading();
        populateCityDropdown();

        const firstCity = allLocations[0] || 'Delhi';
        currentChartCity = firstCity;
        const sel = document.getElementById('chartCitySelect');
        if (sel) sel.value = firstCity;

        // Apply saved language BEFORE first render so data shows translated right away
        const savedLang = localStorage.getItem('agrosmart_lang') || 'en';
        if (savedLang !== 'en') {
            // Load translations first, then render everything in one pass
            await loadTranslations(savedLang);
        } else {
            renderMarketGrid(allMarketData);
            buildTicker(allMarketData);
            buildPriceTable(allMarketData);
            buildChart(allMarketData, firstCity, 'line');
        }

    } catch (err) {
        // Server unreachable / erroring entirely — fall back to hardcoded
        // reference data so the dashboard, comparison table, and every
        // chart still have real content instead of a dead error screen.
        console.warn('[Market] Live fetch failed, using offline fallback data:', err);
        useFallbackMarketData();
    }
}

function useFallbackMarketData() {
    const data = buildFallbackMarketData();
    allMarketData = data.markets;
    allLocations  = data.locations;

    updateDataSourceBadge(0, data.static_count);
    const badge = document.getElementById('dataSourceBadge');
    if (badge) {
        badge.innerHTML = `<i class="fas fa-circle" style="color:#fbbf24;font-size:0.5rem"></i> Offline reference prices (server unreachable)`;
        badge.style.color = '#fbbf24';
    }

    hideLoading();
    populateCityDropdown();

    const firstCity = allLocations[0] || 'Delhi';
    currentChartCity = firstCity;
    const sel = document.getElementById('chartCitySelect');
    if (sel) sel.value = firstCity;

    const subtitle = document.getElementById('marketSubtitle');
    if (subtitle) subtitle.textContent = 'Offline reference prices — showing all major Indian markets';

    renderMarketGrid(allMarketData);
    buildTicker(allMarketData);
    buildPriceTable(allMarketData);
    buildChart(allMarketData, firstCity, 'line');

    if (typeof showToast === 'function') {
        showToast('⚠️ Live server unreachable — showing offline reference prices', 'warning');
    }
}

function updateDataSourceBadge(liveCount, staticCount) {
    const badge = document.getElementById('dataSourceBadge');
    if (!badge) return;
    if (liveCount > 0) {
        badge.innerHTML = `<i class="fas fa-circle" style="color:#4ade80;font-size:0.5rem"></i> ${liveCount} live prices + ${staticCount} MSP reference`;
        badge.style.color = '#4ade80';
    } else {
        badge.innerHTML = `<i class="fas fa-circle" style="color:#fbbf24;font-size:0.5rem"></i> MSP reference prices (live data unavailable)`;
        badge.style.color = '#fbbf24';
    }
}

function hideLoading() {
    const loader = document.getElementById('marketLoading');
    const grid = document.getElementById('marketCitiesGrid');
    if (loader) loader.style.display = 'none';
    if (grid) grid.style.display = '';
}

/* ══════════════════════════════════════════════
   CITY DROPDOWN
══════════════════════════════════════════════ */
function populateCityDropdown() {
    const sel = document.getElementById('chartCitySelect');
    if (!sel) return;
    sel.innerHTML = allLocations
        .map(city => `<option value="${city}">${city}</option>`)
        .join('');
}

/* ══════════════════════════════════════════════
   RENDER MARKET CITY CARDS
══════════════════════════════════════════════ */
function renderMarketGrid(markets) {
    const grid = document.getElementById('marketCitiesGrid');
    const none = document.getElementById('noResults');
    if (!grid) return;

    const entries = Object.entries(markets);
    if (entries.length === 0) {
        grid.style.display = 'none';
        if (none) none.style.display = '';
        return;
    }
    if (none) none.style.display = 'none';
    grid.style.display = '';

    const cropLabel = _t('Crop') || 'Crop';
    const priceLabel = _t('Price') || 'Price';
    const changeLabel = _t('Change') || 'Change';
    const demandLabel = _t('Demand') || 'Demand';
    const cropsLabel = _t('crops') || 'crops';

    let hasVisible = false;

    grid.innerHTML = entries.map(([city, crops], cityIdx) => {
                let filtered = crops;
                if (activeFilter === 'Very High') {
                    filtered = crops.filter(c => c.demand === 'Very High');
                } else if (activeFilter === 'rising') {
                    filtered = crops.filter(c => c.change > 0);
                } else if (activeFilter === 'falling') {
                    filtered = crops.filter(c => c.change < 0);
                }
                if (filtered.length === 0) return '';
                hasVisible = true;

                return `
        <div class="city-card" style="animation-delay:${cityIdx * 0.05}s">
            <div class="city-card-header">
                <div class="city-name">
                    <i class="fas fa-location-dot"></i> ${city}
                </div>
                <span class="city-count">${filtered.length} ${cropsLabel}</span>
            </div>
            <div class="crop-rows">
                <div class="crop-row-header" style="display:grid;grid-template-columns:1.5fr 1fr 80px 100px;padding:8px 20px;font-size:0.68rem;color:var(--text-3);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid var(--border)">
                    <span>${cropLabel}</span>
                    <span>${priceLabel}</span>
                    <span>${changeLabel}</span>
                    <span class="cr-demand-hdr">${demandLabel}</span>
                </div>
                ${filtered.map(crop => {
                    const isUp   = crop.change >= 0;
                    const pctAbs = Math.abs(crop.change).toFixed(1);
                   return `
                    <div class="crop-row">
                        <div class="cr-name" data-crop-key="${crop.crop_key || crop.crop}">${tCrop(crop.crop)}</div>
                        <div>
                            <div class="cr-price">₹${crop.price.toLocaleString('en-IN')}</div>
                            <div class="cr-unit" data-translate-market="quintal">${_t('quintal') || crop.unit}</div>
                        </div>
                        <div class="cr-change ${isUp ? 'up' : 'down'}">
                            <i class="fas fa-arrow-${isUp ? 'up' : 'down'}"></i>
                            ${pctAbs}%
                        </div>
                        <div class="cr-demand demand-${getDemandClass(crop.demand)}" data-demand-key="${crop.demand}">
                            ${tDemand(crop.demand)}
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }).join('');

    if (!hasVisible) {
        grid.style.display = 'none';
        if (none) none.style.display = '';
    }

    setTimeout(() => {
        if (typeof observeAnimations === 'function') observeAnimations();
    }, 100);
}

function getDemandClass(demand) {
    const map = {
        'Very High': 'very-high',
        'High':      'high',
        'Medium':    'medium',
        'Low':       'low',
    };
    return map[demand] || 'medium';
}

/* ══════════════════════════════════════════════
   SEARCH
══════════════════════════════════════════════ */
async function searchLocation() {
    const input    = document.getElementById('locationSearch');
    const clearBtn = document.getElementById('clearSearchBtn');
    if (!input) return;

    const query = input.value.trim();
    if (!query) { clearSearch(); return; }
    if (clearBtn) clearBtn.style.display = 'flex';

    const grid     = document.getElementById('marketCitiesGrid');
    const subtitle = document.getElementById('marketSubtitle');

    if (grid) grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:60px 0;">
            <div class="loading-spinner"></div>
            <p style="color:var(--text-2);margin-top:12px;font-size:0.9rem">
                ${_t('Searching') || 'Searching'} <strong style="color:var(--green)">"${query}"</strong>…
            </p>
        </div>`;
    if (subtitle) subtitle.textContent = `${_t('Searching') || 'Searching'} "${query}"…`;

    const q       = query.toLowerCase();
    const matched = Object.fromEntries(
        Object.entries(allMarketData).filter(([city]) => city.toLowerCase().includes(q))
    );

    if (Object.keys(matched).length > 0) {
        renderMarketGrid(matched);
        buildPriceTable(matched);
        const firstCity = Object.keys(matched)[0];
        currentChartCity = firstCity;
        buildChart(matched, firstCity, activeChartType);
        if (subtitle) subtitle.textContent = `${_t('Search') || 'Results'}: "${query}"`;
        if (typeof showToast === 'function')
            showToast(`📍 ${Object.keys(matched).length} market(s) found for "${query}"`, 'success');
        return;
    }

    // City not in local cache — try API
    try {
        const res  = await fetch(`/api/market?location=${encodeURIComponent(query)}`);
        const data = await res.json();

        if (!data.markets || Object.keys(data.markets).length === 0) {
            if (grid) grid.style.display = 'none';
            const none = document.getElementById('noResults');
            if (none) none.style.display = '';
        } else {
            renderMarketGrid(data.markets);
            buildPriceTable(data.markets);
            const firstCity = data.locations[0];
            currentChartCity = firstCity;
            buildChart(data.markets, firstCity, activeChartType);
            if (subtitle) subtitle.textContent = `${_t('Search') || 'Showing'}: "${query}"`;
            if (typeof showToast === 'function')
                showToast(`📍 Showing ${firstCity} market data`, 'success');
        }
    } catch {
        // API unreachable for this search too — fall back to a
        // freshly-generated hardcoded entry for the searched city so the
        // user still sees something instead of a dead "no results" state.
        const fallbackCity = query.trim().replace(/\b\w/g, c => c.toUpperCase());
        const crops = FALLBACK_CROPS.map(fb => {
            const { history, price, change } = generateFallbackSeries(fallbackCity, fb.crop, fb.price);
            return {
                crop: fb.crop, crop_key: fb.crop, price, change, history,
                unit: fb.unit, demand: getDemandFallback(change), source: 'client_fallback',
            };
        });
        const fallbackMarkets = { [fallbackCity]: crops };
        renderMarketGrid(fallbackMarkets);
        buildPriceTable(fallbackMarkets);
        currentChartCity = fallbackCity;
        buildChart(fallbackMarkets, fallbackCity, activeChartType);
        if (subtitle) subtitle.textContent = `${_t('Showing') || 'Showing'}: "${fallbackCity}" (offline reference prices)`;
        if (typeof showToast === 'function')
            showToast(`⚠️ Server unreachable — showing offline reference prices for "${fallbackCity}"`, 'warning');
    }
}

function clearSearch() {
    const input    = document.getElementById('locationSearch');
    const clearBtn = document.getElementById('clearSearchBtn');
    const subtitle = document.getElementById('marketSubtitle');
    const none     = document.getElementById('noResults');
    const grid     = document.getElementById('marketCitiesGrid');

    if (input)    input.value            = '';
    if (clearBtn) clearBtn.style.display = 'none';
    if (subtitle) subtitle.textContent   = _t('Showing all major Indian markets') || 'Showing all major Indian markets';
    if (none)     none.style.display     = 'none';

    if (grid) grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:60px 0;">
            <div class="loading-spinner"></div>
            <p style="color:var(--text-2);margin-top:12px;font-size:0.9rem">
                ${_t('Loading markets') || 'Loading markets…'}
            </p>
        </div>`;

    renderMarketGrid(allMarketData);
    buildPriceTable(allMarketData);
    buildChart(allMarketData, currentChartCity, activeChartType);
}

function setupSearchEnterKey() {
    const input = document.getElementById('locationSearch');
    if (!input) return;
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') searchLocation();
    });
    input.addEventListener('input', () => {
        const clearBtn = document.getElementById('clearSearchBtn');
        if (clearBtn) clearBtn.style.display = input.value ? 'flex' : 'none';
    });
}

/* ══════════════════════════════════════════════
   FILTER CHIPS
══════════════════════════════════════════════ */
function filterDemand(type, el) {
    activeFilter = type;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    if (el) el.classList.add('active');
    renderMarketGrid(allMarketData);
}

/* ══════════════════════════════════════════════
   LIVE PRICE TICKER
══════════════════════════════════════════════ */
function buildTicker(markets) {
    const content = document.getElementById('tickerContent');
    if (!content) return;

    const items = [];
    Object.entries(markets).forEach(([city, crops]) => {
        crops.forEach(crop => {
            const isUp  = crop.change >= 0;
            const sign  = isUp ? '▲' : '▼';
            const color = isUp ? '#4ade80' : '#f87171';
            items.push(
                `<span style="margin:0 28px">
                    <strong style="color:#e8f5e9">${tCrop(crop.crop)}</strong>
                    <span style="color:var(--text-3)">(${city})</span>
                    <strong style="color:var(--amber)"> ₹${crop.price.toLocaleString('en-IN')}</strong>
                    <span style="color:${color};font-size:0.7rem"> ${sign}${Math.abs(crop.change).toFixed(1)}%</span>
                    <span class="cr-demand demand-${getDemandClass(crop.demand)}" style="font-size:0.65rem;padding:1px 6px;border-radius:50px;margin-left:4px">${tDemand(crop.demand)}</span>
                </span>`
            );
        });
    });

    const html = items.join('  •  ');
    content.innerHTML = html + '  •  ' + html;
}

/* ══════════════════════════════════════════════
   CHART CONTROLS
══════════════════════════════════════════════ */
function switchChart(type) {
    activeChartType = type;
    document.querySelectorAll('.chart-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.getAttribute('onclick') && tab.getAttribute('onclick').includes(`'${type}'`)) {
            tab.classList.add('active');
        }
    });
    buildChart(allMarketData, currentChartCity, type);
}

function updateChart() {
    const sel = document.getElementById('chartCitySelect');
    if (sel) currentChartCity = sel.value;
    buildChart(allMarketData, currentChartCity, activeChartType);
}

function buildChart(markets, city, type) {
    const canvas = document.getElementById('marketChart');
    if (!canvas) return;

    const cityData = markets[city] || Object.values(markets)[0] || [];
    if (marketChart) { marketChart.destroy(); marketChart = null; }

    if (type === 'line')       buildLineChart(canvas, cityData, city);
    else if (type === 'bar')   buildBarChart(canvas, cityData, city);
    else if (type === 'radar') buildRadarChart(canvas, cityData, city);
}

function interpolateHistory(history, targetLen) {
    if (!history || history.length === 0) return new Array(targetLen).fill(0);
    if (history.length >= targetLen) return history.slice(0, targetLen);

    const result = [];
    const n      = history.length;

    for (let i = 0; i < targetLen; i++) {
        const t    = (i / (targetLen - 1)) * (n - 1);
        const lo   = Math.floor(t);
        const hi   = Math.min(lo + 1, n - 1);
        const frac = t - lo;
        result.push(Math.round(history[lo] * (1 - frac) + history[hi] * frac));
    }
    return result;
}

/* ──────────────────────────────────────────────
   LINE CHART
────────────────────────────────────────────── */
function buildLineChart(canvas, cityData, city) {
    const labels = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
    }

    const palette = [
        '#4ade80','#fbbf24','#2dd4bf','#a78bfa',
        '#f87171','#38bdf8','#fb923c','#e879f9',
        '#84cc16','#f43f5e','#06b6d4','#8b5cf6',
        '#ec4899','#10b981','#f59e0b','#3b82f6',
        '#ef4444','#22c55e','#d946ef','#0ea5e9',
        '#f97316','#14b8a6','#8b5cf6','#eab308',
        '#6366f1','#db2777',
    ];

    const demandScore = { 'Very High': 4, 'High': 3, 'Medium': 2, 'Low': 1 };
    const sorted = [...cityData].sort((a, b) =>
        (demandScore[b.demand] || 0) - (demandScore[a.demand] || 0) ||
        Math.abs(b.change) - Math.abs(a.change)
    );

    const datasets = sorted.map((crop, idx) => {
        const history30 = interpolateHistory(crop.history || [], 30);
        const color     = palette[idx % palette.length];
        return {
            label:                     tCrop(crop.crop),
            data:                      history30,
            borderColor:               color,
            backgroundColor:           color + '18',
            borderWidth:               idx < 5 ? 2.5 : 1.5,
            tension:                   0.4,
            fill:                      idx === 0,
            pointRadius:               0,
            pointHoverRadius:          5,
            pointHoverBackgroundColor: color,
            hidden:                    idx >= 8,
        };
    });

    marketChart = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            ...getBaseChartOptions(
                `${city} — ${_t('30-Day Price Trend')} (₹/${_t('quintal') || 'quintal'})`
            ),
            scales: {
                x: {
                    grid:   { color: 'rgba(74,222,128,0.05)', drawBorder: false },
                    ticks:  { color: '#6b8c6c', font: { size: 10 }, maxTicksLimit: 8 },
                    border: { color: 'rgba(74,222,128,0.1)' },
                },
                y: {
                    grid:   { color: 'rgba(74,222,128,0.06)', drawBorder: false },
                    ticks:  {
                        color:    '#6b8c6c',
                        callback: v => '₹' + v.toLocaleString('en-IN'),
                    },
                    border: { color: 'rgba(74,222,128,0.1)' },
                },
            },
        },
    });
}

/* ──────────────────────────────────────────────
   BAR CHART
────────────────────────────────────────────── */
function buildBarChart(canvas, cityData, city) {
    const colors = cityData.map(c =>
        c.change >= 3  ? 'rgba(74,222,128,0.90)'  :
        c.change >= 1  ? 'rgba(74,222,128,0.55)'  :
        c.change > 0   ? 'rgba(74,222,128,0.35)'  :
        c.change > -1  ? 'rgba(251,191,36,0.70)'  :
        c.change > -3  ? 'rgba(251,191,36,0.50)'  :
                         'rgba(248,113,113,0.80)'
    );
    const borderColors = colors.map(c => c.replace(/[\d.]+\)$/, '1)'));

    marketChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels:   cityData.map(c => tCrop(c.crop)),
            datasets: [{
                label:           `${_t('Price') || 'Price'} (₹/${_t('quintal') || 'quintal'})`,
                data:            cityData.map(c => c.price),
                backgroundColor: colors,
                borderColor:     borderColors,
                borderWidth:     1,
                borderRadius:    6,
                borderSkipped:   false,
            }],
        },
        options: {
            ...getBaseChartOptions(
                `${city} — ${_t('Current Prices')} (₹/${_t('quintal') || 'quintal'})`
            ),
            scales: {
                x: {
                    grid:   { color: 'rgba(74,222,128,0.05)' },
                    ticks:  {
                        color:       '#a7c4a8',
                        font:        { size: 9 },
                        maxRotation: 50,
                        callback: function(val) {
                            const label = this.getLabelForValue(val);
                            return label.length > 12 ? label.slice(0, 11) + '…' : label;
                        },
                    },
                    border: { color: 'rgba(74,222,128,0.1)' },
                },
                y: {
                    grid:   { color: 'rgba(74,222,128,0.06)' },
                    ticks:  {
                        color:    '#6b8c6c',
                        callback: v => '₹' + v.toLocaleString('en-IN'),
                    },
                    border: { color: 'rgba(74,222,128,0.1)' },
                },
            },
            plugins: {
                ...getBaseChartOptions('').plugins,
                tooltip: {
                    backgroundColor: '#0e1510',
                    borderColor:     'rgba(74,222,128,0.25)',
                    borderWidth:     1,
                    titleColor:      '#e8f5e9',
                    bodyColor:       '#a7c4a8',
                    padding:         10,
                    callbacks: {
                        label: ctx => {
                            const crop = cityData[ctx.dataIndex];
                            const sign = crop.change >= 0 ? '▲' : '▼';
                            return [
                                ` ₹${ctx.raw.toLocaleString('en-IN')}/${_t('quintal') || 'quintal'}`,
                                ` ${sign} ${Math.abs(crop.change).toFixed(1)}%  |  ${tDemand(crop.demand)} ${_t('Demand') || 'demand'}`,
                            ];
                        },
                    },
                },
            },
        },
    });
}

/* ──────────────────────────────────────────────
   RADAR CHART
────────────────────────────────────────────── */
function buildRadarChart(canvas, cityData, city) {
    const demandScore = { 'Very High': 100, 'High': 75, 'Medium': 50, 'Low': 25 };
    const display     = cityData.slice(0, 12);

    marketChart = new Chart(canvas, {
        type: 'radar',
        data: {
            labels: display.map(c => tCrop(c.crop)),
            datasets: [
                {
                    label:                _t('Demand Intensity') || 'Demand Intensity',
                    data:                 display.map(c => demandScore[c.demand] || 50),
                    backgroundColor:      'rgba(251,191,36,0.12)',
                    borderColor:          'rgba(251,191,36,0.75)',
                    borderWidth:          2,
                    pointBackgroundColor: '#fbbf24',
                    pointBorderColor:     '#fff',
                    pointBorderWidth:     2,
                    pointRadius:          5,
                },
                {
                    label:                _t('Price Momentum') || 'Price Momentum',
                    data:                 display.map(c => Math.min(100, Math.max(0, (c.change + 10) * 5))),
                    backgroundColor:      'rgba(74,222,128,0.10)',
                    borderColor:          'rgba(74,222,128,0.65)',
                    borderWidth:          2,
                    pointBackgroundColor: '#4ade80',
                    pointBorderColor:     '#fff',
                    pointBorderWidth:     2,
                    pointRadius:          4,
                },
            ],
        },
        options: {
            responsive:          true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    min: 0, max: 100,
                    ticks: {
                        color:         'rgba(107,140,108,0.7)',
                        backdropColor: 'transparent',
                        stepSize:      25,
                        font:          { size: 10 },
                    },
                    grid:        { color: 'rgba(74,222,128,0.08)' },
                    angleLines:  { color: 'rgba(74,222,128,0.10)' },
                    pointLabels: { color: '#a7c4a8', font: { size: 10, weight: '600' } },
                },
            },
            plugins: {
                legend: {
                    display: true,
                    labels:  { color: '#a7c4a8', font: { size: 11 }, usePointStyle: true },
                },
                title: {
                    display: true,
                    text:    `${city} — ${_t('Demand Map') || 'Demand Map'}`,
                    color:   '#a7c4a8',
                    font:    { size: 13, weight: '600' },
                    padding: { bottom: 10 },
                },
                tooltip: {
                    backgroundColor: '#0e1510',
                    borderColor:     'rgba(74,222,128,0.25)',
                    borderWidth:     1,
                    titleColor:      '#e8f5e9',
                    bodyColor:       '#a7c4a8',
                },
            },
            animation: { duration: 700, easing: 'easeOutQuart' },
        },
    });
}

/* ──────────────────────────────────────────────
   SHARED BASE CHART OPTIONS
────────────────────────────────────────────── */
function getBaseChartOptions(titleText) {
    return {
        responsive:          true,
        maintainAspectRatio: false,
        interaction:         { mode: 'index', intersect: false },
        plugins: {
            legend: {
                display:  true,
                position: 'bottom',
                labels: {
                    color:           '#a7c4a8',
                    font:            { size: 11 },
                    usePointStyle:   true,
                    pointStyleWidth: 10,
                    boxHeight:       8,
                    padding:         12,
                },
            },
            title: {
                display: !!titleText,
                text:    titleText,
                color:   '#a7c4a8',
                font:    { size: 13, weight: '600' },
                padding: { bottom: 10 },
            },
            tooltip: {
                backgroundColor: '#0e1510',
                borderColor:     'rgba(74,222,128,0.25)',
                borderWidth:     1,
                titleColor:      '#e8f5e9',
                bodyColor:       '#a7c4a8',
                padding:         10,
                callbacks: {
                    label: ctx => ` ${ctx.dataset.label}: ₹${ctx.raw.toLocaleString('en-IN')}`,
                },
            },
        },
        animation: { duration: 700, easing: 'easeOutQuart' },
    };
}

/* ══════════════════════════════════════════════
   PRICE COMPARISON TABLE
══════════════════════════════════════════════ */
function buildPriceTable(markets) {
    const tbody = document.getElementById('priceTableBody');
    if (!tbody) return;

    const cities   = Object.keys(markets);
    const cropSet  = new Set();
    Object.values(markets).forEach(crops => crops.forEach(c => cropSet.add(c.crop)));
    const allCrops = Array.from(cropSet).sort();

    const lookup = {};
    Object.entries(markets).forEach(([city, crops]) => {
        lookup[city] = {};
        crops.forEach(c => { lookup[city][c.crop] = c; });
    });

    const displayCities = cities.slice(0, 10);

    tbody.innerHTML = allCrops.map(cropName => {
        const cells = displayCities.map(city => {
            const item = lookup[city]?.[cropName];
            if (!item) return `<td class="not-available">—</td>`;

            const color  = item.change >= 2  ? '#4ade80' :
                           item.change <= -2 ? '#f87171' : 'var(--text)';
            const arrow  = item.change >= 0.5  ? '▲' :
                           item.change <= -0.5 ? '▼' : '–';
            const dClass = getDemandClass(item.demand);
            return `
            <td>
                <div style="color:${color};font-weight:700">
                    ₹${item.price.toLocaleString('en-IN')}
                    <span style="font-size:0.62rem;opacity:0.7"> ${arrow}</span>
                </div>
                <div class="cr-demand demand-${dClass}" style="display:inline-flex;font-size:0.58rem;padding:1px 5px;margin-top:2px">
                    ${tDemand(item.demand)}
                </div>
            </td>`;
        });

        return `<tr>
            <td><strong>${tCrop(cropName)}</strong></td>
            ${cells.join('')}
        </tr>`;
    }).join('');

    const thead = document.querySelector('.price-table thead tr');
    if (thead) {
        thead.innerHTML =
            `<th>${_t('Crop') || 'Crop'}</th>` +
            displayCities.map(c => `<th>${c}</th>`).join('');
    }
}

function reRenderMarket() {
    if (Object.keys(allMarketData).length === 0) return;

    const subtitle = document.getElementById('marketSubtitle');
    const search   = document.getElementById('locationSearch');
    if (subtitle && search && !search.value) {
        subtitle.textContent = _t('Showing all major Indian markets') || 'Showing all major Indian markets';
    }

    renderMarketGrid(allMarketData);
    buildTicker(allMarketData);
    buildPriceTable(allMarketData);
    buildChart(allMarketData, currentChartCity, activeChartType);
}

document.addEventListener('langChanged', (e) => {
    const lang = e.detail?.lang || 'en';
    loadTranslations(lang);
});