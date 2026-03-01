/**
 * 花粉なう — WxTech ポールンロボ API
 * 都市切替対応版
 */

const CONFIG = {
    API_BASE: 'https://wxtech.weathernews.com/opendata/v1/pollen',
    REFRESH_MS: 30 * 60 * 1000,
    NO_DATA: -9999,
};

// ========== Level (1時間あたり) ==========
function getLevel(n) {
    if (n === CONFIG.NO_DATA || n < 0)
        return { label: '—', emoji: '—', color: '#b0bec5', bg: '#f0f0f0', pct: 0 };
    if (n === 0)
        return { label: 'なし', emoji: '😊', color: '#78909c', bg: '#eceff1', pct: 0 };
    if (n <= 10)
        return { label: '少ない', emoji: '🙂', color: '#388e3c', bg: '#e8f5e9', pct: 15 };
    if (n <= 30)
        return { label: 'やや多い', emoji: '😐', color: '#f9a825', bg: '#fff8e1', pct: 40 };
    if (n <= 50)
        return { label: '多い', emoji: '😷', color: '#ef6c00', bg: '#fff3e0', pct: 65 };
    if (n <= 100)
        return { label: '非常に多い', emoji: '🤧', color: '#c62828', bg: '#ffebee', pct: 85 };
    return { label: '猛烈', emoji: '🚨', color: '#6a1b9a', bg: '#f3e5f5', pct: 100 };
}

// ========== Level (1日の合計ベース) ==========
function getDailyLevel(total) {
    if (total <= 0)
        return { label: 'なし', emoji: '😊', color: '#78909c', bg: '#eceff1', pct: 0 };
    if (total <= 30)
        return { label: '少ない', emoji: '🙂', color: '#388e3c', bg: '#e8f5e9', pct: 15 };
    if (total <= 100)
        return { label: 'やや多い', emoji: '😐', color: '#f9a825', bg: '#fff8e1', pct: 35 };
    if (total <= 200)
        return { label: '多い', emoji: '😷', color: '#ef6c00', bg: '#fff3e0', pct: 55 };
    if (total <= 400)
        return { label: '非常に多い', emoji: '🤧', color: '#c62828', bg: '#ffebee', pct: 80 };
    return { label: '猛烈', emoji: '🚨', color: '#6a1b9a', bg: '#f3e5f5', pct: 100 };
}

// ========== Date ==========
const fmt = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const dayStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// ========== API ==========
async function fetchPollen(cityCode, start, end) {
    const url = `${CONFIG.API_BASE}?citycode=${cityCode}&start=${fmt(start)}&end=${fmt(end)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`API ${r.status}`);
    const csv = await r.text();
    const lines = csv.trim().split('\n');
    if (lines.length <= 1) return [];
    return lines.slice(1).map(l => {
        const [code, ds, ps] = l.split(',');
        return { citycode: code, date: new Date(ds), pollen: parseInt(ps, 10) };
    });
}

// ========== State ==========
let data = [];
let chart = null;
let range = 'today';
let cityCode = '11203';
let timer = null;

// ========== Load ==========
async function load() {
    try {
        const today = dayStart();
        const weekAgo = addDays(today, -7);
        data = await fetchPollen(cityCode, weekAgo, today);
        render();
    } catch (e) {
        console.error(e);
        document.getElementById('hero').innerHTML =
            `<div class="error-box">⚠️ データ取得失敗（${e.message}）<br>30分後に再取得します</div>`;
    }
}

function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(load, CONFIG.REFRESH_MS);
}

// ========== Render ==========
function render() {
    const now = new Date();
    const today = dayStart();
    const yesterday = addDays(today, -1);

    const todayRows = data.filter(d => d.date >= today && d.pollen !== CONFIG.NO_DATA);
    const yesterdayRows = data.filter(d => d.date >= yesterday && d.date < today && d.pollen !== CONFIG.NO_DATA);

    const latest = [...todayRows].reverse().find(d => d.pollen >= 0);
    const current = latest ? latest.pollen : null;
    const prev = todayRows.length >= 2 ? todayRows[todayRows.length - 2] : null;

    renderHero(current, prev, latest, todayRows);
    renderStats(todayRows, yesterdayRows);
    renderChart();
    renderHourly(today);

    document.getElementById('updateInfo').textContent =
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} 更新`;
}

