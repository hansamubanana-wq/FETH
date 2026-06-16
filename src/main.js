import { drawHorses } from "./horses.js";
import { Race } from "./race.js";

const MIN_PLAYERS = 1, MAX_PLAYERS = 8;
const MIN_HORSES = 2, MAX_HORSES = 12;
const FUNDS_MIN = 500, FUNDS_MAX = 5000, FUNDS_STEP = 100;
const BET_STEP = 100;

const state = {
    numPlayers: 2,
    numHorses: 6,
    startingFunds: 1000,
    horses: [],
    players: [],      // { name, balance } ラウンドをまたいで持ち越す
    bets: [],         // { horseId, amount } 今ラウンドの賭け（playerと同じindex）
    currentPicker: 0,
    betAmount: 100,   // 今操作中のプレイヤーの賭け金
    firstRound: true, // 名前入力を出すかどうか
    race: null,
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
    // プレイヤーを初期残高つきで作成
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

    // 賭け金の初期値（残高を超えない範囲で100、残高0なら0）
    state.betAmount = Math.min(BET_STEP, player.balance);
    updateBetDisplay();

    // 馬一覧
    const grid = document.getElementById("horse-choices");
    grid.innerHTML = "";
    for (const h of state.horses) {
        const div = document.createElement("div");
        div.className = "horse-pick";
        const backers = h.backers.length ? `賭けた人: ${h.backers.join(", ")}` : "";
        div.innerHTML = `
            <div class="emoji" style="filter:drop-shadow(0 0 6px ${h.color})">${h.emoji}</div>
            <div class="hname">${h.id + 1}. ${h.name}</div>
            <div class="odds">単勝オッズ ${h.odds}倍</div>
            <div class="takenby">${backers}</div>
        `;
        div.style.borderColor = h.color;
        div.addEventListener("click", () => pickHorse(h));
        grid.appendChild(div);
    }
}

function updateBetDisplay() {
    document.getElementById("bet-amount").textContent = state.betAmount;
}

function clampBet() {
    const max = state.players[state.currentPicker].balance;
    state.betAmount = Math.max(0, Math.min(state.betAmount, max));
    // ステップに丸める（全額などで端数が出ても許容）
}

document.getElementById("bet-minus").addEventListener("click", () => {
    state.betAmount -= BET_STEP;
    clampBet();
    updateBetDisplay();
});
document.getElementById("bet-plus").addEventListener("click", () => {
    state.betAmount += BET_STEP;
    clampBet();
    updateBetDisplay();
});
document.querySelectorAll(".bet-quick button").forEach((btn) => {
    btn.addEventListener("click", () => {
        const bal = state.players[state.currentPicker].balance;
        const v = btn.dataset.bet;
        if (v === "0") state.betAmount = 0;
        else if (v === "half") state.betAmount = Math.floor(bal / 2);
        else if (v === "all") state.betAmount = bal;
        clampBet();
        updateBetDisplay();
    });
});

function pickHorse(horse) {
    const idx = state.currentPicker;
    const player = state.players[idx];

    if (state.firstRound) {
        player.name = document.getElementById("player-name").value.trim() || `プレイヤー${idx + 1}`;
    }

    const amount = state.betAmount;
    horse.backers.push(player.name);
    state.bets.push({ horseId: horse.id, amount });
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
    const startBtn = document.getElementById("start-race");
    startBtn.disabled = true;
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
    const winnerHorse = orderedHorses[0];

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

    // 払い戻しを計算して残高に反映
    const payoutsDiv = document.getElementById("payouts");
    payoutsDiv.innerHTML = "";
    state.bets.forEach((bet, i) => {
        const player = state.players[i];
        const horse = state.horses.find((h) => h.id === bet.horseId);
        const won = bet.horseId === winnerHorse.id;
        let delta = 0;
        let detail = "";

        if (bet.amount === 0) {
            detail = "賭けなし";
        } else if (won) {
            const payout = Math.floor(bet.amount * parseFloat(horse.odds));
            delta = payout - bet.amount;
            player.balance += delta;
            detail = `${horse.name} に ${bet.amount} → 払い戻し ${payout}`;
        } else {
            delta = -bet.amount;
            player.balance += delta;
            detail = `${horse.name} に ${bet.amount}（はずれ）`;
        }

        const row = document.createElement("div");
        row.className = "payout-row";
        const deltaStr =
            delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0";
        const cls = delta > 0 ? "win" : delta < 0 ? "lose" : "";
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
            li.innerHTML = `<span>${medals[i] || i + 1 + "位"} ${p.name}</span><span class="coins">${p.balance} コイン</span>`;
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
