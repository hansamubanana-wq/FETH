// 賭け式の定義。
// nPick: 選ぶ頭数 / ordered: 着順通りに選ぶか / test(order, sel): 的中判定
//   order = ゴール順の horse.id 配列、sel = プレイヤーが選んだ horse.id 配列
// placeN は「複勝/ワイドで何着以内なら当たりか」。出走頭数に応じて main 側から渡す。
export function buildBetTypes(placeN) {
    return [
        {
            key: "win", label: "単勝", nPick: 1, ordered: false,
            desc: "1着になる馬を当てる",
            instruction: "1着になると思う馬をタップ",
            test: (order, sel) => order[0] === sel[0],
        },
        {
            key: "place", label: "複勝", nPick: 1, ordered: false,
            desc: `選んだ馬が${placeN}着以内に入れば当たり`,
            instruction: `${placeN}着以内に入ると思う馬をタップ`,
            test: (order, sel) => order.indexOf(sel[0]) < placeN,
        },
        {
            key: "quinella", label: "馬連", nPick: 2, ordered: false,
            desc: "1・2着になる2頭を順不同で当てる",
            instruction: "1・2着に入る2頭をタップ（順不同）",
            test: (order, sel) => sel.every((id) => order.indexOf(id) < 2),
        },
        {
            key: "exacta", label: "馬単", nPick: 2, ordered: true,
            desc: "1着→2着を着順通りに当てる",
            instruction: "1着→2着の順にタップ",
            test: (order, sel) => order[0] === sel[0] && order[1] === sel[1],
        },
        {
            key: "wide", label: "ワイド", nPick: 2, ordered: false,
            desc: `選んだ2頭がともに${placeN}着以内なら当たり`,
            instruction: `ともに${placeN}着以内に入る2頭をタップ`,
            test: (order, sel) => sel.every((id) => order.indexOf(id) < placeN),
        },
        {
            key: "trio", label: "3連複", nPick: 3, ordered: false,
            desc: "1〜3着になる3頭を順不同で当てる",
            instruction: "1〜3着に入る3頭をタップ（順不同）",
            test: (order, sel) => sel.every((id) => order.indexOf(id) < 3),
        },
        {
            key: "trifecta", label: "3連単", nPick: 3, ordered: true,
            desc: "1着→2着→3着を着順通りに当てる",
            instruction: "1着→2着→3着の順にタップ",
            test: (order, sel) =>
                order[0] === sel[0] && order[1] === sel[1] && order[2] === sel[2],
        },
    ];
}

const PAYOUT_RATE = 0.8; // 控除率20%（払戻率80%）
const ODDS_CAP = 999.9;

// シミュレーション結果(simOrders)から、賭けの的中確率→オッズを算出する。
export function evalOdds(betType, sel, simOrders) {
    if (sel.length < betType.nPick) return null;
    let hit = 0;
    for (const order of simOrders) {
        if (betType.test(order, sel)) hit++;
    }
    const p = hit / simOrders.length;
    if (p <= 0) return ODDS_CAP;
    const odds = PAYOUT_RATE / p;
    return Math.min(ODDS_CAP, Math.max(1.0, Math.round(odds * 10) / 10));
}
