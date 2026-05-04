/**
 * 花粉みるみる — 全国市区町村対応ダッシュボード
 * WxTech ポールンロボ API の今日・昨日・7日間データを表示する。
 */

const CONFIG = {
    API_BASE: 'https://wxtech.weathernews.com/opendata/v1/pollen',
    REFRESH_MS: 30 * 60 * 1000,
    NO_DATA: -9999,
    CITY_INDEX_URL: 'cities.json',
};

const state = {
    cities: [],
    cityByCode: new Map(),
    data: [],
    chart: null,
    range: 'today',
    cityCode: null,
    cityMeta: null,
    timer: null,
};

const els = {};

// ========== Level ==========
function getHourlyLevel(n) {
    if (n === null || n === CONFIG.NO_DATA || n < 0) {
        return { label: '欠測', emoji: '–', color: '#8a99a3', bg: '#eef2f4', pct: 0 };
    }
    if (n === 0) return { label: 'なし', emoji: '😊', color: '#607d8b', bg: '#eef2f4', pct: 0 };
    if (n <= 10) return { label: '少ない', emoji: '🙂', color: '#2f7d4f', bg: '#e5f4eb', pct: 15 };
    if (n <= 30) return { label: 'やや多い', emoji: '😐', color: '#c98700', bg: '#fff5d9', pct: 40 };
    if (n <= 50) return { label: '多い', emoji: '😷', color: '#d46a1f', bg: '#fff0e4', pct: 65 };
    if (n <= 100) return { label: '非常に多い', emoji: '🤧', color: '#c63f3f', bg: '#fde9e9', pct: 85 };
    return { label: '猛烈', emoji: '🚨', color: '#7b3fa3', bg: '#f3e9fa', pct: 100 };
}

function getDailyLevel(total) {
    if (total <= 0) return { label: 'なし', emoji: '😊', color: '#607d8b', bg: '#eef2f4', pct: 0 };
    if (total <= 30) return { label: '少ない', emoji: '🙂', color: '#2f7d4f', bg: '#e5f4eb', pct: 15 };
    if (total <= 100) return { label: 'やや多い', emoji: '😐', color: '#c98700', bg: '#fff5d9', pct: 35 };
    if (total <= 200) return { label: '多い', emoji: '😷', color: '#d46a1f', bg: '#fff0e4', pct: 55 };
    if (total <= 400) return { label: '非常に多い', emoji: '🤧', color: '#c63f3f', bg: '#fde9e9', pct: 80 };
    return { label: '猛烈', emoji: '🚨', color: '#7b3fa3', bg: '#f3e9fa', pct: 100 };
}

// ========== Date helpers ==========
const fmt = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}

function dayStart(d = new Date()) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseWxDate(value) {
    const s = String(value || '').trim();
    const compact = s.match(/^(\d{4})(\d{2})(\d{2})(?:[ T]?(\d{2}))?/);
    if (compact && !s.includes('-') && !s.includes('/')) {
        return new Date(
            Number(compact[1]),
            Number(compact[2]) - 1,
            Number(compact[3]),
            Number(compact[4] || 0)
        );
    }

    const separated = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2}))?)?/);
    if (separated) {
        return new Date(
            Number(separated[1]),
            Number(separated[2]) - 1,
            Number(separated[3]),
            Number(separated[4] || 0),
            Number(separated[5] || 0)
        );
    }

    const date = new Date(s);
    return Number.isNaN(date.getTime()) ? null : date;
}

