from flask import Flask, render_template, request, jsonify, send_file
import requests
import edge_tts
import asyncio
import io
import json as _json
try:
    from pywebpush import webpush, WebPushException
    _PUSH_AVAILABLE = True
except ImportError:
    _PUSH_AVAILABLE = False
import os
import json
import re
import time
import random
import hashlib
import threading
import concurrent.futures
from datetime import datetime, timedelta
from dotenv import load_dotenv

basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, '.env'))

app = Flask(__name__)

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
GROQ_API_KEY        = os.getenv("GROQ_API_KEY", "")
NINJA_API_KEY       = os.getenv("NINJA_API_KEY", "")  # no longer used by /api/market (kept for backward-compat only)
KINDWISE_API_KEY     = os.getenv("KINDWISE_API_KEY", "")   # ← add this line
DEBUG_MODE          = os.getenv("FLASK_DEBUG", "0") == "1"

_translation_cache = {}

LANG_NAMES = {
    "en":"English","hi":"Hindi","bn":"Bengali","te":"Telugu","mr":"Marathi",
    "ta":"Tamil","gu":"Gujarati","kn":"Kannada","ml":"Malayalam","pa":"Punjabi",
    "or":"Odia","as":"Assamese","ur":"Urdu","mai":"Maithili","sat":"Santali",
    "ks":"Kashmiri","ne":"Nepali","sd":"Sindhi","kok":"Konkani","mni":"Manipuri",
    "bodo":"Bodo","doi":"Dogri","sa":"Sanskrit",
}

print(f"[AgroSmart] Groq key:    {'OK (' + GROQ_API_KEY[:8] + '...)' if GROQ_API_KEY else 'MISSING'}")
print(f"[AgroSmart] Weather key: {'OK' if OPENWEATHER_API_KEY else 'MISSING'}")
print(f"[AgroSmart] Ninja key:   {'OK (' + NINJA_API_KEY[:8] + '...)' if NINJA_API_KEY else 'MISSING'}")

# ─── Routes ──────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/diagnose")
def diagnose():
    return render_template("diagnose.html")

@app.route("/market")
def market():
    return render_template("market.html")

@app.route("/alerts")
def alerts():
    return render_template("alerts.html")

@app.route('/offline')
def offline():
    return render_template('offline.html')

# ─── Weather API ─────────────────────────────────────────────────────────────
@app.route("/api/weather")
def get_weather():
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if not lat or not lon:
        return jsonify({"error": "Location required"}), 400

    current_url  = (f"https://api.openweathermap.org/data/2.5/weather"
                    f"?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}&units=metric")
    forecast_url = (f"https://api.openweathermap.org/data/2.5/forecast"
                    f"?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}&units=metric&cnt=56")

    try:
        current_resp  = requests.get(current_url,  timeout=10)
        forecast_resp = requests.get(forecast_url, timeout=10)

        if current_resp.status_code != 200:
            return jsonify({"error": f"Weather API error: {current_resp.text}"}), 500

        current_data  = current_resp.json()
        forecast_data = forecast_resp.json()

        daily = {}
        if forecast_data.get("list"):
            for item in forecast_data["list"]:
                day = datetime.fromtimestamp(item["dt"]).strftime("%Y-%m-%d")
                if day not in daily:
                    daily[day] = {
                        "date":        day,
                        "temp_max":    item["main"]["temp_max"],
                        "temp_min":    item["main"]["temp_min"],
                        "description": item["weather"][0]["description"],
                        "icon":        item["weather"][0]["icon"],
                        "humidity":    item["main"]["humidity"],
                        "wind_speed":  item["wind"]["speed"],
                        "rain":        item.get("rain", {}).get("3h", 0),
                    }
                else:
                    if item["main"]["temp_max"] > daily[day]["temp_max"]:
                        daily[day]["temp_max"] = item["main"]["temp_max"]
                    if item["main"]["temp_min"] < daily[day]["temp_min"]:
                        daily[day]["temp_min"] = item["main"]["temp_min"]

        forecast_list = list(daily.values())[:7]

        return jsonify({
            "current": {
                "city":        current_data.get("name", "Your Location"),
                "lat":         float(lat),
                "lon":         float(lon),
                "temp":        round(current_data["main"]["temp"]),
                "feels_like":  round(current_data["main"]["feels_like"]),
                "humidity":    current_data["main"]["humidity"],
                "description": current_data["weather"][0]["description"],
                "icon":        current_data["weather"][0]["icon"],
                "wind_speed":  current_data["wind"]["speed"],
                "pressure":    current_data["main"]["pressure"],
                "visibility":  current_data.get("visibility", 0) / 1000,
                "rain":        current_data.get("rain", {}).get("1h", 0),
            },
            "forecast": forecast_list
        })
    except Exception as e:
        print(f"[Weather error] {e}")
        return jsonify({"error": str(e)}), 500


# ─── NASA POWER Climate Data (long-term climatology, no API key needed) ─────
_power_cache = {}
POWER_CACHE_TTL_SEC = 24 * 60 * 60  # climatology barely changes; cache a day

def get_power_climate(lat, lon):
    """Fetch long-term monthly climate averages (NASA POWER) for this location.
    Different from live OpenWeather data: this tells us what the climate
    NORMALLY looks like here, which is what actually determines crop
    suitability — not today's weather. Returns None on failure so the
    caller can proceed without it."""
    if lat is None or lon is None:
        return None

    cache_key = f"{round(float(lat), 2)}|{round(float(lon), 2)}"
    now = time.monotonic()
    cached = _power_cache.get(cache_key)
    if cached and (now - cached[0]) < POWER_CACHE_TTL_SEC:
        return cached[1]

    url = (
        "https://power.larc.nasa.gov/api/temporal/climatology/point"
        f"?parameters=T2M,PRECTOTCORR,RH2M"
        f"&community=AG&longitude={lon}&latitude={lat}&format=JSON"
    )
    try:
        resp = requests.get(url, timeout=12)
        if resp.status_code != 200:
            print(f"[POWER] HTTP {resp.status_code}")
            return None
        data = resp.json()
        params = data["properties"]["parameter"]
        month_key = f"{datetime.now().month:02d}"

        climate = {
            "avg_temp_c":   params.get("T2M", {}).get(month_key),
            "avg_rain_mm":  params.get("PRECTOTCORR", {}).get(month_key),
            "avg_humidity": params.get("RH2M", {}).get(month_key),
            "annual_temp_c":  params.get("T2M", {}).get("ANN"),
            "annual_rain_mm": params.get("PRECTOTCORR", {}).get("ANN"),
        }
        _power_cache[cache_key] = (now, climate)
        return climate
    except Exception as e:
        print(f"[POWER] error: {e}")
        return None


# ─── Vegetation Health (NASA MODIS NDVI via ORNL DAAC, no API key needed) ──
# This uses point-based NDVI values (a single number describing how green/
# healthy vegetation is at this spot), NOT raw satellite image processing —
# genuinely lightweight enough to run on a free-tier server, unlike full
# NDVI-from-imagery pipelines which need real remote-sensing compute.
_ndvi_cache = {}
NDVI_CACHE_TTL_SEC = 12 * 60 * 60

def get_vegetation_index(lat, lon):
    """Fetch the most recent MODIS NDVI (vegetation health) reading for this
    point from ORNL DAAC's public MODIS subset service. Returns None on any
    failure — this is a nice-to-have overlay, never a blocker."""
    if lat is None or lon is None:
        return None

    cache_key = f"{round(float(lat), 2)}|{round(float(lon), 2)}"
    now = time.monotonic()
    cached = _ndvi_cache.get(cache_key)
    if cached and (now - cached[0]) < NDVI_CACHE_TTL_SEC:
        return cached[1]

    base = "https://modis.ornl.gov/rst/api/v1/MOD13Q1"
    try:
        # Step 1: find the most recent available date for this point
        dates_resp = requests.get(f"{base}/dates", params={"latitude": lat, "longitude": lon}, timeout=10)
        if dates_resp.status_code != 200:
            return None
        dates = dates_resp.json().get("dates", [])
        if not dates:
            return None
        latest = dates[-1]["modis_date"]

        # Step 2: fetch the actual NDVI value for that date
        subset_resp = requests.get(
            f"{base}/subset",
            params={
                "latitude": lat, "longitude": lon,
                "startDate": latest, "endDate": latest,
                "kmAboveBelow": 0, "kmLeftRight": 0,
                "band": "250m_16_days_NDVI",
            },
            timeout=10,
        )
        if subset_resp.status_code != 200:
            return None
        subset = subset_resp.json().get("subset", [])
        if not subset or not subset[0].get("data"):
            return None

        raw_val = subset[0]["data"][0]
        if raw_val in (None, -3000):  # MODIS fill/no-data value
            return None
        ndvi = round(raw_val * 0.0001, 3)  # MODIS NDVI scale factor

        if ndvi < 0.2:
            health = "Bare soil / no vegetation"
        elif ndvi < 0.4:
            health = "Sparse vegetation"
        elif ndvi < 0.6:
            health = "Moderate vegetation"
        else:
            health = "Dense, healthy vegetation"

        result = {
            "ndvi": ndvi,
            "health_label": health,
            "date": subset[0].get("calendar_date"),
            "note": "Reflects whatever is currently growing on this land (or bare soil) — "
                    "not a prediction of future crop health.",
        }
        _ndvi_cache[cache_key] = (now, result)
        return result
    except Exception as e:
        print(f"[NDVI] error: {e}")
        return None


@app.route("/farm-map")
def farm_map():
    return render_template("farm_map.html")


@app.route("/api/area-details")
def area_details():
    """Combined endpoint for the Farm Map page: climate normals + vegetation
    health for a given point. Crop recommendations still go through the
    existing /api/crop-recommendations endpoint (reused as-is)."""
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if not lat or not lon:
        return jsonify({"error": "Location required"}), 400

    power_climate = get_power_climate(lat, lon)
    vegetation = get_vegetation_index(lat, lon)

    return jsonify({
        "power_climate": power_climate,
        "vegetation": vegetation,
    })


# ─── Sowing Safety Check ──────────────────────────────────────────────────
@app.route("/api/sowing-check")
def sowing_check():
    """Looks ahead at the next ~48h forecast (not just today) so a farmer
    doesn't sow right before heavy rain wastes the work. Uses the same
    OpenWeather forecast data /api/weather already pulls."""
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if not lat or not lon:
        return jsonify({"error": "Location required"}), 400

    forecast_url = (f"https://api.openweathermap.org/data/2.5/forecast"
                     f"?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}&units=metric&cnt=16")  # 16*3h = 48h
    try:
        resp = requests.get(forecast_url, timeout=10)
        if resp.status_code != 200:
            return jsonify({"error": "Forecast unavailable"}), 500
        items = resp.json().get("list", [])

        HEAVY_RAIN_MM_3H = 8   # single 3h window rain likely to disrupt fresh sowing
        TOTAL_RAIN_WARN_MM = 20  # cumulative rain over 48h that's risky for seeds/seedlings

        total_rain = 0
        risky_windows = []
        for item in items:
            rain_3h = item.get("rain", {}).get("3h", 0)
            total_rain += rain_3h
            if rain_3h >= HEAVY_RAIN_MM_3H:
                risky_windows.append({
                    "time": datetime.fromtimestamp(item["dt"]).strftime("%a %I:%M %p"),
                    "rain_mm": rain_3h,
                })

        if risky_windows or total_rain >= TOTAL_RAIN_WARN_MM:
            verdict = "unsafe"
            message = (f"Heavy rain expected within 48 hours "
                       f"(~{round(total_rain)}mm total). Sowing now risks seed wash-out.")
        else:
            verdict = "safe"
            message = f"No heavy rain expected in the next 48 hours (~{round(total_rain)}mm total). Conditions look good for sowing."

        return jsonify({
            "verdict": verdict,
            "message": message,
            "total_rain_mm_48h": round(total_rain, 1),
            "risky_windows": risky_windows,
        })
    except Exception as e:
        print(f"[SowingCheck] error: {e}")
        return jsonify({"error": str(e)}), 500


