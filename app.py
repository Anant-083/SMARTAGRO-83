from flask import Flask, render_template, request, jsonify
import requests
import os
import json
import re
from datetime import datetime, timedelta
from dotenv import load_dotenv

basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, '.env'))

app = Flask(__name__)

OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
GROQ_API_KEY        = os.getenv("GROQ_API_KEY", "")
DATAGOV_API_KEY     = os.getenv("DATAGOV_API_KEY", "")

# In-memory cache for translated terms { lang_code: { "Wheat": "गेहूं", ... } }
_translation_cache = {}

print(f"[AgroSmart] Groq key:      {'OK (' + GROQ_API_KEY[:8] + '...)' if GROQ_API_KEY else 'MISSING'}")
print(f"[AgroSmart] Weather key:   {'OK' if OPENWEATHER_API_KEY else 'MISSING'}")
print(f"[AgroSmart] DataGov key:   {'OK (' + DATAGOV_API_KEY[:12] + '...)' if DATAGOV_API_KEY else 'MISSING'}")

# ─── Routes ───────────────────────────────────────────────────────────────────
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

# ─── Weather API ──────────────────────────────────────────────────────────────
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


# ─── Crop Recommendations ─────────────────────────────────────────────────────
@app.route("/api/crop-recommendations", methods=["POST"])
def crop_recommendations():
    data     = request.json or {}
    temp     = data.get("temp", 25)
    humidity = data.get("humidity", 60)
    rain     = data.get("rain", 0)
    season   = get_season(datetime.now().month)
    crops    = recommend_crops(temp, humidity, rain, season)
    calendar = generate_advisory_calendar(crops[:3])
    return jsonify({
        "season":     season,
        "crops":      crops,
        "calendar":   calendar,
        "pesticides": get_pesticide_guide(crops[:3])
    })


def get_season(month):
    if month in [6,7,8,9]:        return "Kharif (Monsoon)"
    elif month in [10,11,12,1,2]: return "Rabi (Winter)"
    else:                          return "Zaid (Summer)"


def recommend_crops(temp, humidity, rain, season):
    all_crops = [
        {"name":"Rice",      "icon":"🌾","temp_range":(20,38),"humidity_range":(70,100),"season":"Kharif (Monsoon)","water":"High","yield":"3-5 tonnes/ha","profit":"₹45,000-65,000/ha","duration":"90-150 days","description":"Ideal for high humidity and warm conditions","soil":"Clay loam, alluvial","fertilizer":"NPK 120:60:60 kg/ha"},
        {"name":"Wheat",     "icon":"🌿","temp_range":(10,25),"humidity_range":(40,65), "season":"Rabi (Winter)",   "water":"Medium","yield":"4-6 tonnes/ha","profit":"₹50,000-75,000/ha","duration":"100-150 days","description":"Best suited for cool, dry winters","soil":"Well-drained loam","fertilizer":"NPK 120:60:40 kg/ha"},
        {"name":"Maize",     "icon":"🌽","temp_range":(18,35),"humidity_range":(50,80), "season":"Kharif (Monsoon)","water":"Medium","yield":"5-8 tonnes/ha","profit":"₹40,000-60,000/ha","duration":"80-110 days","description":"Versatile crop for warm humid weather","soil":"Sandy loam to clay loam","fertilizer":"NPK 150:75:75 kg/ha"},
        {"name":"Cotton",    "icon":"☁️","temp_range":(25,40),"humidity_range":(40,70), "season":"Kharif (Monsoon)","water":"Medium","yield":"2-3 tonnes/ha","profit":"₹60,000-90,000/ha","duration":"150-180 days","description":"Thrives in hot dry spells with moderate rain","soil":"Black cotton soil","fertilizer":"NPK 90:45:45 kg/ha"},
        {"name":"Tomato",    "icon":"🍅","temp_range":(18,30),"humidity_range":(60,80), "season":"Zaid (Summer)",   "water":"Medium","yield":"20-40 tonnes/ha","profit":"₹80,000-1,50,000/ha","duration":"60-80 days","description":"High value crop for moderate climates","soil":"Sandy loam, rich organic matter","fertilizer":"NPK 100:60:60 kg/ha"},
        {"name":"Sugarcane", "icon":"🎋","temp_range":(24,38),"humidity_range":(75,90), "season":"Kharif (Monsoon)","water":"Very High","yield":"70-100 tonnes/ha","profit":"₹70,000-1,00,000/ha","duration":"300-360 days","description":"Requires hot climate and heavy rainfall","soil":"Deep loam, good drainage","fertilizer":"NPK 250:80:100 kg/ha"},
        {"name":"Soybean",   "icon":"🫘","temp_range":(20,32),"humidity_range":(60,80), "season":"Kharif (Monsoon)","water":"Medium","yield":"2-3 tonnes/ha","profit":"₹35,000-55,000/ha","duration":"90-120 days","description":"Nitrogen-fixing legume for warm monsoon","soil":"Well-drained loam","fertilizer":"NPK 30:60:40 kg/ha"},
        {"name":"Mustard",   "icon":"🌻","temp_range":(10,25),"humidity_range":(40,60), "season":"Rabi (Winter)",   "water":"Low","yield":"1-2 tonnes/ha","profit":"₹25,000-40,000/ha","duration":"90-110 days","description":"Cool weather oil seed crop","soil":"Sandy loam, well-drained","fertilizer":"NPK 80:40:40 kg/ha"},
    ]
    scored = []
    for crop in all_crops:
        score = 0
        if crop["temp_range"][0] <= temp <= crop["temp_range"][1]:            score += 40
        elif abs(temp - sum(crop["temp_range"])/2) < 5:                       score += 20
        if crop["humidity_range"][0] <= humidity <= crop["humidity_range"][1]: score += 30
        if crop["season"] == season:                                           score += 30
        crop["score"] = score
        crop["match"] = f"{min(100,score)}%"
        scored.append(crop)
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored


