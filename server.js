const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// ========== إعدادات اللعبة ==========
const BOUNDARY = 3800;
const BASE_SPEED = 3.8;
const NITRO_SPEED = 9.5;
const NITRO_LOSS = 5;
const GROWTH_PER_FOOD = 1;
const COLLISION_DIST = 20;
const FOOD_COUNT = 7000;
const BOT_COUNT = 3;

// حالة اللعبة
let players = {};      // socket.id -> snake object
let bots = [];
let foods = [];
let deathFoods = [];

// دالة توليد طعام عشوائي
function generateFood() {
    return {
        x: (Math.random() - 0.5) * BOUNDARY * 1.8,
        y: (Math.random() - 0.5) * BOUNDARY * 1.8,
        color: `hsl(${Math.random() * 360}, 80%, 60%)`,
        value: 10
    };
}

// ملء الطعام الأولي
function initFoods() {
    const arr = [];
    for (let i = 0; i < FOOD_COUNT; i++) arr.push(generateFood());
    return arr;
}

// كائن الثعبان
class Snake {
    constructor(id, name, color, startX = null, startY = null) {
        this.id = id;
        this.name = name;
        this.color = color;
        this.score = 0;
        this.width = 14;
        this.nitro = false;
        if (startX === null) startX = (Math.random() - 0.5) * BOUNDARY * 0.6;
        if (startY === null) startY = (Math.random() - 0.5) * BOUNDARY * 0.6;
        this.points = [];
        for (let i = 0; i < 10; i++) {
            this.points.push({ x: startX - i * 14, y: startY });
        }
        const angle = Math.random() * Math.PI * 2;
        this.direction = { x: Math.cos(angle), y: Math.sin(angle) };
        this.targetDir = { ...this.direction };
    }

    updateDirection(dir) {
        this.targetDir = dir;
    }

    applyMovement(speed) {
        // دوران سلس
        let curAng = Math.atan2(this.direction.y, this.direction.x);
        let targetAng = Math.atan2(this.targetDir.y, this.targetDir.x);
        let diff = targetAng - curAng;
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        const newAng = curAng + Math.min(0.2, Math.max(-0.2, diff));
        this.direction = { x: Math.cos(newAng), y: Math.sin(newAng) };

        const head = this.points[0];
        let newHead = {
            x: head.x + this.direction.x * speed,
            y: head.y + this.direction.y * speed
        };
        // الحدود
        newHead.x = Math.min(Math.max(newHead.x, -BOUNDARY), BOUNDARY);
        newHead.y = Math.min(Math.max(newHead.y, -BOUNDARY), BOUNDARY);

        this.points.unshift(newHead);
        this.points.pop();
    }

    grow(amount) {
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
        this.width = Math.min(70, this.width + 0.1);
    }

    shrink() {
        if (this.width > 14) this.width = Math.max(14, this.width - 0.6);
        if (this.points.length > 10) this.points.pop();
    }

    reset() {
        const startX = (Math.random() - 0.5) * BOUNDARY * 0.6;
        const startY = (Math.random() - 0.5) * BOUNDARY * 0.6;
        const newPoints = [];
        for (let i = 0; i < 10; i++) newPoints.push({ x: startX - i * 14, y: startY });
        this.points = newPoints;
        this.width = 14;
        this.score = 0;
        const angle = Math.random() * Math.PI * 2;
        this.direction = { x: Math.cos(angle), y: Math.sin(angle) };
        this.targetDir = { ...this.direction };
        this.nitro = false;
    }
}

// إنشاء بوت
function createBot(index) {
    const colors = ['#aa66cc', '#ff66aa', '#66ffaa', '#ffaa66', '#66aaff'];
    const bot = new Snake(`bot_${index}`, `Bot${index + 1}`, colors[index % colors.length]);
    bot.score = Math.floor(Math.random() * 100) + 50;
    return bot;
}

