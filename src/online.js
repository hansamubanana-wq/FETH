// オンライン対戦モード。Firebase Firestore でルームを同期する。
// 全端末は horseSeed / raceSeed から決定論的に同じ馬・同じレース映像を作る。
// Firebase SDK はオンラインに入ったときだけ動的に読み込む（ローカルモードを邪魔しない）。
import { firebaseConfig } from "./firebase-config.js";
import { buildRace, settleTickets, bestPerType, NUM_HORSES } from "./engine.js";
import { startBetPanel } from "./betui.js";
import { playRace, renderResult, stopRacePlayback } from "./raceui.js";
import { showScreen, randomSeed } from "./ui.js";
import { simulateRaceData } from "./race.js";
import { makeRng } from "./rng.js";
import { pickNames } from "./names.js";
import { APP_VERSION, APP_BUILD } from "./version.js";

const FIREBASE_BASE_URL = "../vendor/firebase/";
const RESULT_WAIT_MS = 10 * 1000;     // 結果は10秒で自動的に次レースへ
const BET_WAIT_MS = 2 * 60 * 1000;    // ベットは2分で締め切り自動スタート
const REVIVE_BALANCE = 3000;
const configured = !!firebaseConfig.projectId;
let fb = null;

async function ensureDb() {
    if (fb) return fb;
    const appMod = await import(`${FIREBASE_BASE_URL}firebase-app.js`);
    const fsMod = await import(`${FIREBASE_BASE_URL}firebase-firestore.js`);
    const db = fsMod.getFirestore(appMod.initializeApp(firebaseConfig));
    fb = {
        db,
        doc: fsMod.doc, setDoc: fsMod.setDoc, updateDoc: fsMod.updateDoc,
        getDoc: fsMod.getDoc, onSnapshot: fsMod.onSnapshot, collection: fsMod.collection,
        deleteField: fsMod.deleteField, deleteDoc: fsMod.deleteDoc,
        arrayUnion: fsMod.arrayUnion, arrayRemove: fsMod.arrayRemove,
        writeBatch: fsMod.writeBatch,
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
    betShownKey: null, playedRound: -1, playingRound: null, finishedRound: -1,
    resultShownSig: null, friendsSyncedAt: 0, hostRetryTimer: null,
    // 部屋ドキュメントと players サブコレクションは別のリスナーで届き、
    // 同じバッチの書き込みでも到着順は保証されない。
    // 「players を何回受け取ったか」を数えて、部屋のフェーズだけが先に進んだ
    // 状態（＝players が前ラウンドのまま）で判断してしまうのを防ぐ。
    playersVersion: 0, bettingStartedVersion: -1, betSelfHealTimer: null,
    // ホストのフェーズ移行を「1ラウンドにつき1回だけ」に固定するための予約票。
    // これがないと、締め切り直後にスナップショットが連続して届いたときに
    // hostStartBetting() などが二重に走り、レースがやり直しになったり画面が固まる。
    claimed: {},
};

function claimOnce(kind, value) {
    if (o.claimed[kind] === value) return false;
    o.claimed[kind] = value;
    return true;
}
function releaseClaim(kind, value) {
    if (o.claimed[kind] === value) delete o.claimed[kind];
    // 予約票を返したあと新しいスナップショットが来ないと進行が止まったままになるので、
    // 同じ部屋状態でもう一度だけ進行判定をやり直す。
    scheduleHostRetry();
}
function scheduleHostRetry() {
    if (o.hostRetryTimer) return;
    o.hostRetryTimer = setTimeout(() => {
        o.hostRetryTimer = null;
        if (o.room) onRoom(o.room);
    }, 1500);
}

function roomDoc() { return fb.doc(fb.db, "rooms", o.code); }
function playersCollection() { return fb.collection(fb.db, "rooms", o.code, "players"); }
function playerDoc(id = uid) { return fb.doc(fb.db, "rooms", o.code, "players", id); }
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
    // ロビーはスナップショットのたびに再描画されるので、中身が同じなら作り直さない
    const sig = friends.map((f) => `${f.id}:${f.name}`).join("|");
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
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

// Firestore のエラーを、原因が分かる日本語メッセージに変換する。
// permission-denied は Firebase コンソール側のセキュリティルール未設定・期限切れで起きる。
function firestoreErrorMessage(e, prefix) {
    if (e && e.code === "permission-denied") {
        return `${prefix}（Firestoreのアクセス権限がありません）\n\n` +
            "Firebaseコンソールで Firestore のセキュリティルールを公開設定にしてください。" +
            "テストモードのルールは30日で期限切れになります。";
    }
    if (e && e.code === "unavailable") return `${prefix}（ネットワークに接続できません）`;
    return `${prefix}\n${(e && (e.code || e.message)) || e}`;
}

async function createRoom() {
    try { await ensureDb(); } catch (e) { alert("Firebaseに接続できませんでした"); return; }
    if (!requireProfile()) return;
    const name = getName();
    const funds = clampFunds(parseInt(document.getElementById("create-funds").value, 10));
    await syncProfile().catch(() => {});
    o.code = randomCode();
    o.isHost = true;
    resetRoundState();
    try {
        const batch = fb.writeBatch(fb.db);
        batch.set(roomDoc(), {
            host: uid, phase: "lobby", funds, round: 0, horseSeed: 0, raceSeed: 0, createdAt: Date.now(),
        });
        batch.set(playerDoc(), { name, balance: funds, betDone: false, tickets: [], bankrupt: false, readyNext: false, round: 0 });
        await batch.commit();
    } catch (e) {
        o.code = null; o.isHost = false;
        alert(firestoreErrorMessage(e, "部屋を作れませんでした"));
        return;
    }
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
    let snap;
    try {
        snap = await fb.getDoc(roomDoc());
    } catch (e) {
        o.code = null;
        alert(firestoreErrorMessage(e, "部屋に参加できませんでした"));
        return;
    }
    if (!snap.exists()) { alert("その合言葉の部屋が見つかりません"); o.code = null; return; }
    const room = snap.data();
    o.isHost = (room.host === uid);
    // ロビー以外（ベット/レース/結果）で参加した人は、今回は観戦して次レースから合流。
    // betDone=true にしておくと進行中のレースをブロックしない。
    const midGame = room.phase !== "lobby";
    resetRoundState();
    if (midGame) o.betShownKey = `${room.round}:${room.horseSeed || 0}`;
    try {
        await fb.setDoc(playerDoc(), { name, balance: room.funds, betDone: midGame, tickets: [], round: room.round || 0 }, { merge: true });
    } catch (e) {
        o.code = null;
        alert(firestoreErrorMessage(e, "部屋に参加できませんでした"));
        return;
    }
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
    stopRacePlayback();
    if (o.unsub) { o.unsub(); o.unsub = null; }
    if (fb && o.code) {
        const others = Object.keys((o.room && o.room.players) || {}).filter((id) => id !== uid);
        if (o.room && !others.length) {
            const batch = fb.writeBatch(fb.db);
            batch.delete(playerDoc());
            batch.delete(roomDoc());
            batch.commit().catch(() => {});                            // 最後の1人なら部屋ごと削除
        } else if (o.isHost && others.length) {
            const batch = fb.writeBatch(fb.db);
            batch.update(roomDoc(), { host: others.sort()[0] });
            batch.delete(playerDoc());
            batch.commit().catch(() => {});
        } else {
            fb.deleteDoc(playerDoc()).catch(() => {});
        }
    }
    o.code = null; o.room = null; o.isHost = false; o.engine = null; o.engineSeed = null;
    resetRoundState();
    clearActive();
    showScreen("screen-online-home");
}

// 部屋を移るときに、前の部屋のラウンド進行状態を持ち越さないようにする
function resetRoundState() {
    if (o.hostRetryTimer) { clearTimeout(o.hostRetryTimer); o.hostRetryTimer = null; }
    clearBetSelfHeal();
    o.bettingStartedVersion = -1;
    o.claimed = {};
    o.betShownKey = null;
    o.playedRound = -1;
    o.playingRound = null;
    o.finishedRound = -1;
    o.resultShownSig = null;
    o.friendsSyncedAt = 0;
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
        const [roomSnap, playerSnap] = await Promise.all([fb.getDoc(roomDoc()), fb.getDoc(playerDoc())]);
        if (roomSnap.exists() && playerSnap.exists()) {
            resetRoundState();
            o.isHost = (roomSnap.data().host === uid);
            subscribe();
            return true;
        }
    } catch (e) { /* ネット不調などは無視してホームへ */ }
    o.code = null; clearActive();
    return false;
}

