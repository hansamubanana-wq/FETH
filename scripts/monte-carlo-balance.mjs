import { drawHorses } from "../src/horses.js";
import { makeRng } from "../src/rng.js";
import { simulateOrder, simulateRaceData } from "../src/race-sim.js";

const CARDS = 100;
const RANK_RUNS = 1200;
const RACES_PER_CARD = 50;
const OLD_DT = 1 / 60;
const TRACK_LEN = 820;

function oldInit(h, rng) {
    return {
        id: h.id, perf: h.power * (1 + (rng() - 0.5) * 0.48), style: h.style,
        ability: h.ability, active: rng() < h.ability.proc,
        trigger: h.ability.lo + rng() * (h.ability.hi - h.ability.lo), x: 0, done: false,
    };
}

function oldSpeed(r, rng) {
    const t = r.x / TRACK_LEN;
    let pace = r.style.profile(Math.min(1, Math.max(0, t))) * (r.ability.penalty || 1);
    if (r.active && t >= r.trigger && t <= r.trigger + r.ability.dur) pace *= 1 + r.ability.boost;
    else if (!r.active) pace *= r.ability.fizzle || 1;
    return Math.max(30, 190 * r.perf * pace + (rng() - 0.5) * 200);
}

function oldRace(horses, rng) {
    const runners = horses.map((h) => oldInit(h, rng));
    const times = Array(runners.length).fill(null);
    let remaining = runners.length;
    let time = 0;
    while (remaining) {
        time += OLD_DT;
        runners.forEach((r, i) => {
            if (r.done) return;
            const speed = oldSpeed(r, rng);
            r.x += speed * OLD_DT;
            if (r.x >= TRACK_LEN) {
                times[i] = time - (r.x - TRACK_LEN) / speed;
                r.done = true;
                remaining--;
            }
        });
    }
    const order = runners.map((_, i) => i).sort((a, b) => times[a] - times[b]);
    return { order, times };
}

function percentile(sorted, p) {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function summarize(name, counters) {
    const gaps = counters.gaps.sort((a, b) => a - b);
    return {
        model: name,
        races: counters.total,
        favoriteWinRate: counters.favoriteWins / counters.total,
        favoriteTop3Rate: counters.favoriteTop3 / counters.total,
        longshotWinRate: counters.longshotWins / counters.total,
        averageFirstLastGapSeconds: gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length,
        p95FirstLastGapSeconds: percentile(gaps, 0.95),
        maxFirstLastGapSeconds: gaps[gaps.length - 1],
    };
}

function counters() {
    return { total: 0, favoriteWins: 0, favoriteTop3: 0, longshotWins: 0, gaps: [] };
}

function record(target, order, times, favorite, longshot) {
    target.total++;
    target.favoriteWins += Number(order[0] === favorite);
    target.favoriteTop3 += Number(order.indexOf(favorite) < 3);
    target.longshotWins += Number(order[0] === longshot);
    target.gaps.push(times[order.at(-1)] - times[order[0]]);
}

const current = counters();
const previous = counters();
for (let card = 0; card < CARDS; card++) {
    const horses = drawHorses(8, makeRng(1000 + card));
    const wins = Array(8).fill(0);
    const rankRng = makeRng(900000 + card);
    for (let run = 0; run < RANK_RUNS; run++) wins[simulateOrder(horses, rankRng)[0]]++;
    const popularity = wins.map((wins, id) => ({ wins, id })).sort((a, b) => b.wins - a.wins);
    const favorite = popularity[0].id;
    const longshot = popularity.at(-1).id;

    const oldWins = Array(8).fill(0);
    const oldRankRng = makeRng(800000 + card);
    for (let run = 0; run < RANK_RUNS; run++) oldWins[oldRace(horses, oldRankRng).order[0]]++;
    const oldPopularity = oldWins.map((wins, id) => ({ wins, id })).sort((a, b) => b.wins - a.wins);
    const oldFavorite = oldPopularity[0].id;
    const oldLongshot = oldPopularity.at(-1).id;

    const raceRng = makeRng(700000 + card);
    const oldRaceRng = makeRng(600000 + card);
    for (let run = 0; run < RACES_PER_CARD; run++) {
        const data = simulateRaceData(horses, raceRng);
        record(current, data.order, data.finishTime, favorite, longshot);
        const old = oldRace(horses, oldRaceRng);
        record(previous, old.order, old.times, oldFavorite, oldLongshot);
    }
}

const before = summarize("旧モデル", previous);
const after = summarize("新モデル", current);
console.log(JSON.stringify({ settings: { cards: CARDS, rankRuns: RANK_RUNS, races: current.total }, before, after }, null, 2));

const valid = after.favoriteWinRate >= 0.25 && after.favoriteWinRate <= 0.40 &&
    after.longshotWinRate > 0 && after.longshotWinRate <= 0.03 &&
    after.averageFirstLastGapSeconds < before.averageFirstLastGapSeconds &&
    after.maxFirstLastGapSeconds < before.maxFirstLastGapSeconds;
if (!valid) {
    console.error("バランス目標を満たしていません。");
    process.exitCode = 1;
}