// ========== API ==========
async function fetchPollen(cityCode, start, end) {
    let currentStart = new Date(start);
    let allData = [];

    while (currentStart <= end) {
        let currentEnd = addDays(currentStart, 30);
        if (currentEnd > end) currentEnd = end;

        const url = `${CONFIG.API_BASE}?citycode=${cityCode}&start=${fmt(currentStart)}&end=${fmt(currentEnd)}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`API ${response.status}`);
        }

        const csv = await response.text();
        const lines = csv.trim().split(/\r?\n/).filter(Boolean);

        if (lines.length > 1) {
            const rows = lines.slice(1).map(line => {
                const [code, ds, ps] = line.split(',');
                const date = parseWxDate(ds);
                const pollen = Number.parseInt(ps, 10);
                if (!date || Number.isNaN(pollen)) return null;
                return { citycode: code, date, pollen };
            }).filter(Boolean);
            allData = allData.concat(rows);
        }

        currentStart = addDays(currentEnd, 1);
    }

    const unique = new Map();
    allData.forEach(d => unique.set(d.date.getTime(), d));
    return Array.from(unique.values()).sort((a, b) => a.date - b.date);
}

// ========== City search ==========
function normalizeTerm(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function queryTerms(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(term => term.replace(/\s+/g, ''));
}

function cityLabel(city) {
    if (!city) return state.cityCode ? `コード ${state.cityCode}` : '地域未選択';
    if (city.pref === 'コード指定') return `コード ${city.code}`;
    return `${city.pref} ${city.name}`;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

async function loadCities() {
    const response = await fetch(CONFIG.CITY_INDEX_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`cities.json ${response.status}`);
    const cities = await response.json();

    state.cities = cities.map(city => ({
        ...city,
        normalized: normalizeTerm(city.search || `${city.pref} ${city.name} ${city.code}`),
    }));
    state.cityByCode = new Map(state.cities.map(city => [city.code, city]));
}

function renderSearchResults(query) {
    const terms = queryTerms(query);
    if (terms.length === 0) {
        els.cityResults.innerHTML = '';
        els.cityResults.hidden = true;
        return;
    }

    const matches = state.cities
        .filter(city => terms.every(term => city.normalized.includes(term)))
        .slice(0, 12);

    const normalizedQuery = String(query || '').normalize('NFKC').trim();
    const canUseCustomCode = /^\d{5}$/.test(normalizedQuery) && !state.cityByCode.has(normalizedQuery);

    if (matches.length === 0 && !canUseCustomCode) {
        els.cityResults.innerHTML = '<div class="no-results">該当する市区町村が見つかりませんでした。</div>';
        els.cityResults.hidden = false;
        return;
    }

    const resultHtml = matches.map(city => `
        <button type="button" class="city-result" data-result-code="${escapeHtml(city.code)}" role="option">
            <span>${escapeHtml(city.pref)} ${escapeHtml(city.name)}</span>
            <small>${escapeHtml(city.code)}</small>
        </button>
    `).join('');

    const customHtml = canUseCustomCode ? `
        <button type="button" class="city-result is-custom" data-result-code="${escapeHtml(normalizedQuery)}" data-allow-unknown="true" role="option">
            <span>コード ${escapeHtml(normalizedQuery)} を直接指定</span>
            <small>API 応答を確認</small>
        </button>
    ` : '';

    els.cityResults.innerHTML = resultHtml + customHtml;
    els.cityResults.hidden = false;
}

function saveCity(code, meta) {
    localStorage.setItem('pollenCityCode', code);
    localStorage.setItem('pollenCityName', meta?.name || '');
    localStorage.setItem('pollenPrefName', meta?.pref || '');
}

function readSavedCity() {
    const code = localStorage.getItem('pollenCityCode');
    if (!code) return null;
    const meta = state.cityByCode.get(code) || {
        code,
        name: localStorage.getItem('pollenCityName') || code,
        pref: localStorage.getItem('pollenPrefName') || 'コード指定',
    };
    return { code, meta };
}

function renderResumeButton() {
    const saved = readSavedCity();
    if (!saved) {
        els.resumeRegion.hidden = true;
        return;
    }
    els.resumeRegion.textContent = `前回の地域を表示: ${cityLabel(saved.meta)}`;
    els.resumeRegion.hidden = false;
}

function getInitialCityCode() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('city');
    if (!code) return null;
    return String(code).normalize('NFKC').trim();
}

function updateUrl(code) {
    const url = new URL(window.location.href);
    url.searchParams.set('city', code);
    window.history.replaceState(null, '', url);
}

function setActivePopular(code) {
    document.querySelectorAll('.popular-btn').forEach(button => {
        button.classList.toggle('is-active', button.dataset.cityCode === code);
    });
}

async function selectCity(code, options = {}) {
    const normalizedCode = String(code || '').normalize('NFKC').trim();
    if (!/^\d{5}$/.test(normalizedCode)) {
        showStatus('市区町村コードは5桁の数字で指定してください。', 'error');
        return;
    }

    const meta = state.cityByCode.get(normalizedCode) || options.meta || {
        code: normalizedCode,
        name: normalizedCode,
        pref: 'コード指定',
    };

    state.cityCode = normalizedCode;
    state.cityMeta = meta;
    saveCity(normalizedCode, meta);
    renderResumeButton();
    setActivePopular(normalizedCode);

    els.citySearch.value = cityLabel(meta);
    els.cityResults.hidden = true;
    els.dashboard.hidden = false;
    els.emptyState.hidden = true;
    els.updateInfo.textContent = '取得中...';

    if (!options.skipUrl) updateUrl(normalizedCode);

    showStatus(`${cityLabel(meta)} のデータを取得しています。`, 'info');
    await load();
    startTimer();
}

// ========== Load/render ==========
async function load() {
    if (!state.cityCode) return;

    try {
        const today = dayStart();
        const start = addDays(today, -7);
        state.data = await fetchPollen(state.cityCode, start, today);
        render();

        const validCount = state.data.filter(d => d.pollen !== CONFIG.NO_DATA).length;
        if (validCount === 0) {
            showStatus('対象期間の有効データがありません。欠測値を含む可能性があります。', 'warning');
        } else {
            showStatus('', 'info');
        }
    } catch (error) {
        console.error(error);
        state.data = [];
        render();
        showStatus(`データ取得に失敗しました（${error.message}）。コードの誤り、APIの一時エラー、または欠測の可能性があります。`, 'error');
    }
}

function startTimer() {
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(load, CONFIG.REFRESH_MS);
}

function rowsForDay(targetDay, includeNoData = false) {
    const start = dayStart(targetDay);
    const end = addDays(start, 1);
    return state.data.filter(row => {
        if (!includeNoData && row.pollen === CONFIG.NO_DATA) return false;
        return row.date >= start && row.date < end;
    });
}

function render() {
    const now = new Date();
    const today = dayStart();
    const yesterday = addDays(today, -1);
    const todayRows = rowsForDay(today);
    const yesterdayRows = rowsForDay(yesterday);
    const validToday = todayRows.filter(row => row.pollen >= 0);
    const latest = validToday.length ? validToday[validToday.length - 1] : null;
    const prev = validToday.length >= 2 ? validToday[validToday.length - 2] : null;

    renderHero(latest ? latest.pollen : null, prev, latest, validToday);
    renderStats(validToday, yesterdayRows);
    renderChart();
    renderHourly(today);

    const yyyy = now.getFullYear();
    const mm = now.getMonth() + 1;
    const dd = now.getDate();
    els.heroDate.textContent = `${cityLabel(state.cityMeta)}｜${yyyy}/${mm}/${dd}`;
    els.updateInfo.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} 更新`;
}

function renderHero(current, prev, latest, todayRows) {
    if (current === null) {
        els.heroEmoji.textContent = '–';
        els.heroCount.textContent = '--';
        els.heroCount.style.color = '';
        els.heroLabel.textContent = '今日の有効データなし';
        els.heroLabel.style.color = '';
        els.heroBarFill.style.width = '0%';
        els.heroTrend.textContent = '欠測値を含む可能性があります。';
        return;
    }

    const dayTotal = todayRows.reduce((sum, row) => sum + Math.max(0, row.pollen), 0);
    const dailyLevel = getDailyLevel(dayTotal);

    els.heroEmoji.textContent = dailyLevel.emoji;
    els.heroCount.textContent = dayTotal.toLocaleString();
    els.heroCount.style.color = dailyLevel.color;
    els.heroLabel.textContent = dailyLevel.label;
    els.heroLabel.style.color = dailyLevel.color;
    els.heroBarFill.style.width = `${dailyLevel.pct}%`;

    let trendHtml = `現在 ${latest.date.getHours()}時: <strong>${current}個/時間</strong>`;
    if (prev && prev.pollen >= 0) {
        const diff = current - prev.pollen;
        if (diff > 0) trendHtml += ` <span class="trend-up">+${diff}</span>`;
        else if (diff < 0) trendHtml += ` <span class="trend-down">${diff}</span>`;
        else trendHtml += ' <span class="trend-same">横ばい</span>';
    }
    els.heroTrend.innerHTML = trendHtml;
}

function renderStats(todayRows, yesterdayRows) {
    const todayTotal = todayRows.reduce((sum, row) => sum + Math.max(0, row.pollen), 0);
    els.statTodayTotal.textContent = todayRows.length ? todayTotal.toLocaleString() : '--';

    let peakVal = null;
    let peakHour = '';
    todayRows.forEach(row => {
        if (peakVal === null || row.pollen > peakVal) {
            peakVal = row.pollen;
            peakHour = `${row.date.getHours()}時`;
        }
    });
    els.statPeak.textContent = peakVal === null ? '--' : peakVal.toLocaleString();
    els.statPeakTime.textContent = peakVal === null ? 'ピーク' : `ピーク ${peakHour}`;

    const yesterdayTotal = yesterdayRows.reduce((sum, row) => sum + Math.max(0, row.pollen), 0);
    els.statYesterday.textContent = yesterdayRows.length ? yesterdayTotal.toLocaleString() : '--';

    const weekStart = addDays(dayStart(), -6);
    const weekRows = state.data.filter(row => row.date >= weekStart && row.pollen >= 0);
    const weekTotal = weekRows.reduce((sum, row) => sum + Math.max(0, row.pollen), 0);
    els.statWeekTotal.textContent = weekRows.length ? weekTotal.toLocaleString() : '--';
}

function hourlySeries(day) {
    const rows = rowsForDay(day, true);
    return Array.from({ length: 24 }, (_, hour) => {
        const row = rows.find(item => item.date.getHours() === hour);
        return row && row.pollen !== CONFIG.NO_DATA ? row.pollen : null;
    });
}

function renderChart() {
    if (typeof Chart === 'undefined') {
        els.pollenChart.hidden = true;
        els.chartStatus.textContent = 'グラフライブラリを読み込めませんでした。';
        els.chartStatus.hidden = false;
        return;
    }

    els.pollenChart.hidden = false;
    els.chartStatus.hidden = true;

    const ctx = els.pollenChart.getContext('2d');
    const today = dayStart();
    const yesterday = addDays(today, -1);
    let labels;
    let values;

    if (state.range === 'today') {
        labels = Array.from({ length: 24 }, (_, hour) => `${hour}時`);
        values = hourlySeries(today);
    } else if (state.range === 'yesterday') {
        labels = Array.from({ length: 24 }, (_, hour) => `${hour}時`);
        values = hourlySeries(yesterday);
    } else {
        const days = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6));
        labels = days.map(day => `${day.getMonth() + 1}/${day.getDate()}`);
        values = days.map(day => {
            const rows = rowsForDay(day);
            if (!rows.length) return null;
            return rows.reduce((sum, row) => sum + Math.max(0, row.pollen), 0);
        });
    }

    const isBar = state.range === 'week';
    const gradient = ctx.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, 'rgba(34, 115, 79, 0.24)');
    gradient.addColorStop(1, 'rgba(34, 115, 79, 0)');

    if (state.chart) state.chart.destroy();
    state.chart = new Chart(ctx, {
        type: isBar ? 'bar' : 'line',
        data: {
            labels,
            datasets: [{
                label: '花粉飛散数',
                data: values,
                fill: !isBar,
                backgroundColor: isBar
                    ? values.map(value => value === null ? '#d8e0e4' : `${getDailyLevel(value).color}bb`)
                    : gradient,
                borderColor: '#22734f',
                borderWidth: 2,
                pointRadius: isBar ? 0 : 3,
                pointBackgroundColor: '#22734f',
                tension: 0.32,
                spanGaps: false,
                borderRadius: isBar ? 6 : 0,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#fff',
                    titleColor: '#174d39',
                    bodyColor: '#17231d',
                    borderColor: '#dfe8e1',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        label: context => {
                            const value = context.parsed.y;
                            if (value === null) return '欠測';
                            const level = isBar ? getDailyLevel(value) : getHourlyLevel(value);
                            return `${value} 個（${level.label}）`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#6f7f78', font: { size: 10 }, maxRotation: 0 },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#eef1ef' },
                    ticks: { color: '#6f7f78', font: { size: 10 } },
                },
            },
        },
    });
}

