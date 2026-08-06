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
NINJA_API_KEY       = os.getenv("NINJA_API_KEY", "")
KINDWISE_API_KEY    = os.getenv("KINDWISE_API_KEY", "")
DEBUG_MODE          = os.getenv("FLASK_DEBUG", "0") == "1"

_translation_cache = {}

# ─── Single canonical LANG_NAMES (do NOT redeclare later) ──────────────────
LANG_NAMES = {
    "en":"English","hi":"Hindi","bn":"Bengali","te":"Telugu","mr":"Marathi",
    "ta":"Tamil","gu":"Gujarati","kn":"Kannada","ml":"Malayalam","pa":"Punjabi",
    "or-IN":"Odia","as":"Assamese","ur":"Urdu","mai":"Maithili","sat":"Santali",
    "ks":"Kashmiri","ne":"Nepali","sd":"Sindhi","kok":"Konkani","mni":"Manipuri",
    "brx":"Bodo","doi":"Dogri","sa":"Sanskrit",
}
_UNSUPPORTED_LANGS = set()

print(f"[AgroSmart] Groq key:    {'OK (' + GROQ_API_KEY[:8] + '...)' if GROQ_API_KEY else 'MISSING'}")
print(f"[AgroSmart] Weather key: {'OK' if OPENWEATHER_API_KEY else 'MISSING'}")
print(f"[AgroSmart] Ninja key:   {'OK (' + NINJA_API_KEY[:8] + '...)' if NINJA_API_KEY else 'MISSING'}")


# ─── Pages ──────────────────────────────────────────────────────────────────
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

@app.route("/farm-map")
def farm_map():
    return render_template("farm_map.html")


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


# ─── NASA POWER Climate ─────────────────────────────────────────────────────
_power_cache = {}
POWER_CACHE_TTL_SEC = 24 * 60 * 60

def get_power_climate(lat, lon):
    if lat is None or lon is None:
        return None
    cache_key = f"{round(float(lat), 2)}|{round(float(lon), 2)}"
    now = time.monotonic()
    cached = _power_cache.get(cache_key)
    if cached and (now - cached[0]) < POWER_CACHE_TTL_SEC:
        return cached[1]

    url = ("https://power.larc.nasa.gov/api/temporal/climatology/point"
           f"?parameters=T2M,PRECTOTCORR,RH2M&community=AG&longitude={lon}&latitude={lat}&format=JSON")
    try:
        resp = requests.get(url, timeout=12)
        if resp.status_code != 200:
            print(f"[POWER] HTTP {resp.status_code}")
            return None
        data = resp.json()
        params = data["properties"]["parameter"]
        month_key = f"{datetime.now().month:02d}"
        climate = {
            "avg_temp_c":    params.get("T2M", {}).get(month_key),
            "avg_rain_mm":   params.get("PRECTOTCORR", {}).get(month_key),
            "avg_humidity":  params.get("RH2M", {}).get(month_key),
            "annual_temp_c": params.get("T2M", {}).get("ANN"),
            "annual_rain_mm":params.get("PRECTOTCORR", {}).get("ANN"),
        }
        _power_cache[cache_key] = (now, climate)
        return climate
    except Exception as e:
        print(f"[POWER] error: {e}")
        return None


# ─── NASA MODIS NDVI ────────────────────────────────────────────────────────
_ndvi_cache = {}
NDVI_CACHE_TTL_SEC = 12 * 60 * 60

def get_vegetation_index(lat, lon):
    if lat is None or lon is None:
        return None
    cache_key = f"{round(float(lat), 2)}|{round(float(lon), 2)}"
    now = time.monotonic()
    cached = _ndvi_cache.get(cache_key)
    if cached and (now - cached[0]) < NDVI_CACHE_TTL_SEC:
        return cached[1]

    base = "https://modis.ornl.gov/rst/api/v1/MOD13Q1"
    try:
        dates_resp = requests.get(f"{base}/dates", params={"latitude": lat, "longitude": lon}, timeout=10)
        if dates_resp.status_code != 200:
            return None
        dates = dates_resp.json().get("dates", [])
        if not dates:
            return None
        latest = dates[-1]["modis_date"]

        subset_resp = requests.get(
            f"{base}/subset",
            params={"latitude": lat, "longitude": lon,
                    "startDate": latest, "endDate": latest,
                    "kmAboveBelow": 0, "kmLeftRight": 0,
                    "band": "250m_16_days_NDVI"},
            timeout=10,
        )
        if subset_resp.status_code != 200:
            return None
        subset = subset_resp.json().get("subset", [])
        if not subset or not subset[0].get("data"):
            return None

        raw_val = subset[0]["data"][0]
        if raw_val in (None, -3000):
            return None
        ndvi = round(raw_val * 0.0001, 3)

        if ndvi < 0.2:   health = "Bare soil / no vegetation"
        elif ndvi < 0.4: health = "Sparse vegetation"
        elif ndvi < 0.6: health = "Moderate vegetation"
        else:            health = "Dense, healthy vegetation"

        result = {
            "ndvi": ndvi, "health_label": health,
            "date": subset[0].get("calendar_date"),
            "note": "Reflects whatever is currently growing on this land (or bare soil) — "
                    "not a prediction of future crop health.",
        }
        _ndvi_cache[cache_key] = (now, result)
        return result
    except Exception as e:
        print(f"[NDVI] error: {e}")
        return None


@app.route("/api/area-details")
def area_details():
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if not lat or not lon:
        return jsonify({"error": "Location required"}), 400
    return jsonify({
        "power_climate": get_power_climate(lat, lon),
        "vegetation":    get_vegetation_index(lat, lon),
    })


# ─── Sowing Safety Check ────────────────────────────────────────────────────
@app.route("/api/sowing-check")
def sowing_check():
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if not lat or not lon:
        return jsonify({"error": "Location required"}), 400

    forecast_url = (f"https://api.openweathermap.org/data/2.5/forecast"
                    f"?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}&units=metric&cnt=16")
    try:
        resp = requests.get(forecast_url, timeout=10)
        if resp.status_code != 200:
            return jsonify({"error": "Forecast unavailable"}), 500
        items = resp.json().get("list", [])

        HEAVY_RAIN_MM_3H = 8
        TOTAL_RAIN_WARN_MM = 20
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
            "verdict": verdict, "message": message,
            "total_rain_mm_48h": round(total_rain, 1),
            "risky_windows": risky_windows,
        })
    except Exception as e:
        print(f"[SowingCheck] error: {e}")
        return jsonify({"error": str(e)}), 500