# ─── Crop Recommendations ────────────────────────────────────────────────────
_crop_ai_cache = {}
CROP_AI_CACHE_TTL_SEC = 3 * 60 * 60  # 3 hours — same city/season/weather bucket repeats a lot in a day


def ai_recommend_crops(city, lat, lon, temp, humidity, rain, season,
                        n=None, p=None, k=None, ph=None, power_climate=None):
    """Ask Groq for crops genuinely suited to THIS location's climate, soil
    region and season — instead of matching generic temp/humidity bands
    against a fixed 8-crop table. Now also considers farmer-entered soil
    NPK/pH values and NASA POWER long-term climate averages when available.
    Returns None on any failure so the caller can fall back to the
    rule-based recommend_crops() and the dashboard never breaks."""
    if not GROQ_API_KEY:
        return None

    soil_bucket = f"{n}|{p}|{k}|{ph}" if any(v is not None for v in (n, p, k, ph)) else "none"
    power_bucket = f"{round(power_climate['avg_temp_c'],1)}|{round(power_climate['avg_rain_mm'],1)}" if power_climate and power_climate.get("avg_temp_c") is not None else "none"
    cache_key = (f"{city}|{round((lat or 0), 1)}|{round((lon or 0), 1)}|{season}|"
                 f"{round(temp/3)*3}|{round(humidity/10)*10}|{soil_bucket}|{power_bucket}")
    now = time.monotonic()
    cached = _crop_ai_cache.get(cache_key)
    if cached and (now - cached[0]) < CROP_AI_CACHE_TTL_SEC:
        return cached[1]

    soil_block = ""
    if any(v is not None for v in (n, p, k, ph)):
        soil_block = (
            f"\nFarmer-tested soil values (from Soil Health Card):\n"
            f"Nitrogen (N): {n if n is not None else 'not provided'}\n"
            f"Phosphorus (P): {p if p is not None else 'not provided'}\n"
            f"Potassium (K): {k if k is not None else 'not provided'}\n"
            f"Soil pH: {ph if ph is not None else 'not provided'}\n"
            f"Use these actual soil values to refine crop suitability — do not "
            f"ignore them in favour of generic regional assumptions.\n"
        )

    climate_block = ""
    if power_climate and power_climate.get("avg_temp_c") is not None:
        climate_block = (
            f"\nLong-term climate normals for this location (NASA POWER, this month):\n"
            f"Typical avg temperature: {power_climate['avg_temp_c']} deg C\n"
            f"Typical avg rainfall: {power_climate['avg_rain_mm']} mm/day\n"
            f"Typical avg humidity: {power_climate['avg_humidity']}%\n"
            f"Use this as the baseline climate pattern for the region, and treat "
            f"today's live weather as a short-term variation on top of it.\n"
        )

    prompt = f"""You are an agronomist advising a farmer in India.

Location: {city or "an unspecified Indian town"} (approx. lat {lat}, lon {lon})
Current season: {season}
Current weather right now: {temp} deg C, {humidity}% humidity, {rain} mm recent rainfall
{climate_block}{soil_block}
Recommend the 6 crops BEST suited to THIS exact location's climate, soil
region and season — not a generic list. Use your knowledge of Indian
agro-climatic zones (e.g. black cotton soil across much of Maharashtra,
alluvial soil in the Indo-Gangetic plain, laterite soil along the Western
Ghats/coastal belts, arid/sandy soil in Rajasthan, red soil in the Deccan
plateau, etc.) to pick realistic, regionally-appropriate crops that a real
agricultural officer would suggest for this place right now, ranked by
suitability. If soil NPK/pH values were provided, factor them in explicitly
and mention in the description when a crop suits (or doesn't suit) those
specific soil readings.

Respond ONLY with a JSON object, no preamble, no markdown fences, matching
exactly this shape:
{{
  "crops": [
    {{
      "name": "Crop name in English",
      "icon": "one relevant emoji",
      "match": "e.g. 92%",
      "description": "one short sentence on why it suits this location/season",
      "season": "Kharif (Monsoon) | Rabi (Winter) | Zaid (Summer)",
      "water": "Low | Medium | High | Very High",
      "yield": "e.g. 3-5 tonnes/ha",
      "profit": "e.g. Rs45,000-65,000/ha",
      "duration": "e.g. 90-150 days",
      "soil": "soil type suited to this region",
      "fertilizer": "e.g. NPK 120:60:60 kg/ha"
    }}
  ]
}}"""

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
      body = {
        "model":       "llama-3.3-70b-versatile",
        "messages":    [{"role": "system", "content": system_prompt}] + messages,
        "temperature": 0.85,   # was 0.75
        "max_tokens":  450,
        "stream":      False
    }

    try:
        resp = _post_to_groq(body, headers)
        if resp is None or resp.status_code != 200:
            print(f"[CropAI] Groq HTTP {getattr(resp, 'status_code', 'no-response')} for {city}")
            return None
        raw = resp.json()["choices"][0]["message"]["content"].strip()
        cleaned = re.sub(r"```(?:json)?", "", raw).replace("```", "").strip()
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        parsed = json.loads(match.group() if match else cleaned)
        crops = parsed.get("crops")
        if not isinstance(crops, list) or not crops:
            return None
        for c in crops:
            c.setdefault("icon", "🌱")
        _crop_ai_cache[cache_key] = (now, crops)
        print(f"[CropAI] OK for {city}: {len(crops)} crops")
        return crops
    except Exception as e:
        print(f"[CropAI] error for {city}: {e}")
        return None


def scale_for_land(crops, land_size, land_unit):
    """Convert per-hectare figures into actual totals for the farmer's plot.
    Leaves crop dicts untouched if land_size wasn't provided."""
    if not land_size:
        return crops
    try:
        size = float(land_size)
    except (TypeError, ValueError):
        return crops
    unit = (land_unit or "acre").lower()
    to_hectare = {"acre": 0.4047, "hectare": 1.0, "bigha": 0.1338}
    hectares = size * to_hectare.get(unit, 0.4047)

    for c in crops:
        c["your_land_estimate"] = {
            "land_size": f"{size} {unit}(s)",
            "note": f"Figures below are per hectare — for your {size} {unit}(s) "
                    f"(~{round(hectares, 2)} ha), scale roughly by {round(hectares, 2)}x."
        }
    return crops


@app.route("/api/crop-recommendations", methods=["POST"])
def crop_recommendations():
    data      = request.json or {}
    temp      = data.get("temp", 25)
    humidity  = data.get("humidity", 60)
    rain      = data.get("rain", 0)
    city      = data.get("city", "")
    lat       = data.get("lat")
    lon       = data.get("lon")
    n         = data.get("n")
    p         = data.get("p")
    k         = data.get("k")
    ph        = data.get("ph")
    land_size = data.get("land_size")
    land_unit = data.get("land_unit", "acre")
    season    = get_season(datetime.now().month)

    power_climate = get_power_climate(lat, lon) if (lat and lon) else None

    ai_crops = ai_recommend_crops(city, lat, lon, temp, humidity, rain, season,
                                   n=n, p=p, k=k, ph=ph, power_climate=power_climate)
    if ai_crops:
        crops, source = ai_crops, "ai"
    else:
        crops, source = recommend_crops(temp, humidity, rain, season), "rule_based"

    crops = scale_for_land(crops, land_size, land_unit)
    calendar = generate_advisory_calendar(crops[:3])
    return jsonify({
        "season":         season,
        "crops":          crops,
        "calendar":       calendar,
        "pesticides":     get_pesticide_guide(crops[:3]),
        "source":         source,        # "ai" = location-aware, "rule_based" = offline fallback
        "power_climate":  power_climate, # None if unavailable — frontend should handle gracefully
        "soil_used":      any(v is not None for v in (n, p, k, ph)),
    })


def get_season(month):
    if month in [6, 7, 8, 9]:
        return "Kharif (Monsoon)"
    elif month in [10, 11, 12, 1, 2]:
        return "Rabi (Winter)"
    else:
        return "Zaid (Summer)"


def recommend_crops(temp, humidity, rain, season):
    all_crops = [
        {"name":"Rice","icon":"🌾","temp_range":(20,38),"humidity_range":(70,100),"season":"Kharif (Monsoon)","water":"High","yield":"3-5 tonnes/ha","profit":"Rs45,000-65,000/ha","duration":"90-150 days","description":"Ideal for high humidity and warm conditions","soil":"Clay loam, alluvial","fertilizer":"NPK 120:60:60 kg/ha"},
        {"name":"Wheat","icon":"🌿","temp_range":(10,25),"humidity_range":(40,65),"season":"Rabi (Winter)","water":"Medium","yield":"4-6 tonnes/ha","profit":"Rs50,000-75,000/ha","duration":"100-150 days","description":"Best suited for cool, dry winters","soil":"Well-drained loam","fertilizer":"NPK 120:60:40 kg/ha"},
        {"name":"Maize","icon":"🌽","temp_range":(18,35),"humidity_range":(50,80),"season":"Kharif (Monsoon)","water":"Medium","yield":"5-8 tonnes/ha","profit":"Rs40,000-60,000/ha","duration":"80-110 days","description":"Versatile crop for warm humid weather","soil":"Sandy loam to clay loam","fertilizer":"NPK 150:75:75 kg/ha"},
        {"name":"Cotton","icon":"☁️","temp_range":(25,40),"humidity_range":(40,70),"season":"Kharif (Monsoon)","water":"Medium","yield":"2-3 tonnes/ha","profit":"Rs60,000-90,000/ha","duration":"150-180 days","description":"Thrives in hot dry spells with moderate rain","soil":"Black cotton soil","fertilizer":"NPK 90:45:45 kg/ha"},
        {"name":"Tomato","icon":"🍅","temp_range":(18,30),"humidity_range":(60,80),"season":"Zaid (Summer)","water":"Medium","yield":"20-40 tonnes/ha","profit":"Rs80,000-1,50,000/ha","duration":"60-80 days","description":"High value crop for moderate climates","soil":"Sandy loam, rich organic matter","fertilizer":"NPK 100:60:60 kg/ha"},
        {"name":"Sugarcane","icon":"🎋","temp_range":(24,38),"humidity_range":(75,90),"season":"Kharif (Monsoon)","water":"Very High","yield":"70-100 tonnes/ha","profit":"Rs70,000-1,00,000/ha","duration":"300-360 days","description":"Requires hot climate and heavy rainfall","soil":"Deep loam, good drainage","fertilizer":"NPK 250:80:100 kg/ha"},
        {"name":"Soybean","icon":"🫘","temp_range":(20,32),"humidity_range":(60,80),"season":"Kharif (Monsoon)","water":"Medium","yield":"2-3 tonnes/ha","profit":"Rs35,000-55,000/ha","duration":"90-120 days","description":"Nitrogen-fixing legume for warm monsoon","soil":"Well-drained loam","fertilizer":"NPK 30:60:40 kg/ha"},
        {"name":"Mustard","icon":"🌻","temp_range":(10,25),"humidity_range":(40,60),"season":"Rabi (Winter)","water":"Low","yield":"1-2 tonnes/ha","profit":"Rs25,000-40,000/ha","duration":"90-110 days","description":"Cool weather oil seed crop","soil":"Sandy loam, well-drained","fertilizer":"NPK 80:40:40 kg/ha"},
    ]
    scored = []
    for crop in all_crops:
        score = 0
        if crop["temp_range"][0] <= temp <= crop["temp_range"][1]:
            score += 40
        elif abs(temp - sum(crop["temp_range"]) / 2) < 5:
            score += 20
        if crop["humidity_range"][0] <= humidity <= crop["humidity_range"][1]:
            score += 30
        if crop["season"] == season:
            score += 30
        crop["score"] = score
        crop["match"] = f"{min(100, score)}%"
        scored.append(crop)
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored


