/* ============================================
   きょう何着てく？ - Application Logic
   ============================================ */

// ==========================================
// Constants & Config
// ==========================================

const API = {
    geocoding: 'https://geocoding-api.open-meteo.com/v1/search',
    weather: 'https://api.open-meteo.com/v1/forecast',
};

const WEATHER_CODES = {
    0: { icon: '☀️', label: '快晴' },
    1: { icon: '🌤️', label: '晴れ' },
    2: { icon: '⛅', label: '曇りがち' },
    3: { icon: '☁️', label: '曇り' },
    45: { icon: '🌫️', label: '霧' },
    48: { icon: '🌫️', label: '着氷性の霧' },
    51: { icon: '🌦️', label: '小雨' },
    53: { icon: '🌧️', label: '雨' },
    55: { icon: '🌧️', label: '強い雨' },
    56: { icon: '🌨️', label: '着氷性の小雨' },
    57: { icon: '🌨️', label: '着氷性の雨' },
    61: { icon: '🌦️', label: '小雨' },
    63: { icon: '🌧️', label: '雨' },
    65: { icon: '🌧️', label: '大雨' },
    66: { icon: '🌨️', label: '着氷性の小雨' },
    67: { icon: '🌨️', label: '着氷性の大雨' },
    71: { icon: '🌨️', label: '小雪' },
    73: { icon: '❄️', label: '雪' },
    75: { icon: '❄️', label: '大雪' },
    77: { icon: '🌨️', label: '霰' },
    80: { icon: '🌦️', label: 'にわか雨' },
    81: { icon: '🌧️', label: '強いにわか雨' },
    82: { icon: '⛈️', label: '激しいにわか雨' },
    85: { icon: '🌨️', label: 'にわか雪' },
    86: { icon: '❄️', label: '激しいにわか雪' },
    95: { icon: '⛈️', label: '雷雨' },
    96: { icon: '⛈️', label: '雹を伴う雷雨' },
    99: { icon: '⛈️', label: '激しい雹を伴う雷雨' },
};

// ==========================================
// DOM Elements
// ==========================================

const $ = (id) => document.getElementById(id);

const els = {
    locationInput: $('location-input'),
    gpsBtn: $('gps-btn'),
    suggestions: $('location-suggestions'),
    departureTime: $('departure-time'),
    returnTime: $('return-time'),
    dateInput: $('date-input'),
    submitBtn: $('submit-btn'),
    inputSection: $('input-section'),
    loadingSection: $('loading-section'),
    resultsSection: $('results-section'),
    resetBtn: $('reset-btn'),
    weatherIconLarge: $('weather-icon-large'),
    locationName: $('location-name'),
    weatherDate: $('weather-date'),
    weatherStats: $('weather-stats'),
    hourlyChart: $('hourly-chart'),
    clothingAdvice: $('clothing-advice'),
    umbrellaAdvice: $('umbrella-advice'),
    itemsAdvice: $('items-advice'),
    warningAdvice: $('warning-advice'),
    summaryText: $('summary-text'),
    warningCard: $('warning-card'),
};

// ==========================================
// State
// ==========================================

let selectedLocation = null;
let searchTimeout = null;

// ==========================================
// Initialize
// ==========================================

