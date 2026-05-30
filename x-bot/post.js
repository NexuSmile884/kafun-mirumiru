/**
 * 花粉みるみる — X自動投稿ボット
 * WxTech APIで花粉データ取得 → 全国主要都市をローテーションして本文生成 → X API v2で投稿
 *
 * 配信戦略（2026-05 改修）:
 *  - 本文はその日の対象都市の「実データ」で毎回ユニーク化（コピペ判定回避＋地名で検索/クラスタに乗る）
 *  - サイトへのリンクは本文に貼らず「自己リプライ」へ逃がす（無課金アカの本文リンクは配信が死ぬため）
 *  - 起動時に 0〜N 分の jitter（固定時刻×固定内容の旧型botシグナルを消す）
 */

const { TwitterApi } = require('twitter-api-v2');
require('dotenv').config();

// ========== Config ==========
const CONFIG = {
    API_BASE: 'https://wxtech.weathernews.com/opendata/v1/pollen',
    NO_DATA: -9999,
    SITE_URL: 'https://nexusmile884.github.io/kafun-mirumiru/',
    DRY_RUN: process.env.DRY_RUN === 'true',
};

// 全国主要都市ローテーション（各都市とも WxTech 観測局あり・データ実在を確認済み 2026-05）
// 1日のうち朝/昼/夜は同一都市、日替わりで巡回（北海道→東北→関東→中部→関西→九州）
const CITIES = [
    { code: '01101', name: '札幌市中央区', pref: '北海道' },
    { code: '04101', name: '仙台市青葉区', pref: '宮城県' },
    { code: '13104', name: '新宿区',       pref: '東京都' },
    { code: '14103', name: '横浜市西区',   pref: '神奈川県' },
    { code: '23106', name: '名古屋市中区', pref: '愛知県' },
    { code: '27128', name: '大阪市中央区', pref: '大阪府' },
    { code: '40133', name: '福岡市中央区', pref: '福岡県' },
];

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

function dayOfYear(d = new Date()) {
    return Math.floor((dayStart(d) - new Date(d.getFullYear(), 0, 0)) / 86400000);
}

// その日の対象都市を決定（日替わりローテ）。FORCE_CITY=コード でテスト上書き可
function pickCity(d = new Date()) {
    const force = process.env.FORCE_CITY;
    if (force) {
        return CITIES.find(c => c.code === force) || { code: force, name: force, pref: '' };
    }
    return CITIES[dayOfYear(d) % CITIES.length];
}

// ========== Hashtag generator ==========
// X 公式は本文中のハッシュタグを 1〜2 個に絞ることを推奨（多すぎはアルゴ評価ダウン）
function getHashtags() {
    return '#花粉情報 #花粉症対策';
}

// リンクは本文に貼らず「自己リプライ」に逃がす。本文で扱った都市を直接開くディープリンク
function buildReply(city) {
    return `全国どの市区町村でもチェックできます👇\n${CONFIG.SITE_URL}?city=${city.code}`;
}

