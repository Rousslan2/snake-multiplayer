const express  = require('express');
const http      = require('http');
const { Server }= require('socket.io');
const path      = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// ── Config ────────────────────────────────────────────────────────────────────

const GRID_W      = 50;
const GRID_H      = 40;
const TICK_MS     = 110;
const FOOD_TARGET = 18;

const COLORS = [
  '#00ff88','#ff6b6b','#4ecdc4','#ffe66d',
  '#a29bfe','#fd79a8','#fdcb6e','#74b9ff',
  '#55efc4','#e17055','#ff9f43','#6c5ce7',
];

// ── State ─────────────────────────────────────────────────────────────────────

const players   = {};
let   foods     = [];
let   colorIdx  = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function randPos() {
  return { x: Math.floor(Math.random() * GRID_W), y: Math.floor(Math.random() * GRID_H) };
}

function onSnake(pos) {
  return Object.values(players).some(p => p.alive && p.body.some(s => s.x === pos.x && s.y === pos.y));
}

function freePos() {
  let tries = 0, pos;
  do { pos = randPos(); tries++; }
  while (tries < 300 && (onSnake(pos) || foods.some(f => f.x === pos.x && f.y === pos.y)));
  return pos;
}

// ── Food ─────────────────────────────────────────────────────────────────────

function pickFoodType() {
  const r = Math.random();
  if (r < 0.04) return 'shield';
  if (r < 0.10) return 'speed';
  if (r < 0.22) return 'gold';
  return 'normal';
}

function spawnFood() {
  while (foods.length < FOOD_TARGET) {
    const pos  = freePos();
    foods.push({ x: pos.x, y: pos.y, type: pickFoodType() });
  }
}

// ── Player ────────────────────────────────────────────────────────────────────

function initPlayer(id) {
  const p = players[id];
  const sx = Math.floor(Math.random() * GRID_W);
  const sy = Math.floor(Math.random() * GRID_H);
  p.body    = [
    { x: sx, y: sy },
    { x: (sx - 1 + GRID_W) % GRID_W, y: sy },
    { x: (sx - 2 + GRID_W) % GRID_W, y: sy },
  ];
  p.dir     = { x: 1, y: 0 };
  p.nextDir = { x: 1, y: 0 };
  p.alive   = true;
  p.grow    = 0;
  p.boosting   = false;
  p.effects    = { speedTicks: 0, shield: false };
}

// ── Movement ──────────────────────────────────────────────────────────────────

function stepPlayer(p) {
  if (!p.alive) return;

  // Direction change (no 180°)
  const d = p.nextDir;
  if (!(d.x === -p.dir.x && d.y === -p.dir.y)) p.dir = d;

  const head    = p.body[0];
  const newHead = {
    x: (head.x + p.dir.x + GRID_W) % GRID_W,
    y: (head.y + p.dir.y + GRID_H) % GRID_H,
  };
  p.body.unshift(newHead);

  if (p.grow > 0) {
    p.grow--;
  } else if (p.boosting && p.body.length > 5) {
    p.body.pop();
    p.body.pop(); // shrink while boosting
  } else {
    p.body.pop();
  }
}

// ── Food collision ────────────────────────────────────────────────────────────

function eatFood(id) {
  const p    = players[id];
  if (!p || !p.alive) return;
  const head = p.body[0];

  for (let i = foods.length - 1; i >= 0; i--) {
    const f = foods[i];
    if (f.x !== head.x || f.y !== head.y) continue;

    const mult = p.effects.doublePoints ? 2 : 1;
    switch (f.type) {
      case 'normal': p.score += 1 * mult; p.grow += 4;  break;
      case 'gold':   p.score += 3 * mult; p.grow += 12; break;
      case 'speed':
        p.effects.speedTicks = 55;   // ~6 s
        p.grow += 3;
        break;
      case 'shield':
        p.effects.shield = true;
        p.grow += 3;
        break;
    }
    io.emit('foodEaten', { x: f.x, y: f.y, color: p.color, type: f.type });
    foods.splice(i, 1);
    const np = freePos();
    foods.push({ x: np.x, y: np.y, type: pickFoodType() });
  }
}