function init() {
    // Set default date to today
    const today = new Date();
    els.dateInput.value = formatDateISO(today);
    // Set min date
    els.dateInput.min = formatDateISO(today);
    // Set max date (16 days ahead - Open-Meteo limit)
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 15);
    els.dateInput.max = formatDateISO(maxDate);

    // デフォルト時間をセット（次の30分区切り）
    const now = new Date();
    let h = now.getHours();
    let m = now.getMinutes();

    if (m < 30) {
        m = 30;
    } else {
        m = 0;
        h = (h + 1) % 24;
    }

    const depTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const retTime = `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    els.departureTime.value = depTime;
    els.returnTime.value = retTime;

    // 前回入力した場所があれば初期値としてセット
    const history = getHistory();
    if (history.length > 0) {
        const lastLoc = history[0];
        selectedLocation = lastLoc;
        els.locationInput.value = lastLoc.name;
    }

    // Event listeners
    els.locationInput.addEventListener('input', handleLocationInput);
    els.locationInput.addEventListener('focus', () => {
        const query = els.locationInput.value.trim();
        if (query.length < 2) {
            showHistory();
        } else if (els.suggestions.children.length > 0) {
            els.suggestions.classList.add('active');
        }
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#location-group')) {
            els.suggestions.classList.remove('active');
        }
    });

    els.gpsBtn.addEventListener('click', handleGPS);
    els.submitBtn.addEventListener('click', handleSubmit);
    els.resetBtn.addEventListener('click', handleReset);
}

// ==========================================
// Location Search
// ==========================================

function handleLocationInput(e) {
    const query = e.target.value.trim();
    clearTimeout(searchTimeout);

    if (query.length < 2) {
        showHistory();
        return;
    }

    searchTimeout = setTimeout(() => searchLocation(query), 350);
}

async function searchLocation(query) {
    try {
        const res = await fetch(
            `${API.geocoding}?name=${encodeURIComponent(query)}&count=10&language=ja&format=json`
        );
        const data = await res.json();

        if (!data.results || data.results.length === 0) {
            els.suggestions.innerHTML =
                '<div class="suggestion-item"><span class="suggestion-name">見つかりませんでした</span></div>';
            els.suggestions.classList.add('active');
            return;
        }

        // Deduplicate: remove entries with same name+admin1, or very close coordinates
        const seen = new Set();
        const filtered = data.results.filter((loc) => {
            // Key by name + admin1 (e.g. "船橋 / 千葉県") to remove exact dupes
            const nameKey = `${loc.name}|${loc.admin1 || ''}`;
            // Also key by rounded coords (0.1° ≈ 11km) to catch near-dupes
            const coordKey = `${Math.round(loc.latitude * 10)}|${Math.round(loc.longitude * 10)}`;
            const key = `${nameKey}::${coordKey}`;

            if (seen.has(key)) return false;
            seen.add(key);

            // Also skip if same name+admin1 already exists (different coords but same city)
            if (seen.has(nameKey)) return false;
            seen.add(nameKey);

            return true;
        });

        // Sort by population (larger cities first) if available, then limit to 5
        const sorted = filtered
            .sort((a, b) => (b.population || 0) - (a.population || 0))
            .slice(0, 5);

        els.suggestions.innerHTML = sorted
            .map(
                (loc, i) => `
            <div class="suggestion-item" data-index="${i}">
                <div class="suggestion-name">${loc.name}</div>
                <div class="suggestion-detail">${[loc.admin1, loc.country].filter(Boolean).join(', ')}</div>
            </div>
        `
            )
            .join('');

        // Add click handlers
        els.suggestions.querySelectorAll('.suggestion-item').forEach((item) => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.dataset.index);
                const loc = sorted[idx];
                selectLocation(loc);
            });
        });

        els.suggestions.classList.add('active');
    } catch (err) {
        console.error('Location search error:', err);
    }
}

function selectLocation(loc) {
    selectedLocation = {
        name: loc.name,
        latitude: loc.latitude,
        longitude: loc.longitude,
        country: loc.country,
        admin1: loc.admin1,
        timezone: loc.timezone,
    };
    els.locationInput.value = loc.name;
    els.suggestions.classList.remove('active');
    saveHistory(selectedLocation);
}

// ==========================================
// History
// ==========================================

const HISTORY_KEY = 'wear_advisor_history';

function getHistory() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch {
        return [];
    }
}

function saveHistory(loc) {
    // 現在地検索時は履歴に残さない
    if(!loc || !loc.name || loc.name === '現在地') return;
    let history = getHistory();
    // 既存の同じ場所があれば削除（先頭に移動するため）
    history = history.filter(item => item.name !== loc.name);
    history.unshift(loc);
    // 直近5件までに制限
    if(history.length > 5) history = history.slice(0, 5);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function removeHistory(index) {
    let history = getHistory();
    history.splice(index, 1);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    showHistory();
}

function showHistory() {
    const history = getHistory();
    if(history.length === 0) {
        els.suggestions.innerHTML = '';
        els.suggestions.classList.remove('active');
        return;
    }
    
    els.suggestions.innerHTML = `
        <div class="suggestion-header" style="padding: 8px 16px; font-size: 0.8rem; color: var(--text-muted); border-bottom: 1px solid rgba(255, 255, 255, 0.05); display: flex; justify-content: space-between; align-items: center;">
            <span>最近の検索</span>
        </div>
    ` + history.map((loc, i) => `
        <div class="suggestion-item history-item" data-index="${i}">
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                <div>
                    <span style="color: var(--text-muted); margin-right: 8px;">🕒</span>
                    <span class="suggestion-name">${loc.name}</span>
                    <div class="suggestion-detail">${[loc.admin1, loc.country].filter(Boolean).join(', ')}</div>
                </div>
                <button class="delete-history-btn" data-index="${i}" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; font-size: 1.1rem; border-radius: 4px;" title="履歴から削除" onmouseover="this.style.color='#f0f0f5'" onmouseout="this.style.color='var(--text-muted)'">×</button>
            </div>
        </div>
    `).join('');
    
    // 履歴クリック時の処理
    els.suggestions.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.delete-history-btn')) return; // 削除ボタンクリック時は無視
            const idx = parseInt(item.dataset.index);
            const loc = history[idx];
            selectLocation(loc);
            els.locationInput.blur(); // フォーカスを外す
        });
    });

    // 削除ボタンクリック時の処理
    els.suggestions.querySelectorAll('.delete-history-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // 親要素のクリックイベントを発火させない
            const idx = parseInt(btn.dataset.index);
            removeHistory(idx);
            els.locationInput.focus(); // 入力欄にフォーカスを維持
        });
    });

    els.suggestions.classList.add('active');
}

// ==========================================
// GPS
// ==========================================

async function handleGPS() {
    if (!navigator.geolocation) {
        showError('お使いのブラウザは位置情報に対応していません');
        return;
    }

    els.gpsBtn.classList.add('loading');

    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: false,
                timeout: 10000,
            });
        });

        const { latitude, longitude } = position.coords;

        // Reverse geocoding via Open-Meteo
        const res = await fetch(
            `${API.geocoding}?name=_&count=1&language=ja&format=json&latitude=${latitude}&longitude=${longitude}`
        );

        // Just use coordinates directly — set a meaningful name
        selectedLocation = {
            name: '現在地',
            latitude,
            longitude,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };

        // Try to get a city name from reverse lookup
        try {
            const reverseRes = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=ja`
            );
            const reverseData = await reverseRes.json();
            if (reverseData.address) {
                const addr = reverseData.address;
                selectedLocation.name =
                    addr.city || addr.town || addr.village || addr.suburb || '現在地';
            }
        } catch {
            // Keep '現在地' as name
        }

        els.locationInput.value = selectedLocation.name;
    } catch (err) {
        showError('位置情報の取得に失敗しました');
    } finally {
        els.gpsBtn.classList.remove('loading');
    }
}