// 全端末が players サブコレクションを直接購読する。
//
// 以前はホストだけが players を購読し、その全内容（買い目を含む）を
// rooms/{code}.summary に書き戻して他の端末へ配っていた。この方式だと
//   ・誰かが1回ベットするたびに部屋ドキュメントを丸ごと書き直す
//     → Firestore の「1ドキュメントあたり毎秒1書き込み」の目安を軽く超えて詰まる
//   ・配られる量が人数の2乗で増える（N人分の買い目 × N人へ配信）
//   ・ホストが1台でも重いと全員の進行が止まる
// ので、大人数だと「重い・固まる」の直接の原因になっていた。
// 直接購読なら書き込みは各自1件、受信は変更のあった1人分だけになる。
function subscribe() {
    if (o.unsub) o.unsub();
    let roomData = null;
    let players = null;   // null = 最初のスナップショット待ち
    let joined = false;

    const emit = () => {
        if (!roomData) { onRoom(null); return; }
        if (!players) return;
        if (!joined) {
            if (!players[uid]) return;   // 自分の参加が反映されるまで待つ
            joined = true;
        }
        onRoom({ ...roomData, players });
    };

    const onListenError = (where) => (error) => {
        // 権限不足や切断を握りつぶすと、画面が進まない理由が分からなくなる
        console.error(`Firestore listen error (${where})`, error);
    };
    const roomUnsub = fb.onSnapshot(roomDoc(), (snap) => {
        roomData = snap.exists() ? snap.data() : null;
        emit();
    }, onListenError("room"));
    const playersUnsub = fb.onSnapshot(playersCollection(), (snap) => {
        const next = {};
        snap.forEach((playerSnap) => { next[playerSnap.id] = playerSnap.data(); });
        players = next;
        o.playersVersion += 1;
        emit();
    }, onListenError("players"));
    o.unsub = () => { roomUnsub(); playersUnsub(); };
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
    // 毎スナップショットで localStorage を読み書きすると大人数のとき無視できない負荷になる
    if (Date.now() - o.friendsSyncedAt > 10000) {
        o.friendsSyncedAt = Date.now();
        rememberFriends(players);
    }

    // ホストが抜けていたら、残っているうち最若番が引き継ぐ（進行が止まらないように）
    if (!players[room.host]) {
        const ids = Object.keys(players).sort();
        if (ids[0] === uid && claimOnce("takeover", room.host)) {
            fb.updateDoc(roomDoc(), { host: uid }).catch(() => releaseClaim("takeover", room.host));
        }
    }
    o.isHost = (room.host === uid);

    if (room.horseSeed && o.engineSeed !== room.horseSeed) {
        o.engine = buildRace(room.horseSeed, room.names || null);
        o.engineSeed = room.horseSeed;
    }

    // 再生中にラウンドが進んでしまったら、古いレース映像を止めて3D資源を解放する。
    // 放置すると次のレースと二重に走って重くなる。
    if (o.playingRound !== null && o.playingRound !== room.round) stopRacePlayback();

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

// プレイヤードキュメントが現在のラウンドのものか。
// round を持たない古いドキュメント（旧バージョンで作られた部屋）は現行扱いにして、
// 更新途中の部屋が2分の締め切りまで進まなくなるのを避ける。
function isCurrentRound(player, round) {
    return player.round === undefined || player.round === round;
}

function allBet(room) {
    const ps = room.players || {};
    const ids = Object.keys(ps);
    if (!ids.length) return false;
    // 前ラウンドの betDone=true が残っているうちに「全員OK」と判定すると、
    // 誰も賭けていないレースが即座に始まってしまう。
    return ids.every((id) => isCurrentRound(ps[id], room.round) && ps[id].betDone);
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
    const ps = room.players || {};
    // 人数が多いとスナップショットのたびに全行を作り直すのが効いてくるので、
    // 表示内容が変わっていないときは何もしない。
    const ids = Object.keys(ps).sort();
    const sig = ids.map((id) => {
        const p = ps[id];
        return `${id}:${p.name}:${p.balance}:${p.betDone ? 1 : 0}:${p.bankrupt ? 1 : 0}`;
    }).join("|") + `#${room.host}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.innerHTML = "";
    Object.keys(ps).forEach((id) => {
        const p = ps[id];
        const li = document.createElement("li");
        const tag = id === room.host ? " 👑" : "";
        const me = id === uid ? "（あなた）" : "";
        const bankrupt = p.bankrupt ? " / BANKRUPT" : "";
        const status = statusFn ? statusFn(p) : `${p.balance} coins${bankrupt}`;
        const avatar = document.createElement("span");
        const label = document.createElement("span");
        const coinLabel = document.createElement("span");
        const playerName = String(p.name || "?");
        avatar.className = "player-avatar";
        avatar.textContent = playerName.slice(0, 1).toUpperCase();
        avatar.style.setProperty("--avatar-hue", String([...playerName].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360));
        label.className = "player-name";
        label.textContent = `${playerName}${tag}${me}`;
        coinLabel.className = "coins";
        coinLabel.textContent = status;
        li.append(avatar, label, coinLabel);
        el.appendChild(li);
    });
}

// ---- ベット ----
function hostStartBetting() {
    const room = o.room;
    if (!room) return;
    const round = (room.round || 0) + 1;
    // 予約票がないと、締め切り直後にスナップショットが立て続けに届いたときに
    // ここが二重に走って horseSeed が引き直され、ベット画面が固まる原因になる。
    if (!claimOnce("betting", round)) return;
    const batch = fb.writeBatch(fb.db);
    batch.update(roomDoc(), {
        phase: "betting",
        round,
        horseSeed: randomSeed(),
        raceSeed: 0,
        names: pickNames(NUM_HORSES),
        resultDeadlineAt: fb.deleteField(),
        betDeadlineAt: Date.now() + BET_WAIT_MS,
    });
    Object.keys(room.players || {}).forEach((id) => {
        batch.update(playerDoc(id), {
            betDone: false,
            tickets: [],
            readyNext: false,
            reviveResult: fb.deleteField(),
            round,   // このラウンドの状態であることの目印
        });
    });
    o.bettingStartedVersion = o.playersVersion;
    batch.commit().catch(() => releaseClaim("betting", round));
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
    // 自分の doc がまだ前ラウンドのままなら、追いつくまで画面を切り替えない。
    // （前ラウンドの betDone=true で待機画面が一瞬出てしまうのを防ぐ）
    if (!isCurrentRound(me, room.round)) { scheduleBetSelfHeal(room); return; }
    clearBetSelfHeal();
    if (me.betDone) {
        const noTickets = !me.tickets || me.tickets.length === 0;
        o.betShownKey = null;   // 出し直しになったら再表示できるようにしておく
        showWait(room, noTickets ? "次のレースまで観戦中" : "他のプレイヤーを待っています");
        startBetCountdown();
        return;
    }
    if (!o.engine) { startBetCountdown(); return; }

    // ラウンドだけで判定していると、
    //   ・betDone がサーバー側で false に戻された
    //   ・同じラウンドで horseSeed が引き直された
    // ときにベット画面が出ないまま待機画面で止まってしまう（＝固まる）。
    // 「どの馬立てを、いま実際に表示しているか」で判定する。
    const key = `${room.round}:${room.horseSeed || 0}`;
    const pickVisible = document.getElementById("screen-pick")?.classList.contains("active");
    if (o.betShownKey === key && pickVisible) { startBetCountdown(); return; }
    o.betShownKey = key;

    document.getElementById("name-wrap").classList.add("hidden");
    o._pickTitleBase = me.bankrupt ? `${me.name} さんの復活チャレンジ` : `${me.name} さんの賭け`;
    document.getElementById("pick-title").textContent = o._pickTitleBase;
    showScreen("screen-pick");
    startBetPanel({
        engine: o.engine,
        balance: me.bankrupt ? 0 : me.balance,
        reviveMode: !!me.bankrupt,
        onComplete: (tickets) => {
            // 締め切り後や次ラウンド開始後の書き込みは捨てる（前ラウンドの買い目が混ざらないように）
            if (!o.room || o.room.phase !== "betting" || o.room.round !== room.round) return;
            fb.updateDoc(playerDoc(), { tickets: tickets || [], betDone: true, round: room.round }).catch(() => {});
        },
    });
    startBetCountdown();
}

// ホストのベット開始バッチから漏れた場合（書き込み直前に参加したなど）に、
// 自分のドキュメントを現在のラウンドへ自力で合わせる。
// 通常の到着順のズレは1秒とかからず解消するので、少し待ってから実行する。
function scheduleBetSelfHeal(room) {
    if (o.betSelfHealTimer) return;
    o.betSelfHealTimer = setTimeout(() => {
        o.betSelfHealTimer = null;
        const now = o.room;
        if (!now || now.phase !== "betting" || now.round !== room.round) return;
        const me = (now.players || {})[uid];
        if (!me || isCurrentRound(me, now.round)) return;
        fb.updateDoc(playerDoc(), {
            round: now.round, betDone: false, tickets: [], readyNext: false,
        }).catch(() => {});
    }, 2500);
}

function clearBetSelfHeal() {
    if (o.betSelfHealTimer) { clearTimeout(o.betSelfHealTimer); o.betSelfHealTimer = null; }
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
    clearBetSelfHeal();
}

// ホスト：全員OK か 締め切り(2分) で自動的にレース開始
function scheduleBetAdvance(room) {
    if (!o.isHost || !room || room.phase !== "betting") return;
    const deadline = room.betDeadlineAt || 0;
    // ベット開始の書き込み後、players を1回でも受け取るまでは「全員OK」を信用しない。
    // 部屋ドキュメントの方が先に届くため、ここを見ないと前ラウンドの betDone=true で
    // 賭けられないレースが始まってしまう。
    const playersFresh = o.playersVersion > o.bettingStartedVersion;
    if ((playersFresh && allBet(room)) || (deadline && Date.now() >= deadline)) {
        hostStartRace(room);
        return;
    }
    if (o.betTimer) clearTimeout(o.betTimer);
    if (deadline) {
        o.betTimer = setTimeout(() => {
            if (o.room && o.room.phase === "betting" && o.room.round === room.round) hostStartRace(o.room);
        }, Math.max(0, deadline - Date.now() + 250));
    }
}

// ---- Race ----
function hostStartRace(room) {
    if (!claimOnce("race", room.round)) return;
    fb.updateDoc(roomDoc(), {
        raceSeed: randomSeed(),
        phase: "race",
    }).catch(() => releaseClaim("race", room.round));
}

async function handleRace(room) {
    if (!room.raceSeed || !o.engine) return;
    if (o.playedRound === room.round) return;
    o.playedRound = room.round; // 再生開始ガード（多重起動防止）
    o.playingRound = room.round;

    const ps0 = room.players || {};
    const ordered = await playRace(o.engine.horses, room.raceSeed, {
        engine: o.engine,
        players: Object.keys(ps0)
            .filter((id) => (ps0[id].tickets || []).length)
            .map((id) => ({ name: ps0[id].name, tickets: ps0[id].tickets || [] })),
    });
    if (o.playingRound === room.round) o.playingRound = null;
    if (!ordered) return;                                   // 途中で中断された
    if (!o.room || o.room.round !== room.round) return;     // 待っているうちに次ラウンドへ進んだ
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
    if (!claimOnce("settle", room.round)) return;

    const orderIds = orderFromSeed(room).map((h) => h.id);
    const ps = room.players || {};
    const settledPlayers = {};
    const batch = fb.writeBatch(fb.db);
    Object.keys(ps).forEach((id) => {
        const player = ps[id];
        const tickets = player.tickets || [];
        if (player.bankrupt) {
            const reviveHit = tickets.some((t) => t.revive && t.typeKey === "win" && o.engine.byKey.win.test(orderIds, t.sel || []));
            settledPlayers[id] = {
                ...player,
                balance: reviveHit ? REVIVE_BALANCE : 0,
                bankrupt: !reviveHit,
                reviveResult: reviveHit ? "hit" : (tickets.some((t) => t.revive) ? "miss" : "none"),
                readyNext: false,
            };
            batch.update(playerDoc(id), {
                balance: settledPlayers[id].balance,
                bankrupt: settledPlayers[id].bankrupt,
                reviveResult: settledPlayers[id].reviveResult,
                readyNext: false,
            });
            return;
        }
        const res = settleTickets(tickets, orderIds, o.engine.horses, o.engine.byKey);
        const nb = player.balance + res.delta;
        settledPlayers[id] = {
            ...player,
            balance: Math.max(0, nb),
            bankrupt: nb <= 0,
            readyNext: false,
        };
        delete settledPlayers[id].reviveResult;
        batch.update(playerDoc(id), {
            balance: settledPlayers[id].balance,
            bankrupt: settledPlayers[id].bankrupt,
            reviveResult: fb.deleteField(),
            readyNext: false,
        });
    });
    batch.update(roomDoc(), {
        phase: "result",
        resultDeadlineAt: Date.now() + RESULT_WAIT_MS,
        gameOver: false,
    });
    batch.commit().catch(() => releaseClaim("settle", room.round));
}
function hostReset() {
    const room = o.room;
    if (!room || !claimOnce("reset", room.round)) return;
    const batch = fb.writeBatch(fb.db);
    batch.update(roomDoc(), {
        phase: "lobby",
        gameOver: false,
        raceSeed: 0,
    });
    Object.keys(room.players || {}).forEach((id) => {
        batch.update(playerDoc(id), {
            balance: room.funds,
            betDone: false,
            tickets: [],
            bankrupt: false,
            round: room.round,
        });
    });
    batch.commit().catch(() => releaseClaim("reset", room.round));
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

    // 精算の書き込みは部屋ドキュメントとプレイヤードキュメントで別々に届くので、
    // 残高が変わったときは描き直す。それ以外のスナップショットでは描き直さない
    // （人数分のカウントアップ演出が毎回やり直しになって重く・チラつく）。
    const ps0 = room.players || {};
    const sig = `${room.round}|` + Object.keys(ps0).sort()
        .map((id) => `${id}:${ps0[id].balance}:${ps0[id].bankrupt ? 1 : 0}:${ps0[id].reviveResult || ""}`)
        .join(",");
    if (o.resultShownSig === sig) return;
    o.resultShownSig = sig;

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

    renderResult(ordered, payoutRows, standings, {
        primaryLabel: "",
        onPrimary: null,
        secondaryLabel: "退出する",
        onSecondary: onLeaveClick,
        note: resultCountdownText(room),
        gameOver: false,
        bestBets: bestPerType(orderIds, o.engine),
    });
    startResultCountdown(room);
}

function resultCountdownText(room) {
    const deadline = room.resultDeadlineAt || (Date.now() + RESULT_WAIT_MS);
    const remain = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    return `あと ${remain} 秒で次のレースへ`;
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
        if (note) note.textContent = resultCountdownText(o.room);
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
    const deadline = room.resultDeadlineAt || 0;
    if (deadline && Date.now() >= deadline) {
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
// 着順の再計算はレース1本ぶんのシミュレーションなので、同じシードなら使い回す。
// （結果画面のたびに回すと大人数のとき目に見えて固まる）
let orderCache = { seed: null, horseSeed: null, order: null };
function orderFromSeed(room) {
    if (orderCache.seed === room.raceSeed && orderCache.horseSeed === o.engineSeed) return orderCache.order;
    const data = simulateRaceData(o.engine.horses, makeRng(room.raceSeed));
    const order = data.order.map((i) => o.engine.horses[i]);
    orderCache = { seed: room.raceSeed, horseSeed: o.engineSeed, order };
    return order;
}

// 共有画面（ベット/レース）の退出ボタン用
export function inRoom() { return !!o.code; }
export function requestLeave() { onLeaveClick(); }