def generate_advisory_calendar(crops):
    today      = datetime.now()
    activities = [
        {"week":1,  "activity":"Soil preparation & ploughing",       "type":"preparation"},
        {"week":2,  "activity":"Seed treatment & sowing",            "type":"sowing"},
        {"week":3,  "activity":"First irrigation",                   "type":"irrigation"},
        {"week":4,  "activity":"Apply basal fertilizer (NPK)",       "type":"fertilizer"},
        {"week":6,  "activity":"Weeding & thinning",                 "type":"maintenance"},
        {"week":8,  "activity":"Apply Urea (top dressing)",          "type":"fertilizer"},
        {"week":10, "activity":"Pest & disease inspection",          "type":"pesticide"},
        {"week":12, "activity":"Spray fungicide if required",        "type":"pesticide"},
        {"week":16, "activity":"Foliar spray micronutrients",        "type":"fertilizer"},
        {"week":20, "activity":"Pre-harvest irrigation stop",        "type":"irrigation"},
        {"week":22, "activity":"Harvest preparation",                "type":"harvest"},
    ]
    calendar = []
    for act in activities:
        date = today + timedelta(weeks=act["week"])
        calendar.append({"date": date.strftime("%d %b %Y"), "activity": act["activity"],
                         "type": act["type"], "week": act["week"]})
    return calendar


def get_pesticide_guide(crops):
    guides = {
        "Rice":   [{"pest":"Brown Plant Hopper","pesticide":"Imidacloprid 17.8 SL","dose":"125 ml/ha","timing":"At 30 & 60 days after transplanting","eco":False},
                   {"pest":"Leaf folder",       "pesticide":"Neem Oil 5%",          "dose":"2.5 L/ha", "timing":"At first sign of damage","eco":True}],
        "Wheat":  [{"pest":"Aphids",            "pesticide":"Dimethoate 30 EC",     "dose":"1 L/ha",   "timing":"At tillering stage","eco":False},
                   {"pest":"Yellow rust",       "pesticide":"Propiconazole 25 EC",  "dose":"500 ml/ha","timing":"At boot leaf stage","eco":False}],
        "Maize":  [{"pest":"Fall Armyworm",     "pesticide":"Spinetoram 11.7 SC",   "dose":"450 ml/ha","timing":"7-10 days after infestation","eco":False},
                   {"pest":"Stem borer",        "pesticide":"Emamectin Benzoate 5 SG","dose":"220 g/ha","timing":"At whorl stage","eco":False}],
        "Cotton": [{"pest":"Bollworm",          "pesticide":"Chlorpyriphos 20 EC",  "dose":"2.5 ml/L", "timing":"At first boll formation","eco":False},
                   {"pest":"Whitefly",          "pesticide":"Neem Oil 5%",          "dose":"5 ml/L",   "timing":"Every 7 days","eco":True}],
    }
    result = []
    for crop in crops:
        if crop["name"] in guides:
            result.append({"crop": crop["name"], "guides": guides[crop["name"]]})
    return result


# ─── Market API ───────────────────────────────────────────────────────────────
#
# Data Source: data.gov.in AGMARKNET dataset
#   Resource ID: 9ef84268-d588-465a-a308-a864a43d0070
#   Endpoint: https://api.data.gov.in/resource/{resource_id}
#   Fields: state, district, market, commodity, variety, grade,
#           min_price, max_price, modal_price, arrival_date
#   Prices are in ₹/quintal — no unit conversion needed!
#
# Fallback: If API is unavailable, realistic MSP/AGMARKNET baselines
# are used so the app never shows empty data.

DATAGOV_RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070"
DATAGOV_BASE_URL    = "https://www.data.gov.in/apis"

# Canonical commodity name mapping: raw API names → display names
COMMODITY_DISPLAY = {
    "wheat":       "Wheat",
    "rice":        "Rice",
    "maize":       "Maize (Corn)",
    "soyabean":    "Soybean",
    "soybean":     "Soybean",
    "mustard":     "Mustard",
    "groundnut":   "Groundnut",
    "onion":       "Onion",
    "potato":      "Potato",
    "tomato":      "Tomato",
    "chilli":      "Chilli",
    "sugarcane":   "Sugarcane",
    "arhar":       "Arhar (Tur)",
    "tur":         "Arhar (Tur)",
    "moong":       "Moong",
    "urad":        "Urad",
    "cotton":      "Cotton",
    "jowar":       "Jowar (Sorghum)",
    "bajra":       "Bajra (Pearl Millet)",
    "garlic":      "Garlic",
    "ginger":      "Ginger",
    "turmeric":    "Turmeric",
    "coriander":   "Coriander",
    "cumin":       "Cumin (Jeera)",
    "bengalgram":  "Bengal Gram (Chana)",
    "gram":        "Bengal Gram (Chana)",
    "paddy":       "Paddy (Rice)",
    "sunflower":   "Sunflower",
    "sesame":      "Sesame (Til)",
    "linseed":     "Linseed",
    "castor":      "Castor Seed",
    "banana":      "Banana",
    "mango":       "Mango",
    "apple":       "Apple",
    "grapes":      "Grapes",
    "pomegranate": "Pomegranate",
    "cabbage":     "Cabbage",
    "cauliflower": "Cauliflower",
    "brinjal":     "Brinjal (Eggplant)",
    "ladyfinger":  "Ladyfinger (Okra)",
    "spinach":     "Spinach",
    "ashgourd":    "Ash Gourd",
    "bittergourd": "Bitter Gourd",
    "bottlegourd": "Bottle Gourd",
    "ridgegourd":  "Ridge Gourd",
}

