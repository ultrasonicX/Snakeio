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

// ========== إعدادات اللعبة ==========
const BOUNDARY = 2500;              // خريطة أصغر (كانت 3800)
const BASE_SPEED = 3.5;
const NITRO_SPEED = 9.5;
const COLLISION_DIST = 20;

// ✅ إعدادات النيترو (شريط الطاقة)
const NITRO_MAX_FUEL = 100;         // أقصى طاقة للنيترو
const NITRO_DRAIN_RATE = 0.8;       // معدل استنزاف الطاقة في الثانية (كل إطار)
const NITRO_REFILL_RATE = 0.5;      // ✅ معدل تعبئة الطاقة في الثانية (تعديل سهل)
const BOT_COUNT = 3;                // عدد البوتات

// ========== حالة اللعبة ==========
let players = {};
let bots = [];

// ========== كائنات اللعبة ==========
class Snake {
    constructor(id, name, color, startX = null, startY = null) {
        this.id = id;
        this.name = name;
        this.color = color;
        this.score = 500;               // ✅ تبدأ بـ 500 نقطة
        this.width = 28;                // ✅ عرض أكبر (ضعف 14)
        this.nitro = false;
        this.nitroFuel = NITRO_MAX_FUEL; // ✅ شريط الطاقة
        if (startX === null) startX = (Math.random() - 0.5) * BOUNDARY * 0.6;
        if (startY === null) startY = (Math.random() - 0.5) * BOUNDARY * 0.6;
        this.points = [];
        // ✅ طول أكبر (3 أضعاف: 30 نقطة بدلاً من 10)
        for (let i = 0; i < 30; i++) {
            this.points.push({ x: startX - i * 14, y: startY });
        }
        const angle = Math.random() * Math.PI * 2;
        this.direction = { x: Math.cos(angle), y: Math.sin(angle) };
        this.targetDir = { ...this.direction };
    }

    updateDirection(target) {
        if (target) this.targetDir = target;
    }