// ==========================================
// Submit & Fetch Weather
// ==========================================

async function handleSubmit() {
    // Validate
    if (!selectedLocation && els.locationInput.value.trim().length >= 2) {
        // Try to search and pick first result
        await searchAndSelectFirst(els.locationInput.value.trim());
    }

    if (!selectedLocation) {
        showError('場所を入力してください');
        return;
    }

    const departure = els.departureTime.value;
    const returnTime = els.returnTime.value;
    const date = els.dateInput.value;

    if (!departure || !returnTime) {
        showError('出発時間と帰宅時間を入力してください');
        return;
    }

    // Show loading
    els.inputSection.classList.add('hidden');
    els.loadingSection.classList.remove('hidden');
    els.resultsSection.classList.add('hidden');

    try {
        const weatherData = await fetchWeather(selectedLocation, date);
        const analysis = analyzeWeather(weatherData, departure, returnTime, date);
        renderResults(analysis, selectedLocation, date);

        els.loadingSection.classList.add('hidden');
        els.resultsSection.classList.remove('hidden');
    } catch (err) {
        console.error('Weather fetch error:', err);
        els.loadingSection.classList.add('hidden');
        els.inputSection.classList.remove('hidden');
        showError('天気データの取得に失敗しました。もう一度お試しください。');
    }
}

async function searchAndSelectFirst(query) {
    try {
        const res = await fetch(
            `${API.geocoding}?name=${encodeURIComponent(query)}&count=1&language=ja&format=json`
        );
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            selectLocation(data.results[0]);
        }
    } catch {
        // ignore
    }
}

