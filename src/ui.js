// 画面切り替えの共通ヘルパー。
export function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

// 32bit 乱数シードを作る（ローカルやホストのレース生成用）。
export function randomSeed() {
    return (Math.floor(Math.random() * 0xffffffff)) >>> 0;
}