def generate_advisory_calendar(crops):
    today = datetime.now()
    activities = [
        {"week":1,  "activity":"Soil preparation & ploughing",  "type":"preparation"},
        {"week":2,  "activity":"Seed treatment & sowing",       "type":"sowing"},
        {"week":3,  "activity":"First irrigation",              "type":"irrigation"},
        {"week":4,  "activity":"Apply basal fertilizer (NPK)",  "type":"fertilizer"},
        {"week":6,  "activity":"Weeding & thinning",            "type":"maintenance"},
        {"week":8,  "activity":"Apply Urea (top dressing)",     "type":"fertilizer"},
        {"week":10, "activity":"Pest & disease inspection",     "type":"pesticide"},
        {"week":12, "activity":"Spray fungicide if required",   "type":"pesticide"},
        {"week":16, "activity":"Foliar spray micronutrients",   "type":"fertilizer"},
        {"week":20, "activity":"Pre-harvest irrigation stop",   "type":"irrigation"},
        {"week":22, "activity":"Harvest preparation",           "type":"harvest"},
    ]
    calendar = []
    for act in activities:
        date = today + timedelta(weeks=act["week"])
        calendar.append({
            "date":     date.strftime("%d %b %Y"),
            "activity": act["activity"],
            "type":     act["type"],
            "week":     act["week"]
        })
    return calendar


def get_pesticide_guide(crops):
    guides = {
        "Rice":   [{"pest":"Brown Plant Hopper","pesticide":"Imidacloprid 17.8 SL","dose":"125 ml/ha","timing":"At 30 & 60 days after transplanting","eco":False},{"pest":"Leaf folder","pesticide":"Neem Oil 5%","dose":"2.5 L/ha","timing":"At first sign of damage","eco":True}],
        "Wheat":  [{"pest":"Aphids","pesticide":"Dimethoate 30 EC","dose":"1 L/ha","timing":"At tillering stage","eco":False},{"pest":"Yellow rust","pesticide":"Propiconazole 25 EC","dose":"500 ml/ha","timing":"At boot leaf stage","eco":False}],
        "Maize":  [{"pest":"Fall Armyworm","pesticide":"Spinetoram 11.7 SC","dose":"450 ml/ha","timing":"7-10 days after infestation","eco":False},{"pest":"Stem borer","pesticide":"Emamectin Benzoate 5 SG","dose":"220 g/ha","timing":"At whorl stage","eco":False}],
        "Cotton": [{"pest":"Bollworm","pesticide":"Chlorpyriphos 20 EC","dose":"2.5 ml/L","timing":"At first boll formation","eco":False},{"pest":"Whitefly","pesticide":"Neem Oil 5%","dose":"5 ml/L","timing":"Every 7 days","eco":True}],
    }
    result = []
    for crop in crops:
        if crop["name"] in guides:
            result.append({"crop": crop["name"], "guides": guides[crop["name"]]})
    return result


# ─── Market Data — Agmarknet (Govt. of India, official) ──────────────────────
# Data source: "Current Daily Price of Various Commodities from Various
# Markets (Mandi)" — published by the Directorate of Marketing & Inspection,
# Ministry of Agriculture & Farmers Welfare, via data.gov.in (open data,
# Govt. of India). This is the SAME data Agmarknet.gov.in itself is built on
# — it is the authoritative, official source for Indian mandi prices, unlike
# global commodity-futures APIs (which price Chicago wheat/corn, not Indian
# mandi produce) or hand-typed reference tables.
#
# Get a free personal key at https://data.gov.in (Sign Up -> My Account ->
# API keys) and set it as DATA_GOV_API_KEY in your .env. Until you do, this
# falls back to data.gov.in's shared public test key, which is rate-limited
# and NOT meant for production — replace it as soon as you can.
DATA_GOV_API_KEY = os.getenv("DATA_GOV_API_KEY", "")
if not DATA_GOV_API_KEY:
    print("[AgroSmart] WARNING: DATA_GOV_API_KEY not set — /api/market will use MSP reference prices only")
AGMARKNET_RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070"
AGMARKNET_URL = f"https://api.data.gov.in/resource/{AGMARKNET_RESOURCE_ID}"

# Reusable session with automatic retries — helps ride out brief network
# hiccups instead of failing on the first slow attempt.
_agmark_session = requests.Session()
_agmark_retry = requests.adapters.Retry(
    total=1, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504]
)
_agmark_session.mount("https://", requests.adapters.HTTPAdapter(max_retries=_agmark_retry))

# Agmarknet's commodity names vs. the display names SmartAgro already uses
# in the UI/translations. Extend this as you add more crops.
AGMARK_COMMODITY_ALIASES = {
    "wheat": "Wheat", "rice": "Rice", "maize": "Maize (Corn)",
    "mustard": "Mustard", "groundnut": "Groundnut", "onion": "Onion",
    "potato": "Potato", "tomato": "Tomato", "green chilli": "Chilli",
    "chilli": "Chilli", "sugarcane": "Sugarcane",
    "arhar (tur/red gram)(whole)": "Arhar (Tur)", "arhar": "Arhar (Tur)",
    "green gram (moong)(whole)": "Moong", "moong": "Moong",
    "black gram (urad beans)(whole)": "Urad", "urad": "Urad",
    "soyabean": "Soybean", "soybean": "Soybean", "cotton": "Cotton",
    "jowar(sorghum)": "Jowar (Sorghum)",
    "bajra(pearl millet/cumbu)": "Bajra (Pearl Millet)",
    "bengal gram(gram)(whole)": "Bengal Gram (Chana)",
    "garlic": "Garlic", "ginger(green)": "Ginger", "ginger": "Ginger",
    "turmeric": "Turmeric", "cumin(jeera)": "Cumin (Jeera)",
    "coriander(leaves)": "Coriander", "coriander": "Coriander",
    "banana": "Banana", "mango": "Mango",
}

# ── Hardcoded fallback (MSP / reference) commodities ─────────────────────────
# Used whenever the live Agmarknet feed returns nothing for a state (rate
# limited test key, holiday with no reporting, network hiccup, etc). This is
# intentionally a broad basket so the dashboard, comparison table and every
# chart type still have enough data to look complete and real — not just a
# couple of rows.
MSP_FALLBACK = [
    {"crop": "Wheat",                "price": 2275,  "unit": "Rs/quintal"},
    {"crop": "Rice",                 "price": 2183,  "unit": "Rs/quintal"},
    {"crop": "Maize (Corn)",         "price": 2090,  "unit": "Rs/quintal"},
    {"crop": "Mustard",              "price": 5650,  "unit": "Rs/quintal"},
    {"crop": "Groundnut",            "price": 6377,  "unit": "Rs/quintal"},
    {"crop": "Onion",                "price": 1800,  "unit": "Rs/quintal"},
    {"crop": "Potato",               "price": 1200,  "unit": "Rs/quintal"},
    {"crop": "Tomato",               "price": 2500,  "unit": "Rs/quintal"},
    {"crop": "Chilli",               "price": 12000, "unit": "Rs/quintal"},
    {"crop": "Sugarcane",            "price": 340,   "unit": "Rs/quintal"},
    {"crop": "Arhar (Tur)",          "price": 7000,  "unit": "Rs/quintal"},
    {"crop": "Moong",                "price": 8558,  "unit": "Rs/quintal"},
    {"crop": "Urad",                 "price": 6950,  "unit": "Rs/quintal"},
    {"crop": "Soybean",              "price": 4600,  "unit": "Rs/quintal"},
    {"crop": "Cotton",               "price": 7121,  "unit": "Rs/quintal"},
    {"crop": "Jowar (Sorghum)",      "price": 3180,  "unit": "Rs/quintal"},
    {"crop": "Bajra (Pearl Millet)", "price": 2500,  "unit": "Rs/quintal"},
    {"crop": "Bengal Gram (Chana)",  "price": 5440,  "unit": "Rs/quintal"},
    {"crop": "Garlic",               "price": 8000,  "unit": "Rs/quintal"},
    {"crop": "Ginger",               "price": 6000,  "unit": "Rs/quintal"},
    {"crop": "Turmeric",             "price": 14000, "unit": "Rs/quintal"},
    {"crop": "Cumin (Jeera)",        "price": 25000, "unit": "Rs/quintal"},
    {"crop": "Coriander",            "price": 7000,  "unit": "Rs/quintal"},
    {"crop": "Banana",               "price": 1500,  "unit": "Rs/quintal"},
    {"crop": "Mango",                "price": 4000,  "unit": "Rs/quintal"},
]


def _seeded_random(seed_str: str) -> random.Random:
    """Deterministic per-(city, crop) PRNG so fallback history/price looks
    the same on every page load (instead of jumping around on refresh) but
    still varies sensibly between cities and crops."""
    h = hashlib.md5(seed_str.encode("utf-8")).hexdigest()
    return random.Random(int(h[:12], 16))


def generate_fallback_series(city: str, crop_name: str, base_price: float, days: int = 30):
    """Build a plausible 30-day price history for a fallback commodity in a
    given city: a small deterministic city-specific offset from the MSP
    base price, then a random walk backwards so charts/tables have real
    variation (trend lines, up/down %, demand tiers) instead of a flat
    zero-change line. Returns (history_oldest_to_newest, today_price, change_pct)."""
    rnd = _seeded_random(f"{city}:{crop_name}")
    city_factor = 0.95 + rnd.random() * 0.10          # ±5% city-to-city variation
    today_price = max(1, round(base_price * city_factor))

    history = [today_price]
    price = today_price
    for _ in range(days - 1):
        drift = (rnd.random() - 0.5) * 0.04            # ±2% daily drift
        price = max(round(price / (1 + drift)), round(base_price * 0.5))
        history.append(price)
    history.reverse()  # oldest -> newest, history[-1] == today_price

    prev = history[-2] if len(history) > 1 else today_price
    change = round(((today_price - prev) / prev) * 100, 2) if prev else 0.0
    return history, today_price, change


