// ==================== server.js ====================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    connectionStateRecovery: {}
});

// ========== إعدادات الأداء الفائقة ==========
const BOUNDARY = 1800;              // خريطة صغيرة جداً لتسريع الحسابات
const BASE_SPEED = 4.5;             // سرعة أعلى
const NITRO_SPEED = 12.0;           // نيترو أسرع
const COLLISION_DIST = 18;           // مسافة تصادم أقل

// ✅ نيترو يخلص بسرعة
const NITRO_MAX_FUEL = 100;
const NITRO_DRAIN_RATE = 3.2;        // استنزاف سريع جداً
const NITRO_REFILL_RATE = 0.6;       // تعبئة بطيئة

const BOT_COUNT = 1;                 // بوت واحد فقط لتخفيف الضغط

// ========== حالة اللعبة ==========
let players = {};
let bots = [];

// ========== كائن الثعبان ==========
class Snake {
    constructor(id, name, color, startX = null, startY = null) {
        this.id = id;
        this.name = name;
        this.color = color;
        this.score = 500;
        this.width = 28;
        this.nitro = false;
        this.nitroFuel = NITRO_MAX_FUEL;
        if (startX === null) startX = (Math.random() - 0.5) * BOUNDARY * 0.6;
        if (startY === null) startY = (Math.random() - 0.5) * BOUNDARY * 0.6;
        this.points = [];
        for (let i = 0; i < 30; i++) {
            this.points.push({ x: startX - i * 14, y: startY });
        }
        const angle = Math.random() * Math.PI * 2;
        this.direction = { x: Math.cos(angle), y: Math.sin(angle) };
        this.targetDir = { ...this.direction };
    }

    updateDirection(target) { if (target) this.targetDir = target; }

    applyMovement(speed) {
        let curAng = Math.atan2(this.direction.y, this.direction.x);
        let targetAng = Math.atan2(this.targetDir.y, this.targetDir.x);
        let diff = targetAng - curAng;
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        const newAng = curAng + Math.min(0.25, Math.max(-0.25, diff));
        this.direction = { x: Math.cos(newAng), y: Math.sin(newAng) };

        const head = this.points[0];
        let newHead = {
            x: head.x + this.direction.x * speed,
            y: head.y + this.direction.y * speed
        };
        newHead.x = Math.min(Math.max(newHead.x, -BOUNDARY), BOUNDARY);
        newHead.y = Math.min(Math.max(newHead.y, -BOUNDARY), BOUNDARY);
        this.points.unshift(newHead);
        this.points.pop();
    }

    growFromKill(amount) {
        for (let a = 0; a < amount; a++) {
            const last = this.points[this.points.length - 1];
            const prev = this.points[this.points.length - 2];
            if (prev) {
                this.points.push({
                    x: last.x + (last.x - prev.x),
                    y: last.y + (last.y - prev.y)
                });
            } else {
                this.points.push({ x: last.x - 14, y: last.y });
            }
        }
        this.width = Math.min(70, this.width + (amount / 12));
    }

    updateNitroFuel(deltaTime) {
        if (this.nitro) {
            this.nitroFuel -= NITRO_DRAIN_RATE * deltaTime;
            if (this.nitroFuel <= 0) {
                this.nitroFuel = 0;
                this.nitro = false;
            }
        } else {
            this.nitroFuel += NITRO_REFILL_RATE * deltaTime;
            if (this.nitroFuel > NITRO_MAX_FUEL) this.nitroFuel = NITRO_MAX_FUEL;
        }
    }

    reset() {
        const startX = (Math.random() - 0.5) * BOUNDARY * 0.6;
        const startY = (Math.random() - 0.5) * BOUNDARY * 0.6;
        const newPoints = [];
        for (let i = 0; i < 30; i++) newPoints.push({ x: startX - i * 14, y: startY });
        this.points = newPoints;
        this.width = 28;
        this.score = 500;
        this.nitro = false;
        this.nitroFuel = NITRO_MAX_FUEL;
        const angle = Math.random() * Math.PI * 2;
        this.direction = { x: Math.cos(angle), y: Math.sin(angle) };
        this.targetDir = { ...this.direction };
    }
}

function createBot(index) {
    const colors = ['#aa66cc', '#ff66aa', '#66ffaa'];
    const bot = new Snake(`bot_${index}`, `Bot${index + 1}`, colors[index % colors.length]);
    bot.score = Math.floor(Math.random() * 200) + 100;
    return bot;
}

function initBots() {
    const newBots = [];
    for (let i = 0; i < BOT_COUNT; i++) newBots.push(createBot(i));
    return newBots;
}

