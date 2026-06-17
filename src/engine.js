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

// このレース結果で「一番儲かった買い目（最高配当の的中券）」を求める。
// orderIds = ゴール順の horse.id 配列。返り値 { label, combo, odds }。
export function bestBet(orderIds, engine) {
    const { byKey, oddsFor } = engine;
    const [o0, o1, o2] = orderIds;
    const top = orderIds.slice(0, PLACE_N);
    const cands = [];
    const add = (key, sel) => { if (byKey[key]) cands.push({ type: byKey[key], sel, odds: oddsFor(key, sel) }); };

    add("win", [o0]);
    top.forEach((h) => add("place", [h]));        // 複勝は的中する各馬から最高配当を拾う
    add("quinella", [o0, o1]);
    add("exacta", [o0, o1]);
    for (let i = 0; i < top.length; i++)          // ワイドは上位内の全ペア
        for (let j = i + 1; j < top.length; j++) add("wide", [top[i], top[j]]);
    add("trio", [o0, o1, o2]);
    add("trifecta", [o0, o1, o2]);

    let best = cands[0];
    for (const c of cands) if (c.odds > best.odds) best = c;
    const combo = best.sel.map((id) => id + 1).join(best.type.ordered ? "→" : "・");
    return { label: best.type.label, combo, odds: best.odds };
}

// 複数枚の馬券をまとめて精算する。tickets = [{typeKey,sel,amount,odds}, ...]。
// 返り値 { delta, detail }（delta は合計の増減）。
export function settleTickets(tickets, orderIds, horses, byKey) {
    if (!tickets || !tickets.length) return { delta: 0, detail: "賭けなし" };
    let delta = 0;
    const parts = [];
    for (const t of tickets) {
        const r = settleBet(t, orderIds, horses, byKey);
        delta += r.delta;
        parts.push(r.detail);
    }
    return { delta, detail: parts.join(" ／ ") };
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
