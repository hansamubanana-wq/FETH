// レースの決定論的シミュレーション。描画に依存しないため、ブラウザとNode検証で共有する。
const SPEED_BASE = 190;
const TRACK_LEN = 820;
const SIM_DT = 1 / 60;

// Box-Muller法。必ず乱数を2個消費し、オンライン対戦の再現性を保つ。
function normal(rng) {
    const u = Math.max(Number.EPSILON, rng());
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(value, lo, hi) {
    return Math.min(hi, Math.max(lo, value));
}

function initRunner(h, rng) {
    const ability = h.ability;
    // 素の能力差を55%に圧縮。調子は正規分布を±4.5%に制限する。
    const basePerf = 1 + (h.power - 1) * 0.55;
    const condition = clamp(normal(rng) * 0.018, -0.045, 0.045);
    // 序盤・中盤・終盤それぞれの位置取り。合計の振れは能力差より小さい。
    const phases = [0, 1, 2].map(() => clamp(normal(rng) * 0.010, -0.022, 0.022));
    const staminaPlan = clamp(normal(rng) * 0.010, -0.022, 0.022);
    const active = rng() < ability.proc;
    const trigger = ability.lo + rng() * (ability.hi - ability.lo);
    // 低調子・終盤の展開不利・スタミナ配分失敗がすべて重なった場合だけ明確に失速する。
    const exhausted = condition < -0.032 && phases[2] < -0.014 &&
        staminaPlan < -0.014 && h.style.stamina < 0.5;
    return {
        id: h.id, basePerf, condition, phases, staminaPlan, exhausted,
        style: h.style, ability, active, trigger, x: 0, done: false,
    };
}

function computeSpeed(r, t, rng) {
    const phase = t < 0.34 ? 0 : (t < 0.70 ? 1 : 2);
    // 脚質カーブも32%に圧縮し、脚質は順位を決める力ではなく展開上の個性にする。
    let pace = 1 + (r.style.profile(clamp(t, 0, 1)) - 1) * 0.32;
    pace *= 1 + r.condition + r.phases[phase];
    if (t > 0.70) {
        const late = (t - 0.70) / 0.30;
        pace *= 1 + r.staminaPlan * late;
        if (r.exhausted) pace *= 1 - 0.075 * late;
    }
    pace *= (r.ability.penalty || 1);
    if (r.active && t >= r.trigger && t <= r.trigger + r.ability.dur) {
        pace *= 1 + r.ability.boost;
    } else if (!r.active) {
        pace *= (r.ability.fizzle || 1);
    }
    // 毎フレームの微細な揺れは±3。大きな一様ノイズで順位が決まらないようにする。
    const microNoise = (rng() - 0.5) * 6;
    return Math.max(80, SPEED_BASE * r.basePerf * pace + microNoise);
}

export function simulateOrder(horses, rng) {
    const runners = horses.map((h) => initRunner(h, rng));
    const finishTime = new Array(runners.length).fill(null);
    let time = 0;
    let remaining = runners.length;
    while (remaining > 0) {
        time += SIM_DT;
        for (let i = 0; i < runners.length; i++) {
            const r = runners[i];
            if (r.done) continue;
            const speed = computeSpeed(r, r.x / TRACK_LEN, rng);
            r.x += speed * SIM_DT;
            if (r.x >= TRACK_LEN) {
                finishTime[i] = time - (r.x - TRACK_LEN) / speed;
                r.done = true;
                remaining--;
            }
        }
    }
    return runners.map((_, i) => i)
        .sort((a, b) => finishTime[a] - finishTime[b])
        .map((i) => runners[i].id);
}

export function simulateRaceData(horses, rng) {
    const runners = horses.map((h) => initRunner(h, rng));
    const frames = [];
    const finishTime = new Array(runners.length).fill(null);
    const order = [];
    let time = 0;
    while (order.length < runners.length) {
        frames.push(runners.map((r) => r.x));
        time += SIM_DT;
        for (let i = 0; i < runners.length; i++) {
            const r = runners[i];
            if (r.done) continue;
            const speed = computeSpeed(r, r.x / TRACK_LEN, rng);
            r.x += speed * SIM_DT;
            if (r.x >= TRACK_LEN) {
                finishTime[i] = time - (r.x - TRACK_LEN) / speed;
                r.x = TRACK_LEN;
                r.done = true;
                order.push(i);
            }
        }
    }
    frames.push(runners.map((r) => r.x));
    order.sort((a, b) => finishTime[a] - finishTime[b]);
    const gap = order.length >= 2 ? finishTime[order[1]] - finishTime[order[0]] : 999;
    const abFrom = runners.map((r) => (r.active ? r.trigger : -1));
    const abTo = runners.map((r) => (r.active ? r.trigger + r.ability.dur : -1));
    const abLabel = runners.map((r) => (r.active ? r.ability.label : null));
    const abilityEvents = runners.map((r) => ({
        horseId: r.id, label: r.ability.label, active: r.active,
        from: r.active ? r.trigger : -1, to: r.active ? r.trigger + r.ability.dur : -1,
        boost: r.ability.boost || 0,
    }));
    return { dt: SIM_DT, frames, order, finishTime, gap, trackLen: TRACK_LEN, abFrom, abTo, abLabel, abilityEvents };
}

export const RACE_SIM_CONSTANTS = { TRACK_LEN, SIM_DT };
