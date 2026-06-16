import { drawHorses } from "./horses.js";
import { Race, simulateOrder } from "./race.js";
import { buildBetTypes, evalOdds } from "./bets.js";

const MIN_PLAYERS = 1, MAX_PLAYERS = 8;
const MIN_HORSES = 2, MAX_HORSES = 12;
const FUNDS_MIN = 500, FUNDS_MAX = 5000, FUNDS_STEP = 100;
const BET_STEP = 100;
const SIM_RUNS = 3000; // オッズ算出用のシミュレーション回数

const state = {
    numPlayers: 2,
    numHorses: 6,
    startingFunds: 1000,
    horses: [],
    players: [],       // { name, balance } ラウンドをまたいで持ち越す
    bets: [],          // { type, sel, amount, odds } 今ラウンドの賭け（playerと同じindex）
    currentPicker: 0,
    betAmount: 100,
    firstRound: true,
    race: null,
    simOrders: [],     // オッズ算出用の擬似レース結果
    betTypes: [],      // 今ラウンドで使える賭け式
    placeN: 3,
    // 操作中プレイヤーの選択状態
    currentType: null,
    selection: [],     // 選んだ horse.id（タップ順）
};

// ---- 画面切り替え ----
function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

// ---- カウンター（step対応） ----
function setupCounter(outputId, minusId, plusId, key, min, max, step) {
    const out = document.getElementById(outputId);
    out.textContent = state[key];
    document.getElementById(minusId).addEventListener("click", () => {
        state[key] = Math.max(min, state[key] - step);
        out.textContent = state[key];
    });
    document.getElementById(plusId).addEventListener("click", () => {
        state[key] = Math.min(max, state[key] + step);
        out.textContent = state[key];
    });
}

setupCounter("player-count", "player-minus", "player-plus", "numPlayers", MIN_PLAYERS, MAX_PLAYERS, 1);
setupCounter("horse-count", "horse-minus", "horse-plus", "numHorses", MIN_HORSES, MAX_HORSES, 1);
setupCounter("funds-count", "funds-minus", "funds-plus", "startingFunds", FUNDS_MIN, FUNDS_MAX, FUNDS_STEP);

// ---- セットアップ → ベット ----
document.getElementById("to-pick").addEventListener("click", () => {
    state.players = Array.from({ length: state.numPlayers }, (_, i) => ({
        name: `プレイヤー${i + 1}`,
        balance: state.startingFunds,
    }));
    state.firstRound = true;
    startBettingRound();
});

// ---- 1ラウンドのベット開始 ----
function startBettingRound() {
    state.horses = drawHorses(state.numHorses);

    // 出走頭数で複勝/ワイドの「○着以内」を決める（実競馬に近い目安）
    state.placeN = state.numHorses >= 8 ? 3 : 2;
    const all = buildBetTypes(state.placeN);
    state.betTypes = all.filter((t) => state.numHorses >= t.nPick);

    // オッズ算出用にレースを多数シミュレーション
    state.simOrders = [];
    for (let i = 0; i < SIM_RUNS; i++) {
        state.simOrders.push(simulateOrder(state.horses));
    }

    state.bets = [];
    state.currentPicker = 0;
    renderPick();
    show("screen-pick");
}

// ---- ベット画面 ----
function renderPick() {
    const idx = state.currentPicker;
    const player = state.players[idx];

    document.getElementById("pick-title").textContent =
        state.firstRound ? `プレイヤー${idx + 1} の番` : `${player.name} の番`;
    document.getElementById("pick-balance").textContent = player.balance;

    // 名前入力は初回ラウンドのみ
    const nameWrap = document.getElementById("name-wrap");
    const nameInput = document.getElementById("player-name");
    if (state.firstRound) {
        nameWrap.classList.remove("hidden");
        nameInput.value = "";
        nameInput.placeholder = `プレイヤー${idx + 1}`;
    } else {
        nameWrap.classList.add("hidden");
    }

    // 賭け式・選択状態を初期化
    state.currentType = state.betTypes[0];
    state.selection = [];

    // 賭け金の初期値
    state.betAmount = Math.min(BET_STEP, player.balance);
    updateBetDisplay();

    renderBetTypeTabs();
    renderHorses();
    renderSelection();
}

// 賭け式タブ
function renderBetTypeTabs() {
    const tabs = document.getElementById("bettype-tabs");
    tabs.innerHTML = "";
    for (const t of state.betTypes) {
        const btn = document.createElement("button");
        btn.textContent = t.label;
        btn.className = t === state.currentType ? "active" : "";
        btn.addEventListener("click", () => {
            state.currentType = t;
            state.selection = [];
            renderBetTypeTabs();
            renderHorses();
            renderSelection();
        });
        tabs.appendChild(btn);
    }
    document.getElementById("bettype-desc").textContent = state.currentType.desc;
    document.getElementById("pick-instruction").textContent = "↓ " + state.currentType.instruction;
}

