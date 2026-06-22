// オンライン対戦モード。Firebase Firestore でルームを同期する。
// 全端末は horseSeed / raceSeed から決定論的に同じ馬・同じレース映像を作る。
// Firebase SDK はオンラインに入ったときだけ動的に読み込む（ローカルモードを邪魔しない）。
import { firebaseConfig } from "./firebase-config.js";
import { buildRace, settleTickets, bestPerType, NUM_HORSES } from "./engine.js";
import { startBetPanel } from "./betui.js";
import { playRace, renderResult } from "./raceui.js";
import { showScreen, randomSeed } from "./ui.js";
import { simulateRaceData } from "./race.js";
import { makeRng } from "./rng.js";
import { mergeNames, pickNames, addName, setRemoteAdder, customCount } from "./names.js";
import { APP_VERSION, APP_BUILD } from "./version.js";

const FB_VER = "10.12.2";
const RESULT_WAIT_MS = 10 * 1000;     // 結果は10秒で自動的に次レースへ
const BET_WAIT_MS = 2 * 60 * 1000;    // ベットは2分で締め切り自動スタート
const REVIVE_BALANCE = 3000;
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
        deleteField: fsMod.deleteField, deleteDoc: fsMod.deleteDoc, arrayUnion: fsMod.arrayUnion,
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
LS.friends = "keiba_friends";
const cleanPlayerName = (n) => (n || "").toString().trim().replace(/\s+/g, " ").slice(0, 10);
const getName = () => localStorage.getItem(LS.name) || "";
const saveName = (n) => localStorage.setItem(LS.name, cleanPlayerName(n));
const setActive = (c) => localStorage.setItem(LS.active, c);
const getActive = () => localStorage.getItem(LS.active) || "";
const clearActive = () => localStorage.removeItem(LS.active);
function getRecent() { try { return JSON.parse(localStorage.getItem(LS.recent) || "[]"); } catch { return []; } }
function addRecent(code) {
    const r = getRecent().filter((c) => c !== code);
    r.unshift(code);
    localStorage.setItem(LS.recent, JSON.stringify(r.slice(0, 6)));
}
function getFriends() { try { return JSON.parse(localStorage.getItem(LS.friends) || "[]"); } catch { return []; } }
function saveFriends(friends) { localStorage.setItem(LS.friends, JSON.stringify(friends.slice(0, 80))); }
function rememberFriends(players) {
    const now = Date.now();
    const map = new Map(getFriends().map((f) => [f.id, f]));
    Object.keys(players || {}).forEach((id) => {
        if (id === uid) return;
        const name = cleanPlayerName(players[id]?.name);
        if (!name) return;
        map.set(id, { id, name, lastPlayed: now });
    });
    saveFriends([...map.values()].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)));
}

const o = {
    code: null, isHost: false, room: null,
    engine: null, engineSeed: null, unsub: null,
    inviteUnsub: null,
    resultTimer: null,
    countdownTimer: null,
    betTimer: null,
    betCountdownTimer: null,
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
    document.getElementById("profile-name-save").addEventListener("click", saveProfileFromInput);
    document.getElementById("online-create-open").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (requireProfile()) openCreateScreen();
    }, true);
    document.getElementById("online-join-open").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (requireProfile()) openJoinScreen();
    }, true);

    // 馬名の登録（サーバー保存）
    setRemoteAdder(persistName);
    const addBtn = document.getElementById("horse-name-add");
    if (addBtn) addBtn.addEventListener("click", () => {
        const inp = document.getElementById("horse-name-input");
        if (addName(inp.value)) { inp.value = ""; updateNameCount(); }
    });

    // アプリ切替・誤操作で抜けないように：在室中はページ離脱を警告
    window.addEventListener("beforeunload", (e) => {
        if (o.code) { e.preventDefault(); e.returnValue = ""; }
    });
}

