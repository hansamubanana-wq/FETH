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

const CLIENT_COUNTS = [10, 20];
const ROUNDS = 3;
const SUMMARY_DEBOUNCE_MS = 300;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label, predicate, timeoutMs = 30000) {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > timeoutMs) {
            throw new Error(`${label} が ${timeoutMs}ms 以内に完了しませんでした`);
        }
        await sleep(50);
    }
    await sleep(350);
}

function summarize(players) {
    const summary = {};
    Object.keys(players).forEach((uid) => {
        const player = players[uid];
        summary[uid] = {
            name: player.name,
            balance: player.balance,
            betDone: !!player.betDone,
            tickets: player.tickets || [],
            bankrupt: !!player.bankrupt,
            readyNext: !!player.readyNext,
            ...(player.reviveResult ? { reviveResult: player.reviveResult } : {}),
        };
    });
    return summary;
}

async function runScenario(clientCount) {
    const roomCode = `ZZ${clientCount}${Date.now().toString(36).toUpperCase()}`;
    const apps = [];
    const clients = [];
    const unsubs = [];
    let roomCreated = false;
    let listenerError = null;
    let summaryTimer = null;
    let hostPlayers = {};
    const metrics = {
        gameplayWrites: 0,
        cleanupWrites: 0,
        summaryWrites: 0,
        roomSnapshotCallbacks: Array(clientCount).fill(0),
        roomDocumentsDelivered: Array(clientCount).fill(0),
        hostPlayerSnapshotCallbacks: 0,
        hostPlayerDocumentsDelivered: 0,
        maxConcurrentWritesToOneDocument: 0,
    };

    const roomRef = (db) => doc(db, "rooms", roomCode);
    const playerRef = (db, uid) => doc(db, "rooms", roomCode, "players", uid);
    const uidAt = (index) => `load-${String(index + 1).padStart(2, "0")}`;
    const pathForPlayer = (index) => `rooms/${roomCode}/players/${uidAt(index)}`;

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

    async function cleanup(db) {
        const batch = writeBatch(db);
        const paths = [];
        for (let i = 0; i < clientCount; i += 1) {
            batch.delete(playerRef(db, uidAt(i)));
            paths.push(pathForPlayer(i));
        }
        batch.delete(roomRef(db));
        paths.push(`rooms/${roomCode}`);
        await batch.commit();
        recordWriteWave(paths, true);
    }

    try {
        for (let i = 0; i < clientCount; i += 1) {
            const app = initializeApp(firebaseConfig, `online-scale-${roomCode}-${i}`);
            const db = getFirestore(app);
            apps.push(app);
            clients.push({ db, room: null });
        }

        const hostDb = clients[0].db;
        for (let i = 0; i < clientCount; i += 1) {
            unsubs.push(onSnapshot(roomRef(clients[i].db), (snapshot) => {
                metrics.roomSnapshotCallbacks[i] += 1;
                if (snapshot.exists()) {
                    metrics.roomDocumentsDelivered[i] += 1;
                    clients[i].room = snapshot.data();
                } else {
                    clients[i].room = null;
                }
            }, (error) => { listenerError ||= error; }));
        }

        const publishSummary = async () => {
            summaryTimer = null;
            await updateDoc(roomRef(hostDb), {
                summary: { players: summarize(hostPlayers), updatedAt: Date.now() },
            });
            metrics.summaryWrites += 1;
            recordWriteWave([`rooms/${roomCode}`]);
        };
        const scheduleSummary = (immediate = false) => {
            if (summaryTimer) clearTimeout(summaryTimer);
            summaryTimer = setTimeout(() => {
                publishSummary().catch((error) => { listenerError ||= error; });
            }, immediate ? 0 : SUMMARY_DEBOUNCE_MS);
        };

        let firstHostSnapshot = true;
        unsubs.push(onSnapshot(collection(hostDb, "rooms", roomCode, "players"), (snapshot) => {
            metrics.hostPlayerSnapshotCallbacks += 1;
            const changes = snapshot.docChanges();
            metrics.hostPlayerDocumentsDelivered += changes.length;
            changes.forEach((change) => {
                if (change.type === "removed") delete hostPlayers[change.doc.id];
                else hostPlayers[change.doc.id] = change.doc.data();
            });
            scheduleSummary(firstHostSnapshot);
            firstHostSnapshot = false;
        }, (error) => { listenerError ||= error; }));

        const setupBatch = writeBatch(hostDb);
        setupBatch.set(roomRef(hostDb), {
            host: uidAt(0),
            phase: "lobby",
            funds: 3000,
            round: 0,
            horseSeed: 0,
            raceSeed: 0,
            summary: { players: {}, updatedAt: Date.now() },
        });
        const setupPaths = [`rooms/${roomCode}`];
        for (let i = 0; i < clientCount; i += 1) {
            setupBatch.set(playerRef(hostDb, uidAt(i)), {
                name: `負荷${i + 1}`,
                balance: 3000,
                betDone: false,
                tickets: [],
            });
            setupPaths.push(pathForPlayer(i));
        }
        await setupBatch.commit();
        roomCreated = true;
        recordWriteWave(setupPaths);
        await waitFor(`${clientCount}人の summary 初期配信`, () => (
            clients.every((client) => Object.keys(client.room?.summary?.players || {}).length === clientCount)
        ));

        for (let round = 1; round <= ROUNDS; round += 1) {
            const startBatch = writeBatch(hostDb);
            const resetPlayers = Object.fromEntries(
                Object.entries(hostPlayers).map(([uid, player]) => [
                    uid,
                    { ...player, betDone: false, tickets: [], readyNext: false },
                ]),
            );
            startBatch.update(roomRef(hostDb), {
                phase: "betting",
                round,
                horseSeed: round * 1000,
                raceSeed: 0,
                summary: { players: summarize(resetPlayers), updatedAt: Date.now() },
            });
            const startPaths = [`rooms/${roomCode}`];
            for (let i = 0; i < clientCount; i += 1) {
                startBatch.update(playerRef(hostDb, uidAt(i)), { betDone: false, tickets: [] });
                startPaths.push(pathForPlayer(i));
            }
            await startBatch.commit();
            recordWriteWave(startPaths);
            await waitFor(`第${round}ラウンド開始`, () => (
                clients.every((client) => client.room?.phase === "betting" && client.room?.round === round)
            ));

            const betPaths = [];
            await Promise.all(clients.map(({ db }, i) => {
                betPaths.push(pathForPlayer(i));
                return updateDoc(playerRef(db, uidAt(i)), {
                    betDone: true,
                    tickets: [{ typeKey: "win", sel: [i % 8], amount: 100 }],
                });
            }));
            recordWriteWave(betPaths);
            await waitFor(`第${round}ラウンド全員ベット`, () => (
                clients.every((client) => (
                    Object.values(client.room?.summary?.players || {}).every((player) => player.betDone)
                ))
            ));

            await updateDoc(roomRef(hostDb), {
                phase: "race",
                raceSeed: round * 1000 + 1,
                summary: { players: summarize(hostPlayers), updatedAt: Date.now() },
            });
            recordWriteWave([`rooms/${roomCode}`]);
            await waitFor(`第${round}ラウンドレース開始`, () => (
                clients.every((client) => client.room?.phase === "race")
            ));

            const settleBatch = writeBatch(hostDb);
            const settledPlayers = Object.fromEntries(
                Object.entries(hostPlayers).map(([uid, player]) => [
                    uid,
                    { ...player, balance: 2900 + round, bankrupt: false, readyNext: false },
                ]),
            );
            settleBatch.update(roomRef(hostDb), {
                phase: "result",
                resultDeadlineAt: Date.now() + 10000,
                summary: { players: summarize(settledPlayers), updatedAt: Date.now() },
            });
            const settlePaths = [`rooms/${roomCode}`];
            for (let i = 0; i < clientCount; i += 1) {
                settleBatch.update(playerRef(hostDb, uidAt(i)), {
                    balance: 2900 + round,
                    bankrupt: false,
                    readyNext: false,
                });
                settlePaths.push(pathForPlayer(i));
            }
            await settleBatch.commit();
            recordWriteWave(settlePaths);
            await waitFor(`第${round}ラウンド精算`, () => (
                clients.every((client) => (
                    client.room?.phase === "result"
                    && Object.values(client.room?.summary?.players || {}).every((player) => player.balance === 2900 + round)
                ))
            ));
        }

        if (listenerError) throw listenerError;
        const nonHostDeliveries = metrics.roomDocumentsDelivered.slice(1);
        return {
            projectId: firebaseConfig.projectId,
            roomCode,
            clients: clientCount,
            rounds: ROUNDS,
            gameplayWrites: metrics.gameplayWrites,
            summaryWrites: metrics.summaryWrites,
            totalRoomDocumentsDelivered: metrics.roomDocumentsDelivered.reduce((sum, value) => sum + value, 0),
            nonHostRoomDocumentsDelivered: nonHostDeliveries,
            averageRoomDocumentsPerNonHost: Number((
                nonHostDeliveries.reduce((sum, value) => sum + value, 0) / nonHostDeliveries.length
            ).toFixed(2)),
            maxRoomDocumentsPerNonHost: Math.max(...nonHostDeliveries),
            hostPlayerSnapshotCallbacks: metrics.hostPlayerSnapshotCallbacks,
            hostPlayerDocumentsDelivered: metrics.hostPlayerDocumentsDelivered,
            maxConcurrentWritesToOneDocument: metrics.maxConcurrentWritesToOneDocument,
        };
    } finally {
        if (summaryTimer) clearTimeout(summaryTimer);
        unsubs.forEach((unsub) => unsub());
        if (roomCreated && clients[0]) {
            await cleanup(clients[0].db).catch((error) => console.error("検証ルームの削除に失敗:", error));
        }
        await Promise.all(apps.map((app) => deleteApp(app)));
    }
}

const results = [];
for (const clientCount of CLIENT_COUNTS) {
    results.push(await runScenario(clientCount));
}

const ten = results.find((result) => result.clients === 10);
const twenty = results.find((result) => result.clients === 20);
const perNonHostGrowthRatio = Number((
    twenty.averageRoomDocumentsPerNonHost / ten.averageRoomDocumentsPerNonHost
).toFixed(3));

console.log(JSON.stringify({
    projectId: firebaseConfig.projectId,
    design: "host-aggregates-players-and-non-hosts-subscribe-room-summary-only",
    results,
    comparison: {
        clientsRatio: 2,
        averageRoomDocumentsPerNonHostGrowthRatio: perNonHostGrowthRatio,
        nonHostDeliveryIsNotQuadratic: perNonHostGrowthRatio < 1.5,
        maxConcurrentWritesToOneDocument: Math.max(
            ...results.map((result) => result.maxConcurrentWritesToOneDocument),
        ),
    },
}, null, 2));

if (perNonHostGrowthRatio >= 1.5) process.exitCode = 1;
