// 賭けパネル（賭け式タブ・賭け金・馬選択・確定/賭けない）。
// ローカルでもオンラインでも共通で使う。#screen-pick のDOMを操作する。
const BET_STEP = 100;

const cur = {
    engine: null,
    balance: 0,
    onComplete: null, // (bet|null) => void  bet={typeKey,sel,amount,odds}
    type: null,
    selection: [],
    amount: 100,
};

// 起動時に一度だけ呼ぶ。各操作のイベントを張る。
export function initBetUI() {
    document.getElementById("bet-minus").addEventListener("click", () => {
        cur.amount -= BET_STEP; clampBet(); updateAmount(); renderSelection();
    });
    document.getElementById("bet-plus").addEventListener("click", () => {
        cur.amount += BET_STEP; clampBet(); updateAmount(); renderSelection();
    });
    document.querySelectorAll(".bet-quick button").forEach((btn) => {
        btn.addEventListener("click", () => {
            const v = btn.dataset.bet;
            if (v === "half") cur.amount = Math.floor(cur.balance / 2);
            else if (v === "all") cur.amount = cur.balance;
            clampBet(); updateAmount(); renderSelection();
        });
    });
    document.getElementById("confirm-bet").addEventListener("click", () => {
        if (cur.selection.length === cur.type.nPick) placeBet([...cur.selection]);
    });
    document.getElementById("skip-bet").addEventListener("click", () => {
        finish(null);
    });
}

// パネルを開く。
export function startBetPanel({ engine, balance, onComplete }) {
    cur.engine = engine;
    cur.balance = balance;
    cur.onComplete = onComplete;
    cur.type = engine.betTypes[0];
    cur.selection = [];
    cur.amount = Math.min(BET_STEP, balance);

    document.getElementById("pick-balance").textContent = balance;
    updateAmount();
    renderTabs();
    renderHorses();
    renderSelection();
}

function clampBet() {
    cur.amount = Math.max(0, Math.min(cur.amount, cur.balance));
}
function updateAmount() {
    document.getElementById("bet-amount").textContent = cur.amount;
}

function renderTabs() {
    const tabs = document.getElementById("bettype-tabs");
    tabs.innerHTML = "";
    for (const t of cur.engine.betTypes) {
        const btn = document.createElement("button");
        btn.textContent = t.label;
        btn.className = t === cur.type ? "active" : "";
        btn.addEventListener("click", () => {
            cur.type = t; cur.selection = [];
            renderTabs(); renderHorses(); renderSelection();
        });
        tabs.appendChild(btn);
    }
    document.getElementById("bettype-desc").textContent = cur.type.desc;
    document.getElementById("pick-instruction").textContent = "↓ " + cur.type.instruction;
}

function renderHorses() {
    const type = cur.type;
    const grid = document.getElementById("horse-choices");
    grid.innerHTML = "";
    for (const h of cur.engine.horses) {
        const div = document.createElement("div");
        div.className = "horse-pick";
        div.style.borderColor = h.color;

        let oddsLine = "";
        if (type.nPick === 1) {
            oddsLine = `<div class="odds">${type.label}オッズ ${cur.engine.oddsFor(type.key, [h.id])}倍</div>`;
        }
        const selPos = cur.selection.indexOf(h.id);
        if (selPos >= 0) div.classList.add("selected");
        const badge = (selPos >= 0 && type.ordered) ? `<div class="order-badge">${selPos + 1}</div>` : "";

        div.innerHTML = `
            ${badge}
            <div class="emoji" style="filter:drop-shadow(0 0 6px ${h.color})">${h.emoji}</div>
            <div class="hname">${h.id + 1}. ${h.name}</div>
            ${oddsLine}
            <div class="style" title="${h.style.desc}">${h.style.label}</div>
        `;
        div.addEventListener("click", () => tapHorse(h));
        grid.appendChild(div);
    }
}

function tapHorse(horse) {
    const type = cur.type;
    if (type.nPick === 1) { placeBet([horse.id]); return; }
    const pos = cur.selection.indexOf(horse.id);
    if (pos >= 0) cur.selection.splice(pos, 1);
    else if (cur.selection.length < type.nPick) cur.selection.push(horse.id);
    renderHorses();
    renderSelection();
}

function renderSelection() {
    const type = cur.type;
    const bar = document.getElementById("selection-bar");
    const preview = document.getElementById("odds-preview");
    const confirm = document.getElementById("confirm-bet");

    if (type.nPick === 1) {
        bar.textContent = "";
        preview.classList.add("hidden");
        confirm.classList.add("hidden");
        return;
    }
    const names = cur.selection.map((id) => {
        const h = cur.engine.horses.find((x) => x.id === id);
        return `${h.id + 1}.${h.name}`;
    });
    const joiner = type.ordered ? " → " : " ・ ";
    bar.textContent = names.length
        ? `選択中: ${names.join(joiner)}（${cur.selection.length}/${type.nPick}）`
        : `${type.nPick}頭 選んでください`;

    if (cur.selection.length === type.nPick) {
        const odds = cur.engine.oddsFor(type.key, cur.selection);
        const payout = Math.floor(cur.amount * odds);
        preview.innerHTML = `予想オッズ <b>${odds}倍</b> ／ 当たれば <b>${payout}</b> コイン`;
        preview.classList.remove("hidden");
        confirm.classList.remove("hidden");
    } else {
        preview.classList.add("hidden");
        confirm.classList.add("hidden");
    }
}

function placeBet(sel) {
    if (cur.amount <= 0) { finish(null); return; }
    const odds = cur.engine.oddsFor(cur.type.key, sel);
    finish({ typeKey: cur.type.key, sel, amount: cur.amount, odds });
}

function finish(bet) {
    const cb = cur.onComplete;
    cur.onComplete = null;
    if (cb) cb(bet);
}
