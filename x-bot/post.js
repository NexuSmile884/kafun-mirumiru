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

// ========== Season helpers ==========
// 本州低地の代表的な花粉カレンダー
const SEASONS = [
    { startMonth: 2,  endMonth: 4,  name: 'スギ花粉',    tag: '#スギ花粉'    },
    { startMonth: 3,  endMonth: 5,  name: 'ヒノキ花粉',  tag: '#ヒノキ花粉'  },
    { startMonth: 5,  endMonth: 8,  name: 'イネ科花粉',  tag: '#イネ科花粉'  },
    { startMonth: 8,  endMonth: 10, name: 'ブタクサ花粉', tag: '#ブタクサ花粉' },
];

function getCurrentSeason(date = new Date()) {
    const m = date.getMonth() + 1;
    const active = SEASONS.filter(s => m >= s.startMonth && m <= s.endMonth);
    if (active.length === 0) {
        return { name: 'オフシーズン', tag: '#花粉症対策', isOff: true };
    }
    return { ...active[active.length - 1], isOff: false };
}

function getNextSeasonStart(date = new Date()) {
    const y = date.getFullYear();
    const candidates = SEASONS
        .map(s => ({ ...s, start: new Date(y, s.startMonth - 1, 1) }))
        .filter(s => s.start > date);
    if (candidates.length > 0) {
        const next = candidates[0];
        const days = Math.ceil((next.start - date) / 86400000);
        return { name: next.name, days };
    }
    // 翌年の最初のシーズン
    const first = SEASONS[0];
    const start = new Date(y + 1, first.startMonth - 1, 1);
    const days = Math.ceil((start - date) / 86400000);
    return { name: first.name, days };
}

// ========== Hashtag generator ==========
function getHashtags(season, dayOfWeek, slot) {
    const base = ['#花粉', '#花粉症'];
    const region = [`#${CONFIG.PREF_NAME}`, `#${CONFIG.CITY_NAME}`];
    const seasonal = [season.tag];
    // 曜日でローテーション（同じ tag を毎日使わない）
    const rotating = [
        '#花粉飛散情報', '#花粉対策', '#マスク生活', '#花粉日記',
        '#花粉ピーク', '#花粉症あるある', '#今日の花粉',
    ];
    const dayTag = rotating[dayOfWeek % rotating.length];
    return [...base, ...region, ...seasonal, dayTag].join(' ');
}

function getCTA(dayOfWeek, slot) {
    // 週末 (土日) の朝のみフォロー誘導
    if ((dayOfWeek === 0 || dayOfWeek === 6) && slot === 'morning') {
        return '🔔 フォローで毎朝の花粉予報をお届け';
    }
    return null;
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
    const force = process.env.FORCE_SLOT;
    if (force === 'morning' || force === 'noon' || force === 'night') return force;
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
    const dow = now.getDay();
    const season = getCurrentSeason(now);
    const hashtags = getHashtags(season, dow, slot);
    const cta = getCTA(dow, slot);

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
        ];
    }

    if (cta) lines.push(``, cta);
    lines.push(``, hashtags, `🔗 ${CONFIG.SITE_URL}`);

    return lines.join('\n');
}