// 馬カード
function renderHorses() {
    const type = state.currentType;
    const grid = document.getElementById("horse-choices");
    grid.innerHTML = "";
    for (const h of state.horses) {
        const div = document.createElement("div");
        div.className = "horse-pick";
        div.style.borderColor = h.color;

        // 単勝・複勝など1頭選びの式は、各馬の想定オッズをカードに表示
        let oddsLine = "";
        if (type.nPick === 1) {
            const o = evalOdds(type, [h.id], state.simOrders);
            oddsLine = `<div class="odds">${type.label}オッズ ${o}倍</div>`;
        }

        const selPos = state.selection.indexOf(h.id);
        if (selPos >= 0) div.classList.add("selected");
        const badge = (selPos >= 0 && type.ordered)
            ? `<div class="order-badge">${selPos + 1}</div>` : "";

        div.innerHTML = `
            ${badge}
            <div class="emoji" style="filter:drop-shadow(0 0 6px ${h.color})">${h.emoji}</div>
            <div class="hname">${h.id + 1}. ${h.name}</div>
            ${oddsLine}
        `;
        div.addEventListener("click", () => tapHorse(h));
        grid.appendChild(div);
    }
}

function tapHorse(horse) {
    const type = state.currentType;

    if (type.nPick === 1) {
        // 1頭選びは即確定
        placeBet([horse.id]);
        return;
    }

    // 複数頭選び：トグル選択
    const pos = state.selection.indexOf(horse.id);
    if (pos >= 0) {
        state.selection.splice(pos, 1);
    } else if (state.selection.length < type.nPick) {
        state.selection.push(horse.id);
    }
    renderHorses();
    renderSelection();
}

function renderSelection() {
    const type = state.currentType;
    const bar = document.getElementById("selection-bar");
    const preview = document.getElementById("odds-preview");
    const confirm = document.getElementById("confirm-bet");

    if (type.nPick === 1) {
        bar.textContent = "";
        preview.classList.add("hidden");
        confirm.classList.add("hidden");
        return;
    }

    const names = state.selection.map((id) => {
        const h = state.horses.find((x) => x.id === id);
        return `${h.id + 1}.${h.name}`;
    });
    const joiner = type.ordered ? " → " : " ・ ";
    bar.textContent = names.length
        ? `選択中: ${names.join(joiner)}（${state.selection.length}/${type.nPick}）`
        : `${type.nPick}頭 選んでください`;

    if (state.selection.length === type.nPick) {
        const odds = evalOdds(type, state.selection, state.simOrders);
        const payout = Math.floor(state.betAmount * odds);
        preview.innerHTML = `予想オッズ <b>${odds}倍</b> ／ 当たれば <b>${payout}</b> コイン`;
        preview.classList.remove("hidden");
        confirm.classList.remove("hidden");
    } else {
        preview.classList.add("hidden");
        confirm.classList.add("hidden");
    }
}

// ---- 賭け金コントロール ----
function updateBetDisplay() {
    document.getElementById("bet-amount").textContent = state.betAmount;
}
function clampBet() {
    const max = state.players[state.currentPicker].balance;
    state.betAmount = Math.max(0, Math.min(state.betAmount, max));
}
document.getElementById("bet-minus").addEventListener("click", () => {
    state.betAmount -= BET_STEP; clampBet(); updateBetDisplay(); renderSelection();
});
document.getElementById("bet-plus").addEventListener("click", () => {
    state.betAmount += BET_STEP; clampBet(); updateBetDisplay(); renderSelection();
});
document.querySelectorAll(".bet-quick button").forEach((btn) => {
    btn.addEventListener("click", () => {
        const bal = state.players[state.currentPicker].balance;
        const v = btn.dataset.bet;
        if (v === "half") state.betAmount = Math.floor(bal / 2);
        else if (v === "all") state.betAmount = bal;
        clampBet(); updateBetDisplay(); renderSelection();
    });
});

document.getElementById("confirm-bet").addEventListener("click", () => {
    if (state.selection.length === state.currentType.nPick) {
        placeBet([...state.selection]);
    }
});

document.getElementById("skip-bet").addEventListener("click", () => {
    saveNameIfFirst();
    state.bets.push({ type: null, sel: [], amount: 0, odds: 0 });
    advancePicker();
});

