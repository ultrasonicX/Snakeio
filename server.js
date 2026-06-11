// ==================== server.js - نسخة فائقة السرعة ====================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ========== إعدادات سريعة جداً ==========
const BOUNDARY = 1500;           // خريطة أصغر
const BASE_SPEED = 5.0;          
const NITRO_SPEED = 12.0;
const NITRO_MAX_FUEL = 100;
const NITRO_DRAIN_RATE = 4.0;    // يخلص بسرعة
const NITRO_REFILL_RATE = 0.5;
const BOT_COUNT = 1;             // بوت واحد فقط

let players = {};
let bots = [];

// ========== فئة الثعبان المبسطة ==========
class Snake {
    constructor(id, name, color, x = null, y = null) {
        this.id = id;
        this.name = name;
        this.color = color;
        this.score = 500;
        this.width = 28;
        this.nitro = false;
        this.nitroFuel = NITRO_MAX_FUEL;
        
        if (x === null) x = (Math.random() - 0.5) * BOUNDARY * 0.6;
        if (y === null) y = (Math.random() - 0.5) * BOUNDARY * 0.6;
        
        this.points = [];
        for (let i = 0; i < 25; i++) {  // طول أقل = أسرع
            this.points.push({ x: x - i * 14, y: y });
        }
        
        const angle = Math.random() * Math.PI * 2;
        this.dx = Math.cos(angle);
        this.dy = Math.sin(angle);
        this.tx = this.dx;
        this.ty = this.dy;
    }
    
    setDirection(x, y) { this.tx = x; this.ty = y; }
    
    move(speed) {
        // دوران سريع
        let curAng = Math.atan2(this.dy, this.dx);
        let targetAng = Math.atan2(this.ty, this.tx);
        let diff = targetAng - curAng;
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        const newAng = curAng + Math.min(0.25, Math.max(-0.25, diff));
        this.dx = Math.cos(newAng);
        this.dy = Math.sin(newAng);
        
        const head = this.points[0];
        let newX = head.x + this.dx * speed;
        let newY = head.y + this.dy * speed;
        newX = Math.min(Math.max(newX, -BOUNDARY), BOUNDARY);
        newY = Math.min(Math.max(newY, -BOUNDARY), BOUNDARY);
        
        this.points.unshift({ x: newX, y: newY });
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
        this.width = Math.min(65, this.width + amount / 12);
    }
    
    updateNitro(dt) {
        if (this.nitro) {
            this.nitroFuel -= NITRO_DRAIN_RATE * dt;
            if (this.nitroFuel <= 0) {
                this.nitroFuel = 0;
                this.nitro = false;
            }
        } else {
            this.nitroFuel += NITRO_REFILL_RATE * dt;
            if (this.nitroFuel > NITRO_MAX_FUEL) this.nitroFuel = NITRO_MAX_FUEL;
        }
    }
    
    reset() {
        const x = (Math.random() - 0.5) * BOUNDARY * 0.6;
        const y = (Math.random() - 0.5) * BOUNDARY * 0.6;
        this.points = [];
        for (let i = 0; i < 25; i++) this.points.push({ x: x - i * 14, y: y });
        this.width = 28;
        this.score = 500;
        this.nitro = false;
        this.nitroFuel = NITRO_MAX_FUEL;
        const angle = Math.random() * Math.PI * 2;
        this.dx = Math.cos(angle);
        this.dy = Math.sin(angle);
        this.tx = this.dx;
        this.ty = this.dy;
    }
}

function createBot(i) {
    const colors = ['#aa66cc', '#ff66aa'];
    const b = new Snake(`bot_${i}`, `Bot${i+1}`, colors[i % colors.length]);
    b.score = Math.random() * 200 + 100;
    return b;
}

function checkCollision(head, body) {
    for (let i = 1; i < body.length; i++) {
        const dx = head.x - body[i].x;
        const dy = head.y - body[i].y;
        if (dx * dx + dy * dy < 324) return true;
    }
    return false;
}

function killSnake(victim, killer, isPlayer, victimId = null, killerId = null) {
    if (killer && killer.id !== victim.id) {
        const points = Math.floor(victim.score / 2);
        killer.score += points;
        killer.grow(Math.floor(points / 8));
        if (killerId) io.to(killerId).emit('killMessage', { victimName: victim.name });
    }
    if (isPlayer && victimId) io.to(victimId).emit('deathMessage', { killerName: killer ? killer.name : 'الحدود' });
    if (isPlayer) victim.reset();
    else {
        const idx = bots.indexOf(victim);
        if (idx !== -1) bots[idx] = createBot(idx);
    }
}

let lastTime = Date.now();

function update() {
    const now = Date.now();
    let dt = Math.min(33, now - lastTime) / 1000;
    if (dt < 0.02) return;
    lastTime = now;
    
    // 1. تحديث جميع الثعابين
    const all = [...Object.values(players), ...bots];
    for (let s of all) {
        const speed = s.nitro ? NITRO_SPEED : BASE_SPEED;
        s.move(speed);
        s.updateNitro(dt);
    }
    
    // 2. تصادمات بين اللاعبين
    const plist = Object.values(players);
    const pids = Object.keys(players);
    for (let i = 0; i < plist.length; i++) {
        const p1 = plist[i];
        const h1 = p1.points[0];
        for (let j = i + 1; j < plist.length; j++) {
            const p2 = plist[j];
            if (checkCollision(h1, p2.points)) killSnake(p1, p2, true, pids[i], pids[j]);
            else if (checkCollision(p2.points[0], p1.points)) killSnake(p2, p1, true, pids[j], pids[i]);
        }
    }
    
    // 3. لاعبين مع بوتات
    for (let i = 0; i < plist.length; i++) {
        const p = plist[i];
        const h = p.points[0];
        for (let b of bots) {
            if (checkCollision(h, b.points)) killSnake(p, b, true, pids[i], null);
            else if (checkCollision(b.points[0], p.points)) killSnake(b, p, false, null, pids[i]);
        }
    }
    
    // 4. بوتات مع بعض
    for (let i = 0; i < bots.length; i++) {
        for (let j = i + 1; j < bots.length; j++) {
            if (checkCollision(bots[i].points[0], bots[j].points)) killSnake(bots[i], bots[j], false);
            else if (checkCollision(bots[j].points[0], bots[i].points)) killSnake(bots[j], bots[i], false);
        }
    }
    
    // 5. إرسال التحديث (مرة واحدة لكل اللاعبين)
    io.emit('gameState', { players, bots });
}

// تحديث كل 35ms
setInterval(update, 35);

// ========== Socket.IO ==========
io.on('connection', (socket) => {
    socket.on('join', (data) => {
        const newSnake = new Snake(socket.id, data.name, data.color);
        players[socket.id] = newSnake;
        socket.emit('init', { id: socket.id, players, bots });
        socket.broadcast.emit('playerJoined', { id: socket.id, name: data.name });
    });
    
    socket.on('move', (data) => {
        const p = players[socket.id];
        if (p) {
            if (data.dir) p.setDirection(data.dir.x, data.dir.y);
            if (data.nitro && !p.nitro && p.nitroFuel > 0) p.nitro = true;
            else if (!data.nitro && p.nitro) p.nitro = false;
        }
    });
    
    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

bots = [createBot(0), createBot(1)];
players = {};

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server on port ${PORT} - Ultra Fast Mode`));
