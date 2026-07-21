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
    phase: "idle", // idle -> type -> horses -> amount
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
            else cur.amount = Number(v);
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
    document.getElementById("bet-cancel").addEventListener("click", resetFlow);
    document.getElementById("bet-back").addEventListener("click", goBack);
}

// パネルを開く。
export function startBetPanel({ engine, balance, onComplete, reviveMode = false }) {
    cur.engine = engine;
    cur.balance = balance;
    cur.onComplete = onComplete;
    cur.reviveMode = reviveMode;
    cur.type = null;
    cur.phase = "idle";
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
    const el = document.getElementById("pick-balance");
    if (cur.reviveMode) {
        el.textContent = "復活チャレンジ";
        return;
    }
    const previous = Number(el.dataset.value ?? el.textContent) || 0;
    rollNumber(el, remaining());
    if (previous !== remaining()) {
        const bar = el.closest(".balance-bar");
        bar?.classList.remove("coin-bounce");
        void bar?.offsetWidth;
        bar?.classList.add("coin-bounce");
    }
}

function renderTabs() {
    const tabs = document.getElementById("bettype-tabs");
    tabs.innerHTML = "";
    const types = cur.reviveMode ? cur.engine.betTypes.filter((t) => t.key === "win") : cur.engine.betTypes;
    const icons = { win: "◆", place: "●", quinella: "◎", exacta: "➜", trio: "△", trifecta: "♛", wide: "◇" };
    for (const t of types) {
        const btn = document.createElement("button");
        btn.innerHTML = `<span class="bettype-icon" aria-hidden="true">${icons[t.key] || "◇"}</span><span>${t.label}</span>`;
        btn.addEventListener("click", () => {
            cur.type = t;
            cur.phase = t.nPick === 1 ? "amount" : "horses";
            renderTabs(); renderHorses(); renderSelection();
        });
        tabs.appendChild(btn);
    }
    document.getElementById("bettype-desc").textContent = cur.reviveMode
        ? "破産中の特別ルール：単勝を的中できれば3000コインで復活できます。外れても追加の支払いはありません。"
        : "選んだ馬を起点に、購入する馬券の種類を決めます。";
}
function meter(label, v, valText = "", cls = "") {
    const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
    return `<div class="meter ${cls}"><span class="ml">${label}</span>` +
        `<span class="mb"><i style="width:${pct}%"></i></span>` +
        `<span class="mv">${valText || pct}</span></div>`;
}

