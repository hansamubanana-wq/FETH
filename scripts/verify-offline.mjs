import { chromium } from "playwright";

const APP_URL = "http://localhost:8000/";
const FORBIDDEN_HOSTS = ["unpkg.com", "threejs.org", "www.gstatic.com"];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
const forbiddenRequests = [];

page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("request", (request) => {
    const host = new URL(request.url()).hostname;
    if (FORBIDDEN_HOSTS.some((forbidden) => host === forbidden || host.endsWith(`.${forbidden}`))) {
        forbiddenRequests.push(request.url());
    }
});

await page.goto(APP_URL, { waitUntil: "load" });
await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
            navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
        });
    }
});
await page.reload({ waitUntil: "load" });

const cacheAudit = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const cachedUrls = (await Promise.all(
        cacheNames.map(async (name) => (await caches.open(name)).keys()),
    )).flat().map((request) => request.url);
    return {
        cacheNames,
        versionCached: cachedUrls.some((url) => new URL(url).pathname.endsWith("/src/version.js")),
    };
});

await context.setOffline(true);
await page.reload({ waitUntil: "load" });
await page.evaluate(() => { window.confirm = () => true; });

await page.locator("#go-local").click();
await page.locator("#player-minus").click();
await page.locator("#to-pick").click();
await page.locator("#skip-bet").click();
await page.locator("#screen-result.active").waitFor({ timeout: 90_000 });

const resultRows = await page.locator("#result-list li").count();
const outcome = {
    offlineRaceCompleted: resultRows === 8,
    resultRows,
    forbiddenRequestCount: forbiddenRequests.length,
    forbiddenRequests,
    versionCached: cacheAudit.versionCached,
    cacheNames: cacheAudit.cacheNames,
    errors,
};

console.log(JSON.stringify(outcome, null, 2));
await browser.close();
process.exit(
    !outcome.offlineRaceCompleted
    || outcome.forbiddenRequestCount !== 0
    || outcome.versionCached
    || errors.length
        ? 1
        : 0,
);