export function enterOnlineHome() {
    if (!configured) { showScreen("screen-online-setup-needed"); return; }
    const n = getName();
    const profile = document.getElementById("profile-name-input");
    if (profile) profile.value = n;
    document.getElementById("create-name").value = n;
    document.getElementById("join-name").value = n;
    syncProfile().catch(() => {});
    renderRecent();
    renderFriends();
    listenInvites();
    updateProfileStatus();
    updateNameCount();
    preloadNames();
    showScreen("screen-online-home");
}

function updateProfileStatus() {
    const status = document.getElementById("profile-name-status");
    if (!status) return;
    const name = getName();
    status.textContent = name ? `${name} としてプレイ中` : "初回だけ名前を保存してください";
}

function saveProfileFromInput() {
    const input = document.getElementById("profile-name-input");
    const name = cleanPlayerName(input?.value);
    if (!name) { alert("名前を入力してください"); input?.focus(); return false; }
    saveName(name);
    document.getElementById("create-name").value = name;
    document.getElementById("join-name").value = name;
    updateProfileStatus();
    syncProfile().catch(() => {});
    return true;
}

function requireProfile() {
    if (getName()) return true;
    showScreen("screen-online-home");
    alert("最初にプレイヤー名を保存してください");
    document.getElementById("profile-name-input")?.focus();
    return false;
}

function openCreateScreen() {
    document.getElementById("create-name").value = getName();
    document.getElementById("create-name")?.closest(".field")?.classList.add("hidden");
    showScreen("screen-create");
}

function openJoinScreen() {
    document.getElementById("join-name").value = getName();
    document.getElementById("join-name")?.closest(".field")?.classList.add("hidden");
    showScreen("screen-join");
}

async function syncProfile() {
    if (!configured || !getName()) return;
    await ensureDb();
    await fb.setDoc(fb.doc(fb.db, "users", uid), { name: getName(), updatedAt: Date.now() }, { merge: true });
}

function updateNameCount() {
    const el = document.getElementById("horse-name-count");
    if (el) el.textContent = `登録済み ${customCount()} 件`;
}

// バージョン更新の検知。自分より新しいビルドがサーバーにあれば onOutdated を呼ぶ。
// 自分が最新なら meta/version を自分のビルドに更新する。
export async function checkVersion(onOutdated) {
    if (!configured) return;
    try {
        await ensureDb();
        const ref = fb.doc(fb.db, "meta", "version");
        const snap = await fb.getDoc(ref);
        const latest = (snap.exists() && snap.data().build) || 0;
        if (APP_BUILD > latest) {
            await fb.setDoc(ref, { build: APP_BUILD, version: APP_VERSION, at: Date.now() }, { merge: true });
        } else if (latest > APP_BUILD) {
            onOutdated(latest);
        }
        // 以降、誰かが新バージョンをデプロイしたらリアルタイムで検知
        fb.onSnapshot(ref, (s) => {
            const b = (s.exists() && s.data().build) || 0;
            if (b > APP_BUILD) onOutdated(b);
        });
    } catch (e) { /* オフライン等は無視 */ }
}

// サーバーの馬名プールを取得してローカルに統合
export async function preloadNames() {
    if (!configured) return;
    try {
        await ensureDb();
        const snap = await fb.getDoc(fb.doc(fb.db, "meta", "horseNames"));
        if (snap.exists()) mergeNames(snap.data().names || []);
        updateNameCount();
    } catch (e) { /* オフライン時はローカルのみ */ }
}

// 馬名をサーバーへ保存（重複は arrayUnion が弾く）
async function persistName(name) {
    if (!configured) return;
    try {
        await ensureDb();
        await fb.setDoc(fb.doc(fb.db, "meta", "horseNames"),
            { names: fb.arrayUnion(name) }, { merge: true });
    } catch (e) { /* 失敗してもローカルには残る */ }
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
            if (requireProfile()) openJoinScreen();
        });
        box.appendChild(chip);
    });
}

function renderFriends() {
    renderFriendBox("friend-list", false);
    renderFriendBox("lobby-friend-invites", true);
}

