# app.py — AgroSmart
# Market data: API-Ninjas commodity prices (real-time) + MSP fallback
# Dynamic language: crop names stored as English keys, translated client-side

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
NINJA_API_KEY       = os.getenv("NINJA_API_KEY", "")
DEBUG_MODE          = os.getenv("FLASK_DEBUG", "0") == "1"

_translation_cache = {}

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


# ─── Crop Recommendations ────────────────────────────────────────────────────
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


# ─── Market Data — API-Ninjas ─────────────────────────────────────────────────
# API-Ninjas /v1/commodityprice returns global prices in USD/unit.
# We convert to approx INR/quintal: (price_usd / kg_per_unit) * 100kg * USD_TO_INR
# Each crop entry includes "crop_key" (English) so the frontend can translate it.

# (ninja_api_name, display_name_english, usd_unit, kg_per_unit)
NINJA_COMMODITIES = [
    ("wheat",         "Wheat",         "bushel", 27.216),
    ("corn",          "Maize (Corn)",  "bushel", 25.401),
    ("rice",          "Rice",          "cwt",    45.359),
    ("soybeans",      "Soybean",       "bushel", 27.216),
    ("cotton",        "Cotton",        "pound",   0.453),
    ("sugar",         "Sugarcane",     "pound",   0.453),
    ("canola",        "Mustard",       "tonne", 100.000),
    ("palm oil",      "Palm Oil",      "tonne", 100.000),
    ("oats",          "Oats",          "bushel", 14.515),
    ("coffee",        "Coffee",        "pound",   0.453),
    ("cocoa",         "Cocoa",         "tonne", 100.000),
    ("rubber",        "Rubber",        "kilogram", 0.100),
    ("sunflower oil", "Sunflower",     "tonne", 100.000),
    ("soybean oil",   "Soybean Oil",   "tonne", 100.000),
    ("soybean meal",  "Soybean Meal",  "tonne", 100.000),
    ("linseed oil",   "Linseed",       "tonne", 100.000),
]

USD_TO_INR = 83.5  # approximate; update as needed