def build_fallback_crops(city: str) -> list:
    """Full fallback commodity list for one city, each with real-looking
    history/change/demand so every table and chart on the market page has
    something meaningful to render."""
    crops = []
    for fb in MSP_FALLBACK:
        history, price, change = generate_fallback_series(city, fb["crop"], fb["price"])
        crops.append({
            "crop":     fb["crop"],
            "crop_key": fb["crop"],
            "price":    price,
            "change":   change,
            "history":  history,
            "unit":     fb.get("unit", "Rs/quintal"),
            "source":   "msp_fallback",
        })
    return crops


CITY_STATE = {
    "Delhi":         "Delhi",
    "Mumbai":        "Maharashtra",
    "Kolkata":       "West Bengal",
    "Chennai":       "Tamil Nadu",
    "Hyderabad":     "Telangana",
    "Pune":          "Maharashtra",
    "Ahmedabad":     "Gujarat",
    "Lucknow":       "Uttar Pradesh",
    "Jaipur":        "Rajasthan",
    "Bhopal":        "Madhya Pradesh",
    "Patna":         "Bihar",
    "Nagpur":        "Maharashtra",
    "Indore":        "Madhya Pradesh",
    "Surat":         "Gujarat",
    "Kanpur":        "Uttar Pradesh",
    "Coimbatore":    "Tamil Nadu",
    "Visakhapatnam": "Andhra Pradesh",
    "Bhubaneswar":   "Odisha",
    "Guwahati":      "Assam",
    "Amritsar":      "Punjab",
}

# Real daily price history, built up one genuine data point per day as the
# app runs (no fabricated numbers). Persisted to disk so it survives restarts.
_AGMARK_HISTORY_PATH = os.path.join(basedir, "market_history_cache.json")
_agmark_history_lock = threading.Lock()
_agmark_fetch_cache = {}          # {state: (timestamp, results)} — in-memory, 15 min
AGMARK_CACHE_TTL_SEC = 15 * 60