// ========== Fetch pollen data ==========
async function fetchPollen(cityCode, start, end) {
    const url = `${CONFIG.API_BASE}?citycode=${cityCode}&start=${fmt(start)}&end=${fmt(end)}`;
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

function buildPost(city, yesterdayRows, todayRows) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const slot = getTimeSlot();
    const hashtags = getHashtags();
    const place = `📍 ${city.pref} ${city.name}`;

    // 昨日の統計
    const yTotal = yesterdayRows.reduce((s, d) => s + Math.max(0, d.pollen), 0);
    const yLevel = getDailyLevel(yTotal);
    let yPeakVal = 0, yPeakH = 0;
    yesterdayRows.forEach(d => { if (d.pollen > yPeakVal) { yPeakVal = d.pollen; yPeakH = d.date.getHours(); } });

    // 今日の統計
    const tTotal = todayRows.reduce((s, d) => s + Math.max(0, d.pollen), 0);
    const tLevel = getDailyLevel(tTotal);
    let tPeakVal = 0, tPeakH = 0;
    todayRows.forEach(d => { if (d.pollen > tPeakVal) { tPeakVal = d.pollen; tPeakH = d.date.getHours(); } });

    // 昨日の飛散量からの今日の見込み
    const forecast =
        yTotal <= 0   ? '📊 今日も飛散は少ない見込みです' :
        yTotal <= 30  ? '📊 今日も少なめの見込み。油断せずに' :
        yTotal <= 100 ? '📊 今日もやや多い見込み。マスク推奨' :
        yTotal <= 200 ? '📈 今日も多い見込み！しっかり対策を' :
        yTotal <= 400 ? '📈 今日も非常に多い見込み！フル装備で' :
                        '🚨 今日も猛烈な飛散の見込み！外出注意';

    const advice = {
        'なし': '花粉はほぼなし。快適！🌤',
        '少ない': '油断せずに 🌱',
        'やや多い': 'マスク推奨 😷',
        '多い': 'マスク＋メガネで対策を！🥽',
        '非常に多い': 'フル装備で！洗濯物は室内干し 🏠',
        '猛烈': '⚠️ 不要不急の外出は控えて 🚫',
    };

    let lines;
    if (slot === 'morning') {
        lines = [
            `🌳 ${month}/${day} 朝の花粉レポート`,
            ``,
            place,
            `${yLevel.emoji} 昨日の飛散量: ${yTotal.toLocaleString()}個`,
            `${yLevel.bar} ${yLevel.label}`,
            `⏰ ピーク: ${yPeakH}時（${yPeakVal}個/時間）`,
            ``,
            forecast,
        ];
    } else if (slot === 'noon') {
        lines = [
            `🌳 ${month}/${day} 昼の花粉速報`,
            ``,
            place,
            `${tLevel.emoji} 午前の飛散量: ${tTotal.toLocaleString()}個`,
            `${tLevel.bar} ${tLevel.label}`,
            tPeakVal > 0 ? `⏰ ピーク: ${tPeakH}時（${tPeakVal}個/時間）` : `⏰ まだピークは来ていません`,
            ``,
            `午後の外出は${tTotal > 100 ? '要注意⚠️' : tTotal > 30 ? 'マスクを忘れずに😷' : '比較的安心です🌱'}`,
        ];
    } else {
        lines = [
            `🌳 ${month}/${day} 今日の花粉まとめ`,
            ``,
            place,
            `${tLevel.emoji} 今日の飛散量: ${tTotal.toLocaleString()}個`,
            `${tLevel.bar} ${tLevel.label}`,
            tPeakVal > 0 ? `⏰ ピーク: ${tPeakH}時（${tPeakVal}個/時間）` : `⏰ 飛散ピークなし`,
            ``,
            `📊 昨日比: ${yTotal > 0 ? (tTotal > yTotal ? `${Math.round(tTotal / yTotal * 100)}%（増加↑）` : `${Math.round(tTotal / yTotal * 100)}%（減少↓）`) : '—'}`,
            advice[tLevel.label] || advice['なし'],
        ];
    }

    lines.push(``, hashtags);
    return lines.join('\n');
}

// ========== Off-season post (low-pollen periods) ==========
// オフ判定都市の数値は出さず、全国版チェッカーへの誘導を中心にした軽量投稿
function buildOffSeasonPost(city) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const hashtags = getHashtags();
    const lines = [
        `🌳 ${month}/${day} 花粉オフシーズン便り`,
        ``,
        `📍 ${city.pref} ${city.name} は飛散が落ち着いています`,
        `今は全国的に花粉が少ない時期。`,
        `住んでいる市区町村の今日・昨日・7日間の推移は、いつでもチェックできます。`,
        ``,
        hashtags,
    ];
    return lines.join('\n');
}