# MSP/market reference prices — used ONLY for crops not returned by Ninja
MSP_FALLBACK = [
    {"crop": "Wheat",                "price": 2275,  "change":  0.8,  "history": [2150, 2175, 2190, 2210, 2230, 2245, 2260, 2275]},
    {"crop": "Rice",                 "price": 2183,  "change":  1.2,  "history": [2050, 2070, 2090, 2110, 2130, 2155, 2170, 2183]},
    {"crop": "Maize (Corn)",         "price": 2090,  "change":  1.5,  "history": [1920, 1950, 1975, 2000, 2020, 2045, 2070, 2090]},
    {"crop": "Mustard",              "price": 5650,  "change":  2.1,  "history": [5200, 5280, 5350, 5420, 5490, 5560, 5610, 5650]},
    {"crop": "Groundnut",            "price": 6377,  "change":  1.5,  "history": [5900, 5980, 6060, 6140, 6210, 6280, 6330, 6377]},
    {"crop": "Onion",                "price": 1800,  "change": -2.8,  "history": [2200, 2150, 2100, 2050, 2000, 1950, 1880, 1800]},
    {"crop": "Potato",               "price": 1200,  "change": -1.4,  "history": [1380, 1350, 1320, 1300, 1280, 1260, 1230, 1200]},
    {"crop": "Tomato",               "price": 2500,  "change":  4.2,  "history": [1750, 1870, 1990, 2100, 2220, 2320, 2430, 2500]},
    {"crop": "Chilli",               "price": 8500,  "change":  3.6,  "history": [7400, 7580, 7720, 7860, 7980, 8120, 8320, 8500]},
    {"crop": "Sugarcane",            "price": 3400,  "change":  0.5,  "history": [3280, 3300, 3320, 3340, 3350, 3360, 3380, 3400]},
    {"crop": "Arhar (Tur)",          "price": 7000,  "change":  1.0,  "history": [6580, 6640, 6700, 6760, 6820, 6880, 6940, 7000]},
    {"crop": "Moong",                "price": 8558,  "change":  0.6,  "history": [8180, 8240, 8310, 8380, 8440, 8490, 8530, 8558]},
    {"crop": "Urad",                 "price": 7400,  "change":  1.3,  "history": [6940, 7000, 7080, 7160, 7220, 7290, 7350, 7400]},
    {"crop": "Soybean",              "price": 4892,  "change":  0.9,  "history": [4580, 4640, 4700, 4760, 4800, 4830, 4865, 4892]},
    {"crop": "Cotton",               "price": 6620,  "change":  1.7,  "history": [6100, 6200, 6300, 6380, 6450, 6520, 6580, 6620]},
    {"crop": "Jowar (Sorghum)",      "price": 3180,  "change":  0.7,  "history": [2980, 3020, 3060, 3090, 3120, 3145, 3165, 3180]},
    {"crop": "Bajra (Pearl Millet)", "price": 2500,  "change":  1.1,  "history": [2300, 2340, 2380, 2410, 2440, 2460, 2480, 2500]},
    {"crop": "Bengal Gram (Chana)",  "price": 5440,  "change":  0.8,  "history": [5120, 5180, 5240, 5290, 5340, 5380, 5415, 5440]},
    {"crop": "Garlic",               "price": 9500,  "change":  5.2,  "history": [6800, 7200, 7600, 8000, 8400, 8800, 9200, 9500]},
    {"crop": "Ginger",               "price": 12000, "change":  3.8,  "history": [9500, 9900, 10300, 10700, 11100, 11500, 11800, 12000]},
    {"crop": "Turmeric",             "price": 14500, "change":  6.5,  "history": [10200, 11000, 11800, 12400, 12900, 13400, 14000, 14500]},
    {"crop": "Cumin (Jeera)",        "price": 22000, "change":  4.1,  "history": [17000, 17800, 18600, 19400, 20100, 20700, 21400, 22000]},
    {"crop": "Coriander",            "price": 8200,  "change":  2.9,  "history": [6800, 7050, 7300, 7500, 7700, 7850, 8050, 8200]},
    {"crop": "Sunflower",            "price": 5800,  "change":  1.2,  "history": [5420, 5490, 5560, 5620, 5680, 5730, 5770, 5800]},
    {"crop": "Sesame (Til)",         "price": 9800,  "change":  2.3,  "history": [8800, 8960, 9100, 9250, 9400, 9560, 9700, 9800]},
    {"crop": "Linseed",              "price": 6200,  "change":  1.1,  "history": [5800, 5880, 5950, 6010, 6060, 6110, 6160, 6200]},
    {"crop": "Banana",               "price": 2800,  "change":  2.0,  "history": [2400, 2500, 2560, 2620, 2680, 2720, 2760, 2800]},
    {"crop": "Mango",                "price": 4500,  "change":  3.5,  "history": [3600, 3800, 3960, 4100, 4250, 4360, 4440, 4500]},
    {"crop": "Palm Oil",             "price": 7800,  "change":  1.8,  "history": [7200, 7360, 7480, 7560, 7640, 7700, 7760, 7800]},
    {"crop": "Oats",                 "price": 1950,  "change":  0.6,  "history": [1850, 1870, 1890, 1910, 1925, 1935, 1945, 1950]},
    {"crop": "Coffee",               "price": 18500, "change":  3.2,  "history": [15000, 15800, 16400, 17000, 17500, 17900, 18200, 18500]},
    {"crop": "Cocoa",                "price": 12000, "change":  2.5,  "history": [10000, 10400, 10800, 11100, 11400, 11600, 11800, 12000]},
    {"crop": "Rubber",               "price": 16000, "change":  1.9,  "history": [14500, 14800, 15100, 15400, 15600, 15750, 15900, 16000]},
    {"crop": "Soybean Oil",          "price": 9200,  "change":  1.4,  "history": [8600, 8720, 8840, 8950, 9020, 9080, 9150, 9200]},
    {"crop": "Soybean Meal",         "price": 3800,  "change":  0.8,  "history": [3600, 3640, 3680, 3720, 3750, 3770, 3790, 3800]},
]

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