function renderHourly(today) {
    const allToday = rowsForDay(today, true);
    const nowHour = new Date().getHours();
    const validValues = allToday.filter(row => row.pollen >= 0).map(row => row.pollen);
    const peak = Math.max(1, ...validValues);

    const rows = Array.from({ length: 24 }, (_, hour) => {
        const entry = allToday.find(row => row.date.getHours() === hour);
        const pollen = entry ? entry.pollen : CONFIG.NO_DATA;
        const noData = pollen === CONFIG.NO_DATA;
        const isFuture = !entry && hour > nowHour;
        const isNow = hour === nowHour;
        const level = getHourlyLevel(noData ? null : pollen);
        const pct = noData ? 0 : Math.min(100, (pollen / peak) * 100);

        return `
            <div class="hourly-row${isNow ? ' is-now' : ''}${isFuture ? ' is-future' : ''}">
                <div class="h-time">${String(hour).padStart(2, '0')}:00</div>
                <div class="h-bar-wrap">
                    <div class="h-bar"><div class="h-bar-inner" style="width:${pct}%;background:${level.color}"></div></div>
                </div>
                <div class="h-count" style="color:${noData ? '#9aa6ad' : level.color}">${noData ? '–' : pollen}</div>
                <div class="h-level" style="background:${level.bg};color:${level.color}">${level.label}</div>
            </div>
        `;
    });

    els.hourlyList.innerHTML = rows.join('');
}