async function fetchWeather(location, dateStr) {
    const params = new URLSearchParams({
        latitude: location.latitude,
        longitude: location.longitude,
        hourly: [
            'temperature_2m',
            'relative_humidity_2m',
            'apparent_temperature',
            'precipitation_probability',
            'precipitation',
            'weather_code',
            'wind_speed_10m',
            'wind_gusts_10m',
            'uv_index',
        ].join(','),
        timezone: location.timezone || 'Asia/Tokyo',
        start_date: dateStr,
        end_date: dateStr,
    });

    const res = await fetch(`${API.weather}?${params}`);
    if (!res.ok) throw new Error('API request failed');
    return res.json();
}

// ==========================================
// Weather Analysis Engine
// ==========================================

function analyzeWeather(data, departure, returnTime, dateStr) {
    const hourly = data.hourly;
    const depHour = parseInt(departure.split(':')[0]);
    const retHour = parseInt(returnTime.split(':')[0]);

    // Extract relevant hours
    const startIdx = depHour;
    const endIdx = Math.min(retHour, 23);

    const relevantRange = {
        temps: [],
        feelsLike: [],
        humidity: [],
        rainProb: [],
        precipitation: [],
        weatherCodes: [],
        windSpeed: [],
        windGusts: [],
        uvIndex: [],
    };

    for (let i = startIdx; i <= endIdx; i++) {
        relevantRange.temps.push(hourly.temperature_2m[i]);
        relevantRange.feelsLike.push(hourly.apparent_temperature[i]);
        relevantRange.humidity.push(hourly.relative_humidity_2m[i]);
        relevantRange.rainProb.push(hourly.precipitation_probability[i]);
        relevantRange.precipitation.push(hourly.precipitation[i]);
        relevantRange.weatherCodes.push(hourly.weather_code[i]);
        relevantRange.windSpeed.push(hourly.wind_speed_10m[i]);
        relevantRange.windGusts.push(hourly.wind_gusts_10m[i]);
        relevantRange.uvIndex.push(hourly.uv_index[i]);
    }

    const maxTemp = Math.max(...relevantRange.temps);
    const minTemp = Math.min(...relevantRange.temps);
    const avgTemp = relevantRange.temps.reduce((a, b) => a + b, 0) / relevantRange.temps.length;
    const maxFeelsLike = Math.max(...relevantRange.feelsLike);
    const minFeelsLike = Math.min(...relevantRange.feelsLike);
    const maxRainProb = Math.max(...relevantRange.rainProb);
    const avgRainProb =
        relevantRange.rainProb.reduce((a, b) => a + b, 0) / relevantRange.rainProb.length;
    const totalPrecipitation = relevantRange.precipitation.reduce((a, b) => a + b, 0);
    const maxWind = Math.max(...relevantRange.windSpeed);
    const maxGusts = Math.max(...relevantRange.windGusts);
    const maxUV = Math.max(...relevantRange.uvIndex);
    const avgHumidity =
        relevantRange.humidity.reduce((a, b) => a + b, 0) / relevantRange.humidity.length;
    const tempDiff = maxTemp - minTemp;

    // Most common weather code
    const codeCounts = {};
    relevantRange.weatherCodes.forEach((c) => {
        codeCounts[c] = (codeCounts[c] || 0) + 1;
    });
    const dominantCode = Object.entries(codeCounts).sort((a, b) => b[1] - a[1])[0][0];

    return {
        hourlyData: hourly,
        depHour,
        retHour,
        maxTemp: Math.round(maxTemp * 10) / 10,
        minTemp: Math.round(minTemp * 10) / 10,
        avgTemp: Math.round(avgTemp * 10) / 10,
        maxFeelsLike: Math.round(maxFeelsLike * 10) / 10,
        minFeelsLike: Math.round(minFeelsLike * 10) / 10,
        maxRainProb: Math.round(maxRainProb),
        avgRainProb: Math.round(avgRainProb),
        totalPrecipitation: Math.round(totalPrecipitation * 10) / 10,
        maxWind: Math.round(maxWind * 10) / 10,
        maxGusts: Math.round(maxGusts * 10) / 10,
        maxUV: Math.round(maxUV * 10) / 10,
        avgHumidity: Math.round(avgHumidity),
        tempDiff: Math.round(tempDiff * 10) / 10,
        dominantCode: parseInt(dominantCode),
        clothing: getClothingAdvice(minFeelsLike, maxFeelsLike, tempDiff, avgHumidity, maxWind),
        umbrella: getUmbrellaAdvice(maxRainProb, avgRainProb, totalPrecipitation, maxWind, relevantRange.weatherCodes),
        items: getItemsAdvice(maxUV, avgHumidity, maxTemp, maxWind, maxRainProb, totalPrecipitation),
        warnings: getWarnings(maxTemp, minTemp, maxWind, maxGusts, maxUV, maxRainProb, totalPrecipitation, tempDiff, relevantRange.weatherCodes),
    };
}