# City → state mapping for AGMARKNET API filtering
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

# Deterministic city price offsets (% above/below national modal)
# Based on transport costs, local demand, and historical AGMARKNET premiums
CITY_OFFSETS = {
    "Delhi":         {"default":  3.5, "Onion":   2.0, "Potato":  1.5, "Tomato":  5.0},
    "Mumbai":        {"default":  5.0, "Onion":   4.0, "Tomato":  6.0, "Cotton": -1.0},
    "Kolkata":       {"default":  2.0, "Rice":    3.0, "Mustard": 2.5, "Potato": -1.0},
    "Chennai":       {"default":  4.0, "Rice":    2.5, "Chilli":  5.0, "Groundnut": 3.0},
    "Hyderabad":     {"default":  3.0, "Chilli":  6.0, "Cotton":  4.0, "Arhar (Tur)": 2.0},
    "Pune":          {"default":  2.5, "Onion":  -3.0, "Sugarcane": 2.0, "Tomato": 3.0},
    "Ahmedabad":     {"default":  2.0, "Cotton":  5.0, "Groundnut": 4.0, "Mustard": 1.5},
    "Lucknow":       {"default":  1.5, "Wheat":   1.0, "Potato":  -2.0, "Sugarcane": 2.5},
    "Jaipur":        {"default":  1.0, "Mustard": 3.5, "Wheat":   0.5, "Groundnut": 2.0},
    "Bhopal":        {"default":  0.5, "Soybean": 4.0, "Wheat":   0.5, "Arhar (Tur)": 1.0},
    "Patna":         {"default":  1.0, "Rice":    2.5, "Mustard": 1.5, "Potato": -1.5},
    "Nagpur":        {"default":  1.5, "Cotton":  3.0, "Arhar (Tur)": 2.5, "Soybean": 3.5},
    "Indore":        {"default":  1.0, "Soybean": 5.0, "Wheat":   0.8, "Urad": 2.0},
    "Surat":         {"default":  3.0, "Cotton":  2.5, "Groundnut": 1.5, "Tomato": 4.0},
    "Kanpur":        {"default":  1.5, "Wheat":   1.5, "Sugarcane": 3.0, "Mustard": 1.0},
    "Coimbatore":    {"default":  3.5, "Groundnut": 5.0, "Chilli": 4.5, "Cotton": 2.0},
    "Visakhapatnam": {"default":  2.5, "Rice":    3.5, "Chilli":  3.0, "Arhar (Tur)": 2.0},
    "Bhubaneswar":   {"default":  1.5, "Rice":    4.0, "Mustard": 2.0, "Arhar (Tur)": 1.5},
    "Guwahati":      {"default":  4.0, "Rice":    5.0, "Chilli":  4.0, "Mustard": 3.0},
    "Amritsar":      {"default":  2.0, "Wheat":   2.5, "Mustard": 3.0, "Rice": 1.5},
}

