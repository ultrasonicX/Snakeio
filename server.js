const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// إعدادات سريعة
const BOUNDARY = 1500;
const BASE_SPEED = 5.0;
const NITRO_SPEED = 12.0;
const MAX_FUEL = 100;
const DRAIN_RATE = 3.5;
const REFILL_RATE = 0.6;

let players = {};
let bots = [];

class Snake {
    constructor(id, name, color, x = null, y = null) {
        this.id = id;
        this.name = name;
        this.color = color;
        this.score = 500;
        this.width = 28;
        this.nitro = false;
        this.fuel = MAX_FUEL;
        
        if (x === null) x = (Math.random() - 0.5) * BOUNDARY * 0.6;
        if (y === null) y = (Math.random() - 0.5) * BOUNDARY * 0.6;
        
        this.points = [];
        for (let i = 0; i < 25; i++) {
            this.points.push({ x: x - i * 14, y: y });
        }
        
        const angle = Math.random() * Math.PI * 2;
        this.dx = Math.cos(angle);
        this.dy = Math.sin(angle);
        this.tx = this.dx;
        this.ty = this.dy;
    }

    setDir(x, y) { this.tx = x; this.ty = y; }

    move(speed) {
        let cur = Math.atan2(this.dy, this.dx);
        let target = Math.atan2(this.ty, this.tx);
        let diff = target - cur;
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        const newAng = cur + Math.min(0.22, Math.max(-0.22, diff));
        this.dx = Math.cos(newAng);
        this.dy = Math.sin(newAng);
        
        const head = this.points[0];
        let nx = head.x + this.dx * speed;
        let ny = head.y + this.dy * speed;
        nx = Math.min(Math.max(nx, -BOUNDARY), BOUNDARY);
        ny = Math.min(Math.max(ny, -BOUNDARY), BOUNDARY);
        
        this.points.unshift({ x: nx, y: ny });
        this.points.pop();
    }

    grow(amount) {
        for (let a = 0; a < amount; a++) {
            const last = this.points[this.points.length - 1];
            const prev = this.points[this.points.length - 2];
            if (prev) {
                this.points.push({ x: last.x + (last.x - prev.x), y: last.y + (last.y - prev.y) });
            } else {
                this.points.push({ x: last.x - 14, y: last.y });
            }
        }
        this.width = Math.min(65, this.width + amount / 12);
    }

    updateFuel(dt) {
        if (this.nitro) {
            this.fuel -= DRAIN_RATE * dt;
            if (this.fuel <= 0) {
                this.fuel = 0;
                this.nitro = false;
            }
        } else {
            this.fuel += REFILL_RATE * dt;
            if (this.fuel > MAX_FUEL) this.fuel = MAX_FUEL;
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
        this.fuel = MAX_FUEL;
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

function collide(head, body) {
    for (let i = 1; i < body.length; i++) {
        const dx = head.x - body[i].x;
        const dy = head.y - body[i].y;
        if (dx * dx + dy * dy < 324) return true;
    }
    return false;
}

function kill(victim, killer, isPlayer, vid = null, kid = null) {
    if (killer && killer.id !== victim.id) {
        const points = Math.floor(victim.score / 2);
        killer.score += points;
        killer.grow(Math.floor(points / 8));
        if (kid) io.to(kid).emit('killMsg', { victim: victim.name });
    }
    if (isPlayer && vid) io.to(vid).emit('deathMsg', { killer: killer ? killer.name : 'الحدود' });
    if (isPlayer) victim.reset();
    else {
        const idx = bots.indexOf(victim);
        if (idx !== -1) bots[idx] = createBot(idx);
    }
}

let last = Date.now();

function gameLoop() {
    const now = Date.now();
    let dt = Math.min(33, now - last) / 1000;
    if (dt < 0.018) return;
    last = now;
    
    const all = [...Object.values(players), ...bots];
    for (let s of all) {
        const sp = s.nitro ? NITRO_SPEED : BASE_SPEED;
        s.move(sp);
        s.updateFuel(dt);
    }
    
    const plist = Object.values(players);
    const pids = Object.keys(players);
    
    for (let i = 0; i < plist.length; i++) {
        for (let j = i + 1; j < plist.length; j++) {
            if (collide(plist[i].points[0], plist[j].points)) kill(plist[i], plist[j], true, pids[i], pids[j]);
            else if (collide(plist[j].points[0], plist[i].points)) kill(plist[j], plist[i], true, pids[j], pids[i]);
        }
    }
    
    for (let i = 0; i < plist.length; i++) {
        for (let b of bots) {
            if (collide(plist[i].points[0], b.points)) kill(plist[i], b, true, pids[i], null);
            else if (collide(b.points[0], plist[i].points)) kill(b, plist[i], false, null, pids[i]);
        }
    }
    
    for (let i = 0; i < bots.length; i++) {
        for (let j = i + 1; j < bots.length; j++) {
            if (collide(bots[i].points[0], bots[j].points)) kill(bots[i], bots[j], false);
            else if (collide(bots[j].points[0], bots[i].points)) kill(bots[j], bots[i], false);
        }
    }
    
    io.emit('state', { players, bots });
}

setInterval(gameLoop, 35);

io.on('connection', (socket) => {
    socket.on('join', (data) => {
        const s = new Snake(socket.id, data.name, data.color);
        players[socket.id] = s;
        socket.emit('init', { id: socket.id, players, bots });
        socket.broadcast.emit('joined', { id: socket.id, name: data.name });
    });
    
    socket.on('move', (data) => {
        const p = players[socket.id];
        if (p) {
            if (data.dir) p.setDir(data.dir.x, data.dir.y);
            if (data.nitro && !p.nitro && p.fuel > 0) p.nitro = true;
            else if (!data.nitro && p.nitro) p.nitro = false;
        }
    });
    
    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('left', socket.id);
    });
});

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

bots = [createBot(0), createBot(1)];
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`✅ Server on port ${PORT}`));