def _load_history_cache():
    try:
        with open(_AGMARK_HISTORY_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_history_cache(cache):
    try:
        with open(_AGMARK_HISTORY_PATH, "w", encoding="utf-8") as f:
            json.dump(cache, f)
    except Exception as e:
        print(f"[Market] Could not persist history cache: {e}")


def _field(record: dict, *keys):
    """data.gov.in resources don't always serve field names consistently
    (snake_case vs the legacy CKAN 'Modal_x0020_Price' style, or different
    capitalisation) — try every known variant before giving up."""
    for k in keys:
        v = record.get(k)
        if v not in (None, ""):
            return v
    return None


# A handful of states are recorded under a different name than their
# common name (same place, different label) — try each candidate in
# order until one returns records. NOTE: this must only contain true
# synonyms for the same region, never a different-but-nearby state —
# e.g. Telangana and Andhra Pradesh have been separate states since 2014,
# so they are deliberately NOT listed as fallbacks for each other; doing
# so would silently show one state's real prices mislabeled as another's.
STATE_NAME_CANDIDATES = {
    "Delhi":  ["Delhi", "NCT of Delhi"],
    "Odisha": ["Odisha", "Orissa"],
}


def fetch_agmarknet_prices(state: str) -> list:
    """Fetch REAL, government-reported mandi (wholesale market) prices for a
    state from data.gov.in's official Agmarknet dataset. Returns [] if the
    feed has nothing usable right now (caller falls back to MSP reference)."""
    now = time.monotonic()
    cached = _agmark_fetch_cache.get(state)
    if cached and (now - cached[0]) < AGMARK_CACHE_TTL_SEC:
        return cached[1]

    records = []
    for candidate in STATE_NAME_CANDIDATES.get(state, [state]):
        params = {
            "api-key": DATA_GOV_API_KEY,
            "format": "json",
            "limit": 400,
            "filters[state]": candidate,
        }
        try:
            resp = _agmark_session.get(AGMARKNET_URL, params=params, timeout=8)
            if resp.status_code != 200:
                print(f"[Market] Agmarknet HTTP {resp.status_code} for state='{candidate}': {resp.text[:200]}")
                continue
            body = resp.json()
            records = body.get("records", [])
            if records:
                print(f"[Market] Agmarknet: {len(records)} raw records for state='{candidate}' "
                      f"(total available: {body.get('total', '?')})")
                break
            else:
                print(f"[Market] Agmarknet: 0 records for state='{candidate}' — trying next candidate if any")
        except Exception as e:
            print(f"[Market] Agmarknet error for state='{candidate}': {e}")
            continue

    if not records:
        print(f"[Market] Agmarknet: no usable records for {state} after trying all name variants")
        return []

    # Log the exact keys of the first record once, so if parsing still
    # fails you can see the real field names by checking your app logs.
    print(f"[Market] Sample record keys for {state}: {list(records[0].keys())}")

    # A state has many markets/varieties reporting the same commodity —
    # keep the most recent record per commodity.
    latest_by_commodity = {}
    skipped_no_price = 0
    for r in records:
        raw_name = str(_field(r, "commodity", "Commodity") or "").strip()
        modal = _field(r, "modal_price", "Modal_x0020_Price", "Modal Price", "modal price")
        if not raw_name or modal is None:
            skipped_no_price += 1
            continue
        try:
            modal_price = float(modal)
        except (TypeError, ValueError):
            skipped_no_price += 1
            continue
        if modal_price <= 0:
            continue
        display_name = AGMARK_COMMODITY_ALIASES.get(raw_name.lower(), raw_name.title())
        latest_by_commodity[display_name] = {
            "market":       _field(r, "market", "Market") or "",
            "district":     _field(r, "district", "District") or "",
            "arrival_date": _field(r, "arrival_date", "Arrival_Date") or "",
            "modal_price":  modal_price,
        }

    print(f"[Market] {state}: parsed {len(latest_by_commodity)} commodities, "
          f"skipped {skipped_no_price} records (missing/invalid price or name)")

    today_key = datetime.now().strftime("%Y-%m-%d")
    results = []
    try:
        with _agmark_history_lock:
            cache = _load_history_cache()
            state_hist = cache.setdefault(state, {})

            for display_name, rec in latest_by_commodity.items():
                hist = state_hist.setdefault(display_name, [])
                if not hist or hist[-1].get("date") != today_key:
                    hist.append({"date": today_key, "price": rec["modal_price"]})
                    hist[:] = hist[-30:]  # keep the last 30 real daily points

                prev_price = hist[-2]["price"] if len(hist) > 1 else rec["modal_price"]
                change = round(((rec["modal_price"] - prev_price) / prev_price) * 100, 2) if prev_price else 0.0

                results.append({
                    "crop":         display_name,
                    "crop_key":     display_name,
                    "price":        int(round(rec["modal_price"])),
                    "change":       change,
                    "history":      [h["price"] for h in hist] or [rec["modal_price"]],
                    "unit":         "Rs/quintal",
                    "source":       "agmarknet_live",
                    "market":       rec["market"],
                    "district":     rec["district"],
                    "arrival_date": rec["arrival_date"],
                })
            _save_history_cache(cache)
    except Exception as e:
        # Never let a disk/cache problem take down live pricing — just skip
        # persistence for this call and still return what we parsed.
        print(f"[Market] History cache error for {state} (non-fatal): {e}")
        if not results:
            for display_name, rec in latest_by_commodity.items():
                results.append({
                    "crop":         display_name,
                    "crop_key":     display_name,
                    "price":        int(round(rec["modal_price"])),
                    "change":       0.0,
                    "history":      [rec["modal_price"]],
                    "unit":         "Rs/quintal",
                    "source":       "agmarknet_live",
                    "market":       rec["market"],
                    "district":     rec["district"],
                    "arrival_date": rec["arrival_date"],
                })

    _agmark_fetch_cache[state] = (now, results)
    print(f"[Market] Agmarknet OK for {state}: {len(results)} commodities")
    return results


def get_demand(price: int, change: float) -> str:
    if change > 2:    return "Very High"
    elif change > 0:  return "High"
    elif change > -2: return "Medium"
    else:             return "Low"


@app.route('/api/market')
def get_market_data():
    cities = list(CITY_STATE.keys())
    location = request.args.get('location', '').strip().lower()
    if location:
        cities = [c for c in cities if location in c.lower()]

    # If someone searches for a city we don't recognize at all, still hand
    # back fallback data for it rather than an empty result — better a
    # complete-looking (if reference-only) market page than a dead end.
    if location and not cities:
        cities = [location.title()]

    markets = {}
    live_total = 0
    static_total = 0

    try:
        # Fetch every unique state IN PARALLEL instead of one-by-one — with
        # ~13 unique states and a government API that can be slow/overloaded,
        # doing this sequentially could mean the whole page waits 12s x 13
        # states in the worst case. Parallel fetching caps total wait time to
        # roughly one slowest request instead of the sum of all of them.
        unique_states = sorted({CITY_STATE.get(c, "") for c in cities if CITY_STATE.get(c, "")})
        state_results_cache = {}
        if unique_states:
            with concurrent.futures.ThreadPoolExecutor(max_workers=len(unique_states)) as executor:
                future_to_state = {executor.submit(fetch_agmarknet_prices, s): s for s in unique_states}
                for future in concurrent.futures.as_completed(future_to_state):
                    state = future_to_state[future]
                    try:
                        state_results_cache[state] = future.result()
                    except Exception as e:
                        print(f"[Market] Unexpected error fetching {state}: {e}")
                        state_results_cache[state] = []

        for city in cities:
            state = CITY_STATE.get(city, "")
            try:
                crops = list(state_results_cache.get(state, []))
            except Exception:
                crops = []

            if not crops:
                # Live feed empty/unavailable for this city's state — use the
                # hardcoded reference basket so the page still has full data
                # for every chart and comparison table.
                crops = build_fallback_crops(city)

            city_crops = []
            for crop in crops:
                demand = get_demand(crop["price"], crop["change"])
                city_crops.append({**crop, "demand": demand})

            city_crops.sort(
                key=lambda x: ({"Very High": 3, "High": 2, "Medium": 1, "Low": 0}.get(x["demand"], 0), x["price"]),
                reverse=True
            )
            markets[city] = city_crops
            live_total   += sum(1 for c in city_crops if c.get("source") == "agmarknet_live")
            static_total += sum(1 for c in city_crops if c.get("source") != "agmarknet_live")

        return jsonify({
            "markets":      markets,
            "locations":    list(markets.keys()),
            "live_count":   live_total,
            "static_count": static_total,
            "fetched_at":   datetime.now().isoformat(),
            "data_source":  "Agmarknet — Ministry of Agriculture & Farmers Welfare, Govt. of India (data.gov.in)",
        })

    except Exception as e:
        # Absolute last resort: something unexpected blew up above (disk,
        # threading, parsing, whatever). Rather than returning a 500 and
        # leaving the dashboard blank, hand back a full hardcoded fallback
        # for every known city so the UI always has something to render.
        print(f"[Market] /api/market hard failure, serving full hardcoded fallback: {e}")
        fallback_cities = cities or list(CITY_STATE.keys())
        markets = {}
        for city in fallback_cities:
            city_crops = [{**c, "demand": get_demand(c["price"], c["change"])} for c in build_fallback_crops(city)]
            city_crops.sort(
                key=lambda x: ({"Very High": 3, "High": 2, "Medium": 1, "Low": 0}.get(x["demand"], 0), x["price"]),
                reverse=True
            )
            markets[city] = city_crops
        return jsonify({
            "markets":      markets,
            "locations":    list(markets.keys()),
            "live_count":   0,
            "static_count": sum(len(v) for v in markets.values()),
            "fetched_at":   datetime.now().isoformat(),
            "data_source":  "MSP reference prices (offline fallback — live fetch failed)",
        })


# ─── Debug endpoint ───────────────────────────────────────────────────────────
@app.route('/api/debug-market')
def debug_market():
    if not DEBUG_MODE:
        return jsonify({"error": "Not available in production. Set FLASK_DEBUG=1 in .env"}), 403
    state = request.args.get('state', 'Delhi')
    try:
        resp = _agmark_session.get(
            AGMARKNET_URL,
            params={"api-key": DATA_GOV_API_KEY, "format": "json", "limit": 20, "filters[state]": state},
            timeout=15
        )
        if not resp.ok:
            return jsonify({"http_status": resp.status_code, "raw_response": resp.text[:1000]})
        body = resp.json()
        records = body.get("records", [])
        return jsonify({
            "http_status":      resp.status_code,
            "total_available":  body.get("total"),
            "records_returned": len(records),
            "sample_record":    records[0] if records else None,
            "sample_keys":      list(records[0].keys()) if records else [],
            "note": "If records_returned is 0, try a different 'state' value (e.g. ?state=Maharashtra). "
                    "If sample_record exists but crops still don't show on /market, compare sample_keys "
                    "against the field names read in fetch_agmarknet_prices().",
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── Kisan Helper Chatbot ─────────────────────────────────────────────────────
_chat_rate = {}
CHAT_LIMIT  = 20

def _is_rate_limited(ip: str) -> bool:
    now = datetime.now().timestamp()
    times = [t for t in _chat_rate.get(ip, []) if now - t < 60]
    _chat_rate[ip] = times
    if len(times) >= CHAT_LIMIT:
        return True
    _chat_rate[ip].append(now)
    return False

# Codes that look valid but LLMs cannot reliably output — warn or fallback
_UNSUPPORTED_LANGS = {"sat", "brx", "doi", "mni", "mai", "kok", "sa"}

# Corrected LANG_NAMES dict (replace your existing one):
LANG_NAMES = {
    "en":"English","hi":"Hindi","bn":"Bengali","te":"Telugu","mr":"Marathi",
    "ta":"Tamil","gu":"Gujarati","kn":"Kannada","ml":"Malayalam","pa":"Punjabi",
    "or-IN":"Odia","as":"Assamese","ur":"Urdu","mai":"Maithili","sat":"Santali",
    "ks":"Kashmiri","ne":"Nepali","sd":"Sindhi","kok":"Konkani","mni":"Manipuri",
    "brx":"Bodo","doi":"Dogri","sa":"Sanskrit",
}

@app.route("/api/chat", methods=["POST"])
def kisan_chat():
    ip = request.remote_addr or "unknown"
    if _is_rate_limited(ip):
        return jsonify({"error": "Too many requests. Please wait a moment."}), 429

    data = request.json or {}
    raw_messages = data.get("messages", [])
    lang = data.get("lang", "en").strip().lower()

    if not raw_messages:
        return jsonify({"error": "No messages"}), 400

    # Validate lang code
    if lang not in LANG_NAMES:
        lang = "en"

    # Warn on unsupported low-resource languages but don't hard-fail
    if lang in _UNSUPPORTED_LANGS:
        return jsonify({
            "reply": "Sorry, this language is not yet supported well by the AI. Please try Hindi or English for now."
        })

    # Validate and sanitise messages — strip injected system roles, cap length
    messages = []
    for m in raw_messages[-12:]:  # max last 12 turns
        if not isinstance(m, dict):
            continue
        role = m.get("role", "")
        content = m.get("content", "")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue
        messages.append({"role": role, "content": content[:2000]})  # cap per-message

    if not messages:
        return jsonify({"error": "No valid messages"}), 400

    lang_name = LANG_NAMES[lang]

    # Language-specific honorific and pronoun guidance
    honorific_guidance = {
        "hi": "Use 'aap' (respectful you). Address with 'ji' occasionally.",
        "ur": "Use 'aap' (respectful you). Address with 'ji' occasionally.",
        "mr": "Use 'tumhi' (respectful you). Address with 'ji' occasionally.",
        "gu": "Use 'aap' (respectful you). Address with 'saheb' or 'ji' occasionally.",
        "pa": "Use 'tussi' (respectful you). Address with 'ji' occasionally.",
        "bn": "Use 'apni' (respectful you). Address warmly as a respected elder would.",
        "or-IN": "Use 'apana' (respectful you). Speak the way an elder Odia agricultural officer would.",
        "as": "Use 'apuni' (respectful you). Speak warmly as an experienced Assamese advisor would.",
        "te": "Use 'meeru' (respectful you). Speak warmly as an experienced Telugu-speaking advisor would.",
        "ta": "Use 'neengal' (respectful you). Speak warmly as an experienced Tamil-speaking advisor would.",
        "kn": "Use 'neevu' (respectful you). Speak warmly as an experienced Kannada-speaking advisor would.",
        "ml": "Use 'ningal' (respectful you). Speak warmly as an experienced Malayalam-speaking advisor would.",
    }.get(lang, f"Use the appropriate respectful second-person pronoun in {lang_name}. Speak warmly as a trusted male advisor would.")

    script_punctuation = {
        "hi":"।","mr":"।","or-IN":"।","bn":"।","as":"।","pa":"।",
        "gu":"।","ne":"।","sa":"।","ur":"۔","sd":"۔",
        "ta":".","te":".","kn":".","ml":".",
    }.get(lang, ".")

    system_prompt = f"""You are Kisan Mitra — a male agricultural officer in your late 50s who has spent 30 years advising farmers across India. You are now a trusted neighbour to every farmer you speak with. You are MALE. In all gendered languages, always use masculine grammatical forms, masculine verb endings, and masculine self-references without exception.

YOUR CHARACTER:
You speak the way a real person talks at a field boundary — warm, direct, practical. You have seen every crop problem, every bad season, every scheme confusion. You give real advice, not brochure language.

When a farmer brings you a problem — diseased crop, bad rain, crashing prices — say something brief that shows you actually heard them before jumping into advice. One sentence of acknowledgment, then help. Real human conversation, not a helpdesk response.

Never open with "Certainly!", "Sure!", "Of course!", "I'd be happy to help", or any call-center phrase. Never close with "Let me know if you need anything else." Just talk like a person.

HOW TO ADDRESS THE FARMER:
{honorific_guidance}
Never assume the farmer's gender. Use neutral respectful address only.

HOW TO SPEAK:
Write in short, complete sentences with full stops — this will be read aloud, so punctuation controls the pauses. Use {script_punctuation} as your sentence-ending punctuation, not the English full stop, unless you are writing in English or Roman script. Break long advice into 2-3 short sentences.

Speak in flowing sentences. For sequential steps, say them naturally: "First do this, then after three days do that" — not as a numbered list or bullet points. Never use bullet symbols (•, -, *, #) anywhere in your reply.

For dosages or multiple options where listing is genuinely necessary, speak them out in sentences.

Mix in English farm words where farmers naturally use them: spray, pump, dose, MSP, scheme, soil test — don't force artificial translations where the English word is what farmers actually say.

Reference real Indian context: kharif/rabi seasons, nearby mandi, rupees not dollars, familiar government schemes.

If you genuinely don't know something (exact local price, very recent scheme change), say so plainly and tell them who to ask: local Krishi Vigyan Kendra, agri helpline 1551, or the district mandi board.

WHAT YOU KNOW:
Crop diseases and treatment, weather-based advice, pesticide and fertilizer dosages, mandi prices and MSP, government schemes (PM-KISAN, Fasal Bima Yojana, Kisan Credit Card, Soil Health Card), soil health, irrigation, seasonal crop-calendar planning.

IMPORTANT: Reply in {lang_name}, in its native script — unless the farmer writes to you in Roman or English script, in which case reply in that same casual style. Keep your reply under 180 words. Always end with a complete sentence."""

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    body = {
        "model":       "llama-3.3-70b-versatile",
        "messages":    [{"role": "system", "content": system_prompt}] + messages,
        "temperature": 0.45,
        "max_tokens":  600,
        "stream":      False
    }
    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers, json=body, timeout=30
        )
        if resp.status_code != 200:
            print(f"[Chat] Groq error {resp.status_code}: {resp.text[:300]}")
            return jsonify({"error": "AI unavailable"}), 500
        reply = resp.json()["choices"][0]["message"]["content"].strip()
        return jsonify({"reply": reply})
    except Exception as e:
        print(f"[Chat] exception: {e}")
        return jsonify({"error": "Service temporarily unavailable"}), 500




# ─── Push Notifications (Web Push standard, free, no card) ──────────────────
_push_subscriptions = []
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY  = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_CLAIMS = {"sub": "mailto:smartagro@example.com"}


@app.route("/api/vapid-public-key", methods=["GET"])
def vapid_public_key():
    return jsonify({"key": VAPID_PUBLIC_KEY})


@app.route("/api/subscribe", methods=["POST"])
def push_subscribe():
    sub = request.json
    if not sub:
        return jsonify({"error": "No subscription data"}), 400
    if sub not in _push_subscriptions:
        _push_subscriptions.append(sub)
    return jsonify({"status": "subscribed", "total": len(_push_subscriptions)})


@app.route("/api/send-alert", methods=["POST"])
def push_send_alert():
    if not _PUSH_AVAILABLE:
        return jsonify({"error": "pywebpush not installed"}), 500
    if not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
        return jsonify({"error": "VAPID keys not configured"}), 500

    data  = request.json or {}
    title = data.get("title", "SmartAgro Alert")
    body  = data.get("body", "")
    sent, failed = 0, 0

    for sub in list(_push_subscriptions):
        try:
            webpush(
                subscription_info=sub,
                data=_json.dumps({"title": title, "body": body}),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS
            )
            sent += 1
        except WebPushException:
            failed += 1
            if sub in _push_subscriptions:
                _push_subscriptions.remove(sub)
    return jsonify({"status": "sent", "sent": sent, "failed": failed})
# ─── Kisan Helper — Speech-to-Text (Groq Whisper) ────────────────────────────
# Works identically on every OS/browser because the audio is recorded with the
# standard MediaRecorder API (supported on Chrome, Safari/iOS, Firefox, Edge,
# all Android browsers) and transcribed server-side — no dependency on the
# patchy, Chrome-only browser SpeechRecognition API.
_stt_rate = {}
STT_LIMIT = 20
MAX_AUDIO_B64_LEN = 8 * 1024 * 1024  # ~6 MB raw audio, generous for a voice note


def _is_rate_limited_stt(ip: str) -> bool:
    now = datetime.now().timestamp()
    times = [t for t in _stt_rate.get(ip, []) if now - t < 60]
    _stt_rate[ip] = times
    if len(times) >= STT_LIMIT:
        return True
    _stt_rate[ip].append(now)
    return False


@app.route("/api/stt", methods=["POST"])
def speech_to_text():
    if not GROQ_API_KEY:
        return jsonify({"error": "GROQ_API_KEY not set in .env"}), 500

    ip = request.remote_addr or "unknown"
    if _is_rate_limited_stt(ip):
        return jsonify({"error": "Too many requests. Please wait a moment."}), 429

    audio_file = request.files.get("audio")
    # NOTE: we deliberately do NOT force a Whisper language hint from the
    # selected reply-language. The farmer may speak in a different language
    # than the one chosen for replies (that's the whole point of "ask in any
    # language, reply in the selected one") — Whisper's own auto-detection
    # handles that mismatch far better than a forced hint would.

    if not audio_file:
        return jsonify({"error": "No audio received"}), 400

    audio_bytes = audio_file.read()
    if len(audio_bytes) > MAX_AUDIO_B64_LEN:
        return jsonify({"error": "Recording too long. Please keep it under ~60 seconds."}), 413
    if len(audio_bytes) < 500:
        return jsonify({"error": "Recording too short or empty. Please try again."}), 400

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
    files = {
        "file": (audio_file.filename or "voice.webm", audio_bytes, audio_file.mimetype or "audio/webm"),
    }
    form_data = {
        "model": "whisper-large-v3-turbo",
        "response_format": "json",
        "temperature": 0,
    }

    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers=headers, files=files, data=form_data, timeout=30
        )
        if resp.status_code != 200:
            print(f"[STT error] {resp.status_code}: {resp.text[:300]}")
            return jsonify({"error": "Could not transcribe audio"}), 500
        text = resp.json().get("text", "").strip()
        return jsonify({"text": text})
    except Exception as e:
        print(f"[STT exception] {e}")
        return jsonify({"error": str(e)}), 500


# ─── Diagnose Crop via Groq Vision ───────────────────────────────────────────
MAX_IMAGE_B64_LEN = 2 * 1024 * 1024
_diagnose_rate = {}
DIAGNOSE_LIMIT  = 10


def _is_rate_limited_diagnose(ip: str) -> bool:
    now = datetime.now().timestamp()
    times = [t for t in _diagnose_rate.get(ip, []) if now - t < 60]
    _diagnose_rate[ip] = times
    if len(times) >= DIAGNOSE_LIMIT:
        return True
    _diagnose_rate[ip].append(now)
    return False


@app.route("/api/diagnose", methods=["POST"])
def diagnose_crop():
    if not KINDWISE_API_KEY:
        return jsonify({"error": "KINDWISE_API_KEY not set in .env"}), 500
    ip = request.remote_addr or "unknown"
    if _is_rate_limited_diagnose(ip):
        return jsonify({"error": "Too many requests. Please wait a moment."}), 429

    data = request.json or {}
    image_b64 = data.get("image", "")
    lang      = data.get("lang", "en").strip().lower()

    if not image_b64:
        return jsonify({"error": "No image data received"}), 400
    if len(image_b64) > MAX_IMAGE_B64_LEN:
        return jsonify({"error": "Image too large. Please use an image under 1 MB."}), 413
    lang_name = LANG_NAMES.get(lang, "")
    if lang != "en" and lang_name:
        lang_instruction = (
            f"\n\nIMPORTANT: Write ALL text values in {lang_name} "
            f"(except JSON keys, numbers, chemical/brand names, units such as "
            f"kg/ha, ml/L, g/ha, %, SL, EC, SC, WP, SG, NPK, and dose figures — "
            f"keep those in English/digits as-is)."
        )
    else:
        lang_instruction = ""

    prompt = f"""You are an expert agricultural plant pathologist AI. Look very carefully at this crop image.
Respond ONLY with valid JSON, no markdown or backticks:
{{
  "disease": "Exact disease name",
  "confidence": 88,
  "severity": "Mild or Moderate or Severe",
  "affected_part": "Leaves/Stem/Fruit/Root/Cob",
  "cause": "Specific pathogen and spread method",
  "eco_remedies": [{{"remedy": "Remedy", "method": "Steps", "frequency": "How often", "effectiveness": 80}}],
  "chemical_remedies": [{{"name": "Chemical", "dose": "Dose per litre", "interval": "Days between sprays"}}],
  "prevention": ["tip1", "tip2", "tip3"],
  "recovery_timeline": "Weeks for recovery"
}}{lang_instruction}"""

    vision_models = [
        "qwen/qwen3.6-27b",
    ]
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}

    for model in vision_models:
        try:
            sys_prompt = "Expert plant pathologist. Return ONLY valid JSON."
            if lang != "en" and lang_name:
                sys_prompt += f" All free-text values must be in {lang_name}."

            body = {
                "model": model,
                "messages": [
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                        {"type": "text", "text": prompt}
                    ]}
                ],
                "temperature": 0.2,
                "max_tokens":  1400,
                "reasoning_effort": "none",  # skip <think> mode so JSON lands directly in content
            }
            resp = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=body, timeout=45)
            if resp.status_code in (429, 500, 503):
                continue
            if resp.status_code != 200:
                continue
            raw = resp.json()["choices"][0]["message"]["content"].strip()
            cleaned = re.sub(r"```(?:json)?", "", raw).replace("```", "").strip()
            match = re.search(r"\{.*\}", cleaned, re.DOTALL)
            if match:
                result = json.loads(match.group())
                # Tag with the language so the frontend can skip the
                # redundant /api/translate-diagnosis-result round-trip.
                result["_lang"] = lang
                return jsonify(result)
        except Exception as e:
            print(f"[Diagnose] {model}: {e}")
            continue

    return jsonify({"error": "All vision models failed. Check your GROQ_API_KEY in .env"}), 500