// ========== Post to X (2段投稿: 本文 → 自己リプライにリンク) ==========
async function postToX(text, replyText) {
    const client = new TwitterApi({
        appKey: process.env.X_API_KEY,
        appSecret: process.env.X_API_SECRET,
        accessToken: process.env.X_ACCESS_TOKEN,
        accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
    });

    try {
        const main = await client.v2.tweet(text);
        let replyId = null;
        if (replyText) {
            try {
                const r = await client.v2.reply(replyText, main.data.id);
                replyId = r.data.id;
            } catch (e) {
                // リプライ失敗は本文投稿を無効化しない（リンクだけ欠ける）
                console.error('⚠️ リンクのリプライ投稿に失敗（本文は投稿済み）:', e.message);
            }
        }
        return { mainId: main.data.id, replyId };
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
// データ欠損ガード: 直近7日(168時間)中、最低これだけ有効データがないと判定不能扱い
// API 失敗時に validRows=[] → recent7Total=0 でオフシーズン誤投稿するのを防ぐ
const MIN_RECENT_VALID_ROWS = parseInt(process.env.MIN_RECENT_VALID_ROWS || '24', 10);
// 投稿時刻の jitter（分）: 固定時刻×固定内容は旧型botシグナル。0〜N分のランダム遅延を入れる
const JITTER_MAX_MIN = parseInt(process.env.JITTER_MAX_MIN || '20', 10);

// ========== Main ==========
async function main() {
    const city = pickCity();
    console.log('🌳 花粉みるみる X Auto-Post');
    console.log(`📍 ${city.pref} ${city.name} (${city.code})`);
    console.log(`🔧 Dry run: ${CONFIG.DRY_RUN}`);

    // 投稿時刻の jitter（DRY_RUN 時は待たない）
    if (!CONFIG.DRY_RUN && JITTER_MAX_MIN > 0) {
        const ms = Math.floor(Math.random() * JITTER_MAX_MIN * 60 * 1000);
        console.log(`⏳ jitter: ${Math.round(ms / 1000)}秒待機してから投稿`);
        await new Promise(r => setTimeout(r, ms));
    }
    console.log('');

    // Fetch data: 直近7日 + 今日
    const today = dayStart();
    const yesterday = addDays(today, -1);
    const sevenDaysAgo = addDays(today, -7);
    const data = await fetchPollen(city.code, sevenDaysAgo, today);

    const validRows = data.filter(d => d.pollen !== CONFIG.NO_DATA);
    const yesterdayRows = validRows.filter(d => d.date >= yesterday && d.date < today);
    const todayRows = validRows.filter(d => d.date >= today);
    const recent7Rows = validRows.filter(d => d.date >= sevenDaysAgo && d.date < today);
    const recent7Total = recent7Rows.reduce((s, d) => s + Math.max(0, d.pollen), 0);

    const slot = getTimeSlot();

    // データ欠損ガード（FORCE_OFFSEASON 時はテスト目的なのでスキップ）
    if (!FORCE_OFFSEASON && recent7Rows.length < MIN_RECENT_VALID_ROWS) {
        console.log(`⚠️ 有効データ不足 (${recent7Rows.length}/${MIN_RECENT_VALID_ROWS} 行)。判定不能のため投稿スキップ`);
        return;
    }

    const isOffSeason = FORCE_OFFSEASON || recent7Total <= OFF_SEASON_7DAY_TOTAL;
    console.log(`📊 直近7日合計: ${recent7Total}個 (有効${recent7Rows.length}行) / オフシーズン: ${isOffSeason} / slot: ${slot}`);

    let text;
    if (isOffSeason) {
        // オフシーズン中は朝のみ軽量投稿、昼/夜はスキップ（クレジット節約）
        if (slot !== 'morning') {
            console.log('💤 オフシーズンの昼/夜枠は投稿スキップ（クレジット節約）');
            return;
        }
        text = buildOffSeasonPost(city);
    } else {
        if (yesterdayRows.length === 0) {
            console.log('⚠️ 昨日のデータがありません。投稿をスキップします。');
            return;
        }
        text = buildPost(city, yesterdayRows, todayRows);
    }

    const replyText = buildReply(city);

    console.log('📝 投稿内容:');
    console.log('─'.repeat(40));
    console.log(text);
    console.log('  ↳（リプライ）');
    console.log(replyText);
    console.log('─'.repeat(40));
    console.log(`📏 本文文字数: ${text.length}/280`);

    if (CONFIG.DRY_RUN) {
        console.log('\n✅ ドライラン完了（実際には投稿されていません）');
        return;
    }

    // Validate API keys
    if (!process.env.X_API_KEY || !process.env.X_API_SECRET) {
        console.error('❌ X API キーが設定されていません。.env を確認してください。');
        process.exit(1);
    }

    const { mainId, replyId } = await postToX(text, replyText);
    console.log(`\n✅ 投稿完了! Tweet ID: ${mainId}${replyId ? ` / リプライ: ${replyId}` : ' / リプライ失敗'}`);
    console.log(`🔗 https://x.com/kafun_mirumiru/status/${mainId}`);
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