// ==========================================
// Clothing Advisor
// ==========================================

function getClothingAdvice(minFeels, maxFeels, tempDiff, humidity, wind) {
    const avgFeels = (minFeels + maxFeels) / 2;
    const result = { layers: [], main: '', detail: '', tags: [] };

    if (avgFeels >= 30) {
        result.main = '半袖 + 涼しい服装';
        result.detail = '暑さ対策が最優先。通気性の良い素材を選ぼう。';
        result.tags.push({ text: '半袖・タンクトップ', type: 'essential' });
        result.tags.push({ text: '短パン・薄手ボトム', type: 'essential' });
        result.tags.push({ text: '通気性のいい素材', type: 'recommended' });
        if (humidity > 70) {
            result.detail += '\n湿度も高いので、吸湿速乾の素材がベスト。';
            result.tags.push({ text: '吸湿速乾素材', type: 'recommended' });
        }
    } else if (avgFeels >= 25) {
        result.main = '半袖でOK';
        result.detail = '薄手で快適に過ごせる気温。';
        result.tags.push({ text: '半袖シャツ', type: 'essential' });
        result.tags.push({ text: '薄手のパンツ', type: 'essential' });
        if (tempDiff >= 7) {
            result.detail += '\n朝晩は少し涼しくなるかも。薄手の羽織りがあると安心。';
            result.tags.push({ text: '薄手のカーディガン', type: 'recommended' });
        }
    } else if (avgFeels >= 20) {
        result.main = '長袖 or 薄手の羽織り';
        result.detail = '過ごしやすい気温。長袖1枚、もしくは半袖+カーディガン。';
        result.tags.push({ text: '長袖シャツ', type: 'essential' });
        result.tags.push({ text: 'カーディガン', type: 'recommended' });
        if (tempDiff >= 7) {
            result.tags.push({ text: '脱ぎ着しやすい服', type: 'warning' });
            result.detail += '\n寒暖差があるので、脱ぎ着で調整しやすい服装に。';
        }
    } else if (avgFeels >= 15) {
        result.main = 'ジャケット + 長袖';
        result.detail = '少しひんやり。薄手のアウターがあると安心。';
        result.tags.push({ text: 'ライトジャケット', type: 'essential' });
        result.tags.push({ text: '長袖シャツ', type: 'essential' });
        result.tags.push({ text: '長ズボン', type: 'essential' });
        if (wind > 20) {
            result.detail += '\n風が強いので、風を通しにくいアウターが◎';
            result.tags.push({ text: '防風アウター', type: 'warning' });
        }
    } else if (avgFeels >= 10) {
        result.main = 'アウター必須';
        result.detail = 'しっかりめのジャケットやセーターが必要。';
        result.tags.push({ text: 'ジャケット・ブルゾン', type: 'essential' });
        result.tags.push({ text: 'セーター・ニット', type: 'essential' });
        result.tags.push({ text: '長ズボン', type: 'essential' });
    } else if (avgFeels >= 5) {
        result.main = 'コート + 暖かインナー';
        result.detail = 'かなり寒い。コートにセーター、暖かいインナーで防寒を。';
        result.tags.push({ text: 'コート', type: 'essential' });
        result.tags.push({ text: '厚手セーター', type: 'essential' });
        result.tags.push({ text: 'ヒートテック等', type: 'recommended' });
        result.tags.push({ text: 'マフラー', type: 'recommended' });
    } else {
        result.main = 'フル防寒装備';
        result.detail = '極寒。ダウンジャケット、マフラー、手袋、帽子フル装備で！';
        result.tags.push({ text: 'ダウンジャケット', type: 'essential' });
        result.tags.push({ text: 'マフラー', type: 'essential' });
        result.tags.push({ text: '手袋', type: 'essential' });
        result.tags.push({ text: 'ニット帽', type: 'recommended' });
        result.tags.push({ text: 'ヒートテック', type: 'essential' });
    }

    return result;
}

