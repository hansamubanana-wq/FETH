import { drawHorses } from "./horses.js";
import { Race } from "./race.js";

const MIN_PLAYERS = 1, MAX_PLAYERS = 8;
const MIN_HORSES = 2, MAX_HORSES = 12;

const state = {
    numPlayers: 2,
    numHorses: 6,
    horses: [],
    players: [],      // { name, horseId }
    currentPicker: 0,
    race: null,
};

// ---- 画面切り替え ----
function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

// ---- カウンター ----
function setupCounter(outputId, minusId, plusId, key, min, max, onChange) {
    const out = document.getElementById(outputId);
    out.textContent = state[key];
    const render = () => {
        out.textContent = state[key];
        if (onChange) onChange();
    };
    document.getElementById(minusId).addEventListener("click", () => {
        state[key] = Math.max(min, state[key] - 1);
        render();
    });
    document.getElementById(plusId).addEventListener("click", () => {
        state[key] = Math.min(max, state[key] + 1);
        render();
    });
}

setupCounter("player-count", "player-minus", "player-plus", "numPlayers", MIN_PLAYERS, MAX_PLAYERS);
setupCounter("horse-count", "horse-minus", "horse-plus", "numHorses", MIN_HORSES, MAX_HORSES);

// ---- セットアップ → 馬選び ----
document.getElementById("to-pick").addEventListener("click", () => {
    state.horses = drawHorses(state.numHorses);
    state.players = [];
    state.currentPicker = 0;
    renderPick();
    show("screen-pick");
});

// ---- 馬選び画面 ----
function renderPick() {
    const idx = state.currentPicker;
    document.getElementById("pick-title").textContent = `プレイヤー${idx + 1} の番`;
    const nameInput = document.getElementById("player-name");
    nameInput.value = "";
    nameInput.placeholder = `プレイヤー${idx + 1}`;

    const grid = document.getElementById("horse-choices");
    grid.innerHTML = "";
    for (const h of state.horses) {
        const div = document.createElement("div");
        div.className = "horse-pick";
        const backers = h.backers.length ? h.backers.join(", ") : "";
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

function pickHorse(horse) {
    const idx = state.currentPicker;
    const name = document.getElementById("player-name").value.trim() || `プレイヤー${idx + 1}`;
    horse.backers.push(name);
    state.players.push({ name, horseId: horse.id });
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
    state.race._draw(); // 初期描画
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
    const list = document.getElementById("result-list");
    list.innerHTML = "";
    const medals = ["🥇", "🥈", "🥉"];
    orderedHorses.forEach((h, i) => {
        const li = document.createElement("li");
        const backers = h.backers.length ? `（${h.backers.join(", ")}）` : "";
        li.innerHTML = `
            <span class="rank">${medals[i] || i + 1}</span>
            <span class="emoji" style="filter:drop-shadow(0 0 4px ${h.color})">${h.emoji}</span>
            <span>${h.id + 1}. ${h.name} ${backers}</span>
        `;
        list.appendChild(li);
    });

    // 勝者（1着の馬を選んでいたプレイヤー）
    const winnerHorse = orderedHorses[0];
    const winnersDiv = document.getElementById("winners");
    if (winnerHorse.backers.length) {
        winnersDiv.innerHTML = `🎉 <b>${winnerHorse.backers.join("・")}</b> さんの勝ち！<br>応援した <b>${winnerHorse.name}</b> が1着でした！`;
    } else {
        winnersDiv.innerHTML = `今回 <b>${winnerHorse.name}</b> を選んだ人はいませんでした…！`;
    }
}

// ---- もう一度／最初から ----
document.getElementById("rematch").addEventListener("click", () => {
    // 同じプレイヤーで新しい馬を引き直す
    state.horses = drawHorses(state.numHorses);
    state.currentPicker = 0;
    state.players = [];
    renderPick();
    show("screen-pick");
});

document.getElementById("back-to-setup").addEventListener("click", () => {
    show("screen-setup");
});