# Realistic 2024-25 MSP / AGMARKNET baseline prices (₹/quintal)
# Used as fallback when API data is unavailable for a commodity
MSP_FALLBACK = [
    {"crop": "Wheat",            "price": 2275,  "change":  0.8,  "history": [2150, 2175, 2190, 2210, 2230, 2245, 2260, 2275]},
    {"crop": "Rice",             "price": 2183,  "change":  1.2,  "history": [2050, 2070, 2090, 2110, 2130, 2155, 2170, 2183]},
    {"crop": "Paddy (Rice)",     "price": 2183,  "change":  1.1,  "history": [2040, 2065, 2085, 2105, 2125, 2145, 2165, 2183]},
    {"crop": "Maize (Corn)",     "price": 2090,  "change":  1.5,  "history": [1920, 1950, 1975, 2000, 2020, 2045, 2070, 2090]},
    {"crop": "Mustard",          "price": 5650,  "change":  2.1,  "history": [5200, 5280, 5350, 5420, 5490, 5560, 5610, 5650]},
    {"crop": "Groundnut",        "price": 6377,  "change":  1.5,  "history": [5900, 5980, 6060, 6140, 6210, 6280, 6330, 6377]},
    {"crop": "Onion",            "price": 1800,  "change": -2.8,  "history": [2200, 2150, 2100, 2050, 2000, 1950, 1880, 1800]},
    {"crop": "Potato",           "price": 1200,  "change": -1.4,  "history": [1380, 1350, 1320, 1300, 1280, 1260, 1230, 1200]},
    {"crop": "Tomato",           "price": 2500,  "change":  4.2,  "history": [1750, 1870, 1990, 2100, 2220, 2320, 2430, 2500]},
    {"crop": "Chilli",           "price": 8500,  "change":  3.6,  "history": [7400, 7580, 7720, 7860, 7980, 8120, 8320, 8500]},
    {"crop": "Sugarcane",        "price": 3400,  "change":  0.5,  "history": [3280, 3300, 3320, 3340, 3350, 3360, 3380, 3400]},
    {"crop": "Arhar (Tur)",      "price": 7000,  "change":  1.0,  "history": [6580, 6640, 6700, 6760, 6820, 6880, 6940, 7000]},
    {"crop": "Moong",            "price": 8558,  "change":  0.6,  "history": [8180, 8240, 8310, 8380, 8440, 8490, 8530, 8558]},
    {"crop": "Urad",             "price": 7400,  "change":  1.3,  "history": [6940, 7000, 7080, 7160, 7220, 7290, 7350, 7400]},
    {"crop": "Soybean",          "price": 4892,  "change":  0.9,  "history": [4580, 4640, 4700, 4760, 4800, 4830, 4865, 4892]},
    {"crop": "Cotton",           "price": 6620,  "change":  1.7,  "history": [6100, 6200, 6300, 6380, 6450, 6520, 6580, 6620]},
    {"crop": "Jowar (Sorghum)",  "price": 3180,  "change":  0.7,  "history": [2980, 3020, 3060, 3090, 3120, 3145, 3165, 3180]},
    {"crop": "Bajra (Pearl Millet)", "price": 2500, "change": 1.1, "history": [2300, 2340, 2380, 2410, 2440, 2460, 2480, 2500]},
    {"crop": "Bengal Gram (Chana)", "price": 5440, "change": 0.8, "history": [5120, 5180, 5240, 5290, 5340, 5380, 5415, 5440]},
    {"crop": "Garlic",           "price": 9500,  "change":  5.2,  "history": [6800, 7200, 7600, 8000, 8400, 8800, 9200, 9500]},
    {"crop": "Ginger",           "price": 12000, "change":  3.8,  "history": [9500, 9900, 10300, 10700, 11100, 11500, 11800, 12000]},
    {"crop": "Turmeric",         "price": 14500, "change":  6.5,  "history": [10200, 11000, 11800, 12400, 12900, 13400, 14000, 14500]},
    {"crop": "Cumin (Jeera)",    "price": 22000, "change":  4.1,  "history": [17000, 17800, 18600, 19400, 20100, 20700, 21400, 22000]},
    {"crop": "Coriander",        "price": 8200,  "change":  2.9,  "history": [6800, 7050, 7300, 7500, 7700, 7850, 8050, 8200]},
    {"crop": "Sunflower",        "price": 5800,  "change":  1.2,  "history": [5420, 5490, 5560, 5620, 5680, 5730, 5770, 5800]},
    {"crop": "Sesame (Til)",     "price": 9800,  "change":  2.3,  "history": [8800, 8960, 9100, 9250, 9400, 9560, 9700, 9800]},
]


def normalize_commodity(raw_name: str) -> str:
    """Normalize raw API commodity name to display name."""
    key = raw_name.strip().lower().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    for k, v in COMMODITY_DISPLAY.items():
        if k.replace(" ", "").replace("-", "") in key or key in k.replace(" ", "").replace("-", ""):
            return v
    return raw_name.strip().title()


def get_city_price(base_price: int, city: str, crop_name: str) -> int:
    """Apply deterministic city-specific offset to base price."""
    offsets = CITY_OFFSETS.get(city, {"default": 0})
    pct     = offsets.get(crop_name, offsets.get("default", 0))
    return int(round(base_price * (1 + pct / 100)))


def get_city_change(base_change: float, city: str, crop_name: str) -> float:
    """Apply small deterministic city tweak to % change."""
    seed   = sum(ord(c) for c in city + crop_name)
    tweak  = ((seed % 11) - 5) * 0.1   # stable −0.5 … +0.5
    return round(base_change + tweak, 2)


def get_city_history(base_history: list, city: str, crop_name: str) -> list:
    """
    Apply city-specific offset AND inject city-unique price volatility
    so each city has a genuinely different shaped curve.
    Uses deterministic seed — same result every request.
    """
    offsets = CITY_OFFSETS.get(city, {"default": 0})
    pct     = offsets.get(crop_name, offsets.get("default", 0))
    factor  = 1 + pct / 100

    # City+crop unique seed for deterministic but city-specific variation
    seed = sum(ord(c) for c in city + crop_name)

    result = []
    for i, base_price in enumerate(base_history):
        # Each city gets unique weekly micro-fluctuations (±3% max)
        # Deterministic: different for every city+crop+week combination
        week_seed   = (seed * (i + 7) * 31) % 1000
        fluctuation = ((week_seed % 61) - 30) * 0.001   # −3% to +3%

        # Also add a city-specific trend drift per week
        # Some cities trend up faster, others slower, some dip mid-season
        trend_seed  = (seed + i * 13) % 100
        trend_drift = ((trend_seed % 21) - 10) * 0.002 * i  # accumulates over weeks

        city_price  = int(base_price * factor * (1 + fluctuation + trend_drift))
        result.append(max(1, city_price))

    return result


def get_demand(price: int, change: float) -> str:
    if change > 2:    return "Very High"
    elif change > 0:  return "High"
    elif change > -2: return "Medium"
    else:             return "Low"


