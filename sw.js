const APP_VERSION = "0.20.1";
const APP_BUILD = 29;
const CACHE_NAME = `feth-build-${APP_BUILD}`;

const PRECACHE_URLS = [
    "./",
    "./index.html",
    "./style.css",
    "./manifest.webmanifest",
    "./assets/art/favicon.svg",
    "./assets/art/icon-192.png",
    "./assets/art/icon-512.png",
    "./assets/art/logo.png",
    "./assets/art/ogp.png",
    "./assets/art/victory.png",
    "./assets/art/bg-home.png",
    "./assets/art/bg-paddock.png",
    "./assets/art/bg-stadium.png",
    "./assets/art/horses/horse1.png",
    "./assets/art/horses/horse2.png",
    "./assets/art/horses/horse3.png",
    "./assets/art/horses/horse4.png",
    "./assets/art/horses/horse5.png",
    "./assets/art/horses/horse6.png",
    "./assets/art/horses/horse7.png",
    "./assets/art/horses/horse8.png",
    "./assets/art/tex/crowd.png",
    "./assets/art/tex/dirt.png",
    "./assets/art/tex/turf.png",
    "./assets/art/tex/sky-day.png",
    "./assets/art/tex/sky-evening.png",
    "./assets/art/tex/sky-night.png",
    "./assets/art/tex/half/crowd.png",
    "./assets/art/tex/half/dirt.png",
    "./assets/art/tex/half/turf.png",
    "./assets/art/tex/half/sky-day.png",
    "./assets/art/tex/half/sky-evening.png",
    "./assets/art/tex/half/sky-night.png",
    "./assets/models/horse.glb",
    "./vendor/three/three.module.min.js",
    "./vendor/three/addons/loaders/GLTFLoader.js",
    "./vendor/three/addons/utils/BufferGeometryUtils.js",
    "./vendor/three/addons/utils/SkeletonUtils.js",
    "./vendor/firebase/firebase-app.js",
    "./vendor/firebase/firebase-firestore.js",
    "./src/bets.js",
    "./src/betui.js",
    "./src/engine.js",
    "./src/firebase-config.js",
    "./src/graphics-quality.js",
    "./src/horses.js",
    "./src/local.js",
    "./src/main.js",
    "./src/names.js",
    "./src/online.js",
    "./src/race.js",
    "./src/race-sim.js",
    "./src/race3d.js",
    "./src/raceui.js",
    "./src/rng.js",
    "./src/ui.js",
    // version.js もビルドと一緒にキャッシュする。ここだけネットワークから
    // 最新を返していると、実際に動いているコードが古いままでも APP_BUILD が
    // 最新になり、「自分は最新」と誤判定して更新バナーが出なくなる。
    "./src/version.js",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((name) => name.startsWith("feth-build-") && name !== CACHE_NAME)
                    .map((name) => caches.delete(name)),
            ))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(request).then((cached) => cached || fetch(request)),
    );
});