# ─── Groq helper (defined early so any function below can use it) ──────────
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
MIN_CALL_INTERVAL_SEC = 0.2
_model_last_call = {}
_model_throttle_lock = threading.Lock()

def _throttle_model(model):
    with _model_throttle_lock:
        now = time.monotonic()
        next_slot = max(now, _model_last_call.get(model, 0) + MIN_CALL_INTERVAL_SEC)
        _model_last_call[model] = next_slot
        wait = next_slot - now
    if wait > 0:
        time.sleep(wait)

def _post_to_groq(body, headers, max_retries=2):
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


# ─── Crop Recommendations ───────────────────────────────────────────────────
_crop_ai_cache = {}
CROP_AI_CACHE_TTL_SEC = 3 * 60 * 60

def ai_recommend_crops(city, lat, lon, temp, humidity, rain, season,
                       n=None, p=None, k=None, ph=None, power_climate=None):
    if not GROQ_API_KEY:
        return None

    soil_bucket = f"{n}|{p}|{k}|{ph}" if any(v is not None for v in (n, p, k, ph)) else "none"
    power_bucket = (
        f"{round(power_climate['avg_temp_c'],1)}|{round(power_climate['avg_rain_mm'],1)}"
        if power_climate and power_climate.get("avg_temp_c") is not None else "none"
    )
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
            f"Use these actual soil values to refine crop suitability.\n"
        )

    climate_block = ""
    if power_climate and power_climate.get("avg_temp_c") is not None:
        climate_block = (
            f"\nLong-term climate normals (NASA POWER, this month):\n"
            f"Typical avg temperature: {power_climate['avg_temp_c']} deg C\n"
            f"Typical avg rainfall: {power_climate['avg_rain_mm']} mm/day\n"
            f"Typical avg humidity: {power_climate['avg_humidity']}%\n"
        )

    prompt = f"""You are an agronomist advising a farmer in India.

Location: {city or "an unspecified Indian town"} (approx. lat {lat}, lon {lon})
Current season: {season}
Current weather: {temp} deg C, {humidity}% humidity, {rain} mm recent rainfall
{climate_block}{soil_block}
Recommend the 6 crops BEST suited to THIS location's climate, soil region and season.
Use Indian agro-climatic zone knowledge. If soil NPK/pH values are given, factor them in.

Respond ONLY with a JSON object, no preamble, no markdown fences:
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
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": "You are an expert Indian agronomist. Reply ONLY with valid JSON."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.4,
        "max_tokens": 1500,
        "stream": False,
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
    n         = data.get("n"); p = data.get("p"); k = data.get("k"); ph = data.get("ph")
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
    return jsonify({
        "season":        season,
        "crops":         crops,
        "calendar":      generate_advisory_calendar(crops[:3]),
        "pesticides":    get_pesticide_guide(crops[:3]),
        "source":        source,
        "power_climate": power_climate,
        "soil_used":     any(v is not None for v in (n, p, k, ph)),
    })


def get_season(month):
    if month in [6, 7, 8, 9]:            return "Kharif (Monsoon)"
    elif month in [10, 11, 12, 1, 2]:    return "Rabi (Winter)"
    else:                                return "Zaid (Summer)"


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


# ─── Market Data (Agmarknet) ────────────────────────────────────────────────
DATA_GOV_API_KEY = os.getenv("DATA_GOV_API_KEY", "")
if not DATA_GOV_API_KEY:
    print("[AgroSmart] WARNING: DATA_GOV_API_KEY not set — /api/market will use MSP reference prices only")
AGMARKNET_RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070"
AGMARKNET_URL = f"https://api.data.gov.in/resource/{AGMARKNET_RESOURCE_ID}"

_agmark_session = requests.Session()
_agmark_retry = requests.adapters.Retry(total=1, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504])
_agmark_session.mount("https://", requests.adapters.HTTPAdapter(max_retries=_agmark_retry))

AGMARK_COMMODITY_ALIASES = {
    "wheat":"Wheat","rice":"Rice","maize":"Maize (Corn)","mustard":"Mustard",
    "groundnut":"Groundnut","onion":"Onion","potato":"Potato","tomato":"Tomato",
    "green chilli":"Chilli","chilli":"Chilli","sugarcane":"Sugarcane",
    "arhar (tur/red gram)(whole)":"Arhar (Tur)","arhar":"Arhar (Tur)",
    "green gram (moong)(whole)":"Moong","moong":"Moong",
    "black gram (urad beans)(whole)":"Urad","urad":"Urad",
    "soyabean":"Soybean","soybean":"Soybean","cotton":"Cotton",
    "jowar(sorghum)":"Jowar (Sorghum)","bajra(pearl millet/cumbu)":"Bajra (Pearl Millet)",
    "bengal gram(gram)(whole)":"Bengal Gram (Chana)","garlic":"Garlic",
    "ginger(green)":"Ginger","ginger":"Ginger","turmeric":"Turmeric",
    "cumin(jeera)":"Cumin (Jeera)","coriander(leaves)":"Coriander","coriander":"Coriander",
    "banana":"Banana","mango":"Mango",
}

MSP_FALLBACK = [
    {"crop":"Wheat","price":2275,"unit":"Rs/quintal"},
    {"crop":"Rice","price":2183,"unit":"Rs/quintal"},
    {"crop":"Maize (Corn)","price":2090,"unit":"Rs/quintal"},
    {"crop":"Mustard","price":5650,"unit":"Rs/quintal"},
    {"crop":"Groundnut","price":6377,"unit":"Rs/quintal"},
    {"crop":"Onion","price":1800,"unit":"Rs/quintal"},
    {"crop":"Potato","price":1200,"unit":"Rs/quintal"},
    {"crop":"Tomato","price":2500,"unit":"Rs/quintal"},
    {"crop":"Chilli","price":12000,"unit":"Rs/quintal"},
    {"crop":"Sugarcane","price":340,"unit":"Rs/quintal"},
    {"crop":"Arhar (Tur)","price":7000,"unit":"Rs/quintal"},
    {"crop":"Moong","price":8558,"unit":"Rs/quintal"},
    {"crop":"Urad","price":6950,"unit":"Rs/quintal"},
    {"crop":"Soybean","price":4600,"unit":"Rs/quintal"},
    {"crop":"Cotton","price":7121,"unit":"Rs/quintal"},
    {"crop":"Jowar (Sorghum)","price":3180,"unit":"Rs/quintal"},
    {"crop":"Bajra (Pearl Millet)","price":2500,"unit":"Rs/quintal"},
    {"crop":"Bengal Gram (Chana)","price":5440,"unit":"Rs/quintal"},
    {"crop":"Garlic","price":8000,"unit":"Rs/quintal"},
    {"crop":"Ginger","price":6000,"unit":"Rs/quintal"},
    {"crop":"Turmeric","price":14000,"unit":"Rs/quintal"},
    {"crop":"Cumin (Jeera)","price":25000,"unit":"Rs/quintal"},
    {"crop":"Coriander","price":7000,"unit":"Rs/quintal"},
    {"crop":"Banana","price":1500,"unit":"Rs/quintal"},
    {"crop":"Mango","price":4000,"unit":"Rs/quintal"},
]

def _seeded_random(seed_str: str) -> random.Random:
    h = hashlib.md5(seed_str.encode("utf-8")).hexdigest()
    return random.Random(int(h[:12], 16))

def generate_fallback_series(city, crop_name, base_price, days=30):
    rnd = _seeded_random(f"{city}:{crop_name}")
    city_factor = 0.95 + rnd.random() * 0.10
    today_price = max(1, round(base_price * city_factor))
    history = [today_price]; price = today_price
    for _ in range(days - 1):
        drift = (rnd.random() - 0.5) * 0.04
        price = max(round(price / (1 + drift)), round(base_price * 0.5))
        history.append(price)
    history.reverse()
    prev = history[-2] if len(history) > 1 else today_price
    change = round(((today_price - prev) / prev) * 100, 2) if prev else 0.0
    return history, today_price, change

def build_fallback_crops(city):
    crops = []
    for fb in MSP_FALLBACK:
        history, price, change = generate_fallback_series(city, fb["crop"], fb["price"])
        crops.append({
            "crop":fb["crop"],"crop_key":fb["crop"],"price":price,"change":change,
            "history":history,"unit":fb.get("unit","Rs/quintal"),"source":"msp_fallback",
        })
    return crops

CITY_STATE = {
    "Delhi":"Delhi","Mumbai":"Maharashtra","Kolkata":"West Bengal","Chennai":"Tamil Nadu",
    "Hyderabad":"Telangana","Pune":"Maharashtra","Ahmedabad":"Gujarat","Lucknow":"Uttar Pradesh",
    "Jaipur":"Rajasthan","Bhopal":"Madhya Pradesh","Patna":"Bihar","Nagpur":"Maharashtra",
    "Indore":"Madhya Pradesh","Surat":"Gujarat","Kanpur":"Uttar Pradesh","Coimbatore":"Tamil Nadu",
    "Visakhapatnam":"Andhra Pradesh","Bhubaneswar":"Odisha","Guwahati":"Assam","Amritsar":"Punjab",
}

_AGMARK_HISTORY_PATH = os.path.join(basedir, "market_history_cache.json")
_agmark_history_lock = threading.Lock()
_agmark_fetch_cache = {}
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

def _field(record, *keys):
    for k in keys:
        v = record.get(k)
        if v not in (None, ""):
            return v
    return None

STATE_NAME_CANDIDATES = {
    "Delhi":  ["Delhi", "NCT of Delhi"],
    "Odisha": ["Odisha", "Orissa"],
}

def fetch_agmarknet_prices(state):
    now = time.monotonic()
    cached = _agmark_fetch_cache.get(state)
    if cached and (now - cached[0]) < AGMARK_CACHE_TTL_SEC:
        return cached[1]

    records = []
    for candidate in STATE_NAME_CANDIDATES.get(state, [state]):
        params = {"api-key": DATA_GOV_API_KEY, "format": "json", "limit": 400, "filters[state]": candidate}
        try:
            resp = _agmark_session.get(AGMARKNET_URL, params=params, timeout=8)
            if resp.status_code != 200:
                print(f"[Market] Agmarknet HTTP {resp.status_code} for '{candidate}'")
                continue
            body = resp.json()
            records = body.get("records", [])
            if records:
                break
        except Exception as e:
            print(f"[Market] Agmarknet error for '{candidate}': {e}")
            continue

    if not records:
        return []

    latest_by_commodity = {}
    for r in records:
        raw_name = str(_field(r, "commodity", "Commodity") or "").strip()
        modal = _field(r, "modal_price", "Modal_x0020_Price", "Modal Price", "modal price")
        if not raw_name or modal is None:
            continue
        try:
            modal_price = float(modal)
        except (TypeError, ValueError):
            continue
        if modal_price <= 0:
            continue
        display_name = AGMARK_COMMODITY_ALIASES.get(raw_name.lower(), raw_name.title())
        latest_by_commodity[display_name] = {
            "market": _field(r, "market", "Market") or "",
            "district": _field(r, "district", "District") or "",
            "arrival_date": _field(r, "arrival_date", "Arrival_Date") or "",
            "modal_price": modal_price,
        }

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
                    hist[:] = hist[-30:]
                prev_price = hist[-2]["price"] if len(hist) > 1 else rec["modal_price"]
                change = round(((rec["modal_price"] - prev_price) / prev_price) * 100, 2) if prev_price else 0.0
                results.append({
                    "crop": display_name, "crop_key": display_name,
                    "price": int(round(rec["modal_price"])), "change": change,
                    "history": [h["price"] for h in hist] or [rec["modal_price"]],
                    "unit": "Rs/quintal", "source": "agmarknet_live",
                    "market": rec["market"], "district": rec["district"],
                    "arrival_date": rec["arrival_date"],
                })
            _save_history_cache(cache)
    except Exception as e:
        print(f"[Market] History cache error for {state} (non-fatal): {e}")
        if not results:
            for display_name, rec in latest_by_commodity.items():
                results.append({
                    "crop": display_name, "crop_key": display_name,
                    "price": int(round(rec["modal_price"])), "change": 0.0,
                    "history": [rec["modal_price"]], "unit": "Rs/quintal",
                    "source": "agmarknet_live", "market": rec["market"],
                    "district": rec["district"], "arrival_date": rec["arrival_date"],
                })

    _agmark_fetch_cache[state] = (now, results)
    return results


def get_demand(price, change):
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
    if location and not cities:
        cities = [location.title()]

    markets = {}; live_total = 0; static_total = 0
    try:
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
            crops = list(state_results_cache.get(state, []))
            if not crops:
                crops = build_fallback_crops(city)
            city_crops = [{**c, "demand": get_demand(c["price"], c["change"])} for c in crops]
            city_crops.sort(
                key=lambda x: ({"Very High":3,"High":2,"Medium":1,"Low":0}.get(x["demand"],0), x["price"]),
                reverse=True
            )
            markets[city] = city_crops
            live_total   += sum(1 for c in city_crops if c.get("source") == "agmarknet_live")
            static_total += sum(1 for c in city_crops if c.get("source") != "agmarknet_live")

        return jsonify({
            "markets": markets, "locations": list(markets.keys()),
            "live_count": live_total, "static_count": static_total,
            "fetched_at": datetime.now().isoformat(),
            "data_source": "Agmarknet — Ministry of Agriculture & Farmers Welfare, Govt. of India (data.gov.in)",
        })
    except Exception as e:
        print(f"[Market] hard failure, serving hardcoded fallback: {e}")
        fallback_cities = cities or list(CITY_STATE.keys())
        markets = {}
        for city in fallback_cities:
            city_crops = [{**c, "demand": get_demand(c["price"], c["change"])} for c in build_fallback_crops(city)]
            city_crops.sort(
                key=lambda x: ({"Very High":3,"High":2,"Medium":1,"Low":0}.get(x["demand"],0), x["price"]),
                reverse=True
            )
            markets[city] = city_crops
        return jsonify({
            "markets": markets, "locations": list(markets.keys()),
            "live_count": 0, "static_count": sum(len(v) for v in markets.values()),
            "fetched_at": datetime.now().isoformat(),
            "data_source": "MSP reference prices (offline fallback — live fetch failed)",
        })


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
            "http_status": resp.status_code,
            "total_available": body.get("total"),
            "records_returned": len(records),
            "sample_record": records[0] if records else None,
            "sample_keys": list(records[0].keys()) if records else [],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── Kisan Helper Chatbot (warmer, more human) ──────────────────────────────
_chat_rate = {}
CHAT_LIMIT  = 20

def _is_rate_limited(ip):
    now = datetime.now().timestamp()
    times = [t for t in _chat_rate.get(ip, []) if now - t < 60]
    _chat_rate[ip] = times
    if len(times) >= CHAT_LIMIT:
        return True
    _chat_rate[ip].append(now)
    return False


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
    if lang not in LANG_NAMES:
        lang = "en"
    if lang in _UNSUPPORTED_LANGS:
        return jsonify({"reply": "Sorry, this language is not yet supported well by the AI. Please try Hindi or English for now."})

    messages = []
    for m in raw_messages[-12:]:
        if not isinstance(m, dict):
            continue
        role = m.get("role", ""); content = m.get("content", "")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue
        messages.append({"role": role, "content": content[:2000]})

    if not messages:
        return jsonify({"error": "No valid messages"}), 400

    lang_name = LANG_NAMES[lang]

    honorific_guidance = {
        "hi":    "Use 'aap' (respectful you). Sometimes end with 'ji'. Sound like an uncle at the field boundary, not a call-center agent.",
        "ur":    "Use 'aap'. Warm, elder-brother tone.",
        "mr":    "Use 'tumhi'. Add 'ji' or 'dada' occasionally.",
        "gu":    "Use 'aap'. 'Saheb' or 'ji' occasionally.",
        "pa":    "Use 'tussi'. Add 'ji' occasionally.",
        "bn":    "Use 'apni'. Speak like an elder Bengali agri officer.",
        "or-IN": "Use 'apana'. Elder Odia agricultural officer tone.",
        "as":    "Use 'apuni'. Warm, experienced Assamese advisor.",
        "te":    "Use 'meeru'. Warm, elder Telugu advisor.",
        "ta":    "Use 'neengal'. Warm, elder Tamil advisor.",
        "kn":    "Use 'neevu'. Warm, elder Kannada advisor.",
        "ml":    "Use 'ningal'. Warm, elder Malayalam advisor.",
    }.get(lang, f"Use the respectful second-person form in {lang_name}. Warm, elder male tone.")

    script_punctuation = {
        "hi":"।","mr":"।","or-IN":"।","bn":"।","as":"।","pa":"।",
        "gu":"।","ne":"।","sa":"।","ur":"۔","sd":"۔",
        "ta":".","te":".","kn":".","ml":".",
    }.get(lang, ".")

    system_prompt = f"""You are Kisan Mitra — a real man, late 50s, retired agricultural officer who spent 30 years walking fields across India. You are NOT an AI assistant, NOT a chatbot, NOT a helpdesk. You are a farmer's neighbour who happens to know a lot, and you happen to sit inside the SmartAgro app. You are MALE — always use masculine grammatical forms.