function renderHero(current, prev, latest, todayRows) {
    const el = id => document.getElementById(id);
    if (current === null) {
        el('heroEmoji').textContent = '🔍';
        el('heroCount').textContent = '--';
        el('heroLabel').textContent = 'データなし';
        el('heroLabel').style.color = '';
        el('heroBarFill').style.width = '0%';
        el('heroTrend').innerHTML = '';
        return;
    }

    // 本日の合計でレベル判定（花粉サイト標準）
    const dayTotal = todayRows.reduce((s, d) => s + Math.max(0, d.pollen), 0);
    const dailyLv = getDailyLevel(dayTotal);

    el('heroEmoji').textContent = dailyLv.emoji;
    el('heroCount').textContent = dayTotal;
    el('heroCount').style.color = dailyLv.color;
    el('heroLabel').textContent = dailyLv.label;
    el('heroLabel').style.color = dailyLv.color;
    el('heroBarFill').style.width = dailyLv.pct + '%';

    // 現在の1時間値をトレンド欄に表示
    let trendHtml = `現在 ${latest.date.getHours()}時: <strong>${current}個/時間</strong>`;
    if (prev && prev.pollen >= 0) {
        const d = current - prev.pollen;
        if (d > 0) trendHtml += ` <span class="trend-up">▲+${d}</span>`;
        else if (d < 0) trendHtml += ` <span class="trend-down">▼${d}</span>`;
        else trendHtml += ` <span class="trend-same">→</span>`;
    }
    el('heroTrend').innerHTML = trendHtml;
}

function renderStats(todayRows, yesterdayRows) {
    const total = todayRows.reduce((s, d) => s + Math.max(0, d.pollen), 0);
    document.getElementById('statTodayTotal').textContent = total.toLocaleString();

    let peakVal = 0, peakH = '';
    todayRows.forEach(d => {
        if (d.pollen > peakVal) { peakVal = d.pollen; peakH = `${d.date.getHours()}時`; }
    });
    document.getElementById('statPeak').textContent = peakVal || '--';
    document.getElementById('statPeakTime').textContent = peakVal ? `ピーク ${peakH}` : 'ピーク';

    const yTotal = yesterdayRows.reduce((s, d) => s + Math.max(0, d.pollen), 0);
    document.getElementById('statYesterday').textContent = yTotal.toLocaleString();
}

function renderChart() {
    const ctx = document.getElementById('pollenChart').getContext('2d');
    const today = dayStart();
    const yesterday = addDays(today, -1);
    let labels, values;

    if (range === 'today') {
        const rows = data.filter(d => d.date >= today);
        labels = rows.map(d => `${d.date.getHours()}時`);
        values = rows.map(d => d.pollen === CONFIG.NO_DATA ? null : d.pollen);
    } else if (range === 'yesterday') {
        const rows = data.filter(d => d.date >= yesterday && d.date < today);
        labels = rows.map(d => `${d.date.getHours()}時`);
        values = rows.map(d => d.pollen === CONFIG.NO_DATA ? null : d.pollen);
    } else {
        const dayTotals = {};
        data.filter(d => d.pollen >= 0 && d.date >= addDays(today, -6)).forEach(d => {
            const k = `${d.date.getMonth() + 1}/${d.date.getDate()}`;
            dayTotals[k] = (dayTotals[k] || 0) + d.pollen;
        });
        labels = Object.keys(dayTotals);
        values = Object.values(dayTotals);
    }

    const isBar = range === 'week';
    const grad = ctx.createLinearGradient(0, 0, 0, 220);
    grad.addColorStop(0, 'rgba(46,125,50,0.25)');
    grad.addColorStop(1, 'rgba(46,125,50,0)');

    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: isBar ? 'bar' : 'line',
        data: {
            labels,
            datasets: [{
                label: '花粉数',
                data: values,
                fill: !isBar,
                backgroundColor: isBar
                    ? values.map(v => getLevel(v || 0).color + 'aa')
                    : grad,
                borderColor: '#2e7d32',
                borderWidth: 2,
                pointRadius: isBar ? 0 : 3,
                pointBackgroundColor: '#2e7d32',
                tension: 0.35,
                spanGaps: false,
                borderRadius: isBar ? 6 : 0,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#fff',
                    titleColor: '#2e7d32',
                    bodyColor: '#1a2e1a',
                    borderColor: '#e0e8de',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        label: c => {
                            const v = c.parsed.y;
                            if (v === null) return '未計測';
                            return `${v} 個（${getLevel(v).label}）`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#8a9b8a', font: { size: 10 }, maxRotation: 0 },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#f0f0f0' },
                    ticks: { color: '#8a9b8a', font: { size: 10 } },
                }
            },
        }
    });
}

