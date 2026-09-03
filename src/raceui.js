// レース再生と結果表示の共通UI。ローカル・オンライン両方から使う。
import { Race, simulateRaceData } from "./race.js";
import { makeRng } from "./rng.js";
import { settleTickets } from "./engine.js";
import { showScreen } from "./ui.js";

const LIVE_INTERVAL = 130;       // ライブ表示の更新間隔(ms)
const LIVE_INTERVAL_CROWD = 280; // 大人数のときはさらに間引く

let liveCtx = null;     // { engine, players:[{name,tickets}], bettorMap }
let lastLive = 0;
let abilityLive = null;
let session = null;     // 再生中のレース（多重再生と後片付けの管理用）

// 再生中のレースを中断して3D資源を解放する。
// ラウンドが進んでしまったときなど、外から強制的に止めたいときに使う。
// 中断された playRace() の Promise は null で解決する。
export function stopRacePlayback() {
    const s = session;
    if (!s) return;
    session = null;
    s.cancelled = true;
    s.timers.forEach((id) => { clearTimeout(id); clearInterval(id); });
    s.timers.clear();
    s.race.stop();
    document.getElementById("race-loading")?.classList.add("hidden");
    s.resolve?.(null);
}

// raceSeed と horses からレースを再生する。
//  context（任意）= { engine, players:[{name,tickets}] } を渡すと
//  「誰が何に賭けたか」「現在順位での損益」をライブ表示する。
// 返り値: Promise<orderedHorses>（演出終了後に解決）。
export function playRace(horses, raceSeed, context = null) {
    stopRacePlayback();   // 前のレースが残っていたら必ず片付けてから始める
    const raceData = simulateRaceData(horses, makeRng(raceSeed));
    showScreen("screen-race");

    const canvas = document.getElementById("track");
    const status = document.getElementById("race-status");
    const screen = document.getElementById("screen-race");
    const finishTelops = document.getElementById("finish-telops");
    const announcedFinishers = new Set();
    if (finishTelops) finishTelops.replaceChildren();
    screen.classList.remove("race-start-flash", "race-finish-flash");

    setupAbilityLive(horses, raceData);
    setupLive(context);

    const loading = document.getElementById("race-loading");
    const loadBar = document.getElementById("race-load-bar");
    const loadPercent = document.getElementById("race-load-percent");
    loading?.classList.remove("hidden");
    const race = new Race(canvas, horses, raceData, (progress) => {
        const percent = Math.round(progress * 100);
        if (loadBar) loadBar.style.width = `${percent}%`;
        if (loadPercent) loadPercent.textContent = `${percent}%`;
    });
    race._draw(0);

    const s = { race, cancelled: false, timers: new Set(), resolve: null };
    session = s;
    const after = (fn, ms) => { const id = setTimeout(fn, ms); s.timers.add(id); return id; };
    const every = (fn, ms) => { const id = setInterval(fn, ms); s.timers.add(id); return id; };

    return new Promise((resolve) => {
        s.resolve = resolve;
        race.whenReady().finally(() => {
            if (s.cancelled) return;
            loading?.classList.add("hidden");
            let c = 3;
            status.textContent = c;
            const timer = every(() => {
            c--;
            if (c > 0) { status.textContent = c; return; }
            clearInterval(timer);
            s.timers.delete(timer);
            status.textContent = "スタート！";
            screen.classList.add("race-start-flash");
            after(() => {
                screen.classList.remove("race-start-flash");
                if (status.textContent === "スタート！") status.textContent = "🏇 レース中！";
            }, 900);
            race.onTick = (ordered, distances) => {
                status.textContent = `🏇 先頭: ${ordered[0].name}`;
                updateLive(ordered);
                updateAbilityLive(distances);
                for (const horse of ordered) {
                    if (announcedFinishers.size >= 3) break;
                    const horseIndex = horses.indexOf(horse);
                    if (horseIndex < 0 || distances[horseIndex] < raceData.trackLen - 0.5 || announcedFinishers.has(horse.id)) continue;
                    announcedFinishers.add(horse.id);
                    showFinishTelop(finishTelops, announcedFinishers.size, horse);
                }
            };
            race.onFinish = (ordered) => {
                race.onTick = null;
                updateLive(ordered, true);
                finishAbilityLive();
                status.textContent = `FINISH — 1着 ${ordered[0].name}`;
                screen.classList.add("race-finish-flash");
                after(() => screen.classList.remove("race-finish-flash"), 1000);
                after(() => {
                    if (s.cancelled) return;
                    if (session === s) session = null;
                    // ここで stop() しないと3Dのシーン一式が解放されず、
                    // レースを重ねるほど重くなって最後は固まる。
                    race.stop();
                    resolve(ordered);
                }, 1300);
            };
            race.start();
            }, 700);
        });
    });
}

