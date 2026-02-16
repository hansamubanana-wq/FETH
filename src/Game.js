import { Map } from "./Map.js";
import { Cursor } from "./Cursor.js";
import { Unit } from "./Unit.js";
import { Menu } from "./Menu.js";

export class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.width = canvas.width;
        this.height = canvas.height;

        this.tileSize = 32; // 32x32 pixel tiles
        this.rows = 20;
        this.cols = 30;

        this.map = new Map(this.cols, this.rows, this.tileSize);
        this.cursor = new Cursor(this);
        this.menu = new Menu();
        this.units = [];

        // Debug unit
        this.units.push(new Unit("Byleth", 5, 5, "player"));
        this.units.push(new Unit("Edelgard", 8, 5, "player"));
        this.units.push(new Unit("Bandit", 12, 8, "enemy"));

        this.lastTime = 0;

        // Game State
        this.gameState = "MAP"; // MAP, UNIT_MOVE, MENU
        this.selectedUnit = null;
        this.validMoves = [];
        this.originalPos = { x: 0, y: 0 }; // Store original pos if cancel
        this.turn = "player"; // 'player' or 'enemy'
    }

    start() {
        this.cursor.initInput();
        requestAnimationFrame(this.loop.bind(this));
    }

    loop(timestamp) {
        const deltaTime = timestamp - this.lastTime;
        this.lastTime = timestamp;

        this.update(deltaTime);
        this.draw();

        requestAnimationFrame(this.loop.bind(this));
    }

    update(deltaTime) {
        const prevKeys = this.cursor.prevKeys;
        const keys = this.cursor.keys;

        // Freeze cursor/units if in MENU or ENEMY_TURN
        if (this.gameState !== "MENU" && this.turn === "player") {
            this.cursor.update(deltaTime);
        }
        this.units.forEach(unit => unit.update(deltaTime));

        // Input Handling only during Player Turn
        if (this.turn === "player") {
            if (keys.z && !prevKeys.z) {
                this.handleConfirm();
            }
            if (keys.x && !prevKeys.x) {
                this.handleCancel();
            }

            // Menu Navigation
            if (this.gameState === "MENU") {
                if (keys.ArrowUp && !prevKeys.ArrowUp) this.menu.navigate(-1);
                if (keys.ArrowDown && !prevKeys.ArrowDown) this.menu.navigate(1);
            }
        }

        // Store previous key state to detect distinct presses
        this.cursor.prevKeys = { ...this.cursor.keys };
    }

    handleConfirm() {
        const cx = this.cursor.x;
        const cy = this.cursor.y;

        if (this.gameState === "MAP") {
            // Try to select a unit
            const unit = this.units.find(u => u.x === cx && u.y === cy);
            if (unit && unit.faction === "player" && !unit.hasMoved) {
                this.selectedUnit = unit;
                this.originalPos = { x: unit.x, y: unit.y };
                this.validMoves = this.map.getValidMoves(unit, this.units);
                this.gameState = "UNIT_MOVE";
                console.log("Unit selected:", unit.name);
            }
        } else if (this.gameState === "UNIT_MOVE") {
            // Try to move unit
            const move = this.validMoves.find(m => m.x === cx && m.y === cy);
            if (move) {
                const occupant = this.units.find(u => u.x === cx && u.y === cy && u !== this.selectedUnit);
                if (!occupant) {
                    this.selectedUnit.x = cx;
                    this.selectedUnit.y = cy;

                    // Check for enemies in range (fixed range 1 for now)
                    const enemiesInRange = this.units.filter(u =>
                        u.faction !== this.selectedUnit.faction &&
                        Math.abs(u.x - cx) + Math.abs(u.y - cy) === 1
                    );

                    const menuOptions = [];
                    if (enemiesInRange.length > 0) {
                        menuOptions.push({ label: "Attack", value: "attack" });
                    }
                    menuOptions.push({ label: "Wait", value: "wait" });

                    // Show Menu
                    const screenX = cx * this.tileSize + 40;
                    const screenY = cy * this.tileSize;

                    this.gameState = "MENU";
                    this.menu.show(screenX, screenY, menuOptions);
                }
            }
        } else if (this.gameState === "MENU") {
            const action = this.menu.select();
            if (action === "wait") {
                this.finishAction();
            } else if (action === "attack") {
                this.menu.hide();
                this.gameState = "UNIT_ATTACK";
                // Highlight attackable squares logic could go here or in draw
            }
        } else if (this.gameState === "UNIT_ATTACK") {
            // Check if cursor is on an enemy in range
            const enemy = this.units.find(u =>
                u.x === cx && u.y === cy &&
                u.faction !== this.selectedUnit.faction &&
                Math.abs(u.x - this.selectedUnit.x) + Math.abs(this.selectedUnit.y - u.y) === 1
            );

            if (enemy) {
                this.executeCombat(this.selectedUnit, enemy);
                this.finishAction();
            }
        }
    }

    handleCancel() {
        if (this.gameState === "UNIT_MOVE") {
            this.gameState = "MAP";
            this.selectedUnit = null;
            this.validMoves = [];
            console.log("Selection cancelled");
        } else if (this.gameState === "MENU") {
            // Cancel movement, go back to UNIT_MOVE
            this.selectedUnit.x = this.originalPos.x;
            this.selectedUnit.y = this.originalPos.y;
            this.menu.hide();
            this.gameState = "UNIT_MOVE";
            // Reposition cursor to unit?
            this.cursor.x = this.selectedUnit.x;
            this.cursor.y = this.selectedUnit.y;
        } else if (this.gameState === "UNIT_ATTACK") {
            // Go back to menu
            const screenX = this.selectedUnit.x * this.tileSize + 40;
            const screenY = this.selectedUnit.y * this.tileSize;
            this.gameState = "MENU";
            this.menu.show(screenX, screenY, [
                { label: "Attack", value: "attack" },
                { label: "Wait", value: "wait" }
            ]);
        }
    }

    executeCombat(attacker, defender) {
        console.log(`${attacker.name} attacks ${defender.name}!`);

        // Basic damage calc
        const dmg = Math.max(0, attacker.str - defender.def);
        defender.hp -= dmg;
        console.log(`Damage: ${dmg}, ${defender.name} HP: ${defender.hp}`);

        // Counter attack logic would go here

        // Check death
        if (defender.hp <= 0) {
            console.log(`${defender.name} defeated!`);
            this.units = this.units.filter(u => u !== defender);
        }
    }

    finishAction() {
        if (this.selectedUnit) {
            this.selectedUnit.hasMoved = true;
            this.selectedUnit.isGrayedOut = true;
            this.selectedUnit = null;
        }
        this.menu.hide(); // safety
        this.gameState = "MAP";
        this.validMoves = [];
        this.checkTurnEnd();
    }

    checkTurnEnd() {
        const playerUnits = this.units.filter(u => u.faction === "player");
        const enemyUnits = this.units.filter(u => u.faction === "enemy");

        if (playerUnits.length === 0) {
            alert("Game Over!");
            // location.reload();
            return;
        }
        if (enemyUnits.length === 0) {
            alert("Victory!");
            // location.reload();
            return;
        }

        const activeUnits = this.units.filter(u => u.faction === this.turn && !u.hasMoved);
        if (activeUnits.length === 0) {
            this.endTurn();
        }
    }

    endTurn() {
        this.turn = this.turn === "player" ? "enemy" : "player";
        console.log(`Starting ${this.turn} turn`);

        // Reset movement flags for the new turn's units
        this.units.forEach(u => {
            if (u.faction === this.turn) {
                u.hasMoved = false;
                u.isGrayedOut = false;
            }
        });

        if (this.turn === "enemy") {
            setTimeout(() => this.runEnemyAI(), 500);
        }
    }

    async runEnemyAI() {
        const enemies = this.units.filter(u => u.faction === "enemy");

        for (const enemy of enemies) {
            // Find closest player unit
            let target = null;
            let minDist = Infinity;

            const players = this.units.filter(u => u.faction === "player");
            for (const p of players) {
                const dist = Math.abs(p.x - enemy.x) + Math.abs(p.y - enemy.y);
                if (dist < minDist) {
                    minDist = dist;
                    target = p;
                }
            }

            if (target) {
                // Move towards target
                // Simple AI: Calculate valid moves, pick one closest to target
                const validMoves = this.map.getValidMoves(enemy, this.units);
                let bestMove = { x: enemy.x, y: enemy.y };
                let bestDist = minDist;

                for (const move of validMoves) {
                    // Don't move onto an occupied square (except self)
                    const occupant = this.units.find(u => u.x === move.x && u.y === move.y && u !== enemy);
                    if (!occupant) {
                        const dist = Math.abs(target.x - move.x) + Math.abs(target.y - move.y);
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestMove = move;
                        }
                    }
                }

                enemy.x = bestMove.x;
                enemy.y = bestMove.y;

                // Attack if adjacent
                const adjacentPlayer = players.find(p => Math.abs(p.x - enemy.x) + Math.abs(p.y - enemy.y) === 1);
                if (adjacentPlayer) {
                    this.executeCombat(enemy, adjacentPlayer);
                }

                enemy.hasMoved = true;
                enemy.isGrayedOut = true;

                // Wait a bit to visualize
                await new Promise(r => setTimeout(r, 500));
            }
        }

        this.endTurn(); // Switch back to player
    }

    draw() {
        this.ctx.clearRect(0, 0, this.width, this.height);

        this.map.draw(this.ctx);

        // Draw move overlay if selecting
        if (this.gameState === "UNIT_MOVE") {
            this.map.drawOverlay(this.ctx, this.validMoves);
        }

        // Highlight attackable targets in UNIT_ATTACK
        if (this.gameState === "UNIT_ATTACK") {
            const enemiesInRange = this.units.filter(u =>
                u.faction !== this.selectedUnit.faction &&
                Math.abs(u.x - this.selectedUnit.x) + Math.abs(u.y - this.selectedUnit.y) === 1
            );

            this.ctx.strokeStyle = "red";
            this.ctx.lineWidth = 3;
            enemiesInRange.forEach(e => {
                this.ctx.strokeRect(e.x * this.tileSize, e.y * this.tileSize, this.tileSize, this.tileSize);
            });
        }

        this.units.forEach(unit => unit.draw(this.ctx, this.tileSize));
        if (this.turn === "player" && this.gameState !== "MENU") {
            this.cursor.draw(this.ctx, this.tileSize);
        }

        // Draw Turn Banner
        const bannerY = 30;
        const bannerHeight = 40;
        const text = this.turn === "player" ? "PLAYER PHASE" : "ENEMY PHASE";
        const color = this.turn === "player" ? "#1e88e5" : "#e53935";

        // Banner Background (Gradient)
        const grad = this.ctx.createLinearGradient(0, bannerY - 20, this.width, bannerY - 20);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(0.2, color);
        grad.addColorStop(0.8, color);
        grad.addColorStop(1, "rgba(0,0,0,0)");

        this.ctx.fillStyle = grad;
        this.ctx.fillRect(0, bannerY - 25, this.width, bannerHeight);

        // Banner Text
        this.ctx.font = "bold 24px 'Segoe UI', serif";
        this.ctx.fillStyle = "white";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";

        // Text Shadow
        this.ctx.shadowColor = "black";
        this.ctx.shadowBlur = 4;
        this.ctx.fillText(text, this.width / 2, bannerY - 5);

        this.ctx.shadowBlur = 0; // Reset
    }
}