// ── Collision ─────────────────────────────────────────────────────────────────

function checkCollisions(ids) {
  const dead = new Set();

  for (const id of ids) {
    const p = players[id];
    if (!p.alive || dead.has(id)) continue;
    const head = p.body[0];

    // Self
    for (let i = 1; i < p.body.length; i++) {
      if (p.body[i].x === head.x && p.body[i].y === head.y) {
        dead.add(id); break;
      }
    }
    if (dead.has(id)) continue;

    // Others
    for (const oid of ids) {
      if (oid === id) continue;
      const o = players[oid];
      if (!o.alive) continue;
      for (let i = 0; i < o.body.length; i++) {
        if (o.body[i].x === head.x && o.body[i].y === head.y) {
          dead.add(id);
          if (i === 0) {
            dead.add(oid); // head-to-head
          } else {
            o.kills = (o.kills || 0) + 1;
            io.emit('kill', {
              killer: o.name, victim: p.name,
              killerColor: o.color, victimColor: p.color,
            });
          }
          break;
        }
      }
      if (dead.has(id)) break;
    }
  }

  for (const id of dead) {
    const p = players[id];
    if (!p) continue;
    if (p.effects.shield) {
      p.effects.shield = false;   // absorb
      if (p.body.length > 3) p.body.shift(); // nudge back
      io.emit('shieldBroke', { id, color: p.color });
    } else {
      p.alive = false;
    }
  }
}

// ── Game loop ─────────────────────────────────────────────────────────────────

function tick() {
  const ids = Object.keys(players);
  if (!ids.length) return;

  // Tick effects
  for (const id of ids) {
    const p = players[id];
    if (!p.alive) continue;
    if (p.effects.speedTicks > 0) p.effects.speedTicks--;
  }

  // Move (boost/speed → double step)
  for (const id of ids) {
    const p = players[id];
    if (!p.alive) continue;
    stepPlayer(p); eatFood(id);
    if (p.boosting || p.effects.speedTicks > 0) {
      stepPlayer(p); eatFood(id);
    }
  }

  checkCollisions(ids);

  // Broadcast
  const state = { players: {}, foods };
  for (const [id, p] of Object.entries(players)) {
    state.players[id] = {
      body:     p.body,
      color:    p.color,
      name:     p.name,
      score:    p.score,
      kills:    p.kills || 0,
      alive:    p.alive,
      dir:      p.dir,
      skin:     p.skin || 'classic',
      boosting: p.boosting,
      effects:  p.effects,
    };
  }
  io.emit('state', state);
}

setInterval(tick, TICK_MS);

// ── Sockets ───────────────────────────────────────────────────────────────────

io.on('connection', socket => {

  socket.on('join', ({ name, skin } = {}) => {
    const color = COLORS[colorIdx % COLORS.length];
    colorIdx++;
    players[socket.id] = {
      name:     (name || 'Anonyme').slice(0, 16),
      color,
      skin:     skin || 'classic',
      score:    0,
      kills:    0,
      alive:    false,
      body: [], dir: { x: 1, y: 0 }, nextDir: { x: 1, y: 0 },
      grow: 0, boosting: false,
      effects:  { speedTicks: 0, shield: false },
    };
    spawnFood();
    initPlayer(socket.id);
    socket.emit('init', { id: socket.id, gridW: GRID_W, gridH: GRID_H });
    io.emit('count', Object.keys(players).length);
  });

  socket.on('dir', d => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    if (Math.abs(d.x) <= 1 && Math.abs(d.y) <= 1) p.nextDir = d;
  });

  socket.on('boost', on => {
    const p = players[socket.id];
    if (p) p.boosting = !!on;
  });

  socket.on('respawn', () => {
    const p = players[socket.id];
    if (p && !p.alive) { p.score = 0; p.kills = 0; initPlayer(socket.id); }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('count', Object.keys(players).length);
  });
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { spawnFood(); console.log(`🐍 Snake → http://localhost:${PORT}`); });