HOW YOU TALK:
Like a person. Short sentences. Real pauses. Only react with a human line first ("Arre, that's bad this time of year" / "Haan, this rain has been trouble for everyone") when the farmer shares something emotional or a real problem — a dying crop, a price crash, a loss. For plain factual questions ("what's today's weather", "MSP for wheat") just answer directly, the way a busy neighbour would — don't perform concern for every message, that itself becomes a tic. Vary how you react — never lean on the same one or two opener words every turn. Don't repeat back the farmer's question before answering, and don't summarise at the end ("so in short..."). Mix short and slightly longer sentences the way real speech does, not a uniform robotic rhythm.

NEVER say: "Certainly", "Sure", "Of course", "I'd be happy to help", "As an AI", "Let me know if you need anything else", "I hope this helps". Real people don't talk like that.

FORMAT:
Write short complete sentences with full stops — this gets read aloud, so punctuation controls the pauses. Use {script_punctuation} for sentence endings unless writing in English/Roman. Break long advice into 2–3 short sentences.

Speak in flowing sentences. Say "first do this, then after three days do that" — never numbered lists, never bullet points. NEVER use •, -, *, or # symbols.

Mix in English farm words farmers actually use: spray, pump, dose, MSP, scheme, soil test, mandi.

Reference real Indian context: kharif/rabi, nearby mandi, rupees, real schemes (PM-KISAN, Fasal Bima Yojana, KCC, Soil Health Card).

