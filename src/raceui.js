// レース再生と結果表示の共通UI。ローカル・オンライン両方から使う。
import { Race, simulateRaceData } from "./race.js";
import { makeRng } from "./rng.js";
import { showScreen } from "./ui.js";

const PHOTO_GAP = 0.16; // この着差(s)未満なら写真判定演出

// raceSeed と horses からレースを再生する。
// 返り値: Promise<orderedHorses>（演出終了後に解決）。
export function playRace(horses, raceSeed) {
    const raceData = simulateRaceData(horses, makeRng(raceSeed));
    showScreen("screen-race");

    const canvas = document.getElementById("track");
    document.getElementById("photo-overlay").classList.add("hidden");
    document.getElementById("flash").classList.remove("fire");
    const status = document.getElementById("race-status");

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
            race.onTick = (leader) => { if (leader) status.textContent = `🏇 先頭: ${leader.name}`; };
            race.onFinish = (ordered) => {
                race.onTick = null;
                if (raceData.gap < PHOTO_GAP) photoFinish(ordered, resolve);
                else {
                    status.textContent = `ゴール！ 1着 ${ordered[0].name}`;
                    setTimeout(() => resolve(ordered), 1300);
                }
            };
            race.start();
        }, 700);
    });
}

function photoFinish(ordered, resolve) {
    const status = document.getElementById("race-status");
    const flash = document.getElementById("flash");
    const overlay = document.getElementById("photo-overlay");

    flash.classList.remove("fire");
    void flash.offsetWidth;
    flash.classList.add("fire");
    status.textContent = "📷 写真判定…";
    overlay.classList.remove("hidden");

    setTimeout(() => {
        overlay.classList.add("hidden");
        status.textContent = `📷 判定の結果… 1着 ${ordered[0].name}！（${ordered[1].name} を差し切り）`;
        setTimeout(() => resolve(ordered), 1600);
    }, 2400);
}

// 結果画面を表示する。
//  orderedHorses: ゴール順の馬
//  payoutRows: [{ name, detail, delta }]
//  standings:   [{ name, balance }]（並び替え済み）
//  buttons: { primaryLabel, onPrimary, secondaryLabel, onSecondary, note }
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
            <span>${h.id + 1}. ${h.name} <small style="color:var(--muted)">(${h.style.label})</small></span>
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
        li.innerHTML = `<span>${rank} ${p.name}</span><span class="coins">${p.balance} コイン</span>`;
        st.appendChild(li);
    });

    // ボタン設定
    const primary = document.getElementById("rematch");
    const secondary = document.getElementById("back-to-setup");
    const note = document.getElementById("result-note");
    primary.onclick = null;
    secondary.onclick = null;

    if (buttons.primaryLabel) {
        primary.textContent = buttons.primaryLabel;
        primary.classList.remove("hidden");
        primary.onclick = buttons.onPrimary;
    } else {
        primary.classList.add("hidden");
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
