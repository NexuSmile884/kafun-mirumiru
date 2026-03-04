/**
 * 花粉みるみる — X自動投稿ボット
 * WxTech APIで花粉データ取得 → テンプレートで本文生成 → X API v2で投稿
 */

const { TwitterApi } = require('twitter-api-v2');
require('dotenv').config();

// ========== Config ==========
const CONFIG = {
    API_BASE: 'https://wxtech.weathernews.com/opendata/v1/pollen',
    NO_DATA: -9999,
    CITY_CODE: process.env.CITY_CODE || '11203',
    CITY_NAME: process.env.CITY_NAME || '川口市',
    PREF_NAME: process.env.PREF_NAME || '埼玉県',
    SITE_URL: 'https://nexusmile884.github.io/kafun-mirumiru/',
    DRY_RUN: process.env.DRY_RUN === 'true',
};

// ========== Level (daily total) ==========
function getDailyLevel(total) {
    if (total <= 0) return { label: 'なし', emoji: '😊', bar: '⬜⬜⬜⬜⬜' };
    if (total <= 30) return { label: '少ない', emoji: '🙂', bar: '🟩⬜⬜⬜⬜' };
    if (total <= 100) return { label: 'やや多い', emoji: '😐', bar: '🟨🟨⬜⬜⬜' };
    if (total <= 200) return { label: '多い', emoji: '😷', bar: '🟧🟧🟧⬜⬜' };
    if (total <= 400) return { label: '非常に多い', emoji: '🤧', bar: '🟥🟥🟥🟥⬜' };
    return { label: '猛烈', emoji: '🚨', bar: '🟥🟥🟥🟥🟥' };
}

// ========== Date helpers ==========
function fmt(d) {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}

function dayStart(d = new Date()) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// ========== Fetch pollen data ==========
async function fetchPollen(start, end) {
    const url = `${CONFIG.API_BASE}?citycode=${CONFIG.CITY_CODE}&start=${fmt(start)}&end=${fmt(end)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    if (lines.length <= 1) return [];
    return lines.slice(1).map(l => {
        const [code, ds, ps] = l.split(',');
        return { citycode: code, date: new Date(ds), pollen: parseInt(ps, 10) };
    });
}

// ========== Build post text ==========
function buildPost(yesterdayRows, todayRows) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();

    // Yesterday stats
    const yTotal = yesterdayRows.reduce((s, d) => s + Math.max(0, d.pollen), 0);
    const yLevel = getDailyLevel(yTotal);

    let yPeakVal = 0, yPeakH = 0;
    yesterdayRows.forEach(d => {
        if (d.pollen > yPeakVal) { yPeakVal = d.pollen; yPeakH = d.date.getHours(); }
    });

    // Today so far
    const tTotal = todayRows.reduce((s, d) => s + Math.max(0, d.pollen), 0);

    // Forecast: compare yesterday with day-before-yesterday trend
    // At 7am JST, early morning data is essentially 0, so we use
    // yesterday's total vs historical trend to predict today
    let forecastText = '';
    if (yTotal <= 0) {
        forecastText = '📊 今日も飛散は少ない見込みです';
    } else if (yTotal <= 30) {
        forecastText = '📊 今日も少なめの見込み。油断せずに';
    } else if (yTotal <= 100) {
        forecastText = '📊 今日もやや多い見込み。マスク推奨';
    } else if (yTotal <= 200) {
        forecastText = '📈 今日も多い見込み！しっかり対策を';
    } else if (yTotal <= 400) {
        forecastText = '📈 今日も非常に多い見込み！フル装備で';
    } else {
        forecastText = '🚨 今日も猛烈な飛散の見込み！外出注意';
    }

    // Advice based on level
    const advice = {
        'なし': '花粉はほぼ飛んでいません。快適な一日を！🌤',
        '少ない': '少なめですが油断せずに 🌱',
        'やや多い': '敏感な方はマスク推奨です 😷',
        '多い': 'マスク＋メガネで対策を！🥽',
        '非常に多い': '外出時はフル装備で！洗濯物は室内干しに 🏠',
        '猛烈': '⚠️ 危険レベル！不要不急の外出は控えましょう 🚫',
    };

    const lines = [
        `🌳 花粉みるみる｜${month}/${day} 朝のレポート`,
        ``,
        `📍 ${CONFIG.CITY_NAME}（${CONFIG.PREF_NAME}）`,
        `${yLevel.emoji} 昨日の飛散量: ${yTotal.toLocaleString()}個`,
        `${yLevel.bar} ${yLevel.label}`,
        `⏰ ピーク: ${yPeakH}時（${yPeakVal}個/時間）`,
        ``,
        forecastText,
        ``,
        advice[yLevel.label],
        ``,
        `#花粉 #花粉情報 #花粉症 #花粉対策`,
        `🔗 ${CONFIG.SITE_URL}`,
    ];

    return lines.join('\n');
}

// ========== Post to X ==========
async function postToX(text) {
    const client = new TwitterApi({
        appKey: process.env.X_API_KEY,
        appSecret: process.env.X_API_SECRET,
        accessToken: process.env.X_ACCESS_TOKEN,
        accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
    });

    const result = await client.v2.tweet(text);
    return result;
}

// ========== Main ==========
async function main() {
    console.log('🌳 花粉みるみる X Auto-Post');
    console.log(`📍 ${CONFIG.CITY_NAME} (${CONFIG.CITY_CODE})`);
    console.log(`🔧 Dry run: ${CONFIG.DRY_RUN}`);
    console.log('');

    // Fetch data: yesterday + today
    const today = dayStart();
    const yesterday = addDays(today, -1);
    const data = await fetchPollen(yesterday, today);

    const yesterdayRows = data.filter(d => d.date >= yesterday && d.date < today && d.pollen !== CONFIG.NO_DATA);
    const todayRows = data.filter(d => d.date >= today && d.pollen !== CONFIG.NO_DATA);

    if (yesterdayRows.length === 0) {
        console.log('⚠️ 昨日のデータがありません。投稿をスキップします。');
        return;
    }

    const text = buildPost(yesterdayRows, todayRows);

    console.log('📝 投稿内容:');
    console.log('─'.repeat(40));
    console.log(text);
    console.log('─'.repeat(40));
    console.log(`📏 文字数: ${text.length}/280`);

    if (CONFIG.DRY_RUN) {
        console.log('\n✅ ドライラン完了（実際には投稿されていません）');
        return;
    }

    // Validate API keys
    if (!process.env.X_API_KEY || !process.env.X_API_SECRET) {
        console.error('❌ X API キーが設定されていません。.env を確認してください。');
        process.exit(1);
    }

    const result = await postToX(text);
    console.log(`\n✅ 投稿完了! Tweet ID: ${result.data.id}`);
    console.log(`🔗 https://x.com/kafun_mirumiru/status/${result.data.id}`);
}

main().catch(err => {
    console.error('❌ エラー:', err.message);
    process.exit(1);
});