function renderFriendBox(id, canInvite) {
    const box = document.getElementById(id);
    if (!box) return;
    const friends = getFriends();
    box.innerHTML = "";
    if (!friends.length) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    const label = document.createElement("div");
    label.className = "recent-label";
    label.textContent = canInvite ? "フレンドを招待" : "一緒に遊んだフレンド";
    box.appendChild(label);
    friends.forEach((friend) => {
        const row = document.createElement("div");
        row.className = "friend-row";
        const name = document.createElement("span");
        name.textContent = friend.name;
        row.appendChild(name);
        const btn = document.createElement("button");
        btn.className = "ghost";
        btn.textContent = canInvite ? "招待" : "部屋で招待できます";
        btn.disabled = !canInvite;
        if (canInvite) btn.addEventListener("click", () => inviteFriend(friend));
        row.appendChild(btn);
        box.appendChild(row);
    });
}

async function inviteFriend(friend) {
    if (!o.code) { alert("部屋に入ってから招待できます"); return; }
    try {
        await ensureDb();
        const invite = {
            inviteId: `${uid}_${o.code}_${Date.now()}`,
            code: o.code,
            fromId: uid,
            fromName: getName(),
            at: Date.now(),
        };
        await fb.setDoc(fb.doc(fb.db, "invites", friend.id), { items: fb.arrayUnion(invite) }, { merge: true });
        alert(`${friend.name} さんに招待を送りました`);
    } catch (e) {
        alert("招待を送れませんでした");
    }
}

async function listenInvites() {
    if (!configured) return;
    try {
        await ensureDb();
        if (o.inviteUnsub) o.inviteUnsub();
        o.inviteUnsub = fb.onSnapshot(fb.doc(fb.db, "invites", uid), (snap) => {
            renderIncomingInvites(snap.exists() ? (snap.data().items || []) : []);
        });
    } catch (e) {
        renderIncomingInvites([]);
    }
}

function renderIncomingInvites(items) {
    const box = document.getElementById("incoming-invites");
    if (!box) return;
    const invites = (items || []).slice(-8).reverse();
    box.innerHTML = "";
    if (!invites.length) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    const label = document.createElement("div");
    label.className = "recent-label";
    label.textContent = "届いている招待";
    box.appendChild(label);
    invites.forEach((invite) => {
        const row = document.createElement("div");
        row.className = "invite-row";
        const text = document.createElement("span");
        text.textContent = `${invite.fromName || "フレンド"} から ${invite.code}`;
        row.appendChild(text);
        const btn = document.createElement("button");
        btn.className = "ghost";
        btn.textContent = "参加";
        btn.addEventListener("click", () => {
            if (!requireProfile()) return;
            document.getElementById("join-code").value = invite.code || "";
            document.getElementById("join-name").value = getName();
            openJoinScreen();
        });
        row.appendChild(btn);
        box.appendChild(row);
    });
}

async function createRoom() {
    try { await ensureDb(); } catch (e) { alert("Firebaseに接続できませんでした"); return; }
    if (!requireProfile()) return;
    const name = getName();
    const funds = clampFunds(parseInt(document.getElementById("create-funds").value, 10));
    await syncProfile().catch(() => {});
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
    if (!requireProfile()) return;
    const code = document.getElementById("join-code").value.trim().toUpperCase();
    const name = getName();
    if (!code) { alert("合言葉を入力してください"); return; }
    await syncProfile().catch(() => {});
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
    clearResultTimers();
    clearBetTimers();
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
        if (getName()) openJoinScreen();
        else enterOnlineHome();
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
    rememberFriends(players);

    // ホストが抜けていたら、残っているうち最若番が引き継ぐ（進行が止まらないように）
    if (!players[room.host]) {
        const ids = Object.keys(players).sort();
        if (ids[0] === uid) fb.updateDoc(roomDoc(), { host: uid });
    }
    o.isHost = (room.host === uid);

    if (room.horseSeed && o.engineSeed !== room.horseSeed) {
        o.engine = buildRace(room.horseSeed, room.names || null);
        o.engineSeed = room.horseSeed;
    }

    switch (room.phase) {
        case "lobby": renderLobby(room); break;
        case "betting": handleBetting(room); break;
        case "race": handleRace(room); break;
        case "result": handleResult(room); break;
    }
    if (room.phase !== "result") clearResultTimers();
    if (room.phase !== "betting") clearBetTimers();

    // ベットは「全員OK」か「2分経過」で自動スタート
    if (o.isHost && room.phase === "betting") scheduleBetAdvance(room);
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
    renderFriends();
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
        const bankrupt = p.bankrupt ? " / BANKRUPT" : "";
        const status = statusFn ? statusFn(p) : `${p.balance} coins${bankrupt}`;
        li.innerHTML = `<span>${p.name}${tag}${me}</span><span class="coins">${status}</span>`;
        el.appendChild(li);
    });
}

