// オンライン対戦の同期方式の負荷を実 Firestore で測る。
//
// 旧方式（〜v0.18）: ホストだけが players を購読し、その全内容（買い目込み）を
//   rooms/{code}.summary に書き戻して他の端末へ配っていた。
//   → 誰か1人がベットするたびに部屋ドキュメントを丸ごと書き直すので、
//     人数が増えるほど「1ドキュメント毎秒1書き込み」の目安を超えて詰まり、
//     配信量も人数の2乗で増えていた。
// 新方式（v0.19〜）: 全端末が players サブコレクションを直接購読する。
//   → 部屋ドキュメントへの書き込みは1ラウンドあたり3回（ベット開始・レース開始・精算）で
//     人数に依存しない。各端末が受け取るのも変更のあった1人分だけ。
//
// このスクリプトはその2点を実測で確認する。
//   1. 部屋ドキュメントへの書き込み数が人数に依存しないこと
//   2. 1端末あたりの受信ドキュメント数が人数比（2倍）ほどには増えないこと
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

async function runScenario(clientCount) {
    const roomCode = `ZZ${clientCount}${Date.now().toString(36).toUpperCase()}`;
    const apps = [];
    const clients = [];
    const unsubs = [];
    let roomCreated = false;
    let listenerError = null;
    const metrics = {
        gameplayWrites: 0,
        cleanupWrites: 0,
        roomDocumentWrites: 0,
        roomDocumentsDelivered: Array(clientCount).fill(0),
        playerDocumentsDelivered: Array(clientCount).fill(0),
        maxConcurrentWritesToOneDocument: 0,
    };

    const roomRef = (db) => doc(db, "rooms", roomCode);
    const playerRef = (db, uid) => doc(db, "rooms", roomCode, "players", uid);
    const uidAt = (index) => `load-${String(index + 1).padStart(2, "0")}`;
    const pathForPlayer = (index) => `rooms/${roomCode}/players/${uidAt(index)}`;

    function recordWriteWave(paths, cleanup = false) {
        if (cleanup) metrics.cleanupWrites += paths.length;
        else metrics.gameplayWrites += paths.length;
        metrics.roomDocumentWrites += paths.filter((path) => path === `rooms/${roomCode}`).length;
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

    const allPlayers = (client) => Object.values(client.players);

    try {
        for (let i = 0; i < clientCount; i += 1) {
            const app = initializeApp(firebaseConfig, `online-scale-${roomCode}-${i}`);
            const db = getFirestore(app);
            apps.push(app);
            clients.push({ db, room: null, players: {} });
        }

        const hostDb = clients[0].db;

        // 本番と同じく、全端末が部屋ドキュメントと players サブコレクションの両方を購読する
        for (let i = 0; i < clientCount; i += 1) {
            unsubs.push(onSnapshot(roomRef(clients[i].db), (snapshot) => {
                if (snapshot.exists()) {
                    metrics.roomDocumentsDelivered[i] += 1;
                    clients[i].room = snapshot.data();
                } else {
                    clients[i].room = null;
                }
            }, (error) => { listenerError ||= error; }));

            unsubs.push(onSnapshot(collection(clients[i].db, "rooms", roomCode, "players"), (snapshot) => {
                const changes = snapshot.docChanges();
                metrics.playerDocumentsDelivered[i] += changes.length;
                changes.forEach((change) => {
                    if (change.type === "removed") delete clients[i].players[change.doc.id];
                    else clients[i].players[change.doc.id] = change.doc.data();
                });
            }, (error) => { listenerError ||= error; }));
        }

        const setupBatch = writeBatch(hostDb);
        setupBatch.set(roomRef(hostDb), {
            host: uidAt(0),
            phase: "lobby",
            funds: 3000,
            round: 0,
            horseSeed: 0,
            raceSeed: 0,
            createdAt: Date.now(),
        });
        const setupPaths = [`rooms/${roomCode}`];
        for (let i = 0; i < clientCount; i += 1) {
            setupBatch.set(playerRef(hostDb, uidAt(i)), {
                name: `負荷${i + 1}`,
                balance: 3000,
                betDone: false,
                tickets: [],
                bankrupt: false,
                readyNext: false,
            });
            setupPaths.push(pathForPlayer(i));
        }
        await setupBatch.commit();
        roomCreated = true;
        recordWriteWave(setupPaths);
        await waitFor(`${clientCount}人の初期配信`, () => (
            clients.every((client) => Object.keys(client.players).length === clientCount)
        ));

        for (let round = 1; round <= ROUNDS; round += 1) {
            // ベット開始：部屋ドキュメントはフェーズとシードだけ（summary を持たない）
            const startBatch = writeBatch(hostDb);
            startBatch.update(roomRef(hostDb), {
                phase: "betting",
                round,
                horseSeed: round * 1000,
                raceSeed: 0,
                betDeadlineAt: Date.now() + 120000,
            });
            const startPaths = [`rooms/${roomCode}`];
            for (let i = 0; i < clientCount; i += 1) {
                startBatch.update(playerRef(hostDb, uidAt(i)), { betDone: false, tickets: [], readyNext: false });
                startPaths.push(pathForPlayer(i));
            }
            await startBatch.commit();
            recordWriteWave(startPaths);
            await waitFor(`第${round}ラウンド開始`, () => (
                clients.every((client) => client.room?.phase === "betting" && client.room?.round === round)
            ));

            // 各自が自分のドキュメントだけを書く（部屋ドキュメントには触らない）
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
                    allPlayers(client).length === clientCount
                    && allPlayers(client).every((player) => player.betDone)
                ))
            ));

            await updateDoc(roomRef(hostDb), { phase: "race", raceSeed: round * 1000 + 1 });
            recordWriteWave([`rooms/${roomCode}`]);
            await waitFor(`第${round}ラウンドレース開始`, () => (
                clients.every((client) => client.room?.phase === "race")
            ));

            const settleBatch = writeBatch(hostDb);
            settleBatch.update(roomRef(hostDb), {
                phase: "result",
                resultDeadlineAt: Date.now() + 10000,
                gameOver: false,
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
                    && allPlayers(client).every((player) => player.balance === 2900 + round)
                ))
            ));
        }

        if (listenerError) throw listenerError;
        const perClientDeliveries = metrics.roomDocumentsDelivered.map(
            (rooms, i) => rooms + metrics.playerDocumentsDelivered[i],
        );
        return {
            projectId: firebaseConfig.projectId,
            roomCode,
            clients: clientCount,
            rounds: ROUNDS,
            gameplayWrites: metrics.gameplayWrites,
            // 部屋ドキュメントへの書き込み。人数に依存しないのが新方式の要点。
            roomDocumentWrites: metrics.roomDocumentWrites,
            roomDocumentWritesPerRound: Number((metrics.roomDocumentWrites / ROUNDS).toFixed(2)),
            averageDocumentsDeliveredPerClient: Number((
                perClientDeliveries.reduce((sum, value) => sum + value, 0) / clientCount
            ).toFixed(2)),
            maxDocumentsDeliveredPerClient: Math.max(...perClientDeliveries),
            maxConcurrentWritesToOneDocument: metrics.maxConcurrentWritesToOneDocument,
        };
    } finally {
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
const perClientGrowthRatio = Number((
    twenty.averageDocumentsDeliveredPerClient / ten.averageDocumentsDeliveredPerClient
).toFixed(3));
// 部屋ドキュメントの書き込みは人数に関係なく「1ラウンド3回」で一定のはず
const roomWritesAreFlat = ten.roomDocumentWrites === twenty.roomDocumentWrites;

console.log(JSON.stringify({
    projectId: firebaseConfig.projectId,
    design: "every-client-subscribes-players-subcollection-directly",
    results,
    comparison: {
        clientsRatio: 2,
        averageDocumentsDeliveredPerClientGrowthRatio: perClientGrowthRatio,
        // 人数2倍で配信量も約2倍まで（＝人数に比例）。2乗で増えていないことを見る。
        perClientDeliveryIsNotQuadratic: perClientGrowthRatio < 2.5,
        roomDocumentWritesAreIndependentOfPlayerCount: roomWritesAreFlat,
        maxConcurrentWritesToOneDocument: Math.max(
            ...results.map((result) => result.maxConcurrentWritesToOneDocument),
        ),
    },
}, null, 2));

if (perClientGrowthRatio >= 2.5 || !roomWritesAreFlat) process.exitCode = 1;