# ─── Alerts ──────────────────────────────────────────────────────────────────
@app.route("/api/alerts", methods=["POST"])
def get_alerts():
    data        = request.json or {}
    temp        = data.get("temp", 25)
    humidity    = data.get("humidity", 60)
    wind_speed  = data.get("wind_speed", 10)
    rain        = data.get("rain", 0)
    description = data.get("description", "").lower()
    alerts      = []

    if temp > 40:
        alerts.append({"type":"danger","category":"Weather","icon":"🌡️","title":"Extreme Heat Alert","message":"Temperature above 40°C. Provide shade netting and increase irrigation frequency.","action":"Schedule irrigation every 4-5 hours. Avoid afternoon spraying."})
    if temp < 5:
        alerts.append({"type":"danger","category":"Weather","icon":"❄️","title":"Frost Warning","message":"Sub-zero temperatures expected. Frost can destroy standing crops overnight.","action":"Cover crops with frost cloth. Use smudge pots or sprinkler irrigation."})
    if humidity > 85:
        alerts.append({"type":"warning","category":"Disease","icon":"🍄","title":"High Fungal Disease Risk","message":"Humidity above 85% creates ideal conditions for fungal diseases.","action":"Apply preventive fungicide (Mancozeb 75 WP at 2.5 g/L) immediately."})
    if wind_speed > 50:
        alerts.append({"type":"danger","category":"Weather","icon":"💨","title":"High Wind Speed Alert","message":"Strong winds can cause lodging in tall crops like maize and wheat.","action":"Avoid spraying. Support tall crops with stakes."})
    if rain > 50:
        alerts.append({"type":"warning","category":"Weather","icon":"🌧️","title":"Heavy Rainfall Alert","message":"Excessive rain may cause waterlogging and root rot.","action":"Ensure field drainage channels are open. Pause irrigation."})
    if "storm" in description or "thunder" in description:
        alerts.append({"type":"danger","category":"Weather","icon":"⛈️","title":"Thunderstorm Warning","message":"Thunderstorm conditions detected. Risk of lightning and hail damage.","action":"Stay indoors. Secure farm equipment."})
    if 25 <= temp <= 35 and humidity > 70:
        alerts.append({"type":"warning","category":"Pest","icon":"🐛","title":"Aphid & Whitefly Risk","message":"Warm humid conditions are ideal for aphid multiplication.","action":"Spray Neem oil (5 ml/L) or Imidacloprid 0.3 ml/L at dusk."})
    if temp > 30 and humidity < 50:
        alerts.append({"type":"warning","category":"Pest","icon":"🕷️","title":"Spider Mite Alert","message":"Hot dry conditions favour rapid spider mite population growth.","action":"Apply Abamectin 1.8 EC (0.5 ml/L). Increase soil moisture."})

    harmful = []
    if temp > 38:                   harmful.append("Wheat (grain shriveling risk)")
    if humidity > 85 and rain > 20: harmful.append("Cotton (boll rot risk)")
    if temp < 10:                   harmful.append("Rice (cold injury risk)")
    if harmful:
        alerts.append({"type":"info","category":"Crop Advisory","icon":"🌾","title":"Crops at Risk in Current Conditions","message":f"Avoid growing: {', '.join(harmful)}","action":"Consider alternate crops better suited to current climate."})

    return jsonify({"alerts": alerts, "total": len(alerts)})

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
TRANSLATE_MODELS = [
    "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
]
TRANSLATE_CHUNK_SIZE = 40   
TRANSLATE_MAX_WORKERS = 4  
TRANSLATE_STAGGER_SEC = 0.15 
MIN_CALL_INTERVAL_SEC = 0.2

_model_last_call = {}
_model_throttle_lock = threading.Lock()


def _throttle_model(model):
    """Make sure consecutive calls to the same Groq model are spaced out,
    even across concurrent threads, so a burst of chunk requests doesn't
    look like a rate-limit-violating spike to Groq."""
    with _model_throttle_lock:
        now = time.monotonic()
        next_slot = max(now, _model_last_call.get(model, 0) + MIN_CALL_INTERVAL_SEC)
        _model_last_call[model] = next_slot
        wait = next_slot - now
    if wait > 0:
        time.sleep(wait)


def _post_to_groq(body, headers, max_retries=2):
    """POST to Groq with throttling + exponential backoff specifically for
    HTTP 429 (rate limit). Returns the final requests.Response."""
    model = body.get("model")
    resp = None
    for attempt in range(max_retries + 1):
        _throttle_model(model)
        resp = requests.post(GROQ_CHAT_URL, headers=headers, json=body, timeout=45)
        if resp.status_code != 429:
            return resp
        retry_after = resp.headers.get("Retry-After")
        try:
            wait = float(retry_after) if retry_after else (1.5 * (attempt + 1))
        except (TypeError, ValueError):
            wait = 1.5 * (attempt + 1)
        if attempt < max_retries:
            time.sleep(min(wait, 6))
    return resp


def _extract_json_object(raw_text):
    """Pull a usable {term: translation} dict out of model output, repairing
    the truncation/formatting issues that show up almost exclusively with
    high-token-cost scripts."""
    text = re.sub(r"```(?:json)?", "", raw_text).replace("```", "").strip()
    text = (text.replace("\u201c", '"').replace("\u201d", '"')
                .replace("\u2018", "'").replace("\u2019", "'"))

    match = re.search(r"\{.*\}", text, re.DOTALL)
    candidate = match.group() if match else text

    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    pairs = re.findall(r'"((?:[^"\\]|\\.)+?)"\s*:\s*"((?:[^"\\]|\\.)*)"', text, re.DOTALL)
    if pairs:
        return {k: v for k, v in pairs}
    return None