function showFinishTelop(container, rank, horse) {
    if (!container) return;
    const row = document.createElement("div");
    row.className = `finish-telop rank-${rank}`;
    const rankLabel = document.createElement("span");
    const number = document.createElement("b");
    const name = document.createElement("strong");
    rankLabel.textContent = `${rank}着`;
    number.textContent = horse.id + 1;
    name.textContent = horse.name;
    row.append(rankLabel, number, name);
    container.appendChild(row);
    setTimeout(() => row.classList.add("leaving"), 2100);
    setTimeout(() => row.remove(), 2600);
}

// ---- ライブ表示（誰が何に賭けたか・現在順位での損益）----
function setupLive(context) {
    const panels = document.querySelector(".live-panels");
    liveCtx = null;
    lastLive = 0;
    if (!context || !context.players || !context.players.length) {
        if (panels) panels.classList.add("hidden");
        return;
    }
    if (panels) panels.classList.remove("hidden");

    // 各馬ごとに「賭けた人」を集計
    const bettorMap = {};
    for (const h of context.engine.horses) bettorMap[h.id] = [];
    context.players.forEach((p) => {
        const ids = new Set();
        (p.tickets || []).forEach((t) => (t.sel || []).forEach((id) => ids.add(id)));
        ids.forEach((id) => { if (bettorMap[id]) bettorMap[id].push(p.name); });
    });
    liveCtx = {
        engine: context.engine,
        players: context.players,
        bettorMap,
        // 大人数だと毎フレームの再描画・精算計算が3Dのフレームレートを削るので間引く
        interval: context.players.length > 8 ? LIVE_INTERVAL_CROWD : LIVE_INTERVAL,
        lastOrderKey: "",
        rows: null,
        plRows: null,
    };
}

// 順位表・損益表の行を一度だけ作る。以降は中身の差し替えだけにして
// innerHTML の作り直し（＝レース中の毎回のパースとレイアウト）をなくす。
function buildLiveRows() {
    const st = document.getElementById("live-standings");
    const pl = document.getElementById("live-pl");
    if (!st || !pl || !liveCtx) return;

    st.innerHTML = "";
    liveCtx.rows = new Map();
    liveCtx.engine.horses.forEach((h) => {
        const li = document.createElement("li");
        const rank = document.createElement("span");
        rank.className = "lr";
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = h.color;
        const name = document.createElement("span");
        name.className = "lh";
        name.textContent = `${h.id + 1}. ${h.name}`;
        li.append(rank, dot, name);
        const who = liveCtx.bettorMap[h.id] || [];
        if (who.length) {
            const tag = document.createElement("span");
            tag.className = "who-tag";
            tag.textContent = `賭: ${who.join(", ")}`;
            li.appendChild(tag);
        }
        liveCtx.rows.set(h.id, { li, rank });
        st.appendChild(li);
    });

    pl.innerHTML = "";
    liveCtx.plRows = liveCtx.players.map((p) => {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = p.name;
        const delta = document.createElement("span");
        delta.className = "delta";
        delta.textContent = "±0";
        li.append(name, delta);
        pl.appendChild(li);
        return delta;
    });
}

function setupAbilityLive(horses, raceData) {
    const el = document.getElementById("live-abilities");
    const events = (raceData.abilityEvents || []).map((ev) => {
        const horse = horses.find((h) => h.id === ev.horseId);
        return {
            ...ev,
            horseName: horse ? horse.name : `Horse ${ev.horseId + 1}`,
            number: ev.horseId + 1,
            color: horse ? horse.color : "#ffb74d",
            seen: false,
        };
    });
    abilityLive = { events, trackLen: raceData.trackLen || 820 };
    if (el) {
        el.innerHTML = "";
        events
            .slice()
            .sort((a, b) => (a.active === b.active ? a.from - b.from : Number(b.active) - Number(a.active)))
            .slice(0, 8)
            .forEach((ev) => el.appendChild(abilityRow(ev, ev.active ? "waiting" : "miss")));
    }
}

