// オンライン対戦モード。Firebase Firestore でルームを同期する。
// 全端末は horseSeed / raceSeed から決定論的に同じ馬・同じレース映像を作る。
// Firebase SDK はオンラインに入ったときだけ動的に読み込む（ローカルモードを邪魔しない）。
import { firebaseConfig } from "./firebase-config.js";
import { buildRace, settleTickets } from "./engine.js";
import { startBetPanel } from "./betui.js";
import { playRace, renderResult } from "./raceui.js";
import { showScreen, randomSeed } from "./ui.js";
import { simulateRaceData } from "./race.js";
import { makeRng } from "./rng.js";

const FB_VER = "10.12.2";
const configured = !!firebaseConfig.projectId;
let fb = null;

async function ensureDb() {
    if (fb) return fb;
    const appMod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app.js`);
    const fsMod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-firestore.js`);
    const db = fsMod.getFirestore(appMod.initializeApp(firebaseConfig));
    fb = {
        db,
        doc: fsMod.doc, setDoc: fsMod.setDoc, updateDoc: fsMod.updateDoc,
        getDoc: fsMod.getDoc, onSnapshot: fsMod.onSnapshot, deleteField: fsMod.deleteField,
    };
    return fb;
}

// このデバイス固有のID
const uid = (() => {
    let v = localStorage.getItem("keiba_uid");
    if (!v) { v = "u" + Math.random().toString(36).slice(2, 10); localStorage.setItem("keiba_uid", v); }
    return v;
})();

const o = {
    code: null, isHost: false, room: null,
    engine: null, engineSeed: null, unsub: null,
    betShownRound: -1, playedRound: -1, settledRound: -1, raceStartedRound: -1, resultShownRound: -1,
};

function roomDoc() { return fb.doc(fb.db, "rooms", o.code); }
function randomCode() {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
}

export function initOnline() {
    document.getElementById("online-create-go").addEventListener("click", createRoom);
    document.getElementById("online-join-go").addEventListener("click", joinRoom);
    document.getElementById("lobby-start").addEventListener("click", hostStartBetting);
    document.querySelectorAll("[data-leave]").forEach((b) => b.addEventListener("click", leaveRoom));
}

export function enterOnlineHome() {
    if (!configured) { showScreen("screen-online-setup-needed"); return; }
    showScreen("screen-online-home");
}

async function createRoom() {
    try { await ensureDb(); } catch (e) { alert("Firebaseに接続できませんでした"); return; }
    const name = document.getElementById("create-name").value.trim() || "ホスト";
    const funds = clampFunds(parseInt(document.getElementById("create-funds").value, 10));
    o.code = randomCode();
    o.isHost = true;
    await fb.setDoc(roomDoc(), {
        host: uid, phase: "lobby", funds, round: 0, horseSeed: 0, raceSeed: 0,
        players: { [uid]: { name, balance: funds, betDone: false, tickets: [] } },
    });
    subscribe();
}

async function joinRoom() {
    try { await ensureDb(); } catch (e) { alert("Firebaseに接続できませんでした"); return; }
    const code = document.getElementById("join-code").value.trim().toUpperCase();
    const name = document.getElementById("join-name").value.trim() || "プレイヤー";
    if (!code) { alert("合言葉を入力してください"); return; }
    o.code = code;
    const snap = await fb.getDoc(roomDoc());
    if (!snap.exists()) { alert("その合言葉の部屋が見つかりません"); o.code = null; return; }
    const room = snap.data();
    o.isHost = (room.host === uid);
    await fb.updateDoc(roomDoc(), {
        [`players.${uid}`]: { name, balance: room.funds, betDone: false, tickets: [] },
    });
    subscribe();
}

function leaveRoom() {
    if (o.unsub) { o.unsub(); o.unsub = null; }
    if (fb && o.code) fb.updateDoc(roomDoc(), { [`players.${uid}`]: fb.deleteField() }).catch(() => {});
    o.code = null; o.room = null; o.isHost = false; o.engine = null; o.engineSeed = null;
    showScreen("screen-online-home");
}

function subscribe() {
    if (o.unsub) o.unsub();
    o.unsub = fb.onSnapshot(roomDoc(), (snap) => onRoom(snap.exists() ? snap.data() : null));
}

function clampFunds(v) {
    if (isNaN(v)) return 1000;
    return Math.max(500, Math.min(5000, Math.round(v / 100) * 100));
}

function onRoom(room) {
    if (!room) { if (o.code) { alert("部屋が閉じられました"); } leaveRoom(); return; }
    o.room = room;
    const players = room.players || {};
    if (!players[uid]) {
        if (o.unsub) o.unsub();
        o.unsub = null; o.code = null;
        showScreen("screen-online-home");
        return;
    }

    if (room.horseSeed && o.engineSeed !== room.horseSeed) {
        o.engine = buildRace(room.horseSeed);
        o.engineSeed = room.horseSeed;
    }

    switch (room.phase) {
        case "lobby": renderLobby(room); break;
        case "betting": handleBetting(room); break;
        case "race": handleRace(room); break;
        case "result": handleResult(room); break;
    }

    if (o.isHost && room.phase === "betting" && allBet(room)) hostStartRace(room);
}

