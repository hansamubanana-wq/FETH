// ローカル（1台で順番に回す）モードのコントローラ。
import { buildRace, settleTickets, bestPerType, NUM_HORSES } from "./engine.js";
import { startBetPanel } from "./betui.js";
import { playRace, renderResult } from "./raceui.js";
import { showScreen, randomSeed } from "./ui.js";

const MIN_PLAYERS = 1, MAX_PLAYERS = 8;
const FUNDS_MIN = 500, FUNDS_MAX = 10000, FUNDS_STEP = 100;

const s = {
    numPlayers: 2,
    startingFunds: 1000,
    players: [],     // { name, balance }
    bets: [],        // { typeKey, sel, amount, odds } | null
    engine: null,
    picker: 0,
    firstRound: true,
};

export function initLocal() {
    setupCounter("player-count", "player-minus", "player-plus", "numPlayers", MIN_PLAYERS, MAX_PLAYERS, 1);
    setupCounter("funds-count", "funds-minus", "funds-plus", "startingFunds", FUNDS_MIN, FUNDS_MAX, FUNDS_STEP);

    document.getElementById("to-pick").addEventListener("click", () => {
        s.players = Array.from({ length: s.numPlayers }, (_, i) => ({
            name: `プレイヤー${i + 1}`, balance: s.startingFunds,
        }));
        s.firstRound = true;
        startRound();
    });
}

// ホームから「ローカル」を選んだとき
export function enterLocalSetup() {
    document.getElementById("player-count").textContent = s.numPlayers;
    document.getElementById("funds-count").textContent = s.startingFunds;
    showScreen("screen-setup");
}

function setupCounter(outId, minusId, plusId, key, min, max, step) {
    const out = document.getElementById(outId);
    out.textContent = s[key];
    document.getElementById(minusId).addEventListener("click", () => {
        s[key] = Math.max(min, s[key] - step); out.textContent = s[key];
    });
    document.getElementById(plusId).addEventListener("click", () => {
        s[key] = Math.min(max, s[key] + step); out.textContent = s[key];
    });
}

function startRound() {
    s.engine = buildRace(randomSeed());
    s.bets = [];
    s.picker = 0;
    renderPicker();
    showScreen("screen-pick");
}

function renderPicker() {
    const idx = s.picker;
    const player = s.players[idx];
    document.getElementById("pick-title").textContent =
        s.firstRound ? `プレイヤー${idx + 1} の番` : `${player.name} の番`;

    const nameWrap = document.getElementById("name-wrap");
    const nameInput = document.getElementById("player-name");
    if (s.firstRound) {
        nameWrap.classList.remove("hidden");
        nameInput.value = "";
        nameInput.placeholder = `プレイヤー${idx + 1}`;
    } else {
        nameWrap.classList.add("hidden");
    }

    startBetPanel({
        engine: s.engine,
        balance: player.balance,
        onComplete: (tickets) => {
            if (s.firstRound) {
                player.name = nameInput.value.trim() || `プレイヤー${idx + 1}`;
            }
            s.bets.push(tickets);
            s.picker++;
            if (s.picker >= s.numPlayers) runRaceAndResult();
            else renderPicker();
        },
    });
}

async function runRaceAndResult() {
    const raceSeed = randomSeed();
    const ordered = await playRace(s.engine.horses, raceSeed, {
        engine: s.engine,
        players: s.players.map((p, i) => ({ name: p.name, tickets: s.bets[i] })),
    });
    const orderIds = ordered.map((h) => h.id);

    const payoutRows = s.bets.map((tickets, i) => {
        const player = s.players[i];
        const res = settleTickets(tickets, orderIds, s.engine.horses, s.engine.byKey);
        player.balance += res.delta;
        return { name: player.name, detail: res.detail, delta: res.delta };
    });
    const standings = [...s.players].sort((a, b) => b.balance - a.balance)
        .map((p) => ({ name: p.name, balance: p.balance }));

    // 誰かが破産（残高0以下）したらゲーム終了→ランキング表示→リセットしてやり直し
    const bankrupt = s.players.some((p) => p.balance <= 0);

    renderResult(ordered, payoutRows, standings, {
        primaryLabel: bankrupt ? "リセットしてもう一度" : "同じメンバーでもう一度",
        onPrimary: () => {
            if (bankrupt) s.players.forEach((p) => { p.balance = s.startingFunds; });
            s.firstRound = false;
            startRound();
        },
        secondaryLabel: "最初から（残高リセット）",
        onSecondary: () => enterLocalSetup(),
        note: bankrupt ? "破産者が出たので、全員の残高をリセットして再戦できます。" : "",
        gameOver: bankrupt,
        bestBets: bestPerType(orderIds, s.engine),
    });
}

// NUM_HORSES を参照（8頭固定の明示）
void NUM_HORSES;
