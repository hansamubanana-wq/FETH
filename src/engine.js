// ゲームのルール部分（馬・オッズ・払い戻し）。ローカルでもオンラインでも共通。
// すべて horseSeed から決定論的に作るので、同じ seed なら全端末で完全一致する。
import { drawHorses } from "./horses.js";
import { simulateOrder } from "./race-sim.js";
import { makeRng } from "./rng.js";
import { buildBetTypes } from "./bets.js";

export const NUM_HORSES = 8; // 出走頭数は8頭固定
export const PLACE_N = 3;    // 8頭なので複勝・ワイドは3着以内
const SIM_RUNS = 6000;       // オッズ算出のシミュレーション回数
const PAYOUT = 0.8;          // 払戻率（控除20%）
const ODDS_CAP = 999.9;

// ハーヴィル方式：単勝確率 p から連系の的中確率を解析的に出す（0回でも有限値になる）
function exactaP(p, a, b) { const d = 1 - p[a]; return d > 1e-9 ? p[a] * p[b] / d : 0; }
function trifectaP(p, a, b, c) {
    const d1 = 1 - p[a], d2 = 1 - p[a] - p[b];
    return (d1 > 1e-9 && d2 > 1e-9) ? p[a] * (p[b] / d1) * (p[c] / d2) : 0;
}
const PERM3 = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

// horseSeed から、その回の馬・賭け式・オッズ計算機を作る。
export function buildRace(horseSeed, names = null) {
    const horses = drawHorses(NUM_HORSES, makeRng(horseSeed), names);
    const betTypes = buildBetTypes(PLACE_N).filter((t) => NUM_HORSES >= t.nPick);
    const byKey = Object.fromEntries(betTypes.map((t) => [t.key, t]));

    // オッズ算出用シミュレーション（horseSeed から決定論的に）
    const rng = makeRng((horseSeed ^ 0x9e3779b9) >>> 0);
    const sims = [];
    for (let i = 0; i < SIM_RUNS; i++) sims.push(simulateOrder(horses, rng));

    // 単勝確率（スムージングして 0 を避ける）
    const n = NUM_HORSES;
    const wc = new Array(n).fill(0);
    for (const o of sims) wc[o[0]]++;
    const winP = wc.map((c) => (c + 0.5) / (SIM_RUNS + 0.5 * n));

    const countHits = (pred) => { let h = 0; for (const o of sims) if (pred(o)) h++; return h; };
    const toOdds = (p) => Math.min(ODDS_CAP, Math.max(1.0, Math.round(PAYOUT / p * 10) / 10));
    const empiricalP = (hits) => (hits + 0.5) / (SIM_RUNS + 1);
    // 出目が十分あればシミュ実測（正確）、少なければ確率モデルで補完（999に張り付かせない）
    const MIN_HITS = 8;
    const blended = (hits, harvilleP) =>
        hits >= MIN_HITS ? empiricalP(hits) : Math.max(harvilleP, empiricalP(hits));

    const oddsFor = (typeKey, sel) => {
        switch (typeKey) {
            case "win": return toOdds(winP[sel[0]]);
            case "place": return toOdds(empiricalP(countHits((o) => o.indexOf(sel[0]) < PLACE_N)));
            case "wide": return toOdds(empiricalP(countHits((o) => sel.every((id) => o.indexOf(id) < PLACE_N))));
            case "quinella": {
                const [a, b] = sel;
                const hits = countHits((o) => (o[0] === a && o[1] === b) || (o[0] === b && o[1] === a));
                return toOdds(blended(hits, exactaP(winP, a, b) + exactaP(winP, b, a)));
            }
            case "exacta": {
                const [a, b] = sel;
                return toOdds(blended(countHits((o) => o[0] === a && o[1] === b), exactaP(winP, a, b)));
            }
            case "trio": {
                const set = new Set(sel);
                const hits = countHits((o) => set.has(o[0]) && set.has(o[1]) && set.has(o[2]));
                let hp = 0; for (const [a, b, c] of PERM3) hp += trifectaP(winP, sel[a], sel[b], sel[c]);
                return toOdds(blended(hits, hp));
            }
            case "trifecta": {
                const [a, b, c] = sel;
                const hits = countHits((o) => o[0] === a && o[1] === b && o[2] === c);
                return toOdds(blended(hits, trifectaP(winP, a, b, c)));
            }
            default: return toOdds(empiricalP(countHits((o) => byKey[typeKey].test(o, sel))));
        }
    };
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

// このレース結果で、各賭け式ごとの「一番儲かる的中買い目」を求める。
// 返り値: [{ label, combo, odds }]（単勝→…→3連単の順）。
export function bestPerType(orderIds, engine) {
    const { byKey, oddsFor } = engine;
    const [o0, o1, o2] = orderIds;
    const top = orderIds.slice(0, PLACE_N);
    const rows = [];

    const fixed = (key, sel) => {
        const t = byKey[key];
        if (!t) return;
        rows.push({ label: t.label, combo: sel.map((id) => id + 1).join(t.ordered ? "→" : "・"), odds: oddsFor(key, sel) });
    };
    // 複勝・ワイドのように的中候補が複数ある式は、最高オッズの組を選ぶ
    const best = (key, candidates) => {
        const t = byKey[key];
        if (!t) return;
        let b = null;
        for (const sel of candidates) {
            const od = oddsFor(key, sel);
            if (!b || od > b.od) b = { sel, od };
        }
        rows.push({ label: t.label, combo: b.sel.map((id) => id + 1).join(t.ordered ? "→" : "・"), odds: b.od });
    };

    fixed("win", [o0]);
    best("place", top.map((h) => [h]));
    fixed("quinella", [o0, o1]);
    fixed("exacta", [o0, o1]);
    const pairs = [];
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) pairs.push([top[i], top[j]]);
    best("wide", pairs);
    fixed("trio", [o0, o1, o2]);
    fixed("trifecta", [o0, o1, o2]);
    return rows;
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