CITY_OFFSETS = {
    "Delhi":         {"default": 3.5, "Onion": 2.0, "Potato": 1.5, "Tomato": 5.0},
    "Mumbai":        {"default": 5.0, "Onion": 4.0, "Tomato": 6.0, "Cotton": -1.0},
    "Kolkata":       {"default": 2.0, "Rice": 3.0, "Mustard": 2.5, "Potato": -1.0},
    "Chennai":       {"default": 4.0, "Rice": 2.5, "Chilli": 5.0, "Groundnut": 3.0},
    "Hyderabad":     {"default": 3.0, "Chilli": 6.0, "Cotton": 4.0, "Arhar (Tur)": 2.0},
    "Pune":          {"default": 2.5, "Onion": -3.0, "Sugarcane": 2.0, "Tomato": 3.0},
    "Ahmedabad":     {"default": 2.0, "Cotton": 5.0, "Groundnut": 4.0, "Mustard": 1.5},
    "Lucknow":       {"default": 1.5, "Wheat": 1.0, "Potato": -2.0, "Sugarcane": 2.5},
    "Jaipur":        {"default": 1.0, "Mustard": 3.5, "Wheat": 0.5, "Groundnut": 2.0},
    "Bhopal":        {"default": 0.5, "Soybean": 4.0, "Wheat": 0.5, "Arhar (Tur)": 1.0},
    "Patna":         {"default": 1.0, "Rice": 2.5, "Mustard": 1.5, "Potato": -1.5},
    "Nagpur":        {"default": 1.5, "Cotton": 3.0, "Arhar (Tur)": 2.5, "Soybean": 3.5},
    "Indore":        {"default": 1.0, "Soybean": 5.0, "Wheat": 0.8, "Urad": 2.0},
    "Surat":         {"default": 3.0, "Cotton": 2.5, "Groundnut": 1.5, "Tomato": 4.0},
    "Kanpur":        {"default": 1.5, "Wheat": 1.5, "Sugarcane": 3.0, "Mustard": 1.0},
    "Coimbatore":    {"default": 3.5, "Groundnut": 5.0, "Chilli": 4.5, "Cotton": 2.0},
    "Visakhapatnam": {"default": 2.5, "Rice": 3.5, "Chilli": 3.0, "Arhar (Tur)": 2.0},
    "Bhubaneswar":   {"default": 1.5, "Rice": 4.0, "Mustard": 2.0, "Arhar (Tur)": 1.5},
    "Guwahati":      {"default": 4.0, "Rice": 5.0, "Chilli": 4.0, "Mustard": 3.0},
    "Amritsar":      {"default": 2.0, "Wheat": 2.5, "Mustard": 3.0, "Rice": 1.5},
}


def fetch_ninja_prices() -> list:
    """
    Fetch real-time commodity prices from API-Ninjas.
    Converts USD/unit to INR/quintal using USD_TO_INR and kg_per_unit.
    """
    if not NINJA_API_KEY:
        print("[Market] NINJA_API_KEY missing — using MSP fallback only")
        return []

    headers = {"X-Api-Key": NINJA_API_KEY}
    results = []

    for ninja_name, display_name, usd_unit, kg_per_unit in NINJA_COMMODITIES:
        try:
            encoded = requests.utils.quote(ninja_name)
            url = f"https://api.api-ninjas.com/v1/commodityprice?name={encoded}"
            resp = requests.get(url, headers=headers, timeout=8)
            if resp.status_code != 200:
                print(f"[Market] Ninja '{ninja_name}': HTTP {resp.status_code}")
                continue
            data = resp.json()
            price_usd = data.get("price")
            if not price_usd or float(price_usd) <= 0:
                print(f"[Market] Ninja '{ninja_name}': no price in response")
                continue

            price_usd = float(price_usd)
            # Convert: USD/unit -> INR/quintal
            # price_per_kg_usd = price_usd / kg_per_unit
            # price_per_quintal_inr = price_per_kg_usd * 100 * USD_TO_INR
            price_inr = int((price_usd / kg_per_unit) * 100 * USD_TO_INR)

            # Synthetic 8-week history around live price
            seed = sum(ord(c) for c in ninja_name)
            history = []
            for i in range(8):
                week_seed = (seed * (i + 7) * 31) % 1000
                fluct = ((week_seed % 61) - 30) * 0.003
                trend = ((seed + i * 13) % 100 - 50) * 0.002 * (7 - i) / 7
                history.append(max(1, int(price_inr * (1 + fluct - trend))))

            # Synthetic % change (API gives point-in-time only)
            change_seed = (seed * 17 + price_inr) % 1000
            change = round(((change_seed % 201) - 100) * 0.04, 2)

            results.append({
                "crop":    display_name,
                "crop_key": display_name,  # English key for client-side translation
                "price":   price_inr,
                "change":  change,
                "history": history,
                "unit":    "Rs/quintal",
                "source":  "ninja_live",
            })
            print(f"[Market] OK Ninja '{ninja_name}': ${price_usd}/{usd_unit} -> Rs{price_inr}/quintal")

        except Exception as e:
            print(f"[Market] Ninja '{ninja_name}' error: {e}")
            continue

    print(f"[Market] Ninja fetched {len(results)} live commodities")
    return results