// ==========================================
// Umbrella Advisor
// ==========================================

function getUmbrellaAdvice(maxRainProb, avgRainProb, totalPrecip, maxWind, weatherCodes) {
    const hasThunder = weatherCodes.some((c) => c >= 95);
    const hasRain = weatherCodes.some((c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82));
    const hasHeavyRain = weatherCodes.some((c) => c === 65 || c === 67 || c === 82);

    let verdict, detail, verdictClass;

    if (maxRainProb <= 15 && !hasRain) {
        verdict = '傘なしでOK！';
        detail = '雨の心配はほぼなし。身軽に出かけよう。';
        verdictClass = 'no-need';
    } else if (maxRainProb <= 30 && !hasRain) {
        verdict = 'たぶん大丈夫';
        detail = '念のため折りたたみ傘があると安心だけど、なくてもたぶんOK。';
        verdictClass = 'no-need';
    } else if (maxRainProb <= 50 || (hasRain && !hasHeavyRain && totalPrecip < 5)) {
        verdict = '折りたたみ傘を持って';
        detail = '降る可能性あり。コンパクトな折りたたみ傘をバッグに入れておこう。';
        verdictClass = 'folding';
        if (maxWind > 30) {
            detail += '\n風が強いので、耐風タイプの傘がおすすめ。';
        }
    } else {
        verdict = '長傘を持って！';
        detail = '雨はほぼ確実。しっかりした長傘がおすすめ。';
        verdictClass = 'full';
        if (hasThunder) {
            detail += '\n⚡ 雷の可能性もあるので、屋内に避難できるルートを意識して。';
        }
        if (hasHeavyRain) {
            detail += '\n大雨の時間帯があります。防水対策もしっかり。';
        }
        if (maxWind > 30) {
            detail += '\n風が非常に強いので、傘が壊れないよう注意。';
        }
    }

    const icons = {
        'no-need': '😎',
        'folding': '🌂',
        'full': '☂️',
    };

    return { verdict, detail, verdictClass, icon: icons[verdictClass] };
}

// ==========================================
// Items Advisor
// ==========================================

function getItemsAdvice(maxUV, humidity, maxTemp, maxWind, maxRainProb, totalPrecip) {
    const items = [];

    // UV protection
    if (maxUV >= 6) {
        items.push({ icon: '🧴', text: '日焼け止め', priority: 'essential', reason: `UV指数${maxUV}でかなり強い` });
        items.push({ icon: '🕶️', text: 'サングラス', priority: 'recommended', reason: '紫外線対策に' });
        items.push({ icon: '🧢', text: '帽子', priority: 'recommended', reason: '日差し対策' });
    } else if (maxUV >= 3) {
        items.push({ icon: '🧴', text: '日焼け止め', priority: 'recommended', reason: `UV指数${maxUV}でやや強め` });
    }

    // Heat countermeasures
    if (maxTemp >= 30) {
        items.push({ icon: '💧', text: '飲み物（多めに）', priority: 'essential', reason: '熱中症対策' });
        items.push({ icon: '🧊', text: '冷却グッズ', priority: 'recommended', reason: '暑さ対策' });
        items.push({ icon: '🤏', text: 'ハンドタオル', priority: 'recommended', reason: '汗拭き用' });
    } else if (maxTemp >= 25) {
        items.push({ icon: '💧', text: '飲み物', priority: 'recommended', reason: '水分補給' });
        if (humidity > 70) {
            items.push({ icon: '🤏', text: 'ハンドタオル', priority: 'recommended', reason: '蒸し暑さ対策' });
        }
    }

    // Rain gear
    if (maxRainProb > 50 || totalPrecip > 5) {
        items.push({ icon: '👟', text: '防水シューズ', priority: 'recommended', reason: '足元が濡れないように' });
        items.push({ icon: '🛍️', text: '防水バッグ・ビニール袋', priority: 'recommended', reason: '荷物の雨対策' });
    }

    // Wind
    if (maxWind > 30) {
        items.push({ icon: '🔒', text: '帽子クリップ', priority: 'recommended', reason: '飛ばされ防止' });
    }

    // Humidity discomfort
    if (humidity > 75 && maxTemp > 25) {
        items.push({ icon: '🍃', text: 'ポータブルファン', priority: 'recommended', reason: '蒸し暑さ対策' });
    }

    // Always useful
    items.push({ icon: '📱', text: 'モバイルバッテリー', priority: 'recommended', reason: '外出時間が長い日に' });

    return items;
}