function rollNumber(el, target, duration = 360) {
    const from = Number(el.dataset.value ?? el.textContent) || 0;
    const started = performance.now();
    el.dataset.value = String(target);
    el.classList.remove("number-roll");
    void el.offsetWidth;
    el.classList.add("number-roll");
    const tick = (now) => {
        const t = Math.min(1, (now - started) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(from + (target - from) * eased).toLocaleString("ja-JP");
        if (t < 1 && el.dataset.value === String(target)) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

function renderHorses() {
    const type = cur.type;
    const grid = document.getElementById("horse-choices");
    grid.innerHTML = "";
    for (const h of cur.engine.horses) {
        const div = document.createElement("div");
        div.className = "horse-pick";
        div.style.setProperty("--horse-color", h.color);

        // どの賭け式でも各馬にオッズを表示する。
        // 1頭選び（単勝/複勝）はその式のオッズ、複数頭の式は人気の目安として単勝オッズを出す。
        let oddsLine;
        if (type?.nPick === 1) {
            oddsLine = `<div class="odds">${type.label} ${cur.engine.oddsFor(type.key, [h.id])}倍</div>`;
        } else {
            oddsLine = `<div class="odds">単勝 ${cur.engine.oddsFor("win", [h.id])}倍</div>`;
        }
        const selPos = cur.selection.indexOf(h.id);
        if (selPos >= 0) div.classList.add("selected");
        const badge = selPos >= 0 ? `<div class="order-badge">${selPos + 1}</div>` : "";

        const s = h.stats;
        div.innerHTML = `
            ${badge}
            <div class="horse-ribbon" aria-hidden="true"><span>${h.id + 1}</span></div>
            <div class="horse-portrait-wrap" style="--portrait-glow:${h.color}">
                <img class="horse-portrait" src="assets/art/horses/horse${h.id + 1}.png" alt="${h.name}の肖像" width="160" height="160">
            </div>
            <div class="hname">${h.id + 1}. ${h.name}</div>
            ${oddsLine}
            <div class="meters">
                ${meter("スピード", s.speed, "", "speed")}
                ${meter("スタミナ", s.stamina, "", "stamina")}
                ${meter("瞬発力", s.kick, "", "kick")}
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
    if (cur.phase === "idle") {
        cur.selection = [horse.id];
        if (cur.reviveMode) {
            cur.type = cur.engine.betTypes.find((t) => t.key === "win") || cur.engine.betTypes[0];
            cur.phase = "amount";
        } else {
            cur.phase = "type";
        }
        renderTabs(); renderHorses(); renderSelection();
        return;
    }
    if (cur.phase !== "horses") return;
    const type = cur.type;
    const pos = cur.selection.indexOf(horse.id);
    if (pos >= 0) cur.selection.splice(pos, 1);
    else if (cur.selection.length < type.nPick) cur.selection.push(horse.id);
    if (cur.selection.length === type.nPick) cur.phase = "amount";
    renderHorses();
    renderSelection();
}

function renderSelection() {
    const type = cur.type;
    const bar = document.getElementById("selection-bar");
    const preview = document.getElementById("odds-preview");
    const confirm = document.getElementById("confirm-bet");
    const panel = document.getElementById("bet-action-panel");
    const placeholder = document.getElementById("bet-panel-placeholder");
    const typePanel = document.getElementById("bettype-panel");
    const amountPanel = document.getElementById("amount-panel");
    const flowActions = document.getElementById("bet-flow-actions");
    const instruction = document.getElementById("pick-instruction");
    document.getElementById("screen-pick").dataset.betPhase = cur.phase;
    const names = cur.selection.map((id) => {
        const h = cur.engine.horses.find((x) => x.id === id);
        return `${h.id + 1}.${h.name}`;
    });
    if (cur.phase === "idle") {
        panel.dataset.phase = "idle";
        placeholder.classList.remove("hidden");
        typePanel.classList.add("hidden");
        amountPanel.classList.add("hidden");
        flowActions.classList.add("hidden");
        bar.textContent = "馬を選んでください";
        confirm.disabled = true;
        confirm.textContent = "馬を選んでください";
        instruction.textContent = cur.reviveMode ? "↓ 復活をかける馬をタップ" : "↓ 最初に軸となる馬をタップ";
        return;
    }
    panel.dataset.phase = cur.phase;
    placeholder.classList.add("hidden");
    flowActions.classList.remove("hidden");
    typePanel.classList.toggle("hidden", cur.phase !== "type");
    amountPanel.classList.toggle("hidden", cur.phase !== "amount");
    amountPanel.classList.toggle("revive-mode", cur.reviveMode);
    amountPanel.querySelector("h3").textContent = cur.reviveMode ? "復活チャレンジの内容確認" : "最後に賭け金を決める";
    const joiner = type?.ordered ? " → " : " ・ ";
    const left = type ? type.nPick - cur.selection.length : 0;
    if (cur.phase === "type") bar.textContent = `選択馬 [${cur.selection[0] + 1}] → 賭け式を選択中`;
    else if (cur.phase === "horses") {
        const next = type.ordered ? `${cur.selection.length + 1}着になる馬` : `あと${left}頭`;
        bar.textContent = `${type.label}: ${names.join(joiner)} → ${next}を選択中`;
    } else bar.textContent = `${type.label}: ${names.join(joiner)} → 賭け金を入力`;
    instruction.textContent = cur.phase === "horses"
        ? (type.ordered ? `↓ ${cur.selection.length + 1}着になる馬を選んでください` : `↓ あと${left}頭選んでください`)
        : cur.phase === "type" ? "選んだ馬の賭け式を決めてください" : "内容を確認して賭け金を決めてください";

    const selectionReady = type && cur.selection.length === type.nPick;
    const amountReady = cur.reviveMode || (cur.amount > 0 && cur.amount <= remaining());
    if (selectionReady && cur.phase === "amount") {
        const odds = cur.engine.oddsFor(type.key, cur.selection);
        const payout = cur.reviveMode ? 3000 : Math.floor(cur.amount * odds);
        preview.innerHTML = cur.reviveMode
            ? `復活成功で <b class="number-roll">${payout.toLocaleString("ja-JP")}</b> コイン`
            : `予想オッズ <b class="number-roll">${odds}倍</b> ・ 当たれば <b class="number-roll">${payout.toLocaleString("ja-JP")}</b> コイン`;
        preview.classList.remove("hidden");
    } else {
        preview.textContent = "";
        preview.classList.add("hidden");
    }
    confirm.disabled = !(selectionReady && amountReady && cur.phase === "amount");
    if (cur.phase === "type") confirm.textContent = "賭け式を選んでください";
    else if (cur.phase === "horses") confirm.textContent = type.ordered
        ? `${cur.selection.length + 1}着になる馬を選んでください`
        : `あと${left}頭選んでください`;
    else confirm.textContent = !amountReady ? "金額を入力してください" : "この内容で賭ける";
}

function resetFlow() {
    cur.type = null;
    cur.selection = [];
    cur.phase = "idle";
    renderHorses(); renderSelection();
}

function goBack() {
    if (cur.phase === "amount" && cur.type?.nPick > 1) {
        cur.selection.pop();
        cur.phase = "horses";
    } else if (cur.phase === "horses") {
        cur.type = null;
        cur.phase = "type";
    } else {
        resetFlow();
        return;
    }
    renderTabs(); renderHorses(); renderSelection();
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
    cur.type = null;
    cur.phase = "idle";
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
    if (!cur.tickets.length) {
        el.innerHTML = '<p class="betslip-empty">まだ購入したベットはありません</p>';
        return;
    }

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
