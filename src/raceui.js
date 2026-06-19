// レース再生と結果表示の共通UI。ローカル・オンライン両方から使う。
import { Race, simulateRaceData } from "./race.js";
import { makeRng } from "./rng.js";
import { settleTickets } from "./engine.js";
import { showScreen } from "./ui.js";

const LIVE_INTERVAL = 130; // ライブ表示の更新間隔(ms)

let liveCtx = null;     // { engine, players:[{name,tickets}], bettorMap }
let lastLive = 0;

// raceSeed と horses からレースを再生する。
//  context（任意）= { engine, players:[{name,tickets}] } を渡すと
//  「誰が何に賭けたか」「現在順位での損益」をライブ表示する。
// 返り値: Promise<orderedHorses>（演出終了後に解決）。
export function playRace(horses, raceSeed, context = null) {
    const raceData = simulateRaceData(horses, makeRng(raceSeed));
    showScreen("screen-race");

    const canvas = document.getElementById("track");
    const status = document.getElementById("race-status");

    setupLive(context);

    const race = new Race(canvas, horses, raceData);
    race._draw(0);

    return new Promise((resolve) => {
        let c = 3;
        status.textContent = c;
        const timer = setInterval(() => {
            c--;
            if (c > 0) { status.textContent = c; return; }
            clearInterval(timer);
            status.textContent = "🏇 レース中！";
            race.onTick = (ordered) => {
                status.textContent = `🏇 先頭: ${ordered[0].name}`;
                updateLive(ordered);
            };
            race.onFinish = (ordered) => {
                race.onTick = null;
                updateLive(ordered, true);
                    status.textContent = `ゴール！ 1着 ${ordered[0].name}`;
                    setTimeout(() => resolve(ordered), 1300);
            };
            race.start();
        }, 700);
    });
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
    liveCtx = { engine: context.engine, players: context.players, bettorMap };
}

function updateLive(ordered, force = false) {
    if (!liveCtx) return;
    const now = performance.now();
    if (!force && now - lastLive < LIVE_INTERVAL) return;
    lastLive = now;

    const orderIds = ordered.map((h) => h.id);
    const medals = ["🥇", "🥈", "🥉"];

    // 順位 + 賭けた人
    const st = document.getElementById("live-standings");
    st.innerHTML = "";
    ordered.forEach((h, i) => {
        const li = document.createElement("li");
        const who = liveCtx.bettorMap[h.id] || [];
        const tag = who.length ? `<span class="who-tag">賭: ${who.join(", ")}</span>` : "";
        li.innerHTML = `
            <span class="lr">${medals[i] || i + 1}</span>
            <span class="dot" style="background:${h.color}"></span>
            <span class="lh">${h.id + 1}. ${h.name}</span>
            ${tag}`;
        st.appendChild(li);
    });

    // 今ゴールなら…の損益
    const pl = document.getElementById("live-pl");
    pl.innerHTML = "";
    liveCtx.players.forEach((p) => {
        const res = settleTickets(p.tickets || [], orderIds, liveCtx.engine.horses, liveCtx.engine.byKey);
        const d = res.delta;
        const str = d > 0 ? `+${d}` : d < 0 ? `${d}` : "±0";
        const cls = d > 0 ? "win" : d < 0 ? "lose" : "";
        const li = document.createElement("li");
        li.innerHTML = `<span>${p.name}</span><span class="delta ${cls}">${str}</span>`;
        pl.appendChild(li);
    });
}

export function renderResult(orderedHorses, payoutRows, standings, buttons) {
    showScreen("screen-result");
    const medals = ["🥇", "🥈", "🥉"];

    const list = document.getElementById("result-list");
    list.innerHTML = "";
    orderedHorses.forEach((h, i) => {
        const li = document.createElement("li");
        if (i === 0) li.classList.add("winner");
        li.innerHTML = `
            <span class="rank">${medals[i] || i + 1}</span>
            <span class="emoji" style="filter:drop-shadow(0 0 4px ${h.color})">${h.emoji}</span>
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
            <div class="delta ${cls}">${deltaStr}</div>
        `;
        payoutsDiv.appendChild(div);
    });

    const st = document.getElementById("standings");
    st.innerHTML = "";
    standings.forEach((p, i) => {
        const li = document.createElement("li");
        const rank = medals[i] || `${i + 1}位`;
        const status = p.bankrupt ? " 💸破産中" : "";
        const ready = p.readyNext ? " / OK" : "";
        li.innerHTML = `<span>${rank} ${p.name}${status}</span><span class="coins">${p.balance} コイン${ready}</span>`;
        st.appendChild(li);
    });

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