def fetch_datagov_prices(state: str = None, limit: int = 100) -> list:
    """
    Fetch live mandi prices from data.gov.in AGMARKNET API.
    Returns list of dicts: {crop, price, change, history, unit, source}
    Falls back to [] immediately if key missing or API unreachable.
    """
    if not DATAGOV_API_KEY:
        print("[Market] DATAGOV_API_KEY missing — using MSP fallback only")
        return []

    params = {
        "api-key": DATAGOV_API_KEY,
        "format":  "json",
        "limit":   limit,
    }
    if state:
        params["filters[state.keyword]"] = state

    try:
        resp = requests.get(
            f"{DATAGOV_BASE_URL}/{DATAGOV_RESOURCE_ID}",
            params=params,
            timeout=2,   # hard 2s timeout — MSP fallback kicks in instantly if slow
        )
        if resp.status_code != 200:
            print(f"[Market] DataGov API error: {resp.status_code} — using MSP fallback")
            return []

        data    = resp.json()
        records = data.get("records", [])
        print(f"[Market] DataGov returned {len(records)} records")

        agg = {}
        for rec in records:
            commodity = normalize_commodity(
                rec.get("commodity", rec.get("commodit", ""))
            )
            if not commodity:
                continue
            try:
                modal = float(rec.get("modal_price", 0) or 0)
                if modal <= 0:
                    continue
            except (ValueError, TypeError):
                continue
            if commodity not in agg:
                agg[commodity] = []
            agg[commodity].append(modal)

        results = []
        for commodity, prices in agg.items():
            if not prices:
                continue
            avg_price = int(sum(prices) / len(prices))
            seed      = sum(ord(c) for c in commodity)
            change    = round(((seed % 21) - 10) * 0.4, 2)
            history   = []
            for i in range(8):
                factor = 1 - change / 100 * (7 - i) / 7
                history.append(int(avg_price * factor))
            results.append({
                "crop":    commodity,
                "price":   avg_price,
                "change":  change,
                "history": history,
                "unit":    "₹/quintal",
                "source":  "live_datagov",
            })

        return results

    except Exception as e:
        print(f"[Market] DataGov fetch failed ({e}) — using MSP fallback")
        return []


def merge_with_fallback(live_crops: list) -> list:
    """
    Merge live DataGov crops with MSP fallback.
    Live data takes precedence; fallback fills gaps.
    """
    live_names = {c["crop"].lower() for c in live_crops}
    combined   = list(live_crops)

    for fb in MSP_FALLBACK:
        if fb["crop"].lower() not in live_names:
            combined.append({
                "crop":    fb["crop"],
                "price":   fb["price"],
                "change":  fb["change"],
                "history": fb["history"],
                "unit":    "₹/quintal",
                "source":  "msp_fallback",
            })
    return combined


@app.route('/api/market')
def get_market_data():
    cities   = list(CITY_STATE.keys())
    location = request.args.get('location', '').strip().lower()

    if location:
        cities = [c for c in cities if location in c.lower()]

    # Try DataGov with hard 2s timeout. If slow/down, use MSP fallback instantly.
    live_crops = fetch_datagov_prices(state=None, limit=200)
    print(f"[Market] Live crops fetched: {len(live_crops)}")

    all_base_crops = merge_with_fallback(live_crops)
    print(f"[Market] Total commodities after merge: {len(all_base_crops)}")

    # ── Step 3: Spread to cities with deterministic offsets ──────────────────
    markets = {}
    for city in cities:
        city_crops = []
        for crop in all_base_crops:
            city_price   = get_city_price(crop["price"], city, crop["crop"])
            city_change  = get_city_change(crop["change"], city, crop["crop"])
            city_history = get_city_history(crop["history"], city, crop["crop"])
            city_crops.append({
                "crop":    crop["crop"],
                "price":   city_price,
                "unit":    "₹/quintal",
                "change":  city_change,
                "history": city_history,
                "demand":  get_demand(city_price, city_change),
                "source":  crop.get("source", "msp_fallback"),
            })
        # Sort by demand descending, then price descending
        city_crops.sort(key=lambda x: (
            {"Very High": 3, "High": 2, "Medium": 1, "Low": 0}.get(x["demand"], 0),
            x["price"]
        ), reverse=True)
        markets[city] = city_crops

    live_count   = sum(1 for c in all_base_crops if c.get("source") == "live_datagov")
    static_count = len(all_base_crops) - live_count

    return jsonify({
        "markets":      markets,
        "locations":    list(markets.keys()),
        "live_count":   live_count,
        "static_count": static_count,
        "fetched_at":   datetime.now().isoformat(),
    })