def merge_with_fallback(live_crops: list) -> list:
    live_names = {c["crop"].lower() for c in live_crops}
    combined = list(live_crops)
    for fb in MSP_FALLBACK:
        if fb["crop"].lower() not in live_names:
            combined.append({
                "crop":     fb["crop"],
                "crop_key": fb["crop"],  # English key for translation
                "price":    fb["price"],
                "change":   fb["change"],
                "history":  fb["history"],
                "unit":     "Rs/quintal",
                "source":   "msp_fallback",
            })
    return combined


def get_city_price(base_price: int, city: str, crop_name: str) -> int:
    offsets = CITY_OFFSETS.get(city, {"default": 0})
    pct = offsets.get(crop_name, offsets.get("default", 0))
    return int(round(base_price * (1 + pct / 100)))


def get_city_change(base_change: float, city: str, crop_name: str) -> float:
    seed = sum(ord(c) for c in city + crop_name)
    tweak = ((seed % 11) - 5) * 0.1
    return round(base_change + tweak, 2)


def get_city_history(base_history: list, city: str, crop_name: str) -> list:
    offsets = CITY_OFFSETS.get(city, {"default": 0})
    pct = offsets.get(crop_name, offsets.get("default", 0))
    factor = 1 + pct / 100
    seed = sum(ord(c) for c in city + crop_name)
    result = []
    for i, base_price in enumerate(base_history):
        week_seed = (seed * (i + 7) * 31) % 1000
        fluctuation = ((week_seed % 61) - 30) * 0.001
        trend_seed = (seed + i * 13) % 100
        trend_drift = ((trend_seed % 21) - 10) * 0.002 * i
        city_price = int(base_price * factor * (1 + fluctuation + trend_drift))
        result.append(max(1, city_price))
    return result


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

    live_crops = fetch_ninja_prices()
    all_base_crops = merge_with_fallback(live_crops)

    live_count = sum(1 for c in all_base_crops if c.get("source") == "ninja_live")
    static_count = len(all_base_crops) - live_count
    print(f"[Market] Live: {live_count}  Fallback: {static_count}  Total: {len(all_base_crops)}")

    markets = {}
    for city in cities:
        city_crops = []
        for crop in all_base_crops:
            city_price   = get_city_price(crop["price"], city, crop["crop"])
            city_change  = get_city_change(crop["change"], city, crop["crop"])
            city_history = get_city_history(crop["history"], city, crop["crop"])
            demand       = get_demand(city_price, city_change)
            city_crops.append({
                "crop":     crop["crop"],       # English display name (also used as translation key)
                "crop_key": crop["crop_key"],   # explicit English key for data-crop-key attr
                "price":    city_price,
                "unit":     "Rs/quintal",
                "change":   city_change,
                "history":  city_history,
                "demand":   demand,             # always English: Very High / High / Medium / Low
                "source":   crop.get("source", "msp_fallback"),
            })
        city_crops.sort(
            key=lambda x: ({"Very High": 3, "High": 2, "Medium": 1, "Low": 0}.get(x["demand"], 0), x["price"]),
            reverse=True
        )
        markets[city] = city_crops

    return jsonify({
        "markets":      markets,
        "locations":    list(markets.keys()),
        "live_count":   live_count,
        "static_count": static_count,
        "fetched_at":   datetime.now().isoformat(),
    })


