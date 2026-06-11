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

// ========== إعدادات اللعبة (محسنة للأداء) ==========
const BOUNDARY = 3800;
const BASE_SPEED = 3.8;
const NITRO_SPEED = 9.5;
const NITRO_LOSS = 5;
const NITRO_INTERVAL = 150;
const GROWTH_PER_FOOD = 1;
const GROWTH_PER_DEATH_FOOD = 1;
const COLLISION_DIST = 20;

// ✅ تقليل عدد الطعام بشكل كبير
const INITIAL_FOOD_COUNT = 300;    // طعام أولي
const FOOD_REFILL_AMOUNT = 15;     // كمية الطعام المضافة كل مرة
const FOOD_REFILL_INTERVAL = 3000; // كل 3 ثواني
const BOT_COUNT = 2;               // تقليل البوتات لتحسين الأداء

// ========== حالة اللعبة ==========
let players = {};
let bots = [];
let foods = [];
let deathFoods = [];

// توليد طعام عشوائي
function generateFood() {
    return {
        x: (Math.random() - 0.5) * BOUNDARY * 1.8,
        y: (Math.random() - 0.5) * BOUNDARY * 1.8,
        color: `hsl(${Math.random() * 360}, 80%, 60%)`,
        value: 10
    };
}

// توليد الطعام الأولي
function initFoods() {
    const arr = [];
    for (let i = 0; i < INITIAL_FOOD_COUNT; i++) {
        arr.push(generateFood());
    }
    return arr;
}

// ✅ إضافة طعام تدريجياً (بشكل قليل)
function refillFoods() {
    const toAdd = Math.min(FOOD_REFILL_AMOUNT, 200 - foods.length);
    for (let i = 0; i < toAdd; i++) {
        foods.push(generateFood());
    }
    console.log(`🍎 Foods refilled: ${foods.length} total`);
}

// ========== كائنات اللعبة ==========
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

    updateDirection(target) {
        if (target) this.targetDir = target;
    }

    applyMovement(speed) {
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
        for (let i = 0; i < 10; i++) {
            newPoints.push({ x: startX - i * 14, y: startY });
        }
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
    const botColors = ['#aa66cc', '#ff66aa', '#66ffaa', '#ffaa66', '#66aaff'];
    const name = `Bot${index + 1}`;
    const snake = new Snake(`bot_${index}`, name, botColors[index % botColors.length]);
    snake.score = Math.floor(Math.random() * 100) + 50;
    return snake;
}

function initBots() {
    const newBots = [];
    for (let i = 0; i < BOT_COUNT; i++) {
        newBots.push(createBot(i));
    }
    return newBots;
}

// فحص التصادم
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
    pointsCount = Math.min(pointsCount, 150);
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
        return { reset: true, id: snake.id };
    } else {
        return { reset: false, id: snake.id };
    }
}

// ✅ تحديث عالم اللعبة بسرعة أقل
let lastUpdate = Date.now();
function gameUpdate() {
    const now = Date.now();
    const delta = Math.min(50, now - lastUpdate);
    if (delta < 40) return; // تحديث كل 40ms على الأقل
    lastUpdate = now;

    // 1. تحديث اللاعبين
    for (let id in players) {
        const p = players[id];
        let speed = BASE_SPEED;
        if (p.nitro) speed = NITRO_SPEED;
        p.applyMovement(speed);
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
    }

    // 3. أكل الطعام
    const allSnakes = [...Object.values(players), ...bots];
    for (let snake of allSnakes) {
        const head = snake.points[0];
        for (let i = 0; i < foods.length; i++) {
            const f = foods[i];
            const dx = head.x - f.x;
            const dy = head.y - f.y;
            if (dx * dx + dy * dy < 225) {
                foods.splice(i, 1);
                snake.score += f.value;
                snake.grow(GROWTH_PER_FOOD);
                break;
            }
        }
        for (let i = 0; i < deathFoods.length; i++) {
            const f = deathFoods[i];
            const dx = head.x - f.x;
            const dy = head.y - f.y;
            if (dx * dx + dy * dy < 225) {
                deathFoods.splice(i, 1);
                snake.score += f.value;
                snake.grow(GROWTH_PER_DEATH_FOOD);
                break;
            }
        }
    }

    // 4. التصادمات
    const playerList = Object.values(players);
    for (let i = 0; i < playerList.length; i++) {
        const p1 = playerList[i];
        const head1 = p1.points[0];
        for (let j = i + 1; j < playerList.length; j++) {
            const p2 = playerList[j];
            if (checkHeadCollision(head1, p2.points)) {
                killSnake(p1, true);
                break;
            }
            const head2 = p2.points[0];
            if (checkHeadCollision(head2, p1.points)) {
                killSnake(p2, true);
                break;
            }
        }
    }

    for (let player of playerList) {
        const head = player.points[0];
        for (let bot of bots) {
            if (checkHeadCollision(head, bot.points)) {
                killSnake(player, true);
                break;
            }
            const botHead = bot.points[0];
            if (checkHeadCollision(botHead, player.points)) {
                killSnake(bot, false);
                const index = bots.indexOf(bot);
                if (index !== -1) bots[index] = createBot(index);
                break;
            }
        }
    }

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

    // إرسال الحالة للجميع
    const gameState = {
        players: players,
        bots: bots,
        foods: foods,
        deathFoods: deathFoods
    };
    io.emit('gameState', gameState);
}

// ✅ بدء حلقة التحديث كل 40ms بدلاً من 30ms
setInterval(gameUpdate, 40);

// ✅ إضافة طعام تدريجياً كل 3 ثواني
setInterval(refillFoods, FOOD_REFILL_INTERVAL);

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
            bots: bots,
            foods: foods,
            deathFoods: deathFoods
        });
        
        socket.broadcast.emit('playerJoined', { id: socket.id, name, color });
        console.log(`👤 ${name} joined (${socket.id})`);
    });

    socket.on('move', (data) => {
        const { dir, nitro } = data;
        const player = players[socket.id];
        if (player) {
            player.updateDirection(dir);
            if (nitro && !player.nitro && player.score >= NITRO_LOSS) {
                player.nitro = true;
                let nitroInterval = setInterval(() => {
                    if (player.nitro && player.score >= NITRO_LOSS) {
                        player.score -= NITRO_LOSS;
                        if (player.score <= 0) {
                            player.score = 0;
                            player.nitro = false;
                            player.shrink();
                            clearInterval(nitroInterval);
                        } else {
                            player.shrink();
                        }
                        io.to(socket.id).emit('scoreUpdate', player.score);
                    } else {
                        clearInterval(nitroInterval);
                    }
                }, NITRO_INTERVAL);
                socket.nitroInterval = nitroInterval;
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    
    // تهيئة أولية
    foods = initFoods();
    deathFoods = [];
    bots = initBots();
    players = {};
    
    console.log(`🍎 Initial foods: ${foods.length}`);
    console.log(`🤖 Bots: ${bots.length}`);
});