// ========== UI ==========
function showStatus(message, type = 'info') {
    if (!message) {
        els.statusMessage.hidden = true;
        els.statusMessage.textContent = '';
        els.statusMessage.className = 'status-message';
        return;
    }
    els.statusMessage.hidden = false;
    els.statusMessage.textContent = message;
    els.statusMessage.className = `status-message is-${type}`;
}

function bindSearch() {
    els.citySearch.addEventListener('input', event => {
        const value = event.target.value;
        renderSearchResults(value);
        els.searchClear.hidden = value.length === 0;
    });

    els.searchClear.addEventListener('click', () => {
        els.citySearch.value = '';
        els.searchClear.hidden = true;
        renderSearchResults('');
        els.citySearch.focus();
    });

    els.cityResults.addEventListener('click', event => {
        const button = event.target.closest('[data-result-code]');
        if (!button) return;
        const code = button.dataset.resultCode;
        const meta = button.dataset.allowUnknown
            ? { code, name: code, pref: 'コード指定' }
            : state.cityByCode.get(code);
        selectCity(code, { meta });
    });
}

function bindPopularButtons() {
    document.querySelectorAll('[data-city-code]').forEach(button => {
        button.addEventListener('click', () => selectCity(button.dataset.cityCode));
    });
}

function bindResumeButton() {
    els.resumeRegion.addEventListener('click', () => {
        const saved = readSavedCity();
        if (saved) selectCity(saved.code, { meta: saved.meta });
    });
}