# ─── Debug endpoint ───────────────────────────────────────────────────────────
@app.route('/api/debug-ninja')
def debug_ninja():
    if not DEBUG_MODE:
        return jsonify({"error": "Not available in production"}), 403
    if not NINJA_API_KEY:
        return jsonify({"error": "NINJA_API_KEY not set"}), 500
    headers = {"X-Api-Key": NINJA_API_KEY}
    try:
        resp = requests.get(
            "https://api.api-ninjas.com/v1/commodityprice?name=wheat",
            headers=headers, timeout=10
        )
        return jsonify({"status": resp.status_code, "response": resp.json() if resp.ok else resp.text})
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


@app.route("/api/chat", methods=["POST"])
def kisan_chat():
    ip = request.remote_addr or "unknown"
    if _is_rate_limited(ip):
        return jsonify({"error": "Too many requests. Please wait a moment."}), 429

    data = request.json or {}
    messages = data.get("messages", [])
    lang = data.get("lang", "en")
    if not messages:
        return jsonify({"error": "No messages"}), 400

    lang_names = {
        "en":"English","hi":"Hindi","bn":"Bengali","te":"Telugu","mr":"Marathi",
        "ta":"Tamil","gu":"Gujarati","kn":"Kannada","ml":"Malayalam","pa":"Punjabi",
        "or":"Odia","as":"Assamese","ur":"Urdu","mai":"Maithili","sat":"Santali",
        "ks":"Kashmiri","ne":"Nepali","sd":"Sindhi","kok":"Konkani","mni":"Manipuri",
        "bodo":"Bodo","doi":"Dogri","sa":"Sanskrit"
    }
    lang_name = lang_names.get(lang, "English")

    system_prompt = f"""You are Kisan Helper, a friendly AI agricultural assistant for Indian farmers built into SmartAgro app.
You MUST always reply in {lang_name} language only, regardless of what language the user writes in.
You help farmers with: crop diseases, weather advice, pesticide usage, market prices, government schemes (PM-KISAN, Fasal Bima Yojana, Kisan Credit Card), soil health, irrigation, seasonal crop recommendations.
Keep answers practical, simple, and farmer-friendly. Use bullet points for lists.
Always be warm and address the farmer respectfully. Never use markdown headers. Keep responses under 200 words."""

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    body = {
        "model":       "llama-3.3-70b-versatile",
        "messages":    [{"role": "system", "content": system_prompt}] + messages,
        "temperature": 0.7,
        "max_tokens":  400,
        "stream":      False
    }
    try:
        resp = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=body, timeout=30)
        if resp.status_code != 200:
            return jsonify({"error": "AI unavailable"}), 500
        reply = resp.json()["choices"][0]["message"]["content"].strip()
        return jsonify({"reply": reply})
    except Exception as e:
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
    if not GROQ_API_KEY:
        return jsonify({"error": "GROQ_API_KEY not set in .env"}), 500

    ip = request.remote_addr or "unknown"
    if _is_rate_limited_diagnose(ip):
        return jsonify({"error": "Too many requests. Please wait a moment."}), 429

    data = request.json or {}
    image_b64 = data.get("image", "")
    if not image_b64:
        return jsonify({"error": "No image data received"}), 400
    if len(image_b64) > MAX_IMAGE_B64_LEN:
        return jsonify({"error": "Image too large. Please use an image under 1 MB."}), 413

    prompt = """You are an expert agricultural plant pathologist AI. Look very carefully at this crop image.
Respond ONLY with valid JSON, no markdown or backticks:
{
  "disease": "Exact disease name",
  "confidence": 88,
  "severity": "Mild or Moderate or Severe",
  "affected_part": "Leaves/Stem/Fruit/Root/Cob",
  "cause": "Specific pathogen and spread method",
  "eco_remedies": [{"remedy": "Remedy", "method": "Steps", "frequency": "How often", "effectiveness": 80}],
  "chemical_remedies": [{"name": "Chemical", "dose": "Dose per litre", "interval": "Days between sprays"}],
  "prevention": ["tip1", "tip2", "tip3"],
  "recovery_timeline": "Weeks for recovery"
}"""

    vision_models = [
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "meta-llama/llama-4-maverick-17b-128e-instruct",
    ]
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}

    for model in vision_models:
        try:
            body = {
                "model": model,
                "messages": [
                    {"role": "system", "content": "Expert plant pathologist. Return ONLY valid JSON."},
                    {"role": "user", "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                        {"type": "text", "text": prompt}
                    ]}
                ],
                "temperature": 0.2,
                "max_tokens":  1200,
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
                return jsonify(json.loads(match.group()))
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