function renderHourly(today) {
    const container = document.getElementById('hourlyList');
    const allToday = data.filter(d => d.date >= today && d.date < addDays(today, 1));
    const nowH = new Date().getHours();
    let peak = 0;
    allToday.forEach(r => { if (r.pollen > peak) peak = r.pollen; });
    if (!peak) peak = 1;

    let html = '';
    for (let h = 0; h < 24; h++) {
        const entry = allToday.find(r => r.date.getHours() === h);
        const p = entry ? entry.pollen : CONFIG.NO_DATA;
        const noData = p === CONFIG.NO_DATA;
        const isFuture = noData && h > nowH;
        const isNow = h === nowH;
        const lv = getLevel(p);
        const pct = noData ? 0 : Math.min(100, (p / peak) * 100);

        html += `<div class="hourly-row${isNow ? ' is-now' : ''}${isFuture ? ' is-future' : ''}">`;
        html += `<div class="h-time">${String(h).padStart(2, '0')}:00</div>`;
        html += `<div class="h-bar-wrap">`;
        html += `<div class="h-bar"><div class="h-bar-inner" style="width:${pct}%;background:${lv.color}"></div></div>`;
        html += `</div>`;
        html += `<div class="h-count" style="color:${noData ? '#ccc' : lv.color}">${noData ? '—' : p}</div>`;
        html += `<div class="h-level" style="background:${lv.bg};color:${lv.color}">${lv.label}</div>`;
        html += `</div>`;
    }
    container.innerHTML = html;
}

// ========== City Selector ==========
function initCitySelector() {
    const select = document.getElementById('citySelect');
    const customWrap = document.getElementById('customCodeWrap');
    const customInput = document.getElementById('customCode');
    const customBtn = document.getElementById('customCodeBtn');

    // Restore from localStorage
    const saved = localStorage.getItem('pollenCityCode');
    if (saved) {
        cityCode = saved;
        const option = select.querySelector(`option[value="${saved}"]`);
        if (option) {
            select.value = saved;
        } else {
            select.value = 'custom';
            customWrap.style.display = 'flex';
            customInput.value = saved;
        }
    }

    select.addEventListener('change', () => {
        if (select.value === 'custom') {
            customWrap.style.display = 'flex';
            customInput.focus();
        } else {
            customWrap.style.display = 'none';
            cityCode = select.value;
            localStorage.setItem('pollenCityCode', cityCode);
            load();
        }
    });

    const applyCustom = () => {
        const v = customInput.value.trim();
        if (/^\d{5}$/.test(v)) {
            cityCode = v;
            localStorage.setItem('pollenCityCode', cityCode);
            load();
        } else {
            customInput.style.borderColor = '#f44336';
            setTimeout(() => customInput.style.borderColor = '', 1500);
        }
    };

    customBtn.addEventListener('click', applyCustom);
    customInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyCustom(); });
}

// ========== Tabs ==========
function initTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            range = tab.dataset.range;
            renderChart();
        });
    });
}

// ========== Init ==========
document.addEventListener('DOMContentLoaded', () => {
    initCitySelector();
    initTabs();
    load();
    startTimer();
});
