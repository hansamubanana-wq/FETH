// 賭けパネル（賭け式タブ・賭け金・馬選択・複数馬券の購入）。
// ローカルでもオンラインでも共通で使う。#screen-pick のDOMを操作する。
// onComplete には購入した馬券の配列を渡す（0枚なら賭けなし）。
const BET_STEP = 100;

const cur = {
    engine: null,
    balance: 0,
    onComplete: null, // (tickets[]) => void  ticket={typeKey,sel,amount,odds}
    type: null,
    selection: [],
    amount: 100,
    tickets: [],
    spent: 0,
};

const remaining = () => cur.balance - cur.spent;

// 起動時に一度だけ呼ぶ。
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
            if (v === "half") cur.amount = Math.floor(remaining() / 2);
            else if (v === "all") cur.amount = remaining();
            clampBet(); updateAmount(); renderSelection();
        });
    });
    document.getElementById("confirm-bet").addEventListener("click", () => {
        if (cur.selection.length === cur.type.nPick) placeTicket([...cur.selection]);
    });
    document.getElementById("skip-bet").addEventListener("click", finishBetting);
}

// パネルを開く。
export function startBetPanel({ engine, balance, onComplete }) {
    cur.engine = engine;
    cur.balance = balance;
    cur.onComplete = onComplete;
    cur.type = engine.betTypes[0];
    cur.selection = [];
    cur.tickets = [];
    cur.spent = 0;
    cur.amount = Math.min(BET_STEP, balance);

    updateAmount();
    renderTabs();
    renderHorses();
    renderSelection();
    renderBetslip();
    renderBalance();
}

function clampBet() {
    cur.amount = Math.max(0, Math.min(cur.amount, remaining()));
}
function updateAmount() {
    document.getElementById("bet-amount").textContent = cur.amount;
}
function renderBalance() {
    document.getElementById("pick-balance").textContent = remaining();
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
    if (type.nPick === 1) { placeTicket([horse.id]); return; }
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

// 馬券を1枚購入してリストに追加。パネルは開いたまま（複数枚買える）。
function placeTicket(sel) {
    if (cur.amount <= 0 || cur.amount > remaining()) return;
    const odds = cur.engine.oddsFor(cur.type.key, sel);
    cur.tickets.push({ typeKey: cur.type.key, sel, amount: cur.amount, odds });
    cur.spent += cur.amount;
    cur.selection = [];
    cur.amount = Math.min(BET_STEP, remaining());
    updateAmount();
    renderHorses();
    renderSelection();
    renderBetslip();
    renderBalance();
}

function removeTicket(i) {
    cur.spent -= cur.tickets[i].amount;
    cur.tickets.splice(i, 1);
    clampBet();
    updateAmount();
    renderBetslip();
    renderBalance();
    renderSelection();
}

function renderBetslip() {
    const el = document.getElementById("betslip");
    el.innerHTML = "";
    if (!cur.tickets.length) return;

    const title = document.createElement("div");
    title.className = "betslip-title";
    title.textContent = `購入した馬券 ${cur.tickets.length}枚（合計 ${cur.spent} コイン）`;
    el.appendChild(title);

    cur.tickets.forEach((t, i) => {
        const type = cur.engine.byKey[t.typeKey];
        const label = t.sel.map((id) => id + 1).join(type.ordered ? "→" : "・");
        const row = document.createElement("div");
        row.className = "betslip-row";
        row.innerHTML = `<span>${type.label} [${label}] ${t.amount}コイン（${t.odds}倍）</span>`;
        const del = document.createElement("button");
        del.textContent = "取消";
        del.className = "betslip-del";
        del.addEventListener("click", () => removeTicket(i));
        row.appendChild(del);
        el.appendChild(row);
    });
}

function finishBetting() {
    const cb = cur.onComplete;
    cur.onComplete = null;
    if (cb) cb([...cur.tickets]);
}
