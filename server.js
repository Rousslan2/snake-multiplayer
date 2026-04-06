const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const GRID_W = 50;
const GRID_H = 40;
const TICK_MS = 110;
const FOOD_COUNT = 15;
const SPECIAL_FOOD_PROB = 0.15;
const COLORS = [
  '#00ff88', '#ff6b6b', '#4ecdc4', '#ffe66d',
  '#a29bfe', '#fd79a8', '#fdcb6e', '#74b9ff',
  '#55efc4', '#e17055', '#d63031', '#6c5ce7',
];

const players = {};
let foods = [];
let colorIndex = 0;

// ── Utilities ────────────────────────────────────────────────────────────────

function randPos() {
  return {
    x: Math.floor(Math.random() * GRID_W),
    y: Math.floor(Math.random() * GRID_H),
  };
}

function occupied(pos) {
  for (const p of Object.values(players)) {
    if (p.alive && p.body.some(s => s.x === pos.x && s.y === pos.y)) return true;
  }
  return foods.some(f => f.x === pos.x && f.y === pos.y);
}

function freePosNear(cx, cy, radius = 5) {
  for (let tries = 0; tries < 200; tries++) {
    const pos = {
      x: Math.floor(cx + (Math.random() * 2 - 1) * radius + GRID_W) % GRID_W,
      y: Math.floor(cy + (Math.random() * 2 - 1) * radius + GRID_H) % GRID_H,
    };
    if (!occupied(pos)) return pos;
  }
  return randPos();
}

// ── Food ─────────────────────────────────────────────────────────────────────

function spawnFood() {
  let tries = 0;
  while (foods.length < FOOD_COUNT && tries < 500) {
    tries++;
    const pos = randPos();
    if (occupied(pos)) continue;
    foods.push({
      x: pos.x, y: pos.y,
      special: Math.random() < SPECIAL_FOOD_PROB,
    });
  }
}

// ── Player ───────────────────────────────────────────────────────────────────

function spawnPlayer(id) {
  const p = players[id];
  const startX = Math.floor(Math.random() * GRID_W);
  const startY = Math.floor(Math.random() * GRID_H);

  p.body = [
    { x: startX, y: startY },
    { x: (startX - 1 + GRID_W) % GRID_W, y: startY },
    { x: (startX - 2 + GRID_W) % GRID_W, y: startY },
  ];
  p.dir = { x: 1, y: 0 };
  p.nextDir = { x: 1, y: 0 };
  p.alive = true;
  p.grow = 0;
}

// ── Game loop ─────────────────────────────────────────────────────────────────

function tick() {
  const ids = Object.keys(players);
  if (ids.length === 0) return;

  // 1. Advance each snake one step
  for (const id of ids) {
    const p = players[id];
    if (!p.alive) continue;

    // Prevent 180° reversal
    const d = p.nextDir;
    if (!(d.x === -p.dir.x && d.y === -p.dir.y)) p.dir = d;

    const head = p.body[0];
    const newHead = {
      x: (head.x + p.dir.x + GRID_W) % GRID_W,
      y: (head.y + p.dir.y + GRID_H) % GRID_H,
    };
    p.body.unshift(newHead);

    if (p.grow > 0) {
      p.grow--;
    } else {
      p.body.pop();
    }
  }

  // 2. Food collisions
  for (const id of ids) {
    const p = players[id];
    if (!p.alive) continue;
    const head = p.body[0];

    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      if (f.x === head.x && f.y === head.y) {
        const pts = f.special ? 3 : 1;
        p.score += pts;
        p.grow += pts * 4;
        foods.splice(i, 1);
        // Spawn replacement away from eating snake
        const newPos = freePosNear(head.x, head.y, 8);
        foods.push({ x: newPos.x, y: newPos.y, special: Math.random() < SPECIAL_FOOD_PROB });
      }
    }
  }

  // 3. Collision detection (self + others)
  const newlyDead = new Set();
  for (const id of ids) {
    const p = players[id];
    if (!p.alive) continue;
    const head = p.body[0];

    // Self-collision (skip head itself)
    for (let i = 1; i < p.body.length; i++) {
      if (p.body[i].x === head.x && p.body[i].y === head.y) {
        newlyDead.add(id);
        break;
      }
    }
    if (newlyDead.has(id)) continue;

    // Other snakes
    for (const otherId of ids) {
      if (otherId === id) continue;
      const other = players[otherId];
      if (!other.alive) continue;

      for (let i = 0; i < other.body.length; i++) {
        if (other.body[i].x === head.x && other.body[i].y === head.y) {
          newlyDead.add(id);
          // Head-to-head: both die
          if (i === 0) newlyDead.add(otherId);
          break;
        }
      }
    }
  }

  for (const id of newlyDead) {
    if (players[id]) players[id].alive = false;
  }

  // 4. Broadcast state
  const state = {
    players: {},
    foods,
  };
  for (const [id, p] of Object.entries(players)) {
    state.players[id] = {
      body: p.body,
      color: p.color,
      name: p.name,
      score: p.score,
      alive: p.alive,
      dir: p.dir,
    };
  }
  io.emit('state', state);
}

setInterval(tick, TICK_MS);

// ── Socket events ─────────────────────────────────────────────────────────────

io.on('connection', socket => {
  socket.on('join', name => {
    const color = COLORS[colorIndex % COLORS.length];
    colorIndex++;

    players[socket.id] = {
      name: (name || 'Anonymous').slice(0, 16),
      color,
      score: 0,
      alive: false,
      body: [],
      dir: { x: 1, y: 0 },
      nextDir: { x: 1, y: 0 },
      grow: 0,
    };

    spawnFood();
    spawnPlayer(socket.id);

    socket.emit('init', { id: socket.id, gridW: GRID_W, gridH: GRID_H });
    io.emit('count', Object.keys(players).length);
  });

  socket.on('dir', d => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    if ((d.x === 0 || d.x === 1 || d.x === -1) && (d.y === 0 || d.y === 1 || d.y === -1)) {
      p.nextDir = d;
    }
  });

  socket.on('respawn', () => {
    const p = players[socket.id];
    if (p && !p.alive) {
      p.score = 0;
      spawnPlayer(socket.id);
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('count', Object.keys(players).length);
  });
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  spawnFood();
  console.log(`Snake server → http://localhost:${PORT}`);
});
