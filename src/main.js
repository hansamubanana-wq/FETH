import { Game } from "./Game.js";
import { MobileControls } from "./MobileControls.js";

window.addEventListener("load", () => {
    const canvas = document.getElementById("game-canvas");

    // Initialize Mobile Controls
    const controls = new MobileControls();
    controls.init();

    const game = new Game(canvas);
    game.start();
});