// ---- ベット ----
function hostStartBetting() {
    const round = (o.room.round || 0) + 1;
    const updates = {
        phase: "betting",
        round,
        horseSeed: randomSeed(),
        raceSeed: 0,
        names: pickNames(NUM_HORSES),
        resultDeadlineAt: fb.deleteField(),
        betDeadlineAt: Date.now() + BET_WAIT_MS,
    };
    Object.keys(o.room.players || {}).forEach((id) => {
        updates[`players.${id}.betDone`] = false;
        updates[`players.${id}.tickets`] = [];
        updates[`players.${id}.readyNext`] = false;
        updates[`players.${id}.reviveResult`] = fb.deleteField();
    });
    fb.updateDoc(roomDoc(), updates);
}

function showWait(room, title) {
    showScreen("screen-wait");
    o._waitTitle = title;
    renderPlayerList("wait-players", room, (p) => {
        const base = p.betDone ? "OK" : "選択中";
        return p.bankrupt ? `破産 / ${base}` : base;
    });
}

function handleBetting(room) {
    const me = room.players[uid];
    if (me.betDone) {
        const noTickets = !me.tickets || me.tickets.length === 0;
        showWait(room, noTickets ? "次のレースまで観戦中" : "他のプレイヤーを待っています");
        startBetCountdown();
        return;
    }
    if (o.betShownRound === room.round || !o.engine) { startBetCountdown(); return; }
    o.betShownRound = room.round;

    document.getElementById("name-wrap").classList.add("hidden");
    o._pickTitleBase = me.bankrupt ? `${me.name} さんの復活チャレンジ` : `${me.name} さんの賭け`;
    document.getElementById("pick-title").textContent = o._pickTitleBase;
    showScreen("screen-pick");
    startBetPanel({
        engine: o.engine,
        balance: me.bankrupt ? 0 : me.balance,
        reviveMode: !!me.bankrupt,
        onComplete: (tickets) => fb.updateDoc(roomDoc(), {
            [`players.${uid}.tickets`]: tickets || [],
            [`players.${uid}.betDone`]: true,
        }),
    });
    startBetCountdown();
}

// ベット締め切りまでのカウントダウン表示
function betCountdownText(room) {
    const dl = room.betDeadlineAt || 0;
    if (!dl) return "";
    const remain = Math.max(0, Math.ceil((dl - Date.now()) / 1000));
    const mm = String(Math.floor(remain / 60)).padStart(2, "0");
    const ss = String(remain % 60).padStart(2, "0");
    return `（あと ${mm}:${ss} で自動スタート）`;
}

function updateBetCountdownUI() {
    const room = o.room;
    if (!room || room.phase !== "betting") return;
    const me = (room.players || {})[uid] || {};
    const txt = betCountdownText(room);
    if (me.betDone) {
        const el = document.getElementById("wait-title");
        if (el) el.textContent = (o._waitTitle || "") + txt;
    } else {
        const el = document.getElementById("pick-title");
        if (el && o._pickTitleBase) el.textContent = `${o._pickTitleBase}　${txt}`;
    }
}