function updateAbilityLive(distances) {
    if (!abilityLive || !distances) return;
    let changed = false;
    abilityLive.events.forEach((ev) => {
        if (!ev.active || ev.seen) return;
        const t = (distances[ev.horseId] || 0) / abilityLive.trackLen;
        if (t >= ev.from && t <= ev.to + 0.03) {
            ev.seen = true;
            changed = true;
        }
    });
    if (changed) renderAbilityLive(false);
}

function finishAbilityLive() {
    if (!abilityLive) return;
    renderAbilityLive(true);
}

function renderAbilityLive(final = false) {
    const el = document.getElementById("live-abilities");
    if (!el || !abilityLive) return;
    el.innerHTML = "";
    const fired = abilityLive.events.filter((ev) => ev.seen);
    const pending = abilityLive.events.filter((ev) => ev.active && !ev.seen);
    const misses = abilityLive.events.filter((ev) => !ev.active);
    const rows = final
        ? [...fired, ...misses].slice(0, 8)
        : [...fired.slice(-5).reverse(), ...pending.slice(0, 3)];
    rows.forEach((ev) => el.appendChild(abilityRow(ev, ev.seen ? "active" : (ev.active ? "waiting" : "miss"))));
}

function abilityRow(ev, state) {
    const li = document.createElement("li");
    li.className = `ability-log ${state}`;
    const status = state === "active" ? "発動" : state === "miss" ? "不発" : "待機";
    li.innerHTML = `
        <span class="ability-num" style="background:${ev.color}">${ev.number}</span>
        <span class="ability-name">${ev.label}</span>
        <span class="ability-state">${status}</span>
    `;
    return li;
}

function updateLive(ordered, force = false) {
    if (!liveCtx) return;
    const now = performance.now();
    if (!force && now - lastLive < liveCtx.interval) return;
    lastLive = now;

    const orderIds = ordered.map((h) => h.id);
    // 順位が変わっていなければ表示も損益も変わらない。人数分の精算計算ごと省く。
    const orderKey = orderIds.join(",");
    if (!force && orderKey === liveCtx.lastOrderKey) return;
    liveCtx.lastOrderKey = orderKey;

    if (!liveCtx.rows) buildLiveRows();
    if (!liveCtx.rows) return;

    const medals = ["🥇", "🥈", "🥉"];
    const st = document.getElementById("live-standings");
    ordered.forEach((h, i) => {
        const row = liveCtx.rows.get(h.id);
        if (!row) return;
        const label = medals[i] || String(i + 1);
        if (row.rank.textContent !== label) row.rank.textContent = label;
        st.appendChild(row.li);   // 既存ノードの並べ替え（作り直さない）
    });

    // 今ゴールなら…の損益
    liveCtx.players.forEach((p, i) => {
        const el = liveCtx.plRows[i];
        if (!el) return;
        const d = settleTickets(p.tickets || [], orderIds, liveCtx.engine.horses, liveCtx.engine.byKey).delta;
        const str = d > 0 ? `+${d}` : d < 0 ? `${d}` : "±0";
        if (el.textContent !== str) el.textContent = str;
        const cls = d > 0 ? "win" : d < 0 ? "lose" : "";
        if (el.className !== `delta ${cls}`) el.className = `delta ${cls}`;
    });
}

