export class Unit {
    constructor(name, x, y, faction) {
        this.name = name;
        this.x = x;
        this.y = y;
        this.faction = faction; // 'player', 'enemy', 'ally'

        this.hp = 20;
        this.maxHp = 20;
        this.str = 5;
        this.def = 2;
        this.spd = 4;
        this.move = 5; // Default movement ranage
    }

    update(deltaTime) {
        // visual animations (idle bobbing) can go here
    }

    draw(ctx, tileSize) {
        const xPos = this.x * tileSize;
        const yPos = this.y * tileSize;

        // Draw Unit Placeholder
        if (this.isGrayedOut) {
            ctx.fillStyle = "#888";
        } else {
            ctx.fillStyle = this.faction === 'player' ? "#4361ee" : "#d00000"; // Blue for player, Red for enemy
        }

        // Draw circle for unit
        ctx.beginPath();
        ctx.arc(xPos + tileSize / 2, yPos + tileSize / 2, tileSize / 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Draw highlight/shadow to make it look like a token
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw HP Bar
        const hpPct = this.hp / this.maxHp;
        ctx.fillStyle = "black";
        ctx.fillRect(xPos + 2, yPos + tileSize - 6, tileSize - 4, 4);

        ctx.fillStyle = hpPct > 0.5 ? "#00ff00" : (hpPct > 0.2 ? "orange" : "red");
        ctx.fillRect(xPos + 2, yPos + tileSize - 6, (tileSize - 4) * hpPct, 4);
    }
}