// ========== Off-season post (low-pollen periods) ==========
// 直近7日合計が非常に少ないときに「次のシーズンまで」型で配信
function buildOffSeasonPost(recent7Total) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const dow = now.getDay();
    const season = getCurrentSeason(now);
    const next = getNextSeasonStart(now);
    const hashtags = getHashtags(season, dow, 'morning');
    const tips = [
        '・空気清浄機のフィルター点検タイミング',
        '・寝具を週1で天日干し（オフ期だからこそ徹底）',
        '・通年型アレルギーならハウスダスト対策の見直し',
        '・耳鼻科で次シーズンに備えた減感作療法の相談',
        '・室内の花粉持込を防ぐコート用ブラシを玄関に',
        '・換気は朝晩の短時間（ピーク時間を避ける）',
    ];
    const tipOfDay = tips[dow % tips.length];

    const lines = [
        `🌳 花粉みるみる｜${month}/${day} 朝のオフシーズン便り`,
        ``,
        `📍 ${CONFIG.CITY_NAME}（${CONFIG.PREF_NAME}）`,
        `😊 直近7日の飛散量: ${recent7Total}個（ほぼなし）`,
        ``,
        `📅 次の本格シーズン「${next.name}」まで約 ${next.days} 日`,
        ``,
        `🛡 今日のオフ期 tip:`,
        tipOfDay,
        ``,
        `🔔 シーズン入りで毎日朝の花粉予報を再開します`,
        ``,
        hashtags,
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

    try {
        const result = await client.v2.tweet(text);
        return result;
    } catch (err) {
        console.error('━━━━━━━━━━ X API Error Detail ━━━━━━━━━━');
        if (err.code !== undefined) console.error(`HTTP code : ${err.code}`);
        if (err.data !== undefined) console.error(`Response  : ${JSON.stringify(err.data, null, 2)}`);
        if (err.errors !== undefined) console.error(`Errors    : ${JSON.stringify(err.errors, null, 2)}`);
        if (err.rateLimit !== undefined) console.error(`RateLimit : ${JSON.stringify(err.rateLimit)}`);
        if (err.headers !== undefined) {
            const h = err.headers;
            const picked = {
                'x-rate-limit-remaining': h['x-rate-limit-remaining'],
                'x-rate-limit-reset': h['x-rate-limit-reset'],
                'x-access-level': h['x-access-level'],
                'x-app-limit-24hour-remaining': h['x-app-limit-24hour-remaining'],
            };
            console.error(`Headers   : ${JSON.stringify(picked)}`);
        }
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        throw err;
    }
}

// オフシーズン閾値: 直近7日合計がこれ以下なら「ほぼ飛んでない」扱い
// env で上書き可能（季節調整・テスト用）
const OFF_SEASON_7DAY_TOTAL = parseInt(process.env.OFF_SEASON_7DAY_TOTAL || '5', 10);
const FORCE_OFFSEASON = process.env.FORCE_OFFSEASON === 'true';

// ========== Main ==========
async function main() {
    console.log('🌳 花粉みるみる X Auto-Post');
    console.log(`📍 ${CONFIG.CITY_NAME} (${CONFIG.CITY_CODE})`);
    console.log(`🔧 Dry run: ${CONFIG.DRY_RUN}`);
    console.log('');

    // Fetch data: 直近7日 + 今日
    const today = dayStart();
    const yesterday = addDays(today, -1);
    const sevenDaysAgo = addDays(today, -7);
    const data = await fetchPollen(sevenDaysAgo, today);

    const validRows = data.filter(d => d.pollen !== CONFIG.NO_DATA);
    const yesterdayRows = validRows.filter(d => d.date >= yesterday && d.date < today);
    const todayRows = validRows.filter(d => d.date >= today);
    const recent7Rows = validRows.filter(d => d.date >= sevenDaysAgo && d.date < today);
    const recent7Total = recent7Rows.reduce((s, d) => s + Math.max(0, d.pollen), 0);

    const slot = getTimeSlot();
    const isOffSeason = FORCE_OFFSEASON || recent7Total <= OFF_SEASON_7DAY_TOTAL;

    console.log(`📊 直近7日合計: ${recent7Total}個 / オフシーズン: ${isOffSeason} / slot: ${slot}`);

    let text;
    if (isOffSeason) {
        // オフシーズン中は朝のみ「次のシーズンまで」型を投稿、他はスキップ
        if (slot !== 'morning') {
            console.log('💤 オフシーズンの昼/夜枠は投稿スキップ（クレジット節約）');
            return;
        }
        text = buildOffSeasonPost(recent7Total);
    } else {
        if (yesterdayRows.length === 0) {
            console.log('⚠️ 昨日のデータがありません。投稿をスキップします。');
            return;
        }
        text = buildPost(yesterdayRows, todayRows);
    }

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
    if (err.data !== undefined) {
        console.error('Response data:', JSON.stringify(err.data, null, 2));
    }
    if (err.stack) {
        console.error('Stack:', err.stack);
    }
    process.exit(1);
});