function bindCustomCode() {
    const applyCustom = () => {
        const code = String(els.customCode.value || '').normalize('NFKC').trim();
        if (!/^\d{5}$/.test(code)) {
            showStatus('市区町村コードは5桁の数字で入力してください。', 'error');
            els.customCode.focus();
            return;
        }
        const meta = state.cityByCode.get(code) || { code, name: code, pref: 'コード指定' };
        selectCity(code, { meta });
    };

    els.customCodeBtn.addEventListener('click', applyCustom);
    els.customCode.addEventListener('keydown', event => {
        if (event.key === 'Enter') applyCustom();
    });
}

function bindTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(item => item.classList.remove('active'));
            tab.classList.add('active');
            state.range = tab.dataset.range;
            renderChart();
        });
    });
}

function cacheElements() {
    [
        'updateInfo', 'citySearch', 'searchClear', 'cityResults', 'resumeRegion', 'customCode',
        'customCodeBtn', 'statusMessage', 'emptyState', 'dashboard', 'heroDate', 'heroEmoji',
        'heroCount', 'heroLabel', 'heroBarFill', 'heroTrend', 'statTodayTotal', 'statPeak',
        'statPeakTime', 'statYesterday', 'statWeekTotal', 'pollenChart', 'chartStatus', 'hourlyList',
    ].forEach(id => { els[id] = document.getElementById(id); });
}

async function init() {
    cacheElements();
    bindSearch();
    bindPopularButtons();
    bindResumeButton();
    bindCustomCode();
    bindTabs();

    els.searchClear.hidden = true;
    els.citySearch.disabled = true;
    els.citySearch.placeholder = '市区町村リストを読み込み中...';

    try {
        await loadCities();
        els.citySearch.disabled = false;
        els.citySearch.placeholder = '例: 港区 / 東京都 / 13103';
        renderResumeButton();

        const initialCode = getInitialCityCode();
        if (initialCode) {
            const meta = state.cityByCode.get(initialCode) || { code: initialCode, name: initialCode, pref: 'コード指定' };
            await selectCity(initialCode, { meta, skipUrl: true });
        }
    } catch (error) {
        console.error(error);
        els.citySearch.disabled = false;
        showStatus('市区町村リストの読み込みに失敗しました。5桁コードの直接指定は利用できます。', 'error');
    }
}

document.addEventListener('DOMContentLoaded', init);