    applyMovement(speed) {
        let curAng = Math.atan2(this.direction.y, this.direction.x);
        let targetAng = Math.atan2(this.targetDir.y, this.targetDir.x);
        let diff = targetAng - curAng;
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        const newAng = curAng + Math.min(0.15, Math.max(-0.15, diff));
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

    // ✅ النمو عند القتل
    growFromKill(amount) {
        // زيادة الطول
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
        // زيادة العرض
        this.width = Math.min(70, this.width + (amount / 20));
    }

    // ✅ تحديث شريط النيترو
    updateNitroFuel(deltaTime) {
        if (this.nitro) {
            this.nitroFuel -= NITRO_DRAIN_RATE * deltaTime;
            if (this.nitroFuel <= 0) {
                this.nitroFuel = 0;
                this.nitro = false;
            }
        } else {
            this.nitroFuel += NITRO_REFILL_RATE * deltaTime;
            if (this.nitroFuel > NITRO_MAX_FUEL) {
                this.nitroFuel = NITRO_MAX_FUEL;
            }
        }
    }

    reset() {
        const startX = (Math.random() - 0.5) * BOUNDARY * 0.6;
        const startY = (Math.random() - 0.5) * BOUNDARY * 0.6;
        const newPoints = [];
        for (let i = 0; i < 30; i++) {
            newPoints.push({ x: startX - i * 14, y: startY });
        }
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

// إنشاء بوت
function createBot(index) {
    const botColors = ['#aa66cc', '#ff66aa', '#66ffaa', '#ffaa66', '#66aaff'];
    const name = `Bot${index + 1}`;
    const bot = new Snake(`bot_${index}`, name, botColors[index % botColors.length]);
    // إعطاء البوت نقاط عشوائية
    bot.score = Math.floor(Math.random() * 300) + 200;
    return bot;
}

function initBots() {
    const newBots = [];
    for (let i = 0; i < BOT_COUNT; i++) {
        newBots.push(createBot(i));
    }
    return newBots;
}

// فحص التصادم بين رأس وجسم
function checkHeadCollision(head, bodyPoints) {
    for (let i = 1; i < bodyPoints.length; i++) {
        const dx = head.x - bodyPoints[i].x;
        const dy = head.y - bodyPoints[i].y;
        if (dx * dx + dy * dy < COLLISION_DIST * COLLISION_DIST) return true;
    }
    return false;
}

// ✅ معالجة القتل - المهاجم يأخذ نصف نقاط الضحية
function killSnake(victim, killer, isPlayerVictim) {
    if (killer && killer.id !== victim.id) {
        const pointsToTake = Math.floor(victim.score / 2);
        killer.score += pointsToTake;
        killer.growFromKill(Math.floor(pointsToTake / 10));
    }
    
    if (isPlayerVictim) {
        victim.reset();
        return { reset: true, id: victim.id };
    } else {
        // بوت مات، نستبدله ببوت جديد
        const index = bots.indexOf(victim);
        if (index !== -1) {
            bots[index] = createBot(index);
        }
        return { reset: false, id: victim.id };
    }
}

let lastUpdate = Date.now();
function gameUpdate() {
    const now = Date.now();
    let deltaTime = Math.min(50, now - lastUpdate);
    if (deltaTime < 20) return;
    deltaTime = deltaTime / 1000; // تحويل إلى ثواني للنيترو
    lastUpdate = now;

    // 1. تحديث اللاعبين
    for (let id in players) {
        const p = players[id];
        let speed = BASE_SPEED;
        if (p.nitro) speed = NITRO_SPEED;
        p.applyMovement(speed);
        p.updateNitroFuel(deltaTime);
    }

    // 2. تحديث البوتات
    for (let bot of bots) {
        if (Math.random() < 0.02) {
            const angle = Math.random() * Math.PI * 2;
            bot.targetDir = { x: Math.cos(angle), y: Math.sin(angle) };
        }
        let speed = BASE_SPEED;
        if (bot.nitro) speed = NITRO_SPEED;
        bot.applyMovement(speed);
        bot.updateNitroFuel(deltaTime);
    }

    // 3. التصادمات - القتل
    const playerList = Object.values(players);
    
    // لاعبين مع لاعبين
    for (let i = 0; i < playerList.length; i++) {
        const p1 = playerList[i];
        const head1 = p1.points[0];
        for (let j = i + 1; j < playerList.length; j++) {
            const p2 = playerList[j];
            // رأس p1 صدم جسم p2
            if (checkHeadCollision(head1, p2.points)) {
                killSnake(p1, p2, true);
                break;
            }
            // رأس p2 صدم جسم p1
            const head2 = p2.points[0];
            if (checkHeadCollision(head2, p1.points)) {
                killSnake(p2, p1, true);
                break;
            }
        }
    }

    // لاعبين مع بوتات
    for (let player of playerList) {
        const head = player.points[0];
        for (let bot of bots) {
            if (checkHeadCollision(head, bot.points)) {
                killSnake(player, bot, true);
                break;
            }
            const botHead = bot.points[0];
            if (checkHeadCollision(botHead, player.points)) {
                killSnake(bot, player, false);
                break;
            }
        }
    }

    // بوتات مع بوتات
    for (let i = 0; i < bots.length; i++) {
        const b1 = bots[i];
        const head1 = b1.points[0];
        for (let j = i + 1; j < bots.length; j++) {
            const b2 = bots[j];
            if (checkHeadCollision(head1, b2.points)) {
                killSnake(b1, b2, false);
                break;
            }
            const head2 = b2.points[0];
            if (checkHeadCollision(head2, b1.points)) {
                killSnake(b2, b1, false);
                break;
            }
        }
    }

    // إرسال الحالة للجميع
    io.emit('gameState', {
        players: players,
        bots: bots
    });
}

setInterval(gameUpdate, 35);

// ========== Socket.IO ==========
io.on('connection', (socket) => {
    console.log('✅ Player connected:', socket.id);

    socket.on('join', (data) => {
        const { name, color } = data;
        const newSnake = new Snake(socket.id, name, color);
        players[socket.id] = newSnake;

        socket.emit('init', {
            id: socket.id,
            players: players,
            bots: bots
        });

        socket.broadcast.emit('playerJoined', { id: socket.id, name, color });
        console.log(`👤 ${name} joined`);
    });

    socket.on('move', (data) => {
        const { dir, nitro } = data;
        const player = players[socket.id];
        if (player) {
            player.updateDirection(dir);
            if (nitro && !player.nitro && player.nitroFuel > 0) {
                player.nitro = true;
            } else if (!nitro && player.nitro) {
                player.nitro = false;
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('❌ Player disconnected:', socket.id);
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    bots = initBots();
    players = {};
    console.log(`🤖 Bots: ${bots.length}`);
    console.log(`⚡ Nitro refill rate: ${NITRO_REFILL_RATE}/sec`);
});
