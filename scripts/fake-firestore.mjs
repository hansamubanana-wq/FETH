// テスト用のインメモリ Firestore（オンライン対戦の同期検証に使う）。
// 本物の Firestore と同じく「部屋ドキュメントのリスナー」と
// 「players コレクションのリスナー」は別々に発火し、到着順は保証されない。
// ここではその順序を意図的に再現する（部屋ドキュメントを先、players を遅らせる）。
// これが v0.19.0 で「賭けられないレースが即座に始まる」不具合を生んだ条件。
export const FAKE_FIRESTORE_SOURCE = `
const store = new Map();          // path -> data
const docListeners = [];          // { path, cb }
const colListeners = [];          // { path, cb }
const DELETE = Symbol("delete");
window.__fakeDb = {
    store,
    collectionDelayMs: 60,   // players コレクションが部屋ドキュメントより遅れて届く量
    writes: [],
    // テストから「別端末の書き込み」を再現するための入口（通知も本番と同じ経路で流れる）
    write: (path, data) => writeDoc(path, data, { merge: true }),
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const pathOf = (ref) => ref.__path;

function docSnap(path) {
    const data = store.get(path);
    return { id: path.split("/").pop(), exists: () => data !== undefined, data: () => clone(data) };
}
function colSnap(colPath) {
    const prefix = colPath + "/";
    const rows = [];
    for (const [path, data] of store) {
        if (!path.startsWith(prefix)) continue;
        if (path.slice(prefix.length).includes("/")) continue;
        rows.push({ id: path.slice(prefix.length), data: () => clone(data) });
    }
    return { forEach: (fn) => rows.forEach(fn), docs: rows, size: rows.length };
}

let flushTimer = null;
const dirtyDocs = new Set();
let dirtyCols = false;
function markDirty(path) {
    dirtyDocs.add(path);
    dirtyCols = true;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        const paths = new Set(dirtyDocs);
        dirtyDocs.clear();
        // 1) ドキュメントリスナーを先に流す（本番でも部屋ドキュメントが先に届きやすい）
        for (const l of docListeners.slice()) if (paths.has(l.path)) l.cb(docSnap(l.path));
        // 2) コレクションリスナーは遅れて流す
        if (dirtyCols) {
            dirtyCols = false;
            setTimeout(() => {
                for (const l of colListeners.slice()) l.cb(colSnap(l.path));
            }, window.__fakeDb.collectionDelayMs);
        }
    }, 0);
}

function applyMerge(target, data) {
    const out = { ...(target || {}) };
    for (const [k, v] of Object.entries(data)) {
        if (v === DELETE) delete out[k];
        else out[k] = v;
    }
    return out;
}
function writeDoc(path, data, { merge }) {
    window.__fakeDb.writes.push(path);
    store.set(path, merge ? applyMerge(store.get(path), data) : applyMerge(null, data));
    markDirty(path);
}
function updateDocPath(path, data) {
    if (!store.has(path)) throw Object.assign(new Error("No document to update: " + path), { code: "not-found" });
    writeDoc(path, data, { merge: true });
}

export const initializeApp = () => ({});
export const getFirestore = () => ({ __db: true });
export const doc = (db, ...seg) => ({ __path: seg.join("/") });
export const collection = (db, ...seg) => ({ __path: seg.join("/"), __collection: true });
export const deleteField = () => DELETE;
export const arrayUnion = (...items) => ({ __arrayUnion: items });
export const arrayRemove = (...items) => ({ __arrayRemove: items });
export async function setDoc(ref, data, opts) { writeDoc(pathOf(ref), data, { merge: !!(opts && opts.merge) }); }
export async function updateDoc(ref, data) { updateDocPath(pathOf(ref), data); }
export async function deleteDoc(ref) {
    store.delete(pathOf(ref));
    markDirty(pathOf(ref));
}
export async function getDoc(ref) { return docSnap(pathOf(ref)); }
export function onSnapshot(ref, cb) {
    const entry = { path: pathOf(ref), cb };
    if (ref.__collection) {
        colListeners.push(entry);
        setTimeout(() => cb(colSnap(entry.path)), 0);
        return () => { const i = colListeners.indexOf(entry); if (i >= 0) colListeners.splice(i, 1); };
    }
    docListeners.push(entry);
    setTimeout(() => cb(docSnap(entry.path)), 0);
    return () => { const i = docListeners.indexOf(entry); if (i >= 0) docListeners.splice(i, 1); };
}
export function writeBatch() {
    const ops = [];
    return {
        set: (ref, data, opts) => ops.push(["set", pathOf(ref), data, opts]),
        update: (ref, data) => ops.push(["update", pathOf(ref), data]),
        delete: (ref) => ops.push(["delete", pathOf(ref)]),
        // バッチはアトミック。ただし通知は本番同様リスナーごとに分かれて届く。
        commit: async () => {
            for (const [op, path] of ops) {
                if (op === "update" && !store.has(path)) {
                    throw Object.assign(new Error("No document to update: " + path), { code: "not-found" });
                }
            }
            for (const [op, path, data, opts] of ops) {
                if (op === "set") writeDoc(path, data, { merge: !!(opts && opts.merge) });
                else if (op === "update") writeDoc(path, data, { merge: true });
                else { store.delete(path); markDirty(path); }
            }
        },
    };
}
`;
