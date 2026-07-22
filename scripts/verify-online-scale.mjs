import { initializeApp, deleteApp } from "firebase/app";
import {
    collection,
    doc,
    getFirestore,
    onSnapshot,
    updateDoc,
    writeBatch,
} from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyDpl-P5UIRp9N4MKyNBq4qPX_Hbepmv9MY",
    authDomain: "prospia-d5526.firebaseapp.com",
    projectId: "prospia-d5526",
    storageBucket: "prospia-d5526.firebasestorage.app",
    messagingSenderId: "650955633033",
    appId: "1:650955633033:web:270e8d5757d8e58aa07158",
};

const CLIENTS = 20;
const ROUNDS = 3;
const ROOM_CODE = `ZZ${Date.now().toString(36).toUpperCase()}`;
const apps = [];
const clients = [];
const unsubs = [];
let roomCreated = false;
let listenerError = null;
const metrics = {
    gameplayWrites: 0,
    cleanupWrites: 0,
    snapshotCallbacks: 0,
    deliveredDocuments: 0,
    maxConcurrentWritesToOneDocument: 0,
    perClientCallbacks: Array(CLIENTS).fill(0),
    perClientDocuments: Array(CLIENTS).fill(0),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label, predicate, timeoutMs = 30000) {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeoutMs) throw new Error(`${label} が ${timeoutMs}ms 以内に完了しませんでした`);
        await sleep(50);
    }
    await sleep(300);
}

function recordWriteWave(paths, cleanup = false) {
    if (cleanup) metrics.cleanupWrites += paths.length;
    else metrics.gameplayWrites += paths.length;
    const concentration = new Map();
    paths.forEach((path) => concentration.set(path, (concentration.get(path) || 0) + 1));
    metrics.maxConcurrentWritesToOneDocument = Math.max(
        metrics.maxConcurrentWritesToOneDocument,
        ...concentration.values(),
    );
}

function roomRef(db) { return doc(db, "rooms", ROOM_CODE); }
function playerRef(db, uid) { return doc(db, "rooms", ROOM_CODE, "players", uid); }

async function cleanup(db) {
    const paths = [];
    const batch = writeBatch(db);
    for (let i = 0; i < CLIENTS; i += 1) {
        const uid = `load-${String(i + 1).padStart(2, "0")}`;
        batch.delete(playerRef(db, uid));
        paths.push(`rooms/${ROOM_CODE}/players/${uid}`);
    }
    batch.delete(roomRef(db));
    paths.push(`rooms/${ROOM_CODE}`);
    await batch.commit();
    recordWriteWave(paths, true);
}

