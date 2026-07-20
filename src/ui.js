// 画面切り替えの共通ヘルパー。
export function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
    const paddockScreens = new Set(["screen-pick"]);
    const stadiumScreens = new Set(["screen-race", "screen-result"]);
    const scene = paddockScreens.has(id) ? "paddock" : stadiumScreens.has(id) ? "stadium" : "home";
    document.body.dataset.scene = scene;
}

// 32bit 乱数シードを作る（ローカルやホストのレース生成用）。
export function randomSeed() {
    return (Math.floor(Math.random() * 0xffffffff)) >>> 0;
}