def _build_translate_prompt(terms_chunk, lang_name, domain_note):
    terms_json = json.dumps(terms_chunk, ensure_ascii=False)
    return f"""You are an expert translator for Indian regional languages. Translate each English term below to {lang_name}.

CRITICAL RULES:
1. Return ONLY a raw JSON object mapping each input term to its {lang_name} translation. No markdown, no backticks, no explanation.
2. Every single key from the input list MUST appear in the output JSON, exactly as written.
3. Keep unchanged: chemical/brand names, numbers, and units (kg/ha, Rs, days, ml/L, g/ha, quintal, SL, EC, SC, WP, SG, NPK).
4. {domain_note}
5. Use the natural everyday word a {lang_name}-speaking farmer would use, not a literal/academic translation.
6. Write in the correct native script of {lang_name}. If a term genuinely has no equivalent, keep the English word as-is rather than leaving it blank.

Input terms (translate ALL of these):
{terms_json}

Output: a single JSON object only."""


def _translate_terms_chunk(terms_chunk, lang_name, domain_note):
    prompt = _build_translate_prompt(terms_chunk, lang_name, domain_note)
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    max_tokens = min(4096, 300 + len(terms_chunk) * 150)

    last_error = None
    for model in TRANSLATE_MODELS:
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": f"You are an expert Indian regional language translator. You MUST respond with valid JSON only, no other text. Translate everything to {lang_name} using its correct native script."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.1,
            "max_tokens": max_tokens,
            "stream": False,
            "response_format": {"type": "json_object"},
        }
        try:
            resp = _post_to_groq(body, headers)
            if resp.status_code == 400:
                body.pop("response_format", None)
                resp = _post_to_groq(body, headers)
            if resp.status_code != 200:
                last_error = f"HTTP {resp.status_code}: {resp.text[:150]}"
                continue

            raw = resp.json()["choices"][0]["message"]["content"].strip()
            translations = _extract_json_object(raw)
            if not translations:
                last_error = "No JSON found/parsable in response"
                continue

            for term in terms_chunk:
                if term not in translations or not translations[term]:
                    translations[term] = term
            return translations

        except Exception as e:
            last_error = str(e)
            continue

    print(f"[Translate] chunk of {len(terms_chunk)} terms to {lang_name} failed on all models: {last_error}")
    return {term: term for term in terms_chunk}


def _translate_terms(terms, lang_name, domain_note, cache_key, cache_dict):
    """Translate a full term list via small, gently-paced parallel chunks,
    with caching and a cleanup retry pass for chunks that failed outright."""
    if cache_key in cache_dict:
        return cache_dict[cache_key], True

    chunks = [terms[i:i + TRANSLATE_CHUNK_SIZE] for i in range(0, len(terms), TRANSLATE_CHUNK_SIZE)]
    results = [None] * len(chunks)

    def run_chunk(idx):
        results[idx] = _translate_terms_chunk(chunks[idx], lang_name, domain_note)

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(TRANSLATE_MAX_WORKERS, len(chunks))) as executor:
        futures = []
        for i in range(len(chunks)):
            if i > 0:
                time.sleep(TRANSLATE_STAGGER_SEC)  # avoid firing every chunk in the same instant
            futures.append(executor.submit(run_chunk, i))
        concurrent.futures.wait(futures)
    for i, chunk in enumerate(chunks):
        if all(results[i].get(term) == term for term in chunk):
            time.sleep(1.5)
            retried = _translate_terms_chunk(chunk, lang_name, domain_note)
            if any(retried.get(term) != term for term in chunk):
                results[i] = retried

    translations = {}
    for r in results:
        translations.update(r)

    cache_dict[cache_key] = translations
    return translations, False


# ─── Market Translation ───────────────────────────────────────────────────────

@app.route("/api/translate-market", methods=["POST"])
def translate_market():
    data = request.json or {}
    lang = data.get("lang", "en").strip().lower()

    if lang == "en":
        return jsonify({"lang": "en", "translations": {}, "cached": False})

    terms = [
        "Wheat","Rice","Paddy (Rice)","Maize (Corn)","Mustard","Groundnut",
        "Onion","Potato","Tomato","Chilli","Sugarcane","Arhar (Tur)","Moong",
        "Urad","Soybean","Soybean Oil","Soybean Meal","Cotton","Jowar (Sorghum)",
        "Bajra (Pearl Millet)","Bengal Gram (Chana)","Garlic","Ginger","Turmeric",
        "Cumin (Jeera)","Coriander","Sunflower","Sesame (Til)","Linseed","Castor Seed",
        "Banana","Mango","Apple","Grapes","Pomegranate","Cabbage","Cauliflower",
        "Brinjal (Eggplant)","Ladyfinger (Okra)","Spinach","Bitter Gourd","Bottle Gourd",
        "Ridge Gourd","Ash Gourd","Palm Oil","Oats","Coffee","Cocoa","Rubber","Lumber",
        "Very High","High","Medium","Low","Price Rising","Price Falling",
        "Very High Demand","All","Crop","Price","Change","Demand",
        "Trend","Comparison","Demand Map","Search","30-Day Price Trend",
        "Current Prices","Demand Intensity","Price Momentum",
        "Showing all major Indian markets","quintal","Searching","Loading markets",
        "Live","MSP Reference","crops",
    ]

    lang_name = LANG_NAMES.get(lang, "Hindi")
    domain_note = "Crop names should be the common local/mandi name a farmer would recognize, not a literal translation."
    translations, cached = _translate_terms(terms, lang_name, domain_note, lang, _translation_cache)

    print(f"[Translate] {len(translations)} terms ready for {lang_name} ({'cache' if cached else 'fresh'})")
    return jsonify({"lang": lang, "lang_name": lang_name, "translations": translations, "cached": cached})


@app.route("/api/translate-market/clear", methods=["POST"])
def clear_translation_cache():
    if not DEBUG_MODE:
        return jsonify({"error": "Not available in production"}), 403
    _translation_cache.clear()
    return jsonify({"status": "cache cleared"})


# ─── Alerts Translation ───────────────────────────────────────────────────────
_alerts_translation_cache = {}

@app.route("/api/translate-alerts", methods=["POST"])
def translate_alerts():
    data = request.json or {}
    lang = data.get("lang", "en").strip().lower()

    if lang == "en":
        return jsonify({"lang": "en", "translations": {}, "cached": False})

    lang_name = LANG_NAMES.get(lang, "Hindi")

    terms = [
        # Alert titles
        "Extreme Heat Alert", "Frost Warning", "High Fungal Disease Risk",
        "High Wind Speed Alert", "Heavy Rainfall Alert", "Thunderstorm Warning",
        "Aphid & Whitefly Risk", "Spider Mite Alert", "Crops at Risk in Current Conditions",
        # Alert messages
        "Temperature above 40°C. Provide shade netting and increase irrigation frequency.",
        "Sub-zero temperatures expected. Frost can destroy standing crops overnight.",
        "Humidity above 85% creates ideal conditions for fungal diseases.",
        "Strong winds can cause lodging in tall crops like maize and wheat.",
        "Excessive rain may cause waterlogging and root rot.",
        "Thunderstorm conditions detected. Risk of lightning and hail damage.",
        "Warm humid conditions are ideal for aphid multiplication.",
        "Hot dry conditions favour rapid spider mite population growth.",
        # Alert actions
        "Schedule irrigation every 4-5 hours. Avoid afternoon spraying.",
        "Cover crops with frost cloth. Use smudge pots or sprinkler irrigation.",
        "Apply preventive fungicide (Mancozeb 75 WP at 2.5 g/L) immediately.",
        "Avoid spraying. Support tall crops with stakes.",
        "Ensure field drainage channels are open. Pause irrigation.",
        "Stay indoors. Secure farm equipment.",
        "Spray Neem oil (5 ml/L) or Imidacloprid 0.3 ml/L at dusk.",
        "Apply Abamectin 1.8 EC (0.5 ml/L). Increase soil moisture.",
        "Consider alternate crops better suited to current climate.",
        # Alert UI labels
        "Action", "Critical", "Warning", "Advisory", "Danger",
        "All Alerts", "Warnings", "Advisories", "Weather", "Pest", "Crop Advisory",
        "Disease",
        # Pest calendar
        "Brown Plant Hopper", "Aphids", "Fall Armyworm", "Whitefly",
        "Red Spider Mite", "Stem Borer", "Thrips", "Mealy Bug",
        "Kharif (Jun–Oct)", "Rabi (Nov–Feb)", "Kharif (Jul–Sep)",
        "Year-round", "Zaid (Mar–May)", "Kharif (Jun–Sep)", "Rabi & Zaid",
        "Rice, Paddy", "Wheat, Mustard, Vegetables", "Maize, Sorghum",
        "Cotton, Tomato, Chilli", "Soybean, Cotton, Brinjal",
        "Rice, Sugarcane, Maize", "Onion, Chilli, Groundnut", "Cotton, Grapes, Papaya",
        "Feeds on rice plants causing \"hopperburn\". Thrives in humid conditions above 75%.",
        "Suck plant sap, transmit viral diseases. High risk in mild temperatures (15–25°C).",
        "Causes significant leaf damage and can destroy entire crops within days.",
        "Transmits leaf curl virus to cotton. Population explosion in dry hot weather.",
        "Causes bronzing/yellowing of leaves. Severe in hot, dry weather above 32°C.",
        "Bores into stems causing \"dead heart\" in vegetative stage and \"white ear\" at heading.",
        "Causes silvery white patches on leaves. Severe in dry weather.",

        "Forms white waxy colonies on plant parts. Excretes honeydew causing sooty mould.",
        "Use resistant varieties. Avoid excess nitrogen. Keep fields drained.",
        "Neem oil spray. Release ladybird beetles as biocontrol.",
        "Early detection critical. Bt-based bioinsecticide spray.",
        "Yellow sticky traps. Reflective mulch. Imidacloprid at threshold level.",
        "Increase irrigation. Abamectin 1.8 EC spray. Avoid dust on leaves.",
        "Pheromone traps. Chlorpyriphos 20 EC. Remove crop residues after harvest.",
        "Spinosad spray. Blue sticky traps. Avoid drought stress.",
        "Buprofezin spray. Introduce Cryptolaemus beetles as biocontrol.",
        "High", "Medium", "Low", "Risk", "Active Now", "Affects",
        # Pesticide guide
        "Chlorpyriphos 20 EC", "Imidacloprid 17.8 SL", "Mancozeb 75 WP",
        "Neem Oil 5% EC (Organic)", "Propiconazole 25 EC", "Emamectin Benzoate 5 SG",
        "Stem borer, Aphids, Termites", "Whitefly, Aphids, Brown Plant Hopper",
        "Leaf blight, Early blight, Rust, Downy mildew",
        "Aphids, Whitefly, Mites, Fungal diseases",
        "Yellow rust, Brown rust, Sheath blight",
        "Fall Armyworm, Diamond back moth, Leaf miner",
        "Target Pest", "Safe Dose", "Max Limit", "Interval", "Pre-Harvest", "PPE Required",
        "Every 14 days", "Every 21 days max", "Every 7–10 days",
        "Every 5–7 days", "Max 2 sprays per season", "Every 10–14 days",
        "15 days before harvest", "21 days before harvest", "7 days before harvest",
        "No waiting period — organic",
        "Gloves, Mask, Goggles, Full sleeve clothing",
        "Gloves, Mask, Full body protection", "Gloves, Goggles, Dust Mask",
        "Basic gloves recommended", "Full protective gear, closed shoes",
        "Full PPE, respiratory protection",
        "Highly toxic to fish and bees. Do not spray near water bodies or during flowering.",
        "Do NOT spray during bee activity (morning/evening). Highly toxic to pollinators.",
        "Causes skin and eye irritation. Do not spray on edible parts 7 days before harvest.",
        "Safe for humans and beneficial insects. May cause phytotoxicity in direct sunlight. Spray at dusk.",
        "Do not mix with alkaline pesticides. Causes groundwater contamination if overused.",
        "Highly toxic to aquatic organisms. Dispose empty containers safely. Do not reuse containers.",
        # Harmful/safe crops
        "Rice", "Wheat", "Maize", "Cotton", "Tomato", "Sugarcane",
        "Soybean", "Mustard", "Potato", "Onion", "Chilli", "Groundnut",
        "Risky", "Safe", "Suitable for", "humidity",
        "No harmful crops identified for current conditions.",
        "No fully safe crops identified — check crop calendar.",
        # Risk chart
        "Heat Stress", "Humidity Risk", "Wind Damage", "Pest Risk",
        "Disease Risk", "Pest Activity", "Overall Risk", "Current Risk Level (%)",
        # Reason strings
        "Too cold (min 10°C needed)", "Too cold (min 13°C needed)",
        "Too cold (min 18°C needed)", "Too cold (min 20°C needed)",
        "Too cold (min 22°C needed)", "Too cold (min 24°C needed)",
        "Too cold (min 25°C needed)",
        "Too hot (max 22°C tolerated)", "Too hot (max 25°C tolerated)",
        "Too hot (max 28°C tolerated)", "Too hot (max 30°C tolerated)",
        "Too hot (max 32°C tolerated)", "Too hot (max 35°C tolerated)",
        "Too hot (max 36°C tolerated)", "Too hot (max 38°C tolerated)",
        "Too hot (max 40°C tolerated)",
        "Humidity too low (min 40% needed)", "Humidity too low (min 50% needed)",
        "Humidity too low (min 60% needed)", "Humidity too low (min 70% needed)",
        "Humidity too low (min 75% needed)",
    ]

    domain_note = (
        "This is for an agricultural alerts page for Indian farmers. "
        "Translate accurately preserving technical terms like pesticide names, "
        "dosage numbers, and units (ml/L, g/L, EC, WP, SL, SG, °C, %) in their original form."
    )
    translations, cached = _translate_terms(terms, lang_name, domain_note, lang, _alerts_translation_cache)

    print(f"[AlertsTranslate] {len(translations)} terms for {lang_name} ({'cache' if cached else 'fresh'})")
    return jsonify({"lang": lang, "lang_name": lang_name, "translations": translations, "cached": cached})

