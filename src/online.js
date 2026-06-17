// オンライン対戦モード。Firebase Firestore でルームを同期する。
// 全端末は horseSeed / raceSeed から決定論的に同じ馬・同じレース映像を作る。
// Firebase SDK はオンラインに入ったときだけ動的に読み込む（ローカルモードを邪魔しない）。
import { firebaseConfig } from "./firebase-config.js";
import { buildRace, settleTickets, bestBet } from "./engine.js";
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
        getDoc: fsMod.getDoc, onSnapshot: fsMod.onSnapshot,
        deleteField: fsMod.deleteField, deleteDoc: fsMod.deleteDoc,
    };
    return fb;
}

// このデバイス固有のID
const uid = (() => {
    let v = localStorage.getItem("keiba_uid");
    if (!v) { v = "u" + Math.random().toString(36).slice(2, 10); localStorage.setItem("keiba_uid", v); }
    return v;
})();

// 名前・現在のルーム・最近の合言葉（フレンド/お気に入り）を保存する
const LS = { name: "keiba_name", active: "keiba_active", recent: "keiba_recent" };
const getName = () => localStorage.getItem(LS.name) || "";
const saveName = (n) => localStorage.setItem(LS.name, n);
const setActive = (c) => localStorage.setItem(LS.active, c);
const getActive = () => localStorage.getItem(LS.active) || "";
const clearActive = () => localStorage.removeItem(LS.active);
function getRecent() { try { return JSON.parse(localStorage.getItem(LS.recent) || "[]"); } catch { return []; } }
function addRecent(code) {
    const r = getRecent().filter((c) => c !== code);
    r.unshift(code);
    localStorage.setItem(LS.recent, JSON.stringify(r.slice(0, 6)));
}

const o = {
    code: null, isHost: false, room: null,
    engine: null, engineSeed: null, unsub: null,
    betShownRound: -1, playedRound: -1, finishedRound: -1, settledRound: -1, raceStartedRound: -1, resultShownRound: -1,
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
    document.getElementById("lobby-invite").addEventListener("click", shareInvite);
    document.querySelectorAll("[data-leave]").forEach((b) => b.addEventListener("click", onLeaveClick));

    // アプリ切替・誤操作で抜けないように：在室中はページ離脱を警告
    window.addEventListener("beforeunload", (e) => {
        if (o.code) { e.preventDefault(); e.returnValue = ""; }
    });
}

export function enterOnlineHome() {
    if (!configured) { showScreen("screen-online-setup-needed"); return; }
    const n = getName();
    document.getElementById("create-name").value = n;
    document.getElementById("join-name").value = n;
    renderRecent();
    showScreen("screen-online-home");
}

// 最近遊んだ合言葉（フレンドと使った部屋）をワンタップ参加用に表示
function renderRecent() {
    const box = document.getElementById("recent-rooms");
    if (!box) return;
    const recent = getRecent();
    box.innerHTML = "";
    if (!recent.length) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    const label = document.createElement("div");
    label.className = "recent-label";
    label.textContent = "フレンドと使った合言葉";
    box.appendChild(label);
    recent.forEach((code) => {
        const chip = document.createElement("button");
        chip.className = "room-chip";
        chip.textContent = code;
        chip.addEventListener("click", () => {
            document.getElementById("join-code").value = code;
            document.getElementById("join-name").value = getName();
            showScreen("screen-join");
        });
        box.appendChild(chip);
    });
}

async function createRoom() {
    try { await ensureDb(); } catch (e) { alert("Firebaseに接続できませんでした"); return; }
    const name = document.getElementById("create-name").value.trim() || "ホスト";
    const funds = clampFunds(parseInt(document.getElementById("create-funds").value, 10));
    saveName(name);
    o.code = randomCode();
    o.isHost = true;
    await fb.setDoc(roomDoc(), {
        host: uid, phase: "lobby", funds, round: 0, horseSeed: 0, raceSeed: 0,
        players: { [uid]: { name, balance: funds, betDone: false, tickets: [] } },
    });
    setActive(o.code); addRecent(o.code);
    subscribe();
}

async function joinRoom() {
    try { await ensureDb(); } catch (e) { alert("Firebaseに接続できませんでした"); return; }
    const code = document.getElementById("join-code").value.trim().toUpperCase();
    const name = document.getElementById("join-name").value.trim() || "プレイヤー";
    if (!code) { alert("合言葉を入力してください"); return; }
    saveName(name);
    o.code = code;
    const snap = await fb.getDoc(roomDoc());
    if (!snap.exists()) { alert("その合言葉の部屋が見つかりません"); o.code = null; return; }
    const room = snap.data();
    o.isHost = (room.host === uid);
    // ロビー以外（ベット/レース/結果）で参加した人は、今回は観戦して次レースから合流。
    // betDone=true にしておくと進行中のレースをブロックしない。
    const midGame = room.phase !== "lobby";
    if (midGame) o.betShownRound = room.round;
    await fb.updateDoc(roomDoc(), {
        [`players.${uid}`]: { name, balance: room.funds, betDone: midGame, tickets: [] },
    });
    setActive(o.code); addRecent(o.code);
    subscribe();
}

// 招待リンクをシェア／コピー
async function shareInvite() {
    const url = `${location.origin}${location.pathname}?room=${o.code}`;
    const text = `競馬ゲームに参加してね！合言葉: ${o.code}`;
    try {
        if (navigator.share) { await navigator.share({ title: "みんなで競馬", text, url }); return; }
        await navigator.clipboard.writeText(url);
        alert("招待リンクをコピーしました！\n" + url);
    } catch (e) {
        alert("招待リンク:\n" + url);
    }
}

