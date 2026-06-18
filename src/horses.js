// 馬のプール。出走数に応じてここから抽選する。
export const HORSE_POOL = [
    { name: "サクラボルト", emoji: "🐎", color: "#e57373" },
    { name: "ミドリノカゼ", emoji: "🐎", color: "#81c784" },
    { name: "アオイナミ", emoji: "🐎", color: "#64b5f6" },
    { name: "コガネスター", emoji: "🐎", color: "#ffd54f" },
    { name: "ムラサキデンセツ", emoji: "🐎", color: "#ba68c8" },
    { name: "シロイナギサ", emoji: "🐎", color: "#e0e0e0" },
    { name: "アカツキロウ", emoji: "🐎", color: "#ff8a65" },
    { name: "クロガネオー", emoji: "🐎", color: "#90a4ae" },
    { name: "ソラトビウマ", emoji: "🐎", color: "#4dd0e1" },
    { name: "ハナビリュウ", emoji: "🐎", color: "#f06292" },
    { name: "イナズマケン", emoji: "🐎", color: "#fff176" },
    { name: "モリノセンシ", emoji: "🐎", color: "#aed581" },
];

// 脚質。profile(t) は進行度 t(0=スタート,1=ゴール) に対する速度倍率。
// どの脚質も平均は約1.0になるよう設計し、得意なタイミングが違うだけにしてある。
// 緩急を大きめにして、前半と後半で大きく順位が入れ替わる（追い抜きが激しい）展開にする。
export const STYLES = {
    nige: { key: "nige", label: "逃げ", desc: "前半で大きくリード", profile: (t) => 1.34 - 0.68 * t },
    senko: { key: "senko", label: "先行", desc: "前めにつけて押し切る", profile: (t) => 1.16 - 0.32 * t },
    sashi: { key: "sashi", label: "差し", desc: "後半にぐっと伸びる", profile: (t) => 0.84 + 0.32 * t },
    oikomi: { key: "oikomi", label: "追込", desc: "最後方から大外一気", profile: (t) => 0.64 + 0.72 * t },
};
const STYLE_KEYS = Object.keys(STYLES);

// 特殊能力（ブースト）。レース中の進行度 t がトリガー区間に入ると速度が boost 分上がる。
// 発動タイミングはレースごとに乱数でズレるので、毎回違う見せ場が生まれる。
export const ABILITIES = [
    { key: "dash", label: "好スタート", lo: 0.00, hi: 0.08, dur: 0.16, boost: 0.30 },
    { key: "spurt", label: "末脚", lo: 0.60, hi: 0.76, dur: 0.22, boost: 0.42 },
    { key: "makuri", label: "まくり", lo: 0.38, hi: 0.54, dur: 0.20, boost: 0.34 },
    { key: "ippatsu", label: "一発", lo: 0.20, hi: 0.74, dur: 0.15, boost: 0.55 },
];

// 配列をシャッフルして先頭 n 頭を返す。各馬に基礎能力(power)・脚質・特殊能力を付与。
// rng を渡すと決定論的に生成できる。names を渡すと馬名を上書きできる（共有プール用）。
export function drawHorses(n, rng = Math.random, names = null) {
    const pool = [...HORSE_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n).map((h, i) => {
        // 基礎能力。馬ごとの差を出しつつ、開きすぎないよう幅は控えめに。
        const power = 0.90 + rng() * 0.28;
        const style = STYLES[STYLE_KEYS[Math.floor(rng() * STYLE_KEYS.length)]];
        // 約65%の馬が特殊能力を持つ
        const ability = rng() < 0.65 ? ABILITIES[Math.floor(rng() * ABILITIES.length)] : null;
        return {
            id: i,
            name: (names && names[i]) ? names[i] : h.name,
            emoji: h.emoji,
            color: h.color,
            power,
            style,
            ability,
            backers: [],
        };
    });
}
