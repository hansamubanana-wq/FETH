// ゲームのルール部分（馬・オッズ・払い戻し）。ローカルでもオンラインでも共通。
// すべて horseSeed から決定論的に作るので、同じ seed なら全端末で完全一致する。
import { drawHorses } from "./horses.js";
import { simulateOrder } from "./race.js";
import { makeRng } from "./rng.js";
import { buildBetTypes, evalOdds } from "./bets.js";

export const NUM_HORSES = 8; // 出走頭数は8頭固定
export const PLACE_N = 3;    // 8頭なので複勝・ワイドは3着以内
const SIM_RUNS = 3000;       // オッズ算出のシミュレーション回数

// horseSeed から、その回の馬・賭け式・オッズ計算機を作る。
export function buildRace(horseSeed) {
    const horses = drawHorses(NUM_HORSES, makeRng(horseSeed));
    const betTypes = buildBetTypes(PLACE_N).filter((t) => NUM_HORSES >= t.nPick);
    const byKey = Object.fromEntries(betTypes.map((t) => [t.key, t]));

    // オッズ算出用シミュレーション（horseSeed から決定論的に）
    const rng = makeRng((horseSeed ^ 0x9e3779b9) >>> 0);
    const sims = [];
    for (let i = 0; i < SIM_RUNS; i++) sims.push(simulateOrder(horses, rng));

    const oddsFor = (typeKey, sel) => evalOdds(byKey[typeKey], sel, sims);
    return { horses, betTypes, byKey, oddsFor };
}

// 1件の賭けを精算する。bet = { typeKey, sel, amount, odds }。
// orderIds = ゴール順の horse.id 配列。返り値 { delta, detail, won }。
export function settleBet(bet, orderIds, horses, byKey) {
    if (!bet || !bet.typeKey || !bet.amount) {
        return { delta: 0, detail: "賭けなし", won: false };
    }
    const type = byKey[bet.typeKey];
    const label = bet.sel
        .map((id) => horses.find((h) => h.id === id).id + 1)
        .join(type.ordered ? "→" : "・");
    const won = type.test(orderIds, bet.sel);
    if (won) {
        const payout = Math.floor(bet.amount * bet.odds);
        return {
            delta: payout - bet.amount,
            detail: `${type.label} [${label}] ${bet.amount} → 払戻 ${payout}（${bet.odds}倍）`,
            won: true,
        };
    }
    return {
        delta: -bet.amount,
        detail: `${type.label} [${label}] ${bet.amount}（はずれ）`,
        won: false,
    };
}
