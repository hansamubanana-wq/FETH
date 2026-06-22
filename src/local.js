import { buildRace, settleTickets, bestPerType, NUM_HORSES } from "./engine.js";
import { startBetPanel } from "./betui.js";
import { playRace, renderResult } from "./raceui.js";
import { showScreen, randomSeed } from "./ui.js";
import { pickNames } from "./names.js";

const MIN_PLAYERS = 1, MAX_PLAYERS = 8;
const FUNDS_MIN = 500, FUNDS_MAX = 10000, FUNDS_STEP = 100;
const REVIVE_BALANCE = 3000;

const s = {
    numPlayers: 2,
    startingFunds: 1000,
    players: [],
    bets: [],
    engine: null,
    picker: 0,
    firstRound: true,
};

export function initLocal() {
    setupCounter("player-count", "player-minus", "player-plus", "numPlayers", MIN_PLAYERS, MAX_PLAYERS, 1);
    setupCounter("funds-count", "funds-minus", "funds-plus", "startingFunds", FUNDS_MIN, FUNDS_MAX, FUNDS_STEP);

    document.getElementById("to-pick").addEventListener("click", () => {
        s.players = Array.from({ length: s.numPlayers }, (_, i) => ({
            name: `プレイヤー${i + 1}`,
            balance: s.startingFunds,
            bankrupt: false,
        }));
        s.firstRound = true;
        startRound();
    });
}

export function enterLocalSetup() {
    document.getElementById("player-count").textContent = s.numPlayers;
    document.getElementById("funds-count").textContent = s.startingFunds;
    showScreen("screen-setup");
}

function setupCounter(outId, minusId, plusId, key, min, max, step) {
    const out = document.getElementById(outId);
    out.textContent = s[key];
    document.getElementById(minusId).addEventListener("click", () => {
        s[key] = Math.max(min, s[key] - step);
        out.textContent = s[key];
    });
    document.getElementById(plusId).addEventListener("click", () => {
        s[key] = Math.min(max, s[key] + step);
        out.textContent = s[key];
    });
}

function startRound() {
    s.engine = buildRace(randomSeed(), pickNames(NUM_HORSES));
    s.bets = [];
    s.picker = 0;
    renderPicker();
    showScreen("screen-pick");
}

function renderPicker() {
    const idx = s.picker;
    const player = s.players[idx];
    document.getElementById("pick-title").textContent = player.bankrupt
        ? `${player.name} 復活チャレンジ`
        : (s.firstRound ? `プレイヤー${idx + 1} の番` : `${player.name} の番`);

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
        balance: player.bankrupt ? 0 : player.balance,
        reviveMode: !!player.bankrupt,
        onComplete: (tickets) => {
            if (s.firstRound) player.name = nameInput.value.trim() || `プレイヤー${idx + 1}`;
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

    const payoutRows = s.bets.map((tickets, i) => settlePlayer(s.players[i], tickets || [], orderIds));
    const standings = [...s.players]
        .sort((a, b) => b.balance - a.balance)
        .map((p) => ({ name: p.name, balance: p.balance, bankrupt: !!p.bankrupt }));
    const hasBankrupt = s.players.some((p) => p.bankrupt);

    renderResult(ordered, payoutRows, standings, {
        primaryLabel: "同じメンバーでもう一度",
        onPrimary: () => {
            s.firstRound = false;
            startRound();
        },
        secondaryLabel: "最初から（残高リセット）",
        onSecondary: () => enterLocalSetup(),
        note: hasBankrupt ? "破産中の人は次レースで単勝を当てると3000コインで復活できます。" : "",
        gameOver: false,
        bestBets: bestPerType(orderIds, s.engine),
    });
}

function settlePlayer(player, tickets, orderIds) {
    if (player.bankrupt) {
        const reviveHit = tickets.some((t) =>
            t.revive && t.typeKey === "win" && s.engine.byKey.win.test(orderIds, t.sel || []));
        if (reviveHit) {
            player.balance = REVIVE_BALANCE;
            player.bankrupt = false;
            return { name: player.name, detail: "復活成功: 単勝的中で3000コイン復帰", delta: REVIVE_BALANCE };
        }
        player.balance = 0;
        player.bankrupt = true;
        return { name: `${player.name} [破産中]`, detail: "復活失敗: 破産状態が続きます", delta: 0 };
    }

    const res = settleTickets(tickets, orderIds, s.engine.horses, s.engine.byKey);
    player.balance = Math.max(0, player.balance + res.delta);
    player.bankrupt = player.balance <= 0;
    return {
        name: player.bankrupt ? `${player.name} [破産中]` : player.name,
        detail: res.detail,
        delta: res.delta,
    };
}
