export class Cursor {
    constructor(game) {
        this.game = game;
        this.x = 0;
        this.y = 0;
        this.moveDelay = 100; // ms between moves when holding key
        this.lastMoveTime = 0;

        this.keys = {
            ArrowUp: false,
            ArrowDown: false,
            ArrowLeft: false,
            ArrowRight: false,
            z: false, // Confirm
            x: false  // Cancel
        };
        this.prevKeys = {};
    }

    initInput() {
        window.addEventListener("keydown", (e) => {
            if (this.keys.hasOwnProperty(e.key)) {
                this.keys[e.key] = true;
            }
        });

        window.addEventListener("keyup", (e) => {
            if (this.keys.hasOwnProperty(e.key)) {
                this.keys[e.key] = false;
            }
        });
    }

    update(deltaTime) {
        const now = Date.now();
        if (now - this.lastMoveTime < this.moveDelay) return;

        let moved = false;

        if (this.keys.ArrowUp && this.y > 0) {
            this.y--;
            moved = true;
        } else if (this.keys.ArrowDown && this.y < this.game.rows - 1) {
            this.y++;
            moved = true;
        }

        if (this.keys.ArrowLeft && this.x > 0) {
            this.x--;
            moved = true;
        } else if (this.keys.ArrowRight && this.x < this.game.cols - 1) {
            this.x++;
            moved = true;
        }

        if (moved) {
            this.lastMoveTime = now;
            this.updateInfoPanel();
        }
    }

    updateInfoPanel() {
        // Update UI with terrain info
        const terrain = this.game.map.getTerrain(this.x, this.y);
        const nameEl = document.getElementById("cursor-name");
        const detailsEl = document.getElementById("cursor-details");

        if (terrain === 1) {
            nameEl.innerText = "Forest";
            detailsEl.innerText = "Def: 1, Avo: 20";
        } else {
            nameEl.innerText = "Plain";
            detailsEl.innerText = "Def: 0, Avo: 0";
        }

        // Update Unit Info
        const unit = this.game.units.find(u => u.x === this.x && u.y === this.y);
        const unitPanel = document.getElementById("unit-info");

        if (unit) {
            unitPanel.classList.remove("hidden");
            document.getElementById("unit-name").innerText = unit.name;
            document.getElementById("unit-hp").innerText = `${unit.hp}/${unit.maxHp}`;
            // document.getElementById("unit-lvl").innerText = unit.lvl; // Not implemented yet
        } else {
            unitPanel.classList.add("hidden");
        }
    }

    draw(ctx, tileSize) {
        const xPos = this.x * tileSize;
        const yPos = this.y * tileSize;

        // Draw cursor styling (thick border)
        ctx.strokeStyle = "#fb8500"; // Orange/Gold
        ctx.lineWidth = 3;
        ctx.strokeRect(xPos, yPos, tileSize, tileSize);

        // Inner highlight
        ctx.fillStyle = "rgba(251, 133, 0, 0.2)";
        ctx.fillRect(xPos, yPos, tileSize, tileSize);
    }
}