try {
    for (let i = 0; i < CLIENTS; i += 1) {
        const app = initializeApp(firebaseConfig, `online-scale-${ROOM_CODE}-${i}`);
        const db = getFirestore(app);
        apps.push(app);
        clients.push({ db, room: null, players: {} });
    }

    const hostDb = clients[0].db;
    for (let i = 0; i < CLIENTS; i += 1) {
        const client = clients[i];
        unsubs.push(onSnapshot(roomRef(client.db), (snapshot) => {
            metrics.snapshotCallbacks += 1;
            metrics.perClientCallbacks[i] += 1;
            if (snapshot.exists()) {
                metrics.deliveredDocuments += 1;
                metrics.perClientDocuments[i] += 1;
                client.room = snapshot.data();
            } else {
                client.room = null;
            }
        }, (error) => { listenerError ||= error; }));
        unsubs.push(onSnapshot(collection(client.db, "rooms", ROOM_CODE, "players"), (snapshot) => {
            metrics.snapshotCallbacks += 1;
            metrics.perClientCallbacks[i] += 1;
            const changes = snapshot.docChanges();
            metrics.deliveredDocuments += changes.length;
            metrics.perClientDocuments[i] += changes.length;
            changes.forEach((change) => {
                if (change.type === "removed") delete client.players[change.doc.id];
                else client.players[change.doc.id] = change.doc.data();
            });
        }, (error) => { listenerError ||= error; }));
    }

    const setupBatch = writeBatch(hostDb);
    setupBatch.set(roomRef(hostDb), { host: "load-01", phase: "lobby", funds: 3000, round: 0, horseSeed: 0, raceSeed: 0 });
    const setupPaths = [`rooms/${ROOM_CODE}`];
    for (let i = 0; i < CLIENTS; i += 1) {
        const uid = `load-${String(i + 1).padStart(2, "0")}`;
        setupBatch.set(playerRef(hostDb, uid), { name: `負荷${i + 1}`, balance: 3000, betDone: false, tickets: [] });
        setupPaths.push(`rooms/${ROOM_CODE}/players/${uid}`);
    }
    await setupBatch.commit();
    roomCreated = true;
    recordWriteWave(setupPaths);
    await waitFor("20クライアントの参加", () => clients.every((client) => Object.keys(client.players).length === CLIENTS));

    for (let round = 1; round <= ROUNDS; round += 1) {
        const startBatch = writeBatch(hostDb);
        startBatch.update(roomRef(hostDb), { phase: "betting", round, horseSeed: round * 1000, raceSeed: 0 });
        const startPaths = [`rooms/${ROOM_CODE}`];
        for (let i = 0; i < CLIENTS; i += 1) {
            const uid = `load-${String(i + 1).padStart(2, "0")}`;
            startBatch.update(playerRef(hostDb, uid), { betDone: false, tickets: [] });
            startPaths.push(`rooms/${ROOM_CODE}/players/${uid}`);
        }
        await startBatch.commit();
        recordWriteWave(startPaths);
        await waitFor(`第${round}ラウンド開始`, () => clients.every((client) => client.room?.phase === "betting" && client.room?.round === round));

        const betPaths = [];
        await Promise.all(clients.map(({ db }, i) => {
            const uid = `load-${String(i + 1).padStart(2, "0")}`;
            betPaths.push(`rooms/${ROOM_CODE}/players/${uid}`);
            return updateDoc(playerRef(db, uid), { betDone: true, tickets: [{ typeKey: "win", sel: [i % 8], amount: 100 }] });
        }));
        recordWriteWave(betPaths);
        await waitFor(`第${round}ラウンド全員ベット`, () => clients.every((client) => Object.values(client.players).every((player) => player.betDone)));

        await updateDoc(roomRef(hostDb), { phase: "race", raceSeed: round * 1000 + 1 });
        recordWriteWave([`rooms/${ROOM_CODE}`]);
        await waitFor(`第${round}ラウンドレース開始`, () => clients.every((client) => client.room?.phase === "race"));

        const settleBatch = writeBatch(hostDb);
        settleBatch.update(roomRef(hostDb), { phase: "result", resultDeadlineAt: Date.now() + 10000 });
        const settlePaths = [`rooms/${ROOM_CODE}`];
        for (let i = 0; i < CLIENTS; i += 1) {
            const uid = `load-${String(i + 1).padStart(2, "0")}`;
            settleBatch.update(playerRef(hostDb, uid), { balance: 2900 + round, bankrupt: false, readyNext: false });
            settlePaths.push(`rooms/${ROOM_CODE}/players/${uid}`);
        }
        await settleBatch.commit();
        recordWriteWave(settlePaths);
        await waitFor(`第${round}ラウンド精算`, () => clients.every((client) => client.room?.phase === "result"));
    }

    const oldSharedRoomWrites = ROUNDS * (1 + CLIENTS + 1 + 1);
    const oldEstimatedDeliveries = oldSharedRoomWrites * CLIENTS;
    const averageCallbacks = metrics.snapshotCallbacks / CLIENTS;
    const averageDocuments = metrics.deliveredDocuments / CLIENTS;
    console.log(JSON.stringify({
        projectId: firebaseConfig.projectId,
        roomCode: ROOM_CODE,
        clients: CLIENTS,
        rounds: ROUNDS,
        gameplayWrites: metrics.gameplayWrites,
        totalSnapshotCallbacks: metrics.snapshotCallbacks,
        totalDeliveredDocuments: metrics.deliveredDocuments,
        callbacksPerClient: metrics.perClientCallbacks,
        deliveredDocumentsPerClient: metrics.perClientDocuments,
        averageCallbacksPerClient: averageCallbacks,
        averageDeliveredDocumentsPerClient: averageDocuments,
        maxConcurrentWritesToOneDocument: metrics.maxConcurrentWritesToOneDocument,
        oldStructureEstimatedSnapshotDeliveries: oldEstimatedDeliveries,
        callbackReductionVsOldEstimatePercent: Number(((1 - metrics.snapshotCallbacks / oldEstimatedDeliveries) * 100).toFixed(1)),
    }, null, 2));
} finally {
    unsubs.forEach((unsub) => unsub());
    if (roomCreated && clients[0]) await cleanup(clients[0].db).catch((error) => console.error("検証ルームの削除に失敗:", error));
    await Promise.all(apps.map((app) => deleteApp(app)));
    if (listenerError) console.error("スナップショットリスナーエラー:", listenerError.code);
}