// ==========================================
// Warnings
// ==========================================

function getWarnings(maxTemp, minTemp, maxWind, maxGusts, maxUV, maxRainProb, totalPrecip, tempDiff, weatherCodes) {
    const warnings = [];

    if (maxTemp >= 35) {
        warnings.push({
            level: 'danger',
            icon: '🔥',
            text: '猛暑日の可能性あり。こまめな水分補給と休憩を。日陰を選んで移動しよう。',
        });
    } else if (maxTemp >= 30) {
        warnings.push({
            level: 'caution',
            icon: '☀️',
            text: '真夏日レベル。水分補給と暑さ対策を忘れずに。',
        });
    }

    if (minTemp <= 0) {
        warnings.push({
            level: 'danger',
            icon: '🥶',
            text: '氷点下になる時間帯あり。路面凍結に注意。防寒対策は万全に。',
        });
    }

    if (tempDiff >= 10) {
        warnings.push({
            level: 'caution',
            icon: '🌡️',
            text: `気温差が${tempDiff}°Cあります。体温調節しやすいレイヤード（重ね着）がおすすめ。`,
        });
    }

    if (maxGusts > 50) {
        warnings.push({
            level: 'danger',
            icon: '💨',
            text: `最大瞬間風速${maxGusts}km/h。傘が壊れたり、物が飛ばされる危険あり。`,
        });
    } else if (maxWind > 30) {
        warnings.push({
            level: 'caution',
            icon: '🌬️',
            text: '風が強め。髪型や軽い荷物に注意。',
        });
    }

    if (maxUV >= 8) {
        warnings.push({
            level: 'danger',
            icon: '⚡',
            text: `UV指数${maxUV}で非常に強い。日焼け止めは必須。長時間の外出は避けて。`,
        });
    }

    if (weatherCodes.some((c) => c >= 95)) {
        warnings.push({
            level: 'danger',
            icon: '⛈️',
            text: '雷雨の可能性あり。屋外活動は控え、建物の中にいるようにしよう。',
        });
    }

    if (totalPrecip >= 20) {
        warnings.push({
            level: 'danger',
            icon: '🌊',
            text: `予想降水量${totalPrecip}mm。大雨に注意。川や低地には近づかないで。`,
        });
    }

    return warnings;
}

// ==========================================
// Render Results
// ==========================================

function renderResults(analysis, location, dateStr) {
    // Weather icon & header
    const weather = WEATHER_CODES[analysis.dominantCode] || { icon: '🌤️', label: '不明' };
    els.weatherIconLarge.textContent = weather.icon;
    els.locationName.textContent = `${location.name}の天気`;
    els.weatherDate.textContent = formatDateJapanese(dateStr) + ` ${weather.label}`;

    // Stats
    els.weatherStats.innerHTML = `
        <div class="stat-item">
            <div class="stat-label">最高気温</div>
            <div class="stat-value temp-high">${analysis.maxTemp}°</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">最低気温</div>
            <div class="stat-value temp-low">${analysis.minTemp}°</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">体感</div>
            <div class="stat-value temp-high">${analysis.maxFeelsLike}°</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">降水確率</div>
            <div class="stat-value rain">${analysis.maxRainProb}%</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">最大風速</div>
            <div class="stat-value wind">${analysis.maxWind}km/h</div>
        </div>
        <div class="stat-item">
            <div class="stat-label">UV指数</div>
            <div class="stat-value uv">${analysis.maxUV}</div>
        </div>
    `;

    // Hourly chart
    renderHourlyChart(analysis);

    // Clothing
    const clothing = analysis.clothing;
    els.clothingAdvice.innerHTML = `
        <div class="advice-main">${clothing.main}</div>
        <p class="advice-detail">${clothing.detail.replace(/\n/g, '<br>')}</p>
        <div style="margin-top: 12px; display: flex; flex-wrap: wrap;">
            ${clothing.tags.map((t) => `<span class="advice-tag ${t.type}">${t.text}</span>`).join('')}
        </div>
    `;

    // Umbrella
    const umbrella = analysis.umbrella;
    els.umbrellaAdvice.innerHTML = `
        <div class="umbrella-verdict ${umbrella.verdictClass}">
            <span class="umbrella-verdict-icon">${umbrella.icon}</span>
            <span class="umbrella-verdict-text">${umbrella.verdict}</span>
        </div>
        <p class="advice-detail">${umbrella.detail.replace(/\n/g, '<br>')}</p>
    `;

    // Items
    const items = analysis.items;
    els.itemsAdvice.innerHTML = items
        .map(
            (item) => `
        <div class="advice-tag ${item.priority}">
            <span>${item.icon}</span>
            <span>${item.text}</span>
        </div>
    `
        )
        .join('');

    // Warnings
    const warnings = analysis.warnings;
    if (warnings.length === 0) {
        els.warningCard.classList.add('hidden');
    } else {
        els.warningCard.classList.remove('hidden');
        els.warningAdvice.innerHTML = warnings
            .map(
                (w) => `
            <div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
                <span style="font-size: 1.2rem; flex-shrink: 0;">${w.icon}</span>
                <span class="advice-detail" style="margin: 0;">${w.text}</span>
            </div>
        `
            )
            .join('');
    }

    // One-line summary
    els.summaryText.innerHTML = generateSummary(analysis, location);
}