function startBetCountdown() {
    if (o.betCountdownTimer) clearInterval(o.betCountdownTimer);
    updateBetCountdownUI();
    o.betCountdownTimer = setInterval(() => {
        if (!o.room || o.room.phase !== "betting") { clearBetTimers(); return; }
        updateBetCountdownUI();
    }, 1000);
}

function clearBetTimers() {
    if (o.betCountdownTimer) { clearInterval(o.betCountdownTimer); o.betCountdownTimer = null; }
    if (o.betTimer) { clearTimeout(o.betTimer); o.betTimer = null; }
}

// ホスト：全員OK か 締め切り(2分) で自動的にレース開始
function scheduleBetAdvance(room) {
    if (!o.isHost || !room || room.phase !== "betting") return;
    const deadline = room.betDeadlineAt || 0;
    if (allBet(room) || (deadline && Date.now() >= deadline)) { hostStartRace(room); return; }
    if (o.betTimer) clearTimeout(o.betTimer);
    if (deadline) {
        o.betTimer = setTimeout(() => {
            if (o.room && o.room.phase === "betting" && o.room.round === room.round) hostStartRace(o.room);
        }, Math.max(0, deadline - Date.now() + 250));
    }
}

// ---- Race ----
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
    if (o.finishedRound !== room.round) return;
    if (o.settledRound === room.round) return;
    o.settledRound = room.round;

    const orderIds = orderFromSeed(room).map((h) => h.id);
    const ps = room.players || {};
    const updates = { phase: "result", resultDeadlineAt: Date.now() + RESULT_WAIT_MS, gameOver: false };
    Object.keys(ps).forEach((id) => {
        const player = ps[id];
        const tickets = player.tickets || [];
        if (player.bankrupt) {
            const reviveHit = tickets.some((t) => t.revive && t.typeKey === "win" && o.engine.byKey.win.test(orderIds, t.sel || []));
            updates[`players.${id}.balance`] = reviveHit ? REVIVE_BALANCE : 0;
            updates[`players.${id}.bankrupt`] = !reviveHit;
            updates[`players.${id}.reviveResult`] = reviveHit ? "hit" : (tickets.some((t) => t.revive) ? "miss" : "none");
            updates[`players.${id}.readyNext`] = false;
            return;
        }
        const res = settleTickets(tickets, orderIds, o.engine.horses, o.engine.byKey);
        const nb = player.balance + res.delta;
        updates[`players.${id}.balance`] = Math.max(0, nb);
        updates[`players.${id}.bankrupt`] = nb <= 0;
        updates[`players.${id}.reviveResult`] = fb.deleteField();
        updates[`players.${id}.readyNext`] = false;
    });
    fb.updateDoc(roomDoc(), updates);
}
function hostReset() {
    const updates = { phase: "lobby", gameOver: false, raceSeed: 0 };
    Object.keys(o.room.players || {}).forEach((id) => {
        updates[`players.${id}.balance`] = o.room.funds;
        updates[`players.${id}.betDone`] = false;
        updates[`players.${id}.tickets`] = [];
    });
    fb.updateDoc(roomDoc(), updates);
}

// ---- 結果 ----
function handleResult(room) {
    scheduleResultAdvance(room);
    if (o.finishedRound === room.round && o.engine) maybeShowResult(room);
    else showWait(room, "Waiting for next race");
}