function allBet(room) {
    const ps = room.players || {};
    const ids = Object.keys(ps);
    return ids.length > 0 && ids.every((id) => ps[id].betDone);
}

// ---- ロビー ----
function renderLobby(room) {
    showScreen("screen-lobby");
    document.getElementById("lobby-code").textContent = o.code;
    renderPlayerList("lobby-players", room, null);
    const startBtn = document.getElementById("lobby-start");
    const note = document.getElementById("lobby-note");
    if (o.isHost) {
        startBtn.classList.remove("hidden");
        note.textContent = "全員そろったら「ゲーム開始」を押してください";
    } else {
        startBtn.classList.add("hidden");
        note.textContent = "ホストの開始を待っています…";
    }
}

function renderPlayerList(elId, room, statusFn) {
    const el = document.getElementById(elId);
    el.innerHTML = "";
    const ps = room.players || {};
    Object.keys(ps).forEach((id) => {
        const p = ps[id];
        const li = document.createElement("li");
        const tag = id === room.host ? " 👑" : "";
        const me = id === uid ? "（あなた）" : "";
        const status = statusFn ? statusFn(p) : `${p.balance} コイン`;
        li.innerHTML = `<span>${p.name}${tag}${me}</span><span class="coins">${status}</span>`;
        el.appendChild(li);
    });
}

// ---- ベット ----
function hostStartBetting() {
    const round = (o.room.round || 0) + 1;
    const updates = { phase: "betting", round, horseSeed: randomSeed(), raceSeed: 0 };
    Object.keys(o.room.players || {}).forEach((id) => {
        updates[`players.${id}.betDone`] = false;
        updates[`players.${id}.tickets`] = [];
    });
    fb.updateDoc(roomDoc(), updates);
}

function handleBetting(room) {
    const me = room.players[uid];
    if (me.betDone) {
        showScreen("screen-wait");
        document.getElementById("wait-title").textContent = "他のプレイヤーの賭けを待っています";
        renderPlayerList("wait-players", room, (p) => (p.betDone ? "✅ 賭けた" : "…考え中"));
        return;
    }
    if (o.betShownRound === room.round || !o.engine) return;
    o.betShownRound = room.round;

    document.getElementById("name-wrap").classList.add("hidden");
    document.getElementById("pick-title").textContent = `${me.name} さんの賭け`;
    showScreen("screen-pick");
    startBetPanel({
        engine: o.engine,
        balance: me.balance,
        onComplete: (tickets) => fb.updateDoc(roomDoc(), {
            [`players.${uid}.tickets`]: tickets || [],
            [`players.${uid}.betDone`]: true,
        }),
    });
}

// ---- レース ----
function hostStartRace(room) {
    if (o.raceStartedRound === room.round) return;
    o.raceStartedRound = room.round;
    fb.updateDoc(roomDoc(), { raceSeed: randomSeed(), phase: "race" });
}

async function handleRace(room) {
    if (!room.raceSeed || !o.engine) return;
    if (o.playedRound === room.round) return;
    o.playedRound = room.round;

    const ordered = await playRace(o.engine.horses, room.raceSeed);
    const orderIds = ordered.map((h) => h.id);

    if (o.isHost && o.settledRound !== room.round) {
        o.settledRound = room.round;
        const ps = o.room.players || {};
        const updates = { phase: "result" };
        Object.keys(ps).forEach((id) => {
            const res = settleTickets(ps[id].tickets, orderIds, o.engine.horses, o.engine.byKey);
            updates[`players.${id}.balance`] = ps[id].balance + res.delta;
        });
        await fb.updateDoc(roomDoc(), updates);
    }
    maybeShowResult(o.room);
}

// ---- 結果 ----
function handleResult(room) { maybeShowResult(room); }

function maybeShowResult(room) {
    if (!room || room.phase !== "result") return;
    if (o.playedRound !== room.round) return;
    if (o.resultShownRound === room.round) return;
    if (!o.engine) return;
    o.resultShownRound = room.round;

    const ordered = orderFromSeed(room);
    const orderIds = ordered.map((h) => h.id);
    const ps = room.players || {};

    const payoutRows = Object.keys(ps).map((id) => {
        const res = settleTickets(ps[id].tickets, orderIds, o.engine.horses, o.engine.byKey);
        return { name: ps[id].name + (id === uid ? "（あなた）" : ""), detail: res.detail, delta: res.delta };
    });
    const standings = Object.keys(ps)
        .map((id) => ({ name: ps[id].name, balance: ps[id].balance }))
        .sort((a, b) => b.balance - a.balance);

    renderResult(ordered, payoutRows, standings, {
        primaryLabel: o.isHost ? "次のレースへ" : "",
        onPrimary: o.isHost ? hostStartBetting : null,
        secondaryLabel: "退出する",
        onSecondary: leaveRoom,
        note: o.isHost ? "" : "ホストが次のレースを始めるのを待っています…",
    });
}

function orderFromSeed(room) {
    const data = simulateRaceData(o.engine.horses, makeRng(room.raceSeed));
    return data.order.map((i) => o.engine.horses[i]);
}