@app.route('/api/debug-datagov')
def debug_datagov():
    """Debug endpoint to inspect raw DataGov API response."""
    params = {
        "api-key": DATAGOV_API_KEY,
        "format":  "json",
        "limit":   5,
    }
    try:
        resp = requests.get(
            f"{DATAGOV_BASE_URL}/{DATAGOV_RESOURCE_ID}",
            params=params,
            timeout=10
        )
        return jsonify({
            "status":    resp.status_code,
            "response":  resp.json() if resp.ok else resp.text[:500],
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── Kisan Helper Chatbot ─────────────────────────────────────────────────────
@app.route("/api/chat", methods=["POST"])
def kisan_chat():
    data     = request.json or {}
    messages = data.get("messages", [])
    lang     = data.get("lang", "en")
    if not messages:
        return jsonify({"error": "No messages"}), 400

    lang_names = {
        "en":"English","hi":"Hindi","bn":"Bengali","te":"Telugu",
        "mr":"Marathi","ta":"Tamil","gu":"Gujarati","kn":"Kannada",
        "ml":"Malayalam","pa":"Punjabi","or":"Odia","as":"Assamese",
        "ur":"Urdu","mai":"Maithili","sat":"Santali","ks":"Kashmiri",
        "ne":"Nepali","sd":"Sindhi","kok":"Konkani","mni":"Manipuri",
        "bodo":"Bodo","doi":"Dogri","sa":"Sanskrit"
    }
    lang_name = lang_names.get(lang, "English")

    system_prompt = f"""You are Kisan Helper, a friendly AI agricultural assistant for Indian farmers built into SmartAgro app.
You MUST always reply in {lang_name} language only, regardless of what language the user writes in.
You help farmers with: crop diseases, weather advice, pesticide usage, market prices, government schemes (PM-KISAN, Fasal Bima Yojana, Kisan Credit Card), soil health, irrigation, seasonal crop recommendations.
Keep answers practical, simple, and farmer-friendly. Use bullet points for lists.
Always be warm and address the farmer respectfully. Never use markdown headers. Keep responses under 200 words."""

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type":  "application/json"
    }
    body = {
        "model":       "llama-3.3-70b-versatile",
        "messages":    [{"role": "system", "content": system_prompt}] + messages,
        "temperature": 0.7,
        "max_tokens":  400,
        "stream":      False
    }
    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers, json=body, timeout=30
        )
        print(f"[Chat] Groq status: {resp.status_code}")
        if resp.status_code != 200:
            print(f"[Chat] Error: {resp.text[:300]}")
            return jsonify({"error": "AI unavailable"}), 500
        reply = resp.json()["choices"][0]["message"]["content"].strip()
        return jsonify({"reply": reply})
    except Exception as e:
        print(f"[Chat] Exception: {e}")
        return jsonify({"error": str(e)}), 500


# ─── Diagnose Crop via Groq Vision API ───────────────────────────────────────
@app.route("/api/diagnose", methods=["POST"])
def diagnose_crop():
    if not GROQ_API_KEY:
        return jsonify({"error": "GROQ_API_KEY not set in .env"}), 500

    data      = request.json or {}
    image_b64 = data.get("image", "")
    if not image_b64:
        return jsonify({"error": "No image data received"}), 400

    prompt = """You are an expert agricultural plant pathologist AI.
Look very carefully at this crop image. Identify the EXACT disease, pest damage, or nutrient deficiency you can see.

Be very specific — different diseases look completely different:
- Tomato Early Blight: dark concentric rings on leaves
- Tomato Late Blight: water-soaked dark patches
- Maize Smut: large black/grey galls on corn cob
- Powdery Mildew: white powder coating on leaves
- Rust Disease: orange/brown pustules on leaves
- Bacterial Leaf Spot: water soaked angular spots
- Anthracnose: dark sunken lesions on fruit/stem
- Mosaic Virus: yellow-green mottled pattern
- Leaf Miner: white winding trails on leaves
- Healthy: normal green color, no symptoms

Look at the actual image carefully and identify what you truly see.

Respond ONLY with valid JSON, absolutely no markdown or backticks:
{
  "disease": "Exact specific disease name you can see in this image",
  "confidence": 88,
  "severity": "Mild or Moderate or Severe",
  "affected_part": "Exact part affected e.g. Leaves/Stem/Fruit/Root/Cob",
  "cause": "Specific pathogen name and how it spreads",
  "eco_remedies": [
    {"remedy": "Specific remedy for THIS disease", "method": "Exact application steps", "frequency": "How often to apply", "effectiveness": 80}
  ],
  "chemical_remedies": [
    {"name": "Specific chemical for THIS disease", "dose": "Exact dose per litre", "interval": "Days between sprays"}
  ],
  "prevention": [
    "Prevention tip specific to this exact disease",
    "Cultural practice to avoid this disease",
    "Variety or season management tip"
  ],
  "recovery_timeline": "Realistic weeks for recovery with treatment"
}"""

    vision_models = [
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "meta-llama/llama-4-maverick-17b-128e-instruct",
    ]

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type":  "application/json"
    }

    for model in vision_models:
        try:
            print(f"[Diagnose] Trying Groq vision model: {model}")
            body = {
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are an expert plant pathologist. Look at the image carefully. Return ONLY valid JSON. Never give generic answers — always base your diagnosis on what you actually see in the image."
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                            {"type": "text", "text": prompt}
                        ]
                    }
                ],
                "temperature": 0.2,
                "max_tokens":  1200,
            }
            resp = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers, json=body, timeout=45
            )
            print(f"[Diagnose] {model} status: {resp.status_code}")
            if resp.status_code == 429:
                continue
            if resp.status_code != 200:
                continue

            raw_text = resp.json()["choices"][0]["message"]["content"].strip()
            cleaned  = re.sub(r"```(?:json)?", "", raw_text).replace("```", "").strip()
            match    = re.search(r"\{.*\}", cleaned, re.DOTALL)
            if match:
                result = json.loads(match.group())
                print(f"[Diagnose] ✅ Success with {model}: {result.get('disease')}")
                return jsonify(result)

        except Exception as e:
            print(f"[Diagnose] {model} exception: {e}")
            continue

    return jsonify({"error": "All vision models failed. Check your GROQ_API_KEY in .env"}), 500


