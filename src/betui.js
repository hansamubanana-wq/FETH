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
    reviveMode: false,
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
    // 掛け金の直接入力
    const amt = document.getElementById("bet-amount");
    amt.addEventListener("input", () => {
        cur.amount = Math.max(0, Math.floor(Number(amt.value) || 0));
        if (cur.amount > remaining()) cur.amount = remaining();
        renderSelection();
    });
    amt.addEventListener("change", () => { clampBet(); updateAmount(); renderSelection(); });

    document.getElementById("confirm-bet").addEventListener("click", () => {
        if (cur.selection.length === cur.type.nPick) placeTicket([...cur.selection]);
    });
    document.getElementById("skip-bet").addEventListener("click", finishBetting);
}

// パネルを開く。
export function startBetPanel({ engine, balance, onComplete, reviveMode = false }) {
    cur.engine = engine;
    cur.balance = balance;
    cur.onComplete = onComplete;
    cur.reviveMode = reviveMode;
    cur.type = reviveMode
        ? engine.betTypes.find((t) => t.key === "win") || engine.betTypes[0]
        : engine.betTypes[0];
    cur.selection = [];
    cur.tickets = [];
    cur.spent = 0;
    cur.amount = reviveMode ? 0 : Math.min(BET_STEP, balance);

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
    document.getElementById("bet-amount").value = cur.amount;
}
function renderBalance() {
    document.getElementById("pick-balance").textContent = cur.reviveMode ? "復活チャレンジ" : remaining();
}

function renderTabs() {
    const tabs = document.getElementById("bettype-tabs");
    tabs.innerHTML = "";
    const types = cur.reviveMode ? cur.engine.betTypes.filter((t) => t.key === "win") : cur.engine.betTypes;
    for (const t of types) {
        const btn = document.createElement("button");
        btn.textContent = t.label;
        btn.className = t === cur.type ? "active" : "";
        btn.addEventListener("click", () => {
            cur.type = t; cur.selection = [];
            renderTabs(); renderHorses(); renderSelection();
        });
        tabs.appendChild(btn);
    }
    document.getElementById("bettype-desc").textContent = cur.reviveMode
        ? "破産中の特別ルール：単勝を的中できれば3000コインで復活できます。外れても追加の支払いはありません。"
        : cur.type.desc;
    document.getElementById("pick-instruction").textContent = cur.reviveMode
        ? "復活をかけて1着になる馬を選んでください"
        : "↓ " + cur.type.instruction;
}
function meter(label, v, valText = "", cls = "") {
    const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
    return `<div class="meter ${cls}"><span class="ml">${label}</span>` +
        `<span class="mb"><i style="width:${pct}%"></i></span>` +
        `<span class="mv">${valText || pct}</span></div>`;
}

function renderHorses() {
    const type = cur.type;
    const grid = document.getElementById("horse-choices");
    grid.innerHTML = "";
    for (const h of cur.engine.horses) {
        const div = document.createElement("div");
        div.className = "horse-pick";
        div.style.borderColor = h.color;

        // どの賭け式でも各馬にオッズを表示する。
        // 1頭選び（単勝/複勝）はその式のオッズ、複数頭の式は人気の目安として単勝オッズを出す。
        let oddsLine;
        if (type.nPick === 1) {
            oddsLine = `<div class="odds">${type.label} ${cur.engine.oddsFor(type.key, [h.id])}倍</div>`;
        } else {
            oddsLine = `<div class="odds">単勝 ${cur.engine.oddsFor("win", [h.id])}倍</div>`;
        }
        const selPos = cur.selection.indexOf(h.id);
        if (selPos >= 0) div.classList.add("selected");
        const badge = (selPos >= 0 && type.ordered) ? `<div class="order-badge">${selPos + 1}</div>` : "";

        const s = h.stats;
        div.innerHTML = `
            ${badge}
            <div class="emoji" style="filter:drop-shadow(0 0 6px ${h.color})">${h.emoji}</div>
            <div class="hname">${h.id + 1}. ${h.name}</div>
            ${oddsLine}
            <div class="meters">
                ${meter("スピード", s.speed)}
                ${meter("スタミナ", s.stamina)}
                ${meter("瞬発力", s.kick)}
            </div>
            <div class="tags">
                <span class="style" title="${h.style.desc}">${h.style.label}</span>
                <span class="ability" title="${h.ability.desc}">⚡${h.ability.label} <span class="proc">${Math.round(h.ability.proc * 100)}%</span></span>
            </div>
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
        const payout = cur.reviveMode ? 3000 : Math.floor(cur.amount * odds);
        preview.innerHTML = cur.reviveMode
            ? `復活成功で <b>${payout}</b> コイン`
            : `予想オッズ <b>${odds}倍</b> ・ 当たれば <b>${payout}</b> コイン`;
        preview.classList.remove("hidden");
        confirm.classList.remove("hidden");
    } else {
        preview.classList.add("hidden");
        confirm.classList.add("hidden");
    }
}
function placeTicket(sel) {
    if (!cur.reviveMode && (cur.amount <= 0 || cur.amount > remaining())) return;
    const odds = cur.engine.oddsFor(cur.type.key, sel);
    cur.tickets.push({ typeKey: cur.type.key, sel, amount: cur.reviveMode ? 0 : cur.amount, odds, revive: cur.reviveMode });
    if (cur.reviveMode) {
        finishBetting();
        return;
    }
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