function renderHourlyChart(analysis) {
    const hourly = analysis.hourlyData;
    let html = '';

    for (let i = 0; i < 24; i++) {
        const isActive = i >= analysis.depHour && i <= analysis.retHour;
        const code = hourly.weather_code[i];
        const weather = WEATHER_CODES[code] || { icon: '🌤️' };
        const temp = Math.round(hourly.temperature_2m[i]);
        const rainProb = hourly.precipitation_probability[i];

        html += `
            <div class="hour-slot ${isActive ? 'active-hour' : ''}">
                <span class="hour-time">${String(i).padStart(2, '0')}時</span>
                <span class="hour-icon">${weather.icon}</span>
                <span class="hour-temp">${temp}°</span>
                ${rainProb > 0 ? `<span class="hour-rain">${rainProb}%</span>` : ''}
            </div>
        `;
    }

    els.hourlyChart.innerHTML = html;

    // Auto-scroll to departure hour
    setTimeout(() => {
        const activeSlot = els.hourlyChart.querySelector('.active-hour');
        if (activeSlot) {
            activeSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
        }
    }, 100);
}

function generateSummary(analysis, location) {
    const parts = [];
    const clothing = analysis.clothing;
    const umbrella = analysis.umbrella;

    parts.push(`<span class="emoji">📝</span> `);
    parts.push(`<strong>${location.name}</strong>は`);

    // Temperature description
    if (analysis.avgTemp >= 30) parts.push('暑い一日。');
    else if (analysis.avgTemp >= 25) parts.push('暖かい一日。');
    else if (analysis.avgTemp >= 20) parts.push('過ごしやすい一日。');
    else if (analysis.avgTemp >= 15) parts.push('ちょっと肌寒い一日。');
    else if (analysis.avgTemp >= 10) parts.push('寒い一日。');
    else parts.push('とても寒い一日。');

    parts.push(`<strong>${clothing.main}</strong>で出かけよう。`);

    if (umbrella.verdictClass === 'no-need') {
        parts.push('傘は置いていってOK！');
    } else if (umbrella.verdictClass === 'folding') {
        parts.push('折りたたみ傘を忘れずに。');
    } else {
        parts.push('長傘を持っていこう！');
    }

    return parts.join('');
}

// ==========================================
// UI Helpers
// ==========================================

function handleReset() {
    els.resultsSection.classList.add('hidden');
    els.inputSection.classList.remove('hidden');
    els.inputSection.style.animation = 'none';
    // Force reflow
    void els.inputSection.offsetHeight;
    els.inputSection.style.animation = 'fadeInUp 500ms ease-out';
}

function showError(message) {
    // Remove existing error
    const existing = document.querySelector('.error-message');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'error-message';
    el.textContent = message;

    const inputCard = document.querySelector('.input-card');
    if (inputCard) {
        inputCard.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }
}

function formatDateISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatDateJapanese(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dow = days[date.getDay()];
    return `${month}月${day}日（${dow}）`;
}

// ==========================================
// Bootstrap
// ==========================================

document.addEventListener('DOMContentLoaded', init);