function checkHeadCollision(head, bodyPoints) {
    for (let i = 1; i < bodyPoints.length; i++) {
        const dx = head.x - bodyPoints[i].x;
        const dy = head.y - bodyPoints[i].y;
        if (dx * dx + dy * dy < COLLISION_DIST * COLLISION_DIST) return true;
    }
    return false;
}

// معالجة القتل مع إرسال رسائل للعميل
function killSnake(victim, killer, isPlayerVictim, victimSocketId = null, killerSocketId = null) {
    if (killer && killer.id !== victim.id) {
        const pointsToTake = Math.floor(victim.score / 2);
        killer.score += pointsToTake;
        killer.growFromKill(Math.floor(pointsToTake / 8));
        // إرسال رسالة "لقد قتلت" للقاتل
        if (killerSocketId) {
            io.to(killerSocketId).emit('killMessage', { victimName: victim.name });
        }
    }
    // إرسال رسالة "لقد مت" للضحية
    if (isPlayerVictim && victimSocketId) {
        io.to(victimSocketId).emit('deathMessage', { killerName: killer ? killer.name : 'الحدود' });
    }
    if (isPlayerVictim) {
        victim.reset();
    } else {
        const index = bots.indexOf(victim);
        if (index !== -1) bots[index] = createBot(index);
    }
}

let lastUpdate = Date.now();
function gameUpdate() {
    const now = Date.now();
    let deltaTime = Math.min(33, now - lastUpdate) / 1000;
    if (deltaTime < 0.02) return;
    lastUpdate = now;

    // تحديث جميع الثعابين
    const allSnakes = [...Object.values(players), ...bots];
    for (let s of allSnakes) {
        let speed = BASE_SPEED;
        if (s.nitro) speed = NITRO_SPEED;
        s.applyMovement(speed);
        s.updateNitroFuel(deltaTime);
    }

    // التصادمات بين اللاعبين
    const playerList = Object.values(players);
    for (let i = 0; i < playerList.length; i++) {
        const p1 = playerList[i];
        const head1 = p1.points[0];
        const p1Id = Object.keys(players).find(key => players[key] === p1);
        for (let j = i + 1; j < playerList.length; j++) {
            const p2 = playerList[j];
            const p2Id = Object.keys(players).find(key => players[key] === p2);
            if (checkHeadCollision(head1, p2.points)) {
                killSnake(p1, p2, true, p1Id, p2Id);
                break;
            }
            const head2 = p2.points[0];
            if (checkHeadCollision(head2, p1.points)) {
                killSnake(p2, p1, true, p2Id, p1Id);
                break;
            }
        }
    }

    // اللاعبين مع البوتات
    for (let player of playerList) {
        const head = player.points[0];
        const playerId = Object.keys(players).find(key => players[key] === player);
        for (let bot of bots) {
            if (checkHeadCollision(head, bot.points)) {
                killSnake(player, bot, true, playerId, null);
                break;
            }
            const botHead = bot.points[0];
            if (checkHeadCollision(botHead, player.points)) {
                killSnake(bot, player, false, null, playerId);
                break;
            }
        }
    }

    // البوتات مع بعض
    for (let i = 0; i < bots.length; i++) {
        const b1 = bots[i];
        const head1 = b1.points[0];
        for (let j = i + 1; j < bots.length; j++) {
            const b2 = bots[j];
            if (checkHeadCollision(head1, b2.points)) {
                killSnake(b1, b2, false, null, null);
                break;
            }
            const head2 = b2.points[0];
            if (checkHeadCollision(head2, b1.points)) {
                killSnake(b2, b1, false, null, null);
                break;
            }
        }
    }

    // إرسال الحالة للجميع
    io.emit('gameState', { players, bots });
}

// تحديث كل 30 مللي ثانية (33 إطار في الثانية)
setInterval(gameUpdate, 30);

// ========== Socket.IO ==========
io.on('connection', (socket) => {
    console.log('✅ Player connected:', socket.id);

    socket.on('join', (data) => {
        const { name, color } = data;
        const newSnake = new Snake(socket.id, name, color);
        players[socket.id] = newSnake;
        socket.emit('init', { id: socket.id, players, bots });
        socket.broadcast.emit('playerJoined', { id: socket.id, name, color });
    });

    socket.on('move', (data) => {
        const player = players[socket.id];
        if (player) {
            player.updateDirection(data.dir);
            if (data.nitro && !player.nitro && player.nitroFuel > 0) {
                player.nitro = true;
            } else if (!data.nitro && player.nitro) {
                player.nitro = false;
            }
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server on port ${PORT}`);
    bots = initBots();
    players = {};
});
