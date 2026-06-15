/* ═══════════════════════════════════════════════════════════════
   market_translate.js — SmartAgro
   Handles dynamic re-translation of all rendered market data
   when the user switches language — without re-fetching market API.

   HOW IT WORKS:
   1. Market API returns crops with "crop_key" (always English).
   2. Each rendered crop element carries:
        data-crop-key="Wheat"
        data-demand-key="Very High"
   3. On language switch, this module calls /api/translate-market,
      caches the result, then walks the DOM updating every element.
   4. Works for: crop cards, price tables, chart labels, filter pills.

   INTEGRATION:
   - Include this file in market.html after translations.js
   - Call initMarketTranslation() once after page load
   - The setLanguage() hook in translations.js calls
     window.reTranslateMarket() automatically if defined
═══════════════════════════════════════════════════════════════ */

(function() {
    'use strict';

    // In-memory translation map: { lang: { "Wheat": "गेहूं", ... } }
    const _cache = {};
    let _currentLang = 'en';
    let _pending = false;

    /* ── Public API ───────────────────────────────────────────── */

    /**
     * Translate an English crop/demand key using the current cache.
     * Falls back to the English key if not found.
     */
    function tMarket(englishKey) {
        if (_currentLang === 'en' || !englishKey) return englishKey;
        const map = _cache[_currentLang];
        if (!map) return englishKey;
        return map[englishKey] || englishKey;
    }

    /**
     * Translate a demand string ("Very High", "High", "Medium", "Low")
     * to the current language using the translation cache.
     */
    function tDemand(demandKey) {
        return tMarket(demandKey);
    }

    /**
     * Call after rendering any market HTML to stamp English keys onto
     * elements so they can be re-translated on language switch.
     *
     * Usage:
     *   element.setAttribute('data-crop-key', cropEnglishName);
     *   element.setAttribute('data-demand-key', demandEnglishValue);
     *
     * This function is called automatically by reTranslateMarket().
     */
    function applyMarketTranslations() {
        const map = _currentLang === 'en' ? null : (_cache[_currentLang] || null);

        // Translate crop name elements: [data-crop-key]
        document.querySelectorAll('[data-crop-key]').forEach(el => {
            const key = el.getAttribute('data-crop-key');
            el.textContent = map ? (map[key] || key) : key;
        });

        // Translate demand badge elements: [data-demand-key]
        document.querySelectorAll('[data-demand-key]').forEach(el => {
            const key = el.getAttribute('data-demand-key');
            el.textContent = map ? (map[key] || key) : key;
        });

        // Translate source badge: [data-source-label]
        document.querySelectorAll('[data-source-label]').forEach(el => {
            const key = el.getAttribute('data-source-label');
            el.textContent = map ? (map[key] || key) : key;
        });

        // Translate chart crop labels inside canvas/chart wrappers
        // These are text nodes in chart legend items: [data-chart-crop-key]
        document.querySelectorAll('[data-chart-crop-key]').forEach(el => {
            const key = el.getAttribute('data-chart-crop-key');
            el.textContent = map ? (map[key] || key) : key;
        });

        // Translate table header cells that use data-translate-key
        document.querySelectorAll('[data-translate-market]').forEach(el => {
            const key = el.getAttribute('data-translate-market');
            el.textContent = map ? (map[key] || key) : key;
        });
    }

    /**
     * Fetch translations for a given language, cache them, then apply.
     * Safe to call multiple times — uses cache after first fetch.
     */
    async function fetchAndApply(lang) {
        if (_pending) return;
        _currentLang = lang;

        if (lang === 'en') {
            applyMarketTranslations();
            return;
        }

        if (_cache[lang]) {
            applyMarketTranslations();
            return;
        }

        _pending = true;
        try {
            const resp = await fetch('/api/translate-market', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lang })
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data.translations && Object.keys(data.translations).length > 0) {
                    _cache[lang] = data.translations;
                    console.log(`[MarketTranslate] Cached ${Object.keys(data.translations).length} terms for ${lang}`);
                }
            }
        } catch (e) {
            console.warn('[MarketTranslate] Fetch failed:', e);
        } finally {
            _pending = false;
        }

        applyMarketTranslations();
    }

    /**
     * Called by translations.js setLanguage() hook.
     * Exposed on window so translations.js can call it.
     */
    window.reTranslateMarket = function(lang) {
        lang = lang || (typeof currentLang !== 'undefined' ? currentLang : 'en');
        fetchAndApply(lang);
    };

    /**
     * Called once from market page JS after market data is rendered.
     * Translates immediately if a non-English language is already selected.
     */
    window.initMarketTranslation = function() {
        const lang = (typeof currentLang !== 'undefined' ? currentLang : null) ||
            localStorage.getItem('agrosmart_lang') ||
            'en';
        _currentLang = lang;
        fetchAndApply(lang);
    };

    /**
     * Expose tMarket and tDemand for use in market.js when building HTML.
     * Since translation may be async on first load, always call
     * initMarketTranslation() AFTER rendering, and also use
     * data-crop-key / data-demand-key attributes for future re-renders.
     */
    window.tMarket = tMarket;
    window.tDemand = tDemand;
    window.applyMarketTranslations = applyMarketTranslations;

})();


/* ════════════════════════════════════════════════════════════════
   PATCH FOR translations.js setLanguage()
   Appends market re-translation to the existing setLanguage hook.
   Place this AFTER translations.js and market_translate.js are loaded.
════════════════════════════════════════════════════════════════ */
(function patchSetLanguage() {
    const _originalSetLanguage = window.setLanguage;
    if (typeof _originalSetLanguage !== 'function') return;

    window.setLanguage = function(code) {
        _originalSetLanguage(code);
        // Re-translate market data if market elements exist on this page
        if (document.querySelector('[data-crop-key]') || document.getElementById('marketsContainer')) {
            window.reTranslateMarket(code);
        }
    };
})();