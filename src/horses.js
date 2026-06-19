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

// 脚質。profile(t) は進行度 t(0=スタート,1=ゴール) に対する速度倍率。stamina はメーター表示用。
export const STYLES = {
    nige: { key: "nige", label: "逃げ", desc: "前半で大きくリード", stamina: 0.2, profile: (t) => 1.34 - 0.68 * t },
    senko: { key: "senko", label: "先行", desc: "前めにつけて押し切る", stamina: 0.45, profile: (t) => 1.16 - 0.32 * t },
    sashi: { key: "sashi", label: "差し", desc: "後半にぐっと伸びる", stamina: 0.7, profile: (t) => 0.84 + 0.32 * t },
    oikomi: { key: "oikomi", label: "追込", desc: "最後方から大外一気", stamina: 0.92, profile: (t) => 0.64 + 0.72 * t },
};
const STYLE_KEYS = Object.keys(STYLES);

// 特殊能力（ブースト）。全馬が必ず1つ持つ。proc=発動確率（レースごとに判定）。
//   lo..hi: 発動位置の範囲 / dur: 効果が続く進行度 / boost: 発動中の加速率
//   penalty: 常時かかる弱体（1未満で常に少し遅い）/ fizzle: 不発の日の弱体（1未満で不発時に遅い）
// 「出れば最強だが低確率」「強いがデメリットあり」などの個性を表現する。
export const ABILITIES = [
    { key: "dash", label: "好スタート", desc: "序盤に加速。安定して出やすい", proc: 0.75, lo: 0.00, hi: 0.08, dur: 0.16, boost: 0.30 },
    { key: "spurt", label: "末脚", desc: "終盤にぐっと伸びる", proc: 0.70, lo: 0.60, hi: 0.76, dur: 0.22, boost: 0.42 },
    { key: "nibashin", label: "二の脚", desc: "中盤で再加速", proc: 0.65, lo: 0.45, hi: 0.60, dur: 0.18, boost: 0.34 },
    { key: "stayer", label: "持久力", desc: "長く安定して伸び続ける（控えめ）", proc: 0.85, lo: 0.30, hi: 0.45, dur: 0.42, boost: 0.18 },
    { key: "makuri", label: "まくり", desc: "中盤に外から押し上げる", proc: 0.55, lo: 0.38, hi: 0.54, dur: 0.20, boost: 0.40 },
    { key: "clutch", label: "勝負強さ", desc: "ゴール前で渾身の伸び", proc: 0.45, lo: 0.80, hi: 0.90, dur: 0.16, boost: 0.55 },
    { key: "oonige", label: "大逃げ", desc: "序盤に大きく飛ばすが終始やや重い", proc: 0.60, lo: 0.00, hi: 0.06, dur: 0.28, boost: 0.55, penalty: 0.95 },
    { key: "mura", label: "ムラ脚", desc: "ハマれば強いが、出ない日は不振", proc: 0.50, lo: 0.45, hi: 0.70, dur: 0.22, boost: 0.58, fizzle: 0.88 },
    { key: "ippatsu", label: "一発", desc: "低確率だが超加速", proc: 0.20, lo: 0.20, hi: 0.75, dur: 0.18, boost: 0.95 },
    { key: "monster", label: "怪物", desc: "めったに出ないが、出れば手がつけられない", proc: 0.12, lo: 0.28, hi: 0.70, dur: 0.30, boost: 1.25, penalty: 0.96 },
];

// 調子（コンディション）のラベル。c は 0..1。
function conditionLabel(c) {
    if (c >= 0.8) return { label: "絶好調", mark: "◎" };
    if (c >= 0.6) return { label: "好調", mark: "○" };
    if (c >= 0.4) return { label: "普通", mark: "△" };
    if (c >= 0.2) return { label: "平凡", mark: "▲" };
    return { label: "不調", mark: "✕" };
}

// 配列をシャッフルして先頭 n 頭を返す。各馬に基礎能力(power)・脚質・特殊能力・調子・
// 表示用ステータスを付与。rng で決定論的、names で馬名上書き可。
export function drawHorses(n, rng = Math.random, names = null) {
    const pool = [...HORSE_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n).map((h, i) => {
        const power = 0.90 + rng() * 0.28;                 // 基礎能力
        const style = STYLES[STYLE_KEYS[Math.floor(rng() * STYLE_KEYS.length)]];
        const ability = ABILITIES[Math.floor(rng() * ABILITIES.length)];
        const condition = rng();                           // この回の調子 0..1
        const cl = conditionLabel(condition);
        // 表示メーター（すべて実際の挙動を決める値から算出＝見た目通りに走る）
        const stats = {
            speed: (power - 0.90) / 0.28,                   // スピード ← 基礎能力
            stamina: style.stamina,                         // スタミナ ← 脚質
            kick: Math.min(1, ability.boost / 1.25),        // 瞬発力 ← 特殊能力の最大加速
            condition,                                      // 調子
        };
        return {
            id: i,
            name: (names && names[i]) ? names[i] : h.name,
            emoji: h.emoji,
            color: h.color,
            power, style, ability,
            condition, condLabel: cl.label, condMark: cl.mark,
            stats,
            backers: [],
        };
    });
}