// ボタンからの退出（誤操作防止の確認つき）
function onLeaveClick() {
    if (o.code && !confirm("ルームから退出しますか？")) return;
    doLeave();
}

function doLeave() {
    if (o.unsub) { o.unsub(); o.unsub = null; }
    if (fb && o.code) {
        const onlyMe = o.room && Object.keys(o.room.players || {}).filter((id) => id !== uid).length === 0;
        if (onlyMe) fb.deleteDoc(roomDoc()).catch(() => {});            // 最後の1人なら部屋ごと削除
        else fb.updateDoc(roomDoc(), { [`players.${uid}`]: fb.deleteField() }).catch(() => {});
    }
    o.code = null; o.room = null; o.isHost = false; o.engine = null; o.engineSeed = null;
    clearActive();
    showScreen("screen-online-home");
}

// 起動時：URLの ?room= か、前回の在室ルームに自動再接続する
export async function reconnectIfPossible() {
    if (!configured) return false;
    const params = new URLSearchParams(location.search);
    const fromUrl = (params.get("room") || "").toUpperCase();
    if (fromUrl) {
        // 招待リンク経由：名前を入れて参加してもらう
        document.getElementById("join-code").value = fromUrl;
        document.getElementById("join-name").value = getName();
        showScreen("screen-join");
        return true;
    }
    const code = getActive();
    if (!code) return false;
    try {
        await ensureDb();
        o.code = code;
        const snap = await fb.getDoc(roomDoc());
        if (snap.exists() && (snap.data().players || {})[uid]) {
            o.isHost = (snap.data().host === uid);
            subscribe();
            return true;
        }
    } catch (e) { /* ネット不調などは無視してホームへ */ }
    o.code = null; clearActive();
    return false;
}

function subscribe() {
    if (o.unsub) o.unsub();
    o.unsub = fb.onSnapshot(roomDoc(), (snap) => onRoom(snap.exists() ? snap.data() : null));
}

function clampFunds(v) {
    if (isNaN(v)) return 1000;
    return Math.max(500, Math.min(10000, Math.round(v / 100) * 100));
}

function onRoom(room) {
    if (!room) { if (o.code) { alert("部屋が閉じられました"); } doLeave(); return; }
    o.room = room;
    const players = room.players || {};
    if (!players[uid]) { doLeave(); return; }

    // ホストが抜けていたら、残っているうち最若番が引き継ぐ（進行が止まらないように）
    if (!players[room.host]) {
        const ids = Object.keys(players).sort();
        if (ids[0] === uid) fb.updateDoc(roomDoc(), { host: uid });
    }
    o.isHost = (room.host === uid);

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
    // ホスト交代などで精算が漏れないよう、ここでも試みる
    if (room.phase === "race") trySettle();
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

function showWait(room, title) {
    showScreen("screen-wait");
    document.getElementById("wait-title").textContent = title;
    renderPlayerList("wait-players", room, (p) => (p.betDone ? "✅ 賭けた" : "…考え中"));
}

function handleBetting(room) {
    const me = room.players[uid];
    if (me.betDone) {
        // 途中参加で今回観戦の人にも分かるメッセージ
        const noTickets = !me.tickets || me.tickets.length === 0;
        showWait(room, noTickets ? "次のレースから参加します（観戦中）" : "他のプレイヤーの賭けを待っています");
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
    o.playedRound = room.round; // 再生開始ガード（多重起動防止）

    const ps0 = room.players || {};
    await playRace(o.engine.horses, room.raceSeed, {
        engine: o.engine,
        players: Object.keys(ps0).map((id) => ({ name: ps0[id].name, tickets: ps0[id].tickets || [] })),
    });
    o.finishedRound = room.round; // 再生完了（ここまで来て初めて精算/結果表示OK）
    trySettle();
    maybeShowResult(o.room);
}

// ホストが、自分のレース演出が終わっていれば残高を精算して結果フェーズへ進める。
// ホスト交代があっても精算が漏れないよう、onRoom からも呼ばれる。
function trySettle() {
    const room = o.room;
    if (!room || room.phase !== "race") return;
    if (!o.isHost || !o.engine) return;
    if (o.finishedRound !== room.round) return;      // 自分の演出がまだ終わっていない
    if (o.settledRound === room.round) return;
    o.settledRound = room.round;

    const orderIds = orderFromSeed(room).map((h) => h.id);
    const ps = room.players || {};
    const updates = { phase: "result" };
    Object.keys(ps).forEach((id) => {
        const res = settleTickets(ps[id].tickets, orderIds, o.engine.horses, o.engine.byKey);
        updates[`players.${id}.balance`] = ps[id].balance + res.delta;
    });
    fb.updateDoc(roomDoc(), updates);
}

// ---- 結果 ----
function handleResult(room) {
    // このラウンドのレースを再生し終えた人は結果を表示。途中参加で未再生の人は待機。
    if (o.finishedRound === room.round && o.engine) maybeShowResult(room);
    else showWait(room, "次のレースを待っています（観戦中）");
}

function maybeShowResult(room) {
    if (!room || room.phase !== "result") return;
    if (o.finishedRound !== room.round) return;
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
        onSecondary: onLeaveClick,
        note: o.isHost ? "" : "ホストが次のレースを始めるのを待っています…",
        bestBet: bestBet(orderIds, o.engine),
    });
}

function orderFromSeed(room) {
    const data = simulateRaceData(o.engine.horses, makeRng(room.raceSeed));
    return data.order.map((i) => o.engine.horses[i]);
}

// 共有画面（ベット/レース）の退出ボタン用
export function inRoom() { return !!o.code; }
export function requestLeave() { onLeaveClick(); }
