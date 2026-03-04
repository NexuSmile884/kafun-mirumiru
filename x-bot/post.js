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
function getTimeSlot() {
    const h = new Date().getHours();
    if (h < 10) return 'morning';
    if (h < 17) return 'noon';
    return 'night';
}

function buildPost(yesterdayRows, todayRows) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const slot = getTimeSlot();

    // Yesterday stats
    const yTotal = yesterdayRows.reduce((s, d) => s + Math.max(0, d.pollen), 0);
    const yLevel = getDailyLevel(yTotal);

    let yPeakVal = 0, yPeakH = 0;
    yesterdayRows.forEach(d => {
        if (d.pollen > yPeakVal) { yPeakVal = d.pollen; yPeakH = d.date.getHours(); }
    });

    // Today stats
    const tTotal = todayRows.reduce((s, d) => s + Math.max(0, d.pollen), 0);
    const tLevel = getDailyLevel(tTotal);

    let tPeakVal = 0, tPeakH = 0;
    todayRows.forEach(d => {
        if (d.pollen > tPeakVal) { tPeakVal = d.pollen; tPeakH = d.date.getHours(); }
    });

    // Forecast text based on yesterday
    function forecastFromYesterday() {
        if (yTotal <= 0) return '📊 今日も飛散は少ない見込みです';
        if (yTotal <= 30) return '📊 今日も少なめの見込み。油断せずに';
        if (yTotal <= 100) return '📊 今日もやや多い見込み。マスク推奨';
        if (yTotal <= 200) return '📈 今日も多い見込み！しっかり対策を';
        if (yTotal <= 400) return '📈 今日も非常に多い見込み！フル装備で';
        return '🚨 今日も猛烈な飛散の見込み！外出注意';
    }

    // Advice
    const advice = {
        'なし': '花粉はほぼなし。快適！🌤',
        '少ない': '油断せずに 🌱',
        'やや多い': 'マスク推奨 😷',
        '多い': 'マスク＋メガネで対策を！🥽',
        '非常に多い': 'フル装備で！洗濯物は室内干し 🏠',
        '猛烈': '⚠️ 不要不急の外出は控えて 🚫',
    };

    let lines = [];

    if (slot === 'morning') {
        // === 朝のレポート ===
        lines = [
            `🌳 花粉みるみる｜${month}/${day} 朝のレポート`,
            ``,
            `📍 ${CONFIG.CITY_NAME}（${CONFIG.PREF_NAME}）`,
            `${yLevel.emoji} 昨日の飛散量: ${yTotal.toLocaleString()}個`,
            `${yLevel.bar} ${yLevel.label}`,
            `⏰ ピーク: ${yPeakH}時（${yPeakVal}個/時間）`,
            ``,
            forecastFromYesterday(),
            ``,
            `#花粉 #花粉情報 #花粉症 #花粉対策`,
            `🔗 ${CONFIG.SITE_URL}`,
        ];
    } else if (slot === 'noon') {
        // === 昼の速報 ===
        lines = [
            `🌳 花粉みるみる｜${month}/${day} 昼の速報`,
            ``,
            `📍 ${CONFIG.CITY_NAME}（${CONFIG.PREF_NAME}）`,
            `${tLevel.emoji} 午前の飛散量: ${tTotal.toLocaleString()}個`,
            `${tLevel.bar} ${tLevel.label}`,
            tPeakVal > 0 ? `⏰ ピーク: ${tPeakH}時（${tPeakVal}個/時間）` : `⏰ まだピークは来ていません`,
            ``,
            `午後の外出は${tTotal > 100 ? '要注意⚠️' : tTotal > 30 ? 'マスクを忘れずに😷' : '比較的安心です🌱'}`,
            ``,
            `#花粉 #花粉情報 #花粉症 #花粉対策`,
            `🔗 ${CONFIG.SITE_URL}`,
        ];
    } else {
        // === 夜のまとめ ===
        lines = [
            `🌳 花粉みるみる｜${month}/${day} 今日のまとめ`,
            ``,
            `📍 ${CONFIG.CITY_NAME}（${CONFIG.PREF_NAME}）`,
            `${tLevel.emoji} 今日の飛散量: ${tTotal.toLocaleString()}個`,
            `${tLevel.bar} ${tLevel.label}`,
            tPeakVal > 0 ? `⏰ ピーク: ${tPeakH}時（${tPeakVal}個/時間）` : `⏰ 飛散ピークなし`,
            ``,
            `📊 昨日比: ${yTotal > 0 ? (tTotal > yTotal ? `${Math.round(tTotal / yTotal * 100)}%（増加↑）` : `${Math.round(tTotal / yTotal * 100)}%（減少↓）`) : '—'}`,
            ``,
            advice[tLevel.label] || advice['なし'],
            ``,
            `#花粉 #花粉情報 #花粉症 #花粉対策`,
            `🔗 ${CONFIG.SITE_URL}`,
        ];
    }

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