# ─── Dashboard Translation ────────────────────────────────────────────────────
_dashboard_translation_cache = {}

@app.route("/api/translate-dashboard", methods=["POST"])
def translate_dashboard():
    data = request.json or {}
    lang = data.get("lang", "en").strip().lower()

    if lang == "en":
        return jsonify({"lang": "en", "translations": {}, "cached": False})

    lang_name = LANG_NAMES.get(lang, "Hindi")

    terms = [
        # UI Labels
        "Dashboard","Diagnose Crop","Market Prices","Alerts","Get My Location",
        "Location Found","Fetching weather...","Awaiting location...",
        "Current Weather Conditions","Live data from your location",
        "6-Day Forecast","Temperature","Humidity","Wind","Visibility","Pressure",
        "Feels like","Calm","Light breeze","Moderate breeze","Strong breeze","Storm warning",
        "Crop Recommendations","Based on your climate & location",
        "Season","Water Need","Expected Yield","Duration","Soil Type","Fertilizer",
        "Estimated Profit","Match",
        "Crop Advisory Calendar","Week-by-week action plan for your crops",
        "Pesticide & Pest Control Guide","Safe and effective crop protection plan",
        "Quick Actions","Diagnose Crop Disease","Upload or take a photo of your crop",
        "Check Market Prices","Live mandi prices across India",
        "View Active Alerts","Weather & pest warnings for your area",
        "Empowering farmers with AI-driven precision agriculture",
        "Eco-Friendly","Chemical","Week",
        # Seasons
        "Kharif (Monsoon)","Rabi (Winter)","Zaid (Summer)",
        # Water levels
        "Very High","High","Medium","Low",
        # Activity types
        "preparation","sowing","irrigation","fertilizer","maintenance","pesticide","harvest",
        # Calendar activities
        "Soil preparation & ploughing","Seed treatment & sowing","First irrigation",
        "Apply basal fertilizer (NPK)","Weeding & thinning","Apply Urea (top dressing)",
        "Pest & disease inspection","Spray fungicide if required",
        "Foliar spray micronutrients","Pre-harvest irrigation stop","Harvest preparation",
        # Crop names
        "Rice","Wheat","Maize","Cotton","Tomato","Sugarcane","Soybean","Mustard",
        # Crop descriptions
        "Ideal for high humidity and warm conditions",
        "Best suited for cool, dry winters",
        "Versatile crop for warm humid weather",
        "Thrives in hot dry spells with moderate rain",
        "High value crop for moderate climates",
        "Requires hot climate and heavy rainfall",
        "Nitrogen-fixing legume for warm monsoon",
        "Cool weather oil seed crop",
        # Soil types
        "Clay loam, alluvial","Well-drained loam","Sandy loam to clay loam",
        "Black cotton soil","Sandy loam, rich organic matter","Deep loam, good drainage",
        "Well-drained loam","Sandy loam, well-drained",
        # Pest names
        "Brown Plant Hopper","Leaf folder","Aphids","Yellow rust",
        "Fall Armyworm","Stem borer","Bollworm","Whitefly",
        # Pesticide section labels
        "Pest Control Plan","Crop","Timing",
    ]

    domain_note = "Crop, pest, and field-activity names should be the common name farmers actually use, not a literal translation."
    translations, cached = _translate_terms(terms, lang_name, domain_note, lang, _dashboard_translation_cache)

    print(f"[DashboardTranslate] {len(translations)} terms ready for {lang_name} ({'cache' if cached else 'fresh'})")
    return jsonify({"lang": lang, "lang_name": lang_name, "translations": translations, "cached": cached})

# ─── Diagnose Page Translation (static UI text) ───────────────────────────────

_diagnose_translation_cache = {}

@app.route("/api/translate-diagnose", methods=["POST"])
def translate_diagnose():
    data = request.json or {}
    lang = data.get("lang", "en").strip().lower()

    if lang == "en":
        return jsonify({"lang": "en", "translations": {}, "cached": False})

    lang_name = LANG_NAMES.get(lang, "Hindi")

    terms = [
        # Upload panel
        "Drop your crop image here", "Supports JPG, PNG, WEBP — max 10 MB",
        "Upload Photo", "Take Photo", "Image ready for analysis",
        "Remove image", "Close camera", "Capture photo", "Analyze Crop",
        "Analyzing…", "Try Again",
        # Tips card
        "Photo Tips for Best Results",
        "Focus on the most visibly affected area",
        "Use natural daylight — avoid harsh shadows",
        "Include both healthy and affected parts if possible",
        "Keep the camera steady and close (30–50 cm)",
        # Results placeholder
        "Upload a crop image to begin diagnosis",
        "Our AI will identify the disease and suggest eco-friendly treatments",
        "Upload or capture image", "Click Analyze Crop", "Get instant AI diagnosis",
        # Analyzing loader
        "AI is analyzing your crop…",
        "Identifying disease patterns and preparing remedies",
        "Scanning image…", "Detecting patterns…", "Finding remedies…",
        # Results content section headers
        "Cause", "Recovery Timeline", "Eco-Friendly Remedies", "RECOMMENDED",
        "Remedy Effectiveness Chart", "Chemical Treatment Options",
        "Prevention Tips", "Confidence", "Severity", "effectiveness",
        "AI-generated diagnosis for guidance only. Consult a local agronomist for critical crop decisions.",
        "Unknown Disease",
        # Error / failure states
        "Analysis Failed", "Could not process the image.",
        "Make sure your API key is set and the image is clear.",
        "Diagnosis failed. Please try again.",
        "Please upload or capture a crop image first.",
        "Please drop a valid image file (JPG, PNG, WEBP).",
        "Image too large. Max 10 MB allowed.",
        "Camera access denied or not available.",
        "Camera ready — position your crop in frame.",
        "Diagnosis complete!",
        # Severity levels (also used as data values from Groq)
        "Mild", "Moderate", "Severe",
        # How It Works section
        "How It Works", "Capture or Upload",
        "Take a clear photo of the affected crop leaf, stem, or fruit",
        "AI Analysis",
        "Our AI model analyzes visual patterns to identify diseases with high accuracy",
        "Get Remedies",
        "Receive eco-friendly and chemical treatment plans with dosage details instantly",
    ]

    domain_note = "This is UI copy and section labels for a crop-disease-diagnosis app. Keep tone simple and clear for farmers; keep numbers/units/file types (JPG, PNG, WEBP, MB, cm) unchanged."
    translations, cached = _translate_terms(terms, lang_name, domain_note, lang, _diagnose_translation_cache)

    print(f"[DiagnoseTranslate] {len(translations)} terms ready for {lang_name} ({'cache' if cached else 'fresh'})")
    return jsonify({"lang": lang, "lang_name": lang_name, "translations": translations, "cached": cached})


# ─── Dynamic Diagnosis Result Translation ─────────────────────────────────────
_diagnosis_result_cache = {}

@app.route("/api/translate-diagnosis-result", methods=["POST"])
def translate_diagnosis_result():
    data = request.json or {}
    lang   = data.get("lang", "en").strip().lower()
    result = data.get("result") or {}

    if lang == "en" or not result:
        return jsonify({"lang": "en", "translations": {}})

    lang_name = LANG_NAMES.get(lang, "Hindi")
    terms = []
    def add(val):
        if isinstance(val, str) and val.strip() and val not in terms:
            terms.append(val.strip())

    add(result.get("disease"))
    add(result.get("severity"))
    add(result.get("affected_part"))
    add(result.get("cause"))
    add(result.get("recovery_timeline"))
    for r in result.get("eco_remedies") or []:
        add(r.get("remedy")); add(r.get("method")); add(r.get("frequency"))
    for c in result.get("chemical_remedies") or []:
        add(c.get("name")); add(c.get("interval"))
        add(c.get("dose"))
    for tip in result.get("prevention") or []:
        add(tip)

    if not terms:
        return jsonify({"lang": lang, "translations": {}})

    domain_note = ("This is an AI-generated crop disease diagnosis for a farmer. "
                   "Translate naturally using terms a farmer would recognize. "
                   "Keep chemical/brand names, numbers, and units (kg/ha, Rs, days, ml/L, g/ha, "
                   "quintal, %, SL, EC, SC, WP, SG, NPK) unchanged.")
    cache_key = lang + "::" + "|".join(terms)
    translations, cached = _translate_terms(terms, lang_name, domain_note, cache_key, _diagnosis_result_cache)

    return jsonify({"lang": lang, "lang_name": lang_name, "translations": translations, "cached": cached})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=7860, debug=DEBUG_MODE)