// ---- 賭けを確定 ----
function placeBet(sel) {
    const type = state.currentType;
    const amount = state.betAmount;

    // 賭け金0なら賭けなし扱い
    if (amount <= 0) {
        saveNameIfFirst();
        state.bets.push({ type: null, sel: [], amount: 0, odds: 0 });
        advancePicker();
        return;
    }

    const odds = evalOdds(type, sel, state.simOrders);
    saveNameIfFirst();
    const player = state.players[state.currentPicker];
    for (const id of sel) {
        state.horses.find((h) => h.id === id).backers.push(player.name);
    }
    state.bets.push({ type, sel, amount, odds });
    advancePicker();
}

function saveNameIfFirst() {
    if (!state.firstRound) return;
    const idx = state.currentPicker;
    const v = document.getElementById("player-name").value.trim();
    state.players[idx].name = v || `プレイヤー${idx + 1}`;
}

function advancePicker() {
    state.currentPicker++;
    if (state.currentPicker >= state.numPlayers) {
        goToRace();
    } else {
        renderPick();
    }
}

// ---- レース画面 ----
function goToRace() {
    show("screen-race");
    const canvas = document.getElementById("track");
    state.race = new Race(canvas, state.horses);
    state.race._draw();
    document.getElementById("race-status").textContent = "よーい…";
    const startBtn = document.getElementById("start-race");
    startBtn.disabled = false;
    startBtn.textContent = "スタート！";
}

document.getElementById("start-race").addEventListener("click", () => {
    document.getElementById("start-race").disabled = true;
    const status = document.getElementById("race-status");
    let count = 3;
    status.textContent = count;
    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            status.textContent = count;
        } else {
            clearInterval(timer);
            status.textContent = "🏇 レース中！";
            runRace();
        }
    }, 700);
});

function runRace() {
    state.race.onFinish = (orderedHorses) => {
        document.getElementById("race-status").textContent = "ゴール！";
        setTimeout(() => showResult(orderedHorses), 900);
    };
    state.race.start();
}

// ---- 結果画面 ----
function showResult(orderedHorses) {
    show("screen-result");
    const order = orderedHorses.map((h) => h.id); // ゴール順 id 配列

    // 着順
    const list = document.getElementById("result-list");
    list.innerHTML = "";
    const medals = ["🥇", "🥈", "🥉"];
    orderedHorses.forEach((h, i) => {
        const li = document.createElement("li");
        li.innerHTML = `
            <span class="rank">${medals[i] || i + 1}</span>
            <span class="emoji" style="filter:drop-shadow(0 0 4px ${h.color})">${h.emoji}</span>
            <span>${h.id + 1}. ${h.name}</span>
        `;
        list.appendChild(li);
    });

    // 払い戻し
    const payoutsDiv = document.getElementById("payouts");
    payoutsDiv.innerHTML = "";
    state.bets.forEach((bet, i) => {
        const player = state.players[i];
        let delta = 0;
        let detail = "";

        if (!bet.type || bet.amount === 0) {
            detail = "賭けなし";
        } else {
            const horseLabel = bet.sel
                .map((id) => state.horses.find((h) => h.id === id).id + 1)
                .join(bet.type.ordered ? "→" : "・");
            const won = bet.type.test(order, bet.sel);
            if (won) {
                const payout = Math.floor(bet.amount * bet.odds);
                delta = payout - bet.amount;
                player.balance += delta;
                detail = `${bet.type.label} [${horseLabel}] ${bet.amount} → 払戻 ${payout}（${bet.odds}倍）`;
            } else {
                delta = -bet.amount;
                player.balance += delta;
                detail = `${bet.type.label} [${horseLabel}] ${bet.amount}（はずれ）`;
            }
        }

        const deltaStr = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0";
        const cls = delta > 0 ? "win" : delta < 0 ? "lose" : "";
        const row = document.createElement("div");
        row.className = "payout-row";
        row.innerHTML = `
            <div>
                <div class="who">${player.name}</div>
                <div class="detail">${detail}</div>
            </div>
            <div class="delta ${cls}">${deltaStr}</div>
        `;
        payoutsDiv.appendChild(row);
    });

    // 所持コイン順位
    const standings = document.getElementById("standings");
    standings.innerHTML = "";
    [...state.players]
        .sort((a, b) => b.balance - a.balance)
        .forEach((p, i) => {
            const li = document.createElement("li");
            const rank = medals[i] || `${i + 1}位`;
            li.innerHTML = `<span>${rank} ${p.name}</span><span class="coins">${p.balance} コイン</span>`;
            standings.appendChild(li);
        });
}

// ---- もう一度／最初から ----
document.getElementById("rematch").addEventListener("click", () => {
    state.firstRound = false; // 名前と残高は持ち越し
    startBettingRound();
});

document.getElementById("back-to-setup").addEventListener("click", () => {
    show("screen-setup");
});