function initBots() {
    const newBots = [];
    for (let i = 0; i < BOT_COUNT; i++) newBots.push(createBot(i));
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

// معالجة الموت
function killSnake(snake, isPlayer) {
    let pointsCount = Math.min(Math.floor(snake.score / 2) + 20, snake.points.length * 3);
    pointsCount = Math.min(pointsCount, 300);
    for (let i = 0; i < pointsCount; i++) {
        const p = snake.points[Math.floor(Math.random() * snake.points.length)];
        const hue = (snake.score + i * 37) % 360;
        deathFoods.push({
            x: p.x + (Math.random() - 0.5) * 18,
            y: p.y + (Math.random() - 0.5) * 18,
            color: `hsl(${hue}, 75%, 55%)`,
            value: Math.floor(snake.score / pointsCount) + 2
        });
    }
    if (isPlayer) {
        snake.reset();
    }
    return snake;
}

// تحديث عالم اللعبة (يُستدعى كل 30ms)
function gameUpdate() {
    // 1. تحديث جميع الثعابين (لاعبين + بوتات)
    const allSnakes = [...Object.values(players), ...bots];
    for (let snake of allSnakes) {
        let speed = BASE_SPEED;
        if (snake.nitro) speed = NITRO_SPEED;
        snake.applyMovement(speed);
    }

    // 2. أكل الطعام (للكل)
    for (let snake of allSnakes) {
        const head = snake.points[0];
        // طعام عادي
        for (let i = 0; i < foods.length; i++) {
            const f = foods[i];
            const dx = head.x - f.x, dy = head.y - f.y;
            if (dx * dx + dy * dy < 225) {
                foods.splice(i, 1);
                snake.score += f.value;
                snake.grow(GROWTH_PER_FOOD);
                break;
            }
        }
        // طعام الموت
        for (let i = 0; i < deathFoods.length; i++) {
            const f = deathFoods[i];
            const dx = head.x - f.x, dy = head.y - f.y;
            if (dx * dx + dy * dy < 225) {
                deathFoods.splice(i, 1);
                snake.score += f.value;
                snake.grow(GROWTH_PER_FOOD);
                break;
            }
        }
    }

    // 3. التصادمات (رأس مع جسم الآخرين)
    const playerArray = Object.values(players);
    // بين اللاعبين
    for (let i = 0; i < playerArray.length; i++) {
        const p1 = playerArray[i];
        const head1 = p1.points[0];
        for (let j = i + 1; j < playerArray.length; j++) {
            const p2 = playerArray[j];
            if (checkHeadCollision(head1, p2.points)) killSnake(p1, true);
            const head2 = p2.points[0];
            if (checkHeadCollision(head2, p1.points)) killSnake(p2, true);
        }
    }
    // اللاعبين مع البوتات
    for (let player of playerArray) {
        const head = player.points[0];
        for (let bot of bots) {
            if (checkHeadCollision(head, bot.points)) killSnake(player, true);
            const botHead = bot.points[0];
            if (checkHeadCollision(botHead, player.points)) {
                killSnake(bot, false);
                const index = bots.indexOf(bot);
                if (index !== -1) bots[index] = createBot(index);
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
                killSnake(b1, false);
                bots[i] = createBot(i);
                break;
            }
            const head2 = b2.points[0];
            if (checkHeadCollision(head2, b1.points)) {
                killSnake(b2, false);
                bots[j] = createBot(j);
                break;
            }
        }
    }

    // إعادة ملء الطعام إذا قل
    if (foods.length < FOOD_COUNT - 200) {
        const toAdd = Math.min(400, FOOD_COUNT - foods.length);
        for (let i = 0; i < toAdd; i++) foods.push(generateFood());
    }

    // إرسال الحالة لجميع اللاعبين
    io.emit('gameState', {
        players: players,
        bots: bots,
        foods: foods,
        deathFoods: deathFoods
    });
}

// بدء حلقة التحديث
setInterval(gameUpdate, 30);

// ========== Socket.IO ==========
io.on('connection', (socket) => {
    console.log('✅ Player connected:', socket.id);

    socket.on('join', (data) => {
        const { name, color } = data;
        const newSnake = new Snake(socket.id, name, color);
        players[socket.id] = newSnake;
        // إرسال الحالة الأولية لهذا اللاعب
        socket.emit('init', {
            id: socket.id,
            players: players,
            bots: bots,
            foods: foods,
            deathFoods: deathFoods
        });
        // إعلام الآخرين
        socket.broadcast.emit('playerJoined', { id: socket.id, name, color });
        console.log(`👤 ${name} joined`);
    });

    socket.on('move', (data) => {
        const player = players[socket.id];
        if (!player) return;
        const { dir, nitro } = data;
        if (dir) player.updateDirection(dir);
        if (nitro !== undefined) {
            if (nitro && !player.nitro && player.score >= NITRO_LOSS) {
                player.nitro = true;
                // بدء تأثير النيترو: خسارة نقاط وتصغير تدريجي
                const interval = setInterval(() => {
                    if (player.nitro && player.score >= NITRO_LOSS) {
                        player.score -= NITRO_LOSS;
                        player.shrink();
                        if (player.score <= 0) {
                            player.score = 0;
                            player.nitro = false;
                            clearInterval(interval);
                        }
                        // إرسال تحديث النقاط للاعب فقط
                        socket.emit('scoreUpdate', player.score);
                    } else {
                        clearInterval(interval);
                    }
                }, 150);
                socket.nitroInterval = interval;
            } else if (!nitro && player.nitro) {
                player.nitro = false;
                if (socket.nitroInterval) clearInterval(socket.nitroInterval);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('❌ Player disconnected:', socket.id);
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

// خدمة الملفات الثابتة
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// تهيئة العالم
foods = initFoods();
deathFoods = [];
bots = initBots();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