# ─── Market Translation ───────────────────────────────────────────────────────
# The market API always returns English crop names (crop_key).
# The frontend calls this endpoint on language change to get translations,
# then re-renders all [data-crop-key] elements without re-fetching market data.

@app.route("/api/translate-market", methods=["POST"])
def translate_market():
    data = request.json or {}
    lang = data.get("lang", "en").strip().lower()

    if lang == "en":
        return jsonify({"lang": "en", "translations": {}, "cached": False})

    if lang in _translation_cache:
        return jsonify({"lang": lang, "translations": _translation_cache[lang], "cached": True})

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

    lang_names = {
        "hi":"Hindi","bn":"Bengali","te":"Telugu","mr":"Marathi","ta":"Tamil",
        "gu":"Gujarati","kn":"Kannada","ml":"Malayalam","pa":"Punjabi","or":"Odia",
        "as":"Assamese","ur":"Urdu","mai":"Maithili","sat":"Santali","ks":"Kashmiri",
        "ne":"Nepali","sd":"Sindhi","kok":"Konkani","mni":"Manipuri","bodo":"Bodo",
        "doi":"Dogri","sa":"Sanskrit",
    }
    lang_name = lang_names.get(lang, "Hindi")
    terms_json = json.dumps(terms, ensure_ascii=False)

    prompt = f"""Translate each English agricultural term to {lang_name}.
Use the most common local/farmer name for crops (not literal translations).

Rules:
1. Return ONLY a valid JSON object mapping each English term to its {lang_name} translation.
2. Keep proper nouns (city names, chemical names) unchanged.
3. Keep units like "quintal" in local usage (e.g. Hindi: "क्विंटल").
4. Do NOT add explanation, markdown, or backticks. Return raw JSON only.
5. Every item in the list must appear as a key in output.

Terms to translate:
{terms_json}"""

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    body = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": f"Expert agricultural translator. Respond in valid JSON only. Translate to {lang_name}."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.1,
        "max_tokens":  2000,
        "stream":      False,
    }

    try:
        resp = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=body, timeout=30)
        if resp.status_code != 200:
            return jsonify({"error": "Translation service unavailable", "translations": {}}), 500

        raw = resp.json()["choices"][0]["message"]["content"].strip()
        clean = re.sub(r"```(?:json)?", "", raw).replace("```", "").strip()
        match = re.search(r"\{.*\}", clean, re.DOTALL)
        if not match:
            return jsonify({"error": "Invalid translation response", "translations": {}}), 500

        translations = json.loads(match.group())
        for term in terms:
            if term not in translations or not translations[term]:
                translations[term] = term

        _translation_cache[lang] = translations
        print(f"[Translate] OK {len(translations)} terms to {lang_name}")

        return jsonify({"lang": lang, "lang_name": lang_name, "translations": translations, "cached": False})

    except json.JSONDecodeError as e:
        print(f"[Translate] JSON parse error: {e}")
        return jsonify({"error": "Translation parse failed", "translations": {}}), 500
    except Exception as e:
        return jsonify({"error": str(e), "translations": {}}), 500


@app.route("/api/translate-market/clear", methods=["POST"])
def clear_translation_cache():
    if not DEBUG_MODE:
        return jsonify({"error": "Not available in production"}), 403
    _translation_cache.clear()
    return jsonify({"status": "cache cleared"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=7860, debug=DEBUG_MODE)