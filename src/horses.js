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

// 配列をシャッフルして先頭 n 頭を返す。各馬に基礎能力(power)を付与。
export function drawHorses(n) {
    const pool = [...HORSE_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n).map((h, i) => {
        // 基礎能力。幅を広く取って「強い馬・弱い馬」をはっきりさせる。
        // 0.70 〜 1.55 程度。差が大きいほどオッズの差も大きくなる。
        const power = 0.70 + Math.random() * 0.85;
        return {
            id: i,
            name: h.name,
            emoji: h.emoji,
            color: h.color,
            power,
            backers: [], // この馬に賭けたプレイヤー名
        };
    });
}
