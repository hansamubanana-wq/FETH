// 画面切り替えの共通ヘルパー。
let activeScreen = null;
export function showScreen(id) {
    // オンラインは毎スナップショットで同じ画面を指定してくるので、変化がないときは何もしない
    if (activeScreen === id && document.getElementById(id)?.classList.contains("active")) return;
    activeScreen = id;
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
    const paddockScreens = new Set(["screen-pick"]);
    const stadiumScreens = new Set(["screen-race", "screen-result"]);
    const scene = paddockScreens.has(id) ? "paddock" : stadiumScreens.has(id) ? "stadium" : "home";
    document.body.dataset.scene = scene;
    document.body.dataset.landscapeRequired = String(id === "screen-pick" || id === "screen-race");
}

// 32bit 乱数シードを作る（ローカルやホストのレース生成用）。
export function randomSeed() {
    return (Math.floor(Math.random() * 0xffffffff)) >>> 0;
}