export function renderResult(orderedHorses, payoutRows, standings, buttons) {
    showScreen("screen-result");
    const medals = ["🥇", "🥈", "🥉"];
    const victoryHorse = document.getElementById("victory-horse");
    if (victoryHorse && orderedHorses[0]) {
        victoryHorse.src = `assets/art/horses/horse${orderedHorses[0].id + 1}.png`;
        victoryHorse.alt = `${orderedHorses[0].name}の優勝肖像`;
    }

    const list = document.getElementById("result-list");
    list.innerHTML = "";
    orderedHorses.forEach((h, i) => {
        const li = document.createElement("li");
        if (i === 0) li.classList.add("winner");
        li.style.setProperty("--result-delay", `${i * 75}ms`);
        li.innerHTML = `
            ${i === 0 ? '<span class="winner-trophy" aria-label="優勝">🏆</span>' : ""}
            <span class="rank">${medals[i] || i + 1}</span>
            <span class="result-portrait-wrap">${i === 0 ? '<span class="winner-rays" aria-hidden="true"></span>' : ""}<img class="result-horse-portrait" src="assets/art/horses/horse${h.id + 1}.png" alt="" width="52" height="52"></span>
            <span>${h.id + 1}. ${h.name} <small style="color:var(--muted)">(${h.style.label}${h.ability ? " ⚡" + h.ability.label : ""})</small></span>
        `;
        list.appendChild(li);
    });

    const payoutsDiv = document.getElementById("payouts");
    payoutsDiv.innerHTML = "";
    payoutRows.forEach((row) => {
        const deltaStr = row.delta > 0 ? `+${row.delta}` : row.delta < 0 ? `${row.delta}` : "±0";
        const cls = row.delta > 0 ? "win" : row.delta < 0 ? "lose" : "";
        const div = document.createElement("div");
        div.className = "payout-row";
        div.innerHTML = `
            <div>
                <div class="who">${row.name}</div>
                <div class="detail">${row.detail}</div>
            </div>
            <div class="delta ${cls} payout-value" data-target="${row.delta}">±0</div>
        `;
        payoutsDiv.appendChild(div);
    });
    payoutsDiv.querySelectorAll(".payout-value").forEach((el) => animateSignedCount(el, Number(el.dataset.target)));

    const st = document.getElementById("standings");
    st.innerHTML = "";
    standings.forEach((p, i) => {
        const li = document.createElement("li");
        const rank = medals[i] || `${i + 1}位`;
        const status = p.bankrupt ? " 💸破産中" : "";
        const ready = p.readyNext ? " / OK" : "";
        li.innerHTML = `<span>${rank} ${p.name}${status}</span><span class="coins"><span class="coin-value number-roll" data-target="${p.balance}">0</span> コイン${ready}</span>`;
        st.appendChild(li);
    });
    st.querySelectorAll(".coin-value").forEach((el) => animateCount(el, Number(el.dataset.target)));

    // 各賭け式ごとの最適だった買い目
    const bb = document.getElementById("best-bet");
    if (buttons.bestBets && buttons.bestBets.length) {
        bb.innerHTML = `<div class="bb-title">💡 各賭け式の最適だった買い目</div>` +
            buttons.bestBets.map((r) =>
                `<div class="bb-row"><span>${r.label} [${r.combo}]</span><span class="bb-odds">${r.odds}倍</span></div>`
            ).join("");
        bb.classList.remove("hidden");
    } else {
        bb.classList.add("hidden");
    }

    // 破産者が出たらゲーム終了バナー＋見出し変更
    const title = document.getElementById("result-title");
    if (title) title.textContent = buttons.gameOver ? "🏆 最終ランキング" : "🏁 結果発表";
    const banner = document.getElementById("gameover-banner");
    if (banner) banner.classList.toggle("hidden", !buttons.gameOver);

    const primary = document.getElementById("rematch");
    const secondary = document.getElementById("back-to-setup");
    const note = document.getElementById("result-note");
    primary.onclick = null;
    secondary.onclick = null;

    if (buttons.primaryLabel) {
        primary.textContent = buttons.primaryLabel;
        primary.classList.remove("hidden");
        primary.onclick = buttons.onPrimary;
        primary.disabled = !buttons.onPrimary;
    } else {
        primary.classList.add("hidden");
        primary.disabled = false;
    }
    if (buttons.secondaryLabel) {
        secondary.textContent = buttons.secondaryLabel;
        secondary.classList.remove("hidden");
        secondary.onclick = buttons.onSecondary;
    } else {
        secondary.classList.add("hidden");
    }
    if (note) note.textContent = buttons.note || "";
}

function animateCount(el, target, duration = 650) {
    const started = performance.now();
    const tick = (now) => {
        const t = Math.min(1, (now - started) / duration);
        el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3))).toLocaleString("ja-JP");
        if (t < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

function animateSignedCount(el, target, duration = 700) {
    const started = performance.now();
    const tick = (now) => {
        const t = Math.min(1, (now - started) / duration);
        const value = Math.round(target * (1 - Math.pow(1 - t, 3)));
        el.textContent = value > 0 ? `+${value.toLocaleString("ja-JP")}` : value < 0 ? value.toLocaleString("ja-JP") : "±0";
        if (t < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}