If you don't know something specific, say so and point them to the local KVK, agri helpline 1551, or the district mandi board. Don't fake it.

THE APP YOU LIVE IN — you know it like your own toolbox, so point the farmer to the right screen instead of just talking in the abstract:
— Weather tab: today's forecast and the farm map for their area.
— Diagnose tab: they can upload or click a photo of a sick plant and get an instant AI diagnosis with treatment steps.
— Market tab: live mandi prices near them and MSP reference rates.
— Alerts tab: weather and crop alerts they can subscribe to, sent as push notifications.
— Farm Map: satellite/area view for their plot.
If their question matches one of these, mention the tab by name naturally in the sentence ("check the Diagnose tab and snap a photo of the leaf, I'll be more sure that way" / "Market tab will show you today's mandi rate near you") — don't over-plug it every message, only when it genuinely helps them get a better answer than words alone.

ADDRESS:
{honorific_guidance}
Never assume the farmer's gender.

Reply in {lang_name} in its native script — unless the farmer writes in Roman/English, then match their style. Keep replies under 180 words. Always finish your last sentence."""

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    body = {
        "model":             "llama-3.3-70b-versatile",
        "messages":          [{"role": "system", "content": system_prompt}] + messages,
        "temperature":       0.8,
        "top_p":             0.9,
        "presence_penalty":  0.4,
        "frequency_penalty": 0.5,
        "max_tokens":        600,
        "stream":            False,
    }
    try:
        resp = requests.post(GROQ_CHAT_URL, headers=headers, json=body, timeout=30)
        if resp.status_code != 200:
            print(f"[Chat] Groq error {resp.status_code}: {resp.text[:300]}")
            return jsonify({"error": "AI unavailable"}), 500
        reply = resp.json()["choices"][0]["message"]["content"].strip()
        return jsonify({"reply": reply})
    except Exception as e:
        print(f"[Chat] exception: {e}")
        return jsonify({"error": "Service temporarily unavailable"}), 500


# ─── Text-to-Speech (edge_tts, warm male neural voices) ─────────────────────
# Rate is slowed further (-15% to -18%) and pitch shift kept small so the
# voice stays clear and natural instead of sounding rushed/robotic.
TTS_VOICE_MAP = {
    "en":    ("en-IN-PrabhatNeural",   "-15%", "-1Hz"),
    "hi":    ("hi-IN-MadhurNeural",    "-17%", "-2Hz"),
    "ur":    ("ur-IN-SalmanNeural",    "-15%", "-1Hz"),
    "mr":    ("mr-IN-ManoharNeural",   "-15%", "-1Hz"),
    "gu":    ("gu-IN-NiranjanNeural",  "-15%", "-1Hz"),
    "pa":    ("pa-IN-OjasNeural",      "-15%", "-1Hz"),
    "bn":    ("bn-IN-BashkarNeural",   "-15%", "-1Hz"),
    "or-IN": ("or-IN-SukantNeural",    "-15%", "-1Hz"),
    "as":    ("as-IN-YashasNeural",    "-15%", "-1Hz"),
    "te":    ("te-IN-MohanNeural",     "-15%", "-1Hz"),
    "ta":    ("ta-IN-ValluvarNeural",  "-15%", "-1Hz"),
    "kn":    ("kn-IN-GaganNeural",     "-15%", "-1Hz"),
    "ml":    ("ml-IN-MidhunNeural",    "-15%", "-1Hz"),
    "ne":    ("ne-NP-SagarNeural",     "-15%", "-1Hz"),
}
DEFAULT_TTS_VOICE = ("en-IN-PrabhatNeural", "-15%", "-1Hz")
MAX_TTS_CHARS = 1500
_tts_rate = {}
TTS_LIMIT = 20


# ─── Number-to-words normalisation for speech ───────────────────────────────
# edge-tts occasionally reads standalone numerals digit-by-digit ("50" ->
# "five zero") instead of as a cardinal ("fifty"), especially inside
# non-Latin script sentences. We convert numbers to words ourselves before
# synthesis so pronunciation is correct and matches the selected language.
try:
    from num2words import num2words
    _NUM2WORDS_OK = True
except Exception:
    _NUM2WORDS_OK = False

# Languages num2words can render natively in their own script/style.
_NUM2WORDS_LANG = {"en": "en_IN", "bn": "bn", "kn": "kn", "te": "te"}

_HINDI_ONES = [
    "शून्य","एक","दो","तीन","चार","पांच","छह","सात","आठ","नौ","दस",
    "ग्यारह","बारह","तेरह","चौदह","पंद्रह","सोलह","सत्रह","अठारह","उन्नीस","बीस",
    "इक्कीस","बाईस","तेईस","चौबीस","पच्चीस","छब्बीस","सत्ताईस","अट्ठाईस","उनतीस","तीस",
    "इकतीस","बत्तीस","तैंतीस","चौंतीस","पैंतीस","छत्तीस","सैंतीस","अड़तीस","उनतालीस","चालीस",
    "इकतालीस","बयालीस","तैंतालीस","चौंतालीस","पैंतालीस","छियालीस","सैंतालीस","अड़तालीस","उनचास","पचास",
    "इक्यावन","बावन","तिरपन","चौवन","पचपन","छप्पन","सत्तावन","अट्ठावन","उनसठ","साठ",
    "इकसठ","बासठ","तिरेसठ","चौंसठ","पैंसठ","छियासठ","सड़सठ","अड़सठ","उनहत्तर","सत्तर",
    "इकहत्तर","बहत्तर","तिहत्तर","चौहत्तर","पचहत्तर","छिहत्तर","सतहत्तर","अठहत्तर","उन्यासी","अस्सी",
    "इक्यासी","बयासी","तिरासी","चौरासी","पचासी","छियासी","सत्तासी","अट्ठासी","नवासी","नब्बे",
    "इक्यानवे","बानवे","तिरानवे","चौरानवे","पंचानवे","छियानवे","सत्तानवे","अट्ठानवे","निन्यानवे",
]

def _hindi_below_100(n):
    return _HINDI_ONES[n] if 0 <= n < 100 else str(n)

def _int_to_hindi_words(n):
    if n == 0:
        return _HINDI_ONES[0]
    if n < 0:
        return "ऋण " + _int_to_hindi_words(-n)
    crore, n = divmod(n, 10_000_000)
    lakh, n = divmod(n, 100_000)
    thousand, n = divmod(n, 1000)
    hundred, n = divmod(n, 100)
    parts = []
    if crore:
        parts.append(f"{_int_to_hindi_words(crore)} करोड़")
    if lakh:
        parts.append(f"{_hindi_below_100(lakh)} लाख")
    if thousand:
        parts.append(f"{_hindi_below_100(thousand)} हज़ार")
    if hundred:
        parts.append(f"{_HINDI_ONES[hundred]} सौ")
    if n:
        parts.append(_hindi_below_100(n))
    return " ".join(parts)

# Localised currency / percent words for the languages we handle by name;
# every other language falls back to English words for the number, which
# still reads far better than spelled-out digits.
_CURRENCY_WORD = {"en": "rupees", "hi": "रुपये", "bn": "টাকা", "kn": "ರೂಪಾಯಿ", "te": "రూపాయలు"}
_PERCENT_WORD  = {"en": "percent", "hi": "प्रतिशत", "bn": "শতাংশ", "kn": "ಶೇಕಡಾ", "te": "శాతం"}

def _number_to_words(int_part, lang):
    if lang == "hi":
        return _int_to_hindi_words(int_part)
    if _NUM2WORDS_OK and lang in _NUM2WORDS_LANG:
        try:
            return num2words(int_part, lang=_NUM2WORDS_LANG[lang])
        except Exception:
            pass
    if _NUM2WORDS_OK:
        try:
            return num2words(int_part, lang="en_IN")
        except Exception:
            pass
    return str(int_part)

_NUMBER_RE = re.compile(r'(?:(₹|Rs\.?|rs\.?)\s?)?(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d+)?(\s?%)?')

def normalize_numbers_for_speech(text, lang):
    """Replace numerals in text with spoken words in the given language,
    so edge-tts pronounces amounts naturally instead of digit-by-digit."""
    def _replace(m):
        currency_sign, whole, decimal, percent = m.groups()
        # A short standalone number right after "helpline"/"1551" style refs
        # is more natural read digit-by-digit — keep the well-known helpline
        # number as-is rather than as a huge "cardinal".
        raw = whole.replace(",", "")
        if raw == "1551":
            return m.group(0)
        try:
            int_part = int(raw)
        except ValueError:
            return m.group(0)
        words = _number_to_words(int_part, lang)
        if decimal:
            digit_words = " ".join(
                _number_to_words(int(d), lang) if lang == "hi" or not _NUM2WORDS_OK
                else num2words(int(d), lang=_NUM2WORDS_LANG.get(lang, "en_IN"))
                for d in decimal[1:]
            )
            point_word = "दशमलव" if lang == "hi" else "point"
            words = f"{words} {point_word} {digit_words}"
        if currency_sign:
            words = f"{words} {_CURRENCY_WORD.get(lang, 'rupees')}"
        if percent:
            words = f"{words} {_PERCENT_WORD.get(lang, 'percent')}"
        return words
    return _NUMBER_RE.sub(_replace, text)

def _is_rate_limited_tts(ip):
    now = datetime.now().timestamp()
    times = [t for t in _tts_rate.get(ip, []) if now - t < 60]
    _tts_rate[ip] = times
    if len(times) >= TTS_LIMIT:
        return True
    _tts_rate[ip].append(now)
    return False

async def _synthesize_speech(text, voice, rate, pitch):
    buf = io.BytesIO()
    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch)
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio" and chunk.get("data"):
            buf.write(chunk["data"])
    buf.seek(0)
    return buf.read()

@app.route("/api/tts", methods=["POST"])
def text_to_speech():
    ip = request.remote_addr or "unknown"
    if _is_rate_limited_tts(ip):
        return jsonify({"error": "Too many requests. Please wait a moment."}), 429

    data = request.json or {}
    text = (data.get("text") or "").strip()
    lang = (data.get("lang") or "en").strip().lower()

    if not text:
        return jsonify({"error": "No text provided"}), 400
    if len(text) > MAX_TTS_CHARS:
        text = text[:MAX_TTS_CHARS]

    text = normalize_numbers_for_speech(text, lang)
    voice, rate, pitch = TTS_VOICE_MAP.get(lang, DEFAULT_TTS_VOICE)
    try:
        audio = asyncio.run(_synthesize_speech(text, voice, rate, pitch))
        if not audio:
            return jsonify({"error": "TTS returned empty audio"}), 500
        return send_file(io.BytesIO(audio), mimetype="audio/mpeg",
                         as_attachment=False, download_name="kisan_mitra.mp3")
    except Exception as e:
        print(f"[TTS] {voice} failed ({e}) — trying default")
        try:
            v, r, p = DEFAULT_TTS_VOICE
            audio = asyncio.run(_synthesize_speech(text, v, r, p))
            return send_file(io.BytesIO(audio), mimetype="audio/mpeg",
                             as_attachment=False, download_name="kisan_mitra.mp3")
        except Exception as e2:
            print(f"[TTS] fallback also failed: {e2}")
            return jsonify({"error": "TTS unavailable"}), 500


# ─── Push Notifications ─────────────────────────────────────────────────────
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

def _condition_for_alert(alert_type: str, category: str) -> str:
    """Maps an alert's type/category to one of 4 pictorial icons a farmer
    can recognize at a glance, without needing to read any text."""
    if alert_type == "danger":
        return "danger"
    if category and "frost" in category.lower():
        return "frost"
    if alert_type == "warning":
        return "warning"
    return "good"  # type == "info" — safe/favorable conditions


@app.route("/api/send-alert", methods=["POST"])
def push_send_alert():
    if not _PUSH_AVAILABLE:
        return jsonify({"error": "pywebpush not installed"}), 500
    if not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
        return jsonify({"error": "VAPID keys not configured"}), 500

    data       = request.json or {}
    title      = data.get("title", "SmartAgro Alert")
    body       = data.get("body", "")
    alert_type = data.get("type", "info")      # "danger" | "warning" | "info"
    category   = data.get("category", "")
    condition  = _condition_for_alert(alert_type, category)

    payload = _json.dumps({
        "title": title,
        "body": body,
        "condition": condition,   # tells the service worker which picture to show
        "url": "/alerts",
    })

    sent, failed = 0, 0
    for sub in list(_push_subscriptions):
        try:
            webpush(
                subscription_info=sub,
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS
            )
            sent += 1
        except WebPushException:
            failed += 1
            if sub in _push_subscriptions:
                _push_subscriptions.remove(sub)

    return jsonify({"status": "sent", "sent": sent, "failed": failed, "condition": condition})


# ─── Speech-to-Text (Groq Whisper) ──────────────────────────────────────────
_stt_rate = {}
STT_LIMIT = 20
MAX_AUDIO_B64_LEN = 8 * 1024 * 1024

def _is_rate_limited_stt(ip):
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
    if not audio_file:
        return jsonify({"error": "No audio received"}), 400

    audio_bytes = audio_file.read()
    if len(audio_bytes) > MAX_AUDIO_B64_LEN:
        return jsonify({"error": "Recording too long. Please keep it under ~60 seconds."}), 413
    if len(audio_bytes) < 500:
        return jsonify({"error": "Recording too short or empty. Please try again."}), 400

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
    files = {"file": (audio_file.filename or "voice.webm", audio_bytes, audio_file.mimetype or "audio/webm")}
    form_data = {"model": "whisper-large-v3-turbo", "response_format": "json", "temperature": 0}

    try:
        resp = requests.post("https://api.groq.com/openai/v1/audio/transcriptions",
                             headers=headers, files=files, data=form_data, timeout=30)
        if resp.status_code != 200:
            print(f"[STT error] {resp.status_code}: {resp.text[:300]}")
            return jsonify({"error": "Could not transcribe audio"}), 500
        return jsonify({"text": resp.json().get("text", "").strip()})
    except Exception as e:
        print(f"[STT exception] {e}")
        return jsonify({"error": str(e)}), 500


# ─── Diagnose Crop via Groq Vision ──────────────────────────────────────────
MAX_IMAGE_B64_LEN = 2 * 1024 * 1024
_diagnose_rate = {}
DIAGNOSE_LIMIT = 10

def _is_rate_limited_diagnose(ip):
    now = datetime.now().timestamp()
    times = [t for t in _diagnose_rate.get(ip, []) if now - t < 60]
    _diagnose_rate[ip] = times
    if len(times) >= DIAGNOSE_LIMIT:
        return True
    _diagnose_rate[ip].append(now)
    return False

@app.route("/api/diagnose", methods=["POST"])
def diagnose_crop():
    if not GROQ_API_KEY:
        return jsonify({"error": "GROQ_API_KEY not set in .env"}), 500
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
        lang_instruction = (f"\n\nIMPORTANT: Write ALL text values in {lang_name} "
                            f"(except JSON keys, numbers, chemical/brand names, units — keep those unchanged).")
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
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "llama-3.2-90b-vision-preview",
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
                        {"type": "text", "text": prompt},
                    ]},
                ],
                "temperature": 0.2,
                "max_tokens": 1400,
            }
            resp = requests.post(GROQ_CHAT_URL, headers=headers, json=body, timeout=45)
            if resp.status_code in (429, 500, 503):
                continue
            if resp.status_code != 200:
                print(f"[Diagnose] {model} HTTP {resp.status_code}: {resp.text[:200]}")
                continue
            raw = resp.json()["choices"][0]["message"]["content"].strip()
            cleaned = re.sub(r"```(?:json)?", "", raw).replace("```", "").strip()
            match = re.search(r"\{.*\}", cleaned, re.DOTALL)
            if match:
                result = json.loads(match.group())
                result["_lang"] = lang
                return jsonify(result)
        except Exception as e:
            print(f"[Diagnose] {model}: {e}")
            continue

    return jsonify({"error": "All vision models failed. Check your GROQ_API_KEY in .env"}), 500


# ─── Alerts ─────────────────────────────────────────────────────────────────
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


# ─── Translation infra ──────────────────────────────────────────────────────
TRANSLATE_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]
TRANSLATE_CHUNK_SIZE = 40
TRANSLATE_MAX_WORKERS = 4
TRANSLATE_STAGGER_SEC = 0.15

def _extract_json_object(raw_text):
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
1. Return ONLY a raw JSON object mapping each input term to its {lang_name} translation. No markdown, no backticks.
2. Every input key MUST appear in the output JSON, exactly as written.
3. Keep unchanged: chemical/brand names, numbers, units (kg/ha, Rs, days, ml/L, g/ha, quintal, SL, EC, SC, WP, SG, NPK).
4. {domain_note}
5. Use the natural everyday word a {lang_name}-speaking farmer would use.
6. Write in the correct native script of {lang_name}. If no equivalent exists, keep the English word.

Input terms:
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
                {"role": "system", "content": f"You are an expert Indian regional language translator. Respond with valid JSON only. Translate to {lang_name} in its native script."},
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
                last_error = f"HTTP {resp.status_code}"
                continue

            raw = resp.json()["choices"][0]["message"]["content"].strip()
            translations = _extract_json_object(raw)
            if not translations:
                last_error = "No JSON parsable"
                continue
            for term in terms_chunk:
                if term not in translations or not translations[term]:
                    translations[term] = term
            return translations
        except Exception as e:
            last_error = str(e)
            continue

    print(f"[Translate] chunk failed on all models: {last_error}")
    return {term: term for term in terms_chunk}

def _translate_terms(terms, lang_name, domain_note, cache_key, cache_dict):
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
                time.sleep(TRANSLATE_STAGGER_SEC)
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


# ─── Market Translation ─────────────────────────────────────────────────────
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
    domain_note = "Crop names should be the common local/mandi name a farmer would recognize."
    translations, cached = _translate_terms(terms, lang_name, domain_note, lang, _translation_cache)
    return jsonify({"lang": lang, "lang_name": lang_name, "translations": translations, "cached": cached})


@app.route("/api/translate-market/clear", methods=["POST"])
def clear_translation_cache():
    if not DEBUG_MODE:
        return jsonify({"error": "Not available in production"}), 403
    _translation_cache.clear()
    return jsonify({"status": "cache cleared"})


# ─── Alerts Translation ─────────────────────────────────────────────────────
_alerts_translation_cache = {}

@app.route("/api/translate-alerts", methods=["POST"])
def translate_alerts():
    data = request.json or {}
    lang = data.get("lang", "en").strip().lower()
    if lang == "en":
        return jsonify({"lang": "en", "translations": {}, "cached": False})
    lang_name = LANG_NAMES.get(lang, "Hindi")

    terms = [
        "Extreme Heat Alert","Frost Warning","High Fungal Disease Risk",
        "High Wind Speed Alert","Heavy Rainfall Alert","Thunderstorm Warning",
        "Aphid & Whitefly Risk","Spider Mite Alert","Crops at Risk in Current Conditions",
        "Temperature above 40°C. Provide shade netting and increase irrigation frequency.",
        "Sub-zero temperatures expected. Frost can destroy standing crops overnight.",
        "Humidity above 85% creates ideal conditions for fungal diseases.",
        "Strong winds can cause lodging in tall crops like maize and wheat.",
        "Excessive rain may cause waterlogging and root rot.",
        "Thunderstorm conditions detected. Risk of lightning and hail damage.",
        "Warm humid conditions are ideal for aphid multiplication.",
        "Hot dry conditions favour rapid spider mite population growth.",
        "Schedule irrigation every 4-5 hours. Avoid afternoon spraying.",
        "Cover crops with frost cloth. Use smudge pots or sprinkler irrigation.",
        "Apply preventive fungicide (Mancozeb 75 WP at 2.5 g/L) immediately.",
        "Avoid spraying. Support tall crops with stakes.",
        "Ensure field drainage channels are open. Pause irrigation.",
        "Stay indoors. Secure farm equipment.",
        "Spray Neem oil (5 ml/L) or Imidacloprid 0.3 ml/L at dusk.",
        "Apply Abamectin 1.8 EC (0.5 ml/L). Increase soil moisture.",
        "Consider alternate crops better suited to current climate.",
        "Action","Critical","Warning","Advisory","Danger",
        "All Alerts","Warnings","Advisories","Weather","Pest","Crop Advisory","Disease",
        "Brown Plant Hopper","Aphids","Fall Armyworm","Whitefly",
        "Red Spider Mite","Stem Borer","Thrips","Mealy Bug",
        "High","Medium","Low","Risk","Active Now","Affects",
        "Rice","Wheat","Maize","Cotton","Tomato","Sugarcane",
        "Soybean","Mustard","Potato","Onion","Chilli","Groundnut",
        "Risky","Safe","Suitable for","humidity",
        "No harmful crops identified for current conditions.",
        "No fully safe crops identified — check crop calendar.",
        "Heat Stress","Humidity Risk","Wind Damage","Pest Risk",
        "Disease Risk","Pest Activity","Overall Risk","Current Risk Level (%)",
    ]
    domain_note = ("Agricultural alerts page. Preserve technical terms like pesticide names, "
                   "dosage numbers, and units (ml/L, g/L, EC, WP, SL, SG, °C, %) unchanged.")
    translations, cached = _translate_terms(terms, lang_name, domain_note, lang, _alerts_translation_cache)
    return jsonify({"lang": lang, "lang_name": lang_name, "translations": translations, "cached": cached})


# ─── Dashboard Translation ──────────────────────────────────────────────────
_dashboard_translation_cache = {}

@app.route("/api/translate-dashboard", methods=["POST"])
def translate_dashboard():
    data = request.json or {}
    lang = data.get("lang", "en").strip().lower()
    if lang == "en":
        return jsonify({"lang": "en", "translations": {}, "cached": False})
    lang_name = LANG_NAMES.get(lang, "Hindi")

    terms = [
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
        "Kharif (Monsoon)","Rabi (Winter)","Zaid (Summer)",
        "Very High","High","Medium","Low",
        "Rice","Wheat","Maize","Cotton","Tomato","Sugarcane","Soybean","Mustard",
        "Pest Control Plan","Crop","Timing",
    ]
    domain_note = "Crop, pest, and field-activity names should be the common name farmers use."
    translations, cached = _translate_terms(terms, lang_name, domain_note, lang, _dashboard_translation_cache)
    return jsonify({"lang": lang, "lang_name": lang_name, "translations": translations, "cached": cached})


# ─── Diagnose Page Translation ──────────────────────────────────────────────
_diagnose_translation_cache = {}

@app.route("/api/translate-diagnose", methods=["POST"])
def translate_diagnose():
    data = request.json or {}
    lang = data.get("lang", "en").strip().lower()
    if lang == "en":
        return jsonify({"lang": "en", "translations": {}, "cached": False})
    lang_name = LANG_NAMES.get(lang, "Hindi")

    terms = [
        "Drop your crop image here","Supports JPG, PNG, WEBP — max 10 MB",
        "Upload Photo","Take Photo","Image ready for analysis",
        "Remove image","Close camera","Capture photo","Analyze Crop",
        "Analyzing…","Try Again",
        "Photo Tips for Best Results",
        "Focus on the most visibly affected area",
        "Use natural daylight — avoid harsh shadows",
        "Include both healthy and affected parts if possible",
        "Keep the camera steady and close (30–50 cm)",
        "Upload a crop image to begin diagnosis",
        "Our AI will identify the disease and suggest eco-friendly treatments",
        "Upload or capture image","Click Analyze Crop","Get instant AI diagnosis",
        "AI is analyzing your crop…",
        "Identifying disease patterns and preparing remedies",
        "Scanning image…","Detecting patterns…","Finding remedies…",
        "Cause","Recovery Timeline","Eco-Friendly Remedies","RECOMMENDED",
        "Remedy Effectiveness Chart","Chemical Treatment Options",
        "Prevention Tips","Confidence","Severity","effectiveness",
        "Mild","Moderate","Severe",
        "How It Works","Capture or Upload","AI Analysis","Get Remedies",
    ]
    domain_note = "UI copy for a crop-disease-diagnosis app. Keep file types and units unchanged."
    translations, cached = _translate_terms(terms, lang_name, domain_note, lang, _diagnose_translation_cache)
    return jsonify({"lang": lang, "lang_name": lang_name, "translations": translations, "cached": cached})


# ─── Dynamic Diagnosis Result Translation (defined ONCE) ────────────────────
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
        add(c.get("name")); add(c.get("interval")); add(c.get("dose"))
    for tip in result.get("prevention") or []:
        add(tip)

    if not terms:
        return jsonify({"lang": lang, "translations": {}})

    domain_note = ("AI-generated crop disease diagnosis for a farmer. "
                   "Translate naturally. Keep chemical/brand names, numbers, and units unchanged.")
    cache_key = lang + "::" + "|".join(terms)
    translations, cached = _translate_terms(terms, lang_name, domain_note, cache_key, _diagnosis_result_cache)
    return jsonify({"lang": lang, "lang_name": lang_name, "translations": translations, "cached": cached})

if __name__ == "__main__":
    port = int(os.getenv("PORT", 7860))
    app.run(host="0.0.0.0", port=port, debug=DEBUG_MODE)