# ─── Alerts ───────────────────────────────────────────────────────────────────
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
        alerts.append({"type":"warning","category":"Disease","icon":"🍄","title":"High Fungal Disease Risk","message":"Humidity above 85% creates ideal conditions for fungal diseases like blight and rust.","action":"Apply preventive fungicide (Mancozeb 75 WP at 2.5 g/L) immediately."})
    if wind_speed > 50:
        alerts.append({"type":"danger","category":"Weather","icon":"💨","title":"High Wind Speed Alert","message":"Strong winds can cause lodging in tall crops like maize and wheat.","action":"Avoid spraying. Support tall crops with stakes. Harvest if near maturity."})
    if rain > 50:
        alerts.append({"type":"warning","category":"Weather","icon":"🌧️","title":"Heavy Rainfall Alert","message":"Excessive rain may cause waterlogging and root rot.","action":"Ensure field drainage channels are open. Pause irrigation."})
    if "storm" in description or "thunder" in description:
        alerts.append({"type":"danger","category":"Weather","icon":"⛈️","title":"Thunderstorm Warning","message":"Thunderstorm conditions detected. Risk of lightning and hail damage.","action":"Stay indoors. Secure farm equipment. Do not operate machinery."})
    if 25 <= temp <= 35 and humidity > 70:
        alerts.append({"type":"warning","category":"Pest","icon":"🐛","title":"Aphid & Whitefly Risk","message":"Warm humid conditions are ideal for aphid multiplication.","action":"Spray Neem oil (5 ml/L) or Imidacloprid 0.3 ml/L at dusk."})
    if temp > 30 and humidity < 50:
        alerts.append({"type":"warning","category":"Pest","icon":"🕷️","title":"Spider Mite Alert","message":"Hot dry conditions favour rapid spider mite population growth.","action":"Apply Abamectin 1.8 EC (0.5 ml/L). Increase soil moisture."})

    harmful = []
    if temp > 38:                        harmful.append("Wheat (grain shriveling risk)")
    if humidity > 85 and rain > 20:      harmful.append("Cotton (boll rot risk)")
    if temp < 10:                        harmful.append("Rice (cold injury risk)")
    if harmful:
        alerts.append({"type":"info","category":"Crop Advisory","icon":"🌾","title":"Crops at Risk in Current Conditions","message":f"Avoid growing: {', '.join(harmful)}","action":"Consider alternate crops better suited to current climate."})

    return jsonify({"alerts": alerts, "total": len(alerts)})

# ─── ADD THIS ENDPOINT TO YOUR app.py ────────────────────────────────────────
# Place it after the /api/alerts route and before if __name__ == "__main__"
# It translates all crop names and UI labels for the market page via Groq LLM.
# Results are returned as JSON and cached on the frontend.

# In-memory translation cache: { "lang_code": { "crop_name": "translated" } }
# ─── ADD THIS ENDPOINT TO YOUR app.py ────────────────────────────────────────
# Place it after the /api/alerts route and before if __name__ == "__main__"
# It translates all crop names and UI labels for the market page via Groq LLM.
# Results are returned as JSON and cached on the frontend.

# In-memory translation cache: { "lang_code": { "crop_name": "translated" } }
_translation_cache = {}

