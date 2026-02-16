export class Map {
    constructor(cols, rows, tileSize) {
        this.cols = cols;
        this.rows = rows;
        this.tileSize = tileSize;
        this.grid = [];

        // Initialize grid with basic terrain (0: Plain, 1: Forest)
        for (let y = 0; y < rows; y++) {
            const row = [];
            for (let x = 0; x < cols; x++) {
                // Randomly place some forests
                row.push(Math.random() > 0.8 ? 1 : 0);
            }
            this.grid.push(row);
        }
    }

    getTerrain(x, y) {
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return null;
        return this.grid[y][x];
    }

    draw(ctx) {
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                const terrain = this.grid[y][x];
                const xPos = x * this.tileSize;
                const yPos = y * this.tileSize;

                // Base Ground
                ctx.fillStyle = "#8da25d"; // Base Grass
                if ((x + y) % 2 === 0) {
                    ctx.fillStyle = "#96ad63"; // Checkerboard
                }
                ctx.fillRect(xPos, yPos, this.tileSize, this.tileSize);

                // Draw Detail based on terrain
                if (terrain === 1) { // Forest
                    this.drawForest(ctx, xPos, yPos);
                } else {
                    // Random grass tufts for detail
                    this.drawGrassDetail(ctx, xPos, yPos, x, y);
                }

                // Grid lines - subtle
                ctx.strokeStyle = "rgba(0,0,0,0.05)";
                ctx.strokeRect(xPos, yPos, this.tileSize, this.tileSize);
            }
        }
    }

    drawForest(ctx, x, y) {
        const ts = this.tileSize;
        // Darker patch under trees
        ctx.fillStyle = "#2d6a4f";
        ctx.fillRect(x, y, ts, ts);

        // Draw 3 little trees
        ctx.fillStyle = "#1b4332";

        // Tree 1
        ctx.beginPath();
        ctx.moveTo(x + ts * 0.5, y + ts * 0.1);
        ctx.lineTo(x + ts * 0.8, y + ts * 0.8);
        ctx.lineTo(x + ts * 0.2, y + ts * 0.8);
        ctx.fill();

        // Tree 2 (Offset)
        ctx.fillStyle = "#2d6a4f";
        ctx.beginPath();
        ctx.moveTo(x + ts * 0.3, y + ts * 0.3);
        ctx.lineTo(x + ts * 0.6, y + ts * 0.9);
        ctx.lineTo(x + ts * 0.0, y + ts * 0.9);
        ctx.fill();

        // Tree 3 (Lighter top)
        ctx.fillStyle = "#40916c";
        ctx.beginPath();
        ctx.moveTo(x + ts * 0.7, y + ts * 0.2);
        ctx.lineTo(x + ts * 1.0, y + ts * 0.7);
        ctx.lineTo(x + ts * 0.4, y + ts * 0.7);
        ctx.fill();
    }

    drawGrassDetail(ctx, x, y, gx, gy) {
        // Pseudo-random based on position
        if ((gx * 7 + gy * 3) % 5 === 0) {
            ctx.fillStyle = "#aacc66";
            ctx.fillRect(x + 5, y + 10, 2, 4);
            ctx.fillRect(x + 7, y + 8, 2, 6);
            ctx.fillRect(x + 9, y + 11, 2, 3);
        }
    }

    // BFS to find reachable tiles
    getValidMoves(unit, units) {
        const startNode = { x: unit.x, y: unit.y, dist: 0 };
        const queue = [startNode];
        const visited = new Set();
        const validMoves = [];

        // Helper to check if a tile is occupied by an enemy/obstacle
        const isOccupied = (x, y) => {
            return units.some(u => u.x === x && u.y === y && u !== unit && u.faction !== unit.faction);
        };

        visited.add(`${unit.x},${unit.y}`);
        validMoves.push({ x: unit.x, y: unit.y }); // Can always stay still

        while (queue.length > 0) {
            const current = queue.shift();

            if (current.dist >= unit.move) continue;

            const neighbors = [
                { x: current.x, y: current.y - 1 },
                { x: current.x, y: current.y + 1 },
                { x: current.x - 1, y: current.y },
                { x: current.x + 1, y: current.y }
            ];

            for (const neighbor of neighbors) {
                const key = `${neighbor.x},${neighbor.y}`;
                if (
                    neighbor.x >= 0 && neighbor.x < this.cols &&
                    neighbor.y >= 0 && neighbor.y < this.rows &&
                    !visited.has(key)
                ) {
                    // Check terrain cost (Forest = 2, Plain = 1)
                    const terrain = this.grid[neighbor.y][neighbor.x];
                    const cost = (terrain === 1) ? 2 : 1;

                    if (current.dist + cost <= unit.move && !isOccupied(neighbor.x, neighbor.y)) {
                        visited.add(key);
                        queue.push({ x: neighbor.x, y: neighbor.y, dist: current.dist + cost });
                        validMoves.push({ x: neighbor.x, y: neighbor.y });
                    }
                }
            }
        }
        return validMoves;
    }

    drawOverlay(ctx, validMoves) {
        ctx.fillStyle = "rgba(0, 0, 255, 0.3)"; // Blue overlay for move range
        for (const move of validMoves) {
            ctx.fillRect(move.x * this.tileSize, move.y * this.tileSize, this.tileSize, this.tileSize);
            ctx.strokeStyle = "rgba(0, 0, 255, 0.5)";
            ctx.strokeRect(move.x * this.tileSize, move.y * this.tileSize, this.tileSize, this.tileSize);
        }
    }
}