function maybeShowResult(room) {
    if (!room || room.phase !== "result") return;
    if (o.finishedRound !== room.round) return;
    if (!o.engine) return;

    const ordered = orderFromSeed(room);
    const orderIds = ordered.map((h) => h.id);
    const ps = room.players || {};

    const payoutRows = Object.keys(ps).map((id) => {
        const player = ps[id];
        let res;
        if (player.reviveResult === "hit") {
            res = { detail: "復活成功：単勝的中で3000コイン獲得", delta: REVIVE_BALANCE };
        } else if (player.reviveResult === "miss") {
            res = { detail: "復活失敗：破産状態が続きます", delta: 0 };
        } else if (player.reviveResult === "none" && player.bankrupt) {
            res = { detail: "破産：復活チャレンジ未挑戦", delta: 0 };
        } else {
            res = settleTickets(player.tickets || [], orderIds, o.engine.horses, o.engine.byKey);
        }
        const suffix = id === uid ? " (you)" : "";
        const status = player.bankrupt ? " [BANKRUPT]" : "";
        return { name: player.name + suffix + status, detail: res.detail, delta: res.delta };
    });
    const standings = Object.keys(ps)
        .map((id) => ({ name: ps[id].name, balance: ps[id].balance, bankrupt: !!ps[id].bankrupt, readyNext: !!ps[id].readyNext }))
        .sort((a, b) => b.balance - a.balance);

    const me = ps[uid] || {};
    const readyCount = Object.keys(ps).filter((id) => ps[id].readyNext).length;
    const total = Object.keys(ps).length;
    renderResult(ordered, payoutRows, standings, {
        primaryLabel: me.readyNext ? "OK済み" : "OK（次のレースへ）",
        onPrimary: me.readyNext ? null : markReadyNext,
        secondaryLabel: "退出する",
        onSecondary: onLeaveClick,
        note: resultCountdownText(room, readyCount, total),
        gameOver: false,
        bestBets: bestPerType(orderIds, o.engine),
    });
    startResultCountdown(room);
}

function markReadyNext() {
    if (!o.code) return;
    fb.updateDoc(roomDoc(), { [`players.${uid}.readyNext`]: true }).catch(() => {});
}

function resultCountdownText(room, readyCount, total) {
    const deadline = room.resultDeadlineAt || (Date.now() + RESULT_WAIT_MS);
    const remain = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    return `あと ${remain} 秒で次のレースへ（OK ${readyCount}/${total}）`;
}

function startResultCountdown(room) {
    if (o.countdownTimer) clearInterval(o.countdownTimer);
    o.countdownTimer = setInterval(() => {
        if (!o.room || o.room.phase !== "result" || o.room.round !== room.round) {
            clearInterval(o.countdownTimer);
            o.countdownTimer = null;
            return;
        }
        const note = document.getElementById("result-note");
        if (note) {
            const ps = o.room.players || {};
            const readyCount = Object.keys(ps).filter((id) => ps[id].readyNext).length;
            note.textContent = resultCountdownText(o.room, readyCount, Object.keys(ps).length);
        }
    }, 1000);
}

function clearResultTimers() {
    if (o.countdownTimer) {
        clearInterval(o.countdownTimer);
        o.countdownTimer = null;
    }
    if (o.resultTimer) {
        clearTimeout(o.resultTimer);
        o.resultTimer = null;
    }
}

function scheduleResultAdvance(room) {
    if (!o.isHost || !room || room.phase !== "result") return;
    const ps = room.players || {};
    const ids = Object.keys(ps);
    const allReady = ids.length > 0 && ids.every((id) => ps[id].readyNext);
    const deadline = room.resultDeadlineAt || 0;
    if (allReady || (deadline && Date.now() >= deadline)) {
        hostStartBetting();
        return;
    }
    if (o.resultTimer) clearTimeout(o.resultTimer);
    if (deadline) {
        o.resultTimer = setTimeout(() => {
            if (o.room && o.room.phase === "result" && o.room.round === room.round) hostStartBetting();
        }, Math.max(0, deadline - Date.now() + 250));
    }
}
function orderFromSeed(room) {
    const data = simulateRaceData(o.engine.horses, makeRng(room.raceSeed));
    return data.order.map((i) => o.engine.horses[i]);
}

// 共有画面（ベット/レース）の退出ボタン用
export function inRoom() { return !!o.code; }
export function requestLeave() { onLeaveClick(); }
