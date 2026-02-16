import { Game } from "./Game.js";
import { MobileControls } from "./MobileControls.js";

window.addEventListener("load", () => {
    const canvas = document.getElementById("game-canvas");

    // Set canvas to full screen
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Handle Resize
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        // Note: Game.js might need a method to handle resize if we want dynamic updates,
        // but for now a reload is usually expected for major resizing. 
        // We'll keep it simple.
    });

    // Initialize Mobile Controls
    const controls = new MobileControls();
    controls.init();

    const game = new Game(canvas);
    game.start();
});