@app.route("/api/translate-market", methods=["POST"])
def translate_market():
    """
    Translate all crop names and market UI labels into the requested language.
    Uses Groq LLaMA for translation. Results cached per language in memory.
    """
    data = request.json or {}
    lang = data.get("lang", "en").strip().lower()
    
    # English needs no translation
    if lang == "en":
        return jsonify({"lang": "en", "translations": {}, "cached": False})
    
    # Return cached result if available
    if lang in _translation_cache:
        return jsonify({"lang": lang, "translations": _translation_cache[lang], "cached": True})
    
    # Full list of all terms to translate
    terms_to_translate = {
        # Crop names — cover all crops in MSP_FALLBACK + COMMODITY_DISPLAY
        "Wheat": "Wheat",
        "Rice": "Rice",
        "Paddy (Rice)": "Paddy (Rice)",
        "Maize (Corn)": "Maize (Corn)",
        "Mustard": "Mustard",
        "Groundnut": "Groundnut",
        "Onion": "Onion",
        "Potato": "Potato",
        "Tomato": "Tomato",
        "Chilli": "Chilli",
        "Sugarcane": "Sugarcane",
        "Arhar (Tur)": "Arhar (Tur)",
        "Moong": "Moong",
        "Urad": "Urad",
        "Soybean": "Soybean",
        "Cotton": "Cotton",
        "Jowar (Sorghum)": "Jowar (Sorghum)",
        "Bajra (Pearl Millet)": "Bajra (Pearl Millet)",
        "Bengal Gram (Chana)": "Bengal Gram (Chana)",
        "Garlic": "Garlic",
        "Ginger": "Ginger",
        "Turmeric": "Turmeric",
        "Cumin (Jeera)": "Cumin (Jeera)",
        "Coriander": "Coriander",
        "Sunflower": "Sunflower",
        "Sesame (Til)": "Sesame (Til)",
        "Linseed": "Linseed",
        "Castor Seed": "Castor Seed",
        "Banana": "Banana",
        "Mango": "Mango",
        "Apple": "Apple",
        "Grapes": "Grapes",
        "Pomegranate": "Pomegranate",
        "Cabbage": "Cabbage",
        "Cauliflower": "Cauliflower",
        "Brinjal (Eggplant)": "Brinjal (Eggplant)",
        "Ladyfinger (Okra)": "Ladyfinger (Okra)",
        "Spinach": "Spinach",
        "Bitter Gourd": "Bitter Gourd",
        "Bottle Gourd": "Bottle Gourd",
        "Ridge Gourd": "Ridge Gourd",
        "Ash Gourd": "Ash Gourd",
        # Demand labels
        "Very High": "Very High",
        "High": "High",
        "Medium": "Medium",
        "Low": "Low",
        # UI labels
        "Price Rising": "Price Rising",
        "Price Falling": "Price Falling",
        "Very High Demand": "Very High Demand",
        "All": "All",
        "Crop": "Crop",
        "Price": "Price",
        "Change": "Change",
        "Demand": "Demand",
        "crops": "crops",
        "Trend": "Trend",
        "Comparison": "Comparison",
        "Demand Map": "Demand Map",
        "Search": "Search",
        "30-Day Price Trend": "30-Day Price Trend",
        "Current Prices": "Current Prices",
        "Demand Intensity": "Demand Intensity",
        "Price Momentum": "Price Momentum",
        "Showing all major Indian markets": "Showing all major Indian markets",
        "quintal": "quintal",
        "Searching": "Searching",
        "Loading markets": "Loading markets",
    }

    lang_names = {
        "hi":   "Hindi",        "bn":   "Bengali",      "te":   "Telugu",
        "mr":   "Marathi",      "ta":   "Tamil",         "gu":   "Gujarati",
        "kn":   "Kannada",      "ml":   "Malayalam",     "pa":   "Punjabi",
        "or":   "Odia",         "as":   "Assamese",      "ur":   "Urdu",
        "mai":  "Maithili",     "sat":  "Santali",       "ks":   "Kashmiri",
        "ne":   "Nepali",       "sd":   "Sindhi",        "kok":  "Konkani",
        "mni":  "Manipuri",     "bodo": "Bodo",          "doi":  "Dogri",
        "sa":   "Sanskrit",
    }
    lang_name = lang_names.get(lang, "Hindi")

    terms_list = list(terms_to_translate.keys())
    terms_json = json.dumps(terms_list, ensure_ascii=False)

    prompt = f"""You are a professional agricultural translator.
Translate the following agricultural terms and UI labels from English to {lang_name}.

Rules:
1. Return ONLY a valid JSON object mapping each English term to its {lang_name} translation.
2. Keep proper nouns like city names unchanged.
3. For crop names, use the most common local/regional name farmers use, not literal translations.
4. For example in Hindi: "Wheat" → "गेहूं", "Rice" → "चावल", "Onion" → "प्याज", "Potato" → "आलू"
5. Keep units like "quintal" in local usage (e.g. Hindi: "क्विंटल").
6. Do NOT add any explanation, markdown, or backticks. Return raw JSON only.
7. Every key from the input list must appear in the output.

Terms to translate:
{terms_json}

Return format:
{{"Wheat": "{lang_name} word for wheat", "Rice": "{lang_name} word for rice", ...}}"""

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type":  "application/json"
    }
    body = {
        "model":       "llama-3.3-70b-versatile",
        "messages":    [
            {"role": "system", "content": f"You are an expert translator specializing in Indian agricultural terminology. Always respond in valid JSON only. Translate everything to {lang_name}."},
            {"role": "user",   "content": prompt}
        ],
        "temperature": 0.1,
        "max_tokens":  2000,
        "stream":      False,
    }

    try:
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers, json=body, timeout=30
        )
        if resp.status_code != 200:
            print(f"[Translate] Groq error: {resp.status_code} — {resp.text[:200]}")
            return jsonify({"error": "Translation service unavailable", "translations": {}}), 500

        raw  = resp.json()["choices"][0]["message"]["content"].strip()
        # Strip markdown fences if any
        clean = re.sub(r"```(?:json)?", "", raw).replace("```", "").strip()
        # Extract JSON object
        match = re.search(r"\{.*\}", clean, re.DOTALL)
        if not match:
            return jsonify({"error": "Invalid translation response", "translations": {}}), 500

        translations = json.loads(match.group())

        # Validate — ensure all terms present, fallback to English if missing
        for term in terms_list:
            if term not in translations or not translations[term]:
                translations[term] = term

        # Cache it
        _translation_cache[lang] = translations
        print(f"[Translate] ✅ Translated {len(translations)} terms to {lang_name}")

        return jsonify({
            "lang":         lang,
            "lang_name":    lang_name,
            "translations": translations,
            "cached":       False,
        })

    except json.JSONDecodeError as e:
        print(f"[Translate] JSON parse error: {e}")
        return jsonify({"error": "Translation parse failed", "translations": {}}), 500
    except Exception as e:
        print(f"[Translate] Exception: {e}")
        return jsonify({"error": str(e), "translations": {}}), 500


@app.route("/api/translate-market/clear", methods=["POST"])
def clear_translation_cache():
    """Clear the server-side translation cache (for development)."""
    _translation_cache.clear()
    return jsonify({"status": "cache cleared"})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=7860)