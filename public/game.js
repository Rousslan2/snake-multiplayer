/* ── Snake Multiplayer Client ──────────────────────────────────────── */

const socket = io();

const canvas  = document.getElementById('canvas');
const ctx     = canvas.getContext('2d');

// Config (overridden by server on join)
let GRID_W  = 50;
let GRID_H  = 40;
let CELL    = 14;
let myId    = null;

// Game state (latest frame from server)
let gameState = null;
let prevState = null;

// Particle system
const particles = [];

// Touch handling
let touchStart = null;

// ── Canvas sizing ────────────────────────────────────────────────────

function fitCanvas() {
  const wrap = document.getElementById('canvasWrap');
  const maxW = wrap.clientWidth  || window.innerWidth  - 232;
  const maxH = wrap.clientHeight || window.innerHeight - 60;
  CELL = Math.max(6, Math.min(Math.floor(maxW / GRID_W), Math.floor(maxH / GRID_H)));
  canvas.width  = GRID_W * CELL;
  canvas.height = GRID_H * CELL;
}

window.addEventListener('resize', () => requestAnimationFrame(fitCanvas));

// ── Lobby ────────────────────────────────────────────────────────────

socket.on('count', n => {
  const s = n === 1 ? '' : 's';
  document.getElementById('onlineCount').textContent = `⚡ ${n} joueur${s} en ligne`;
  document.getElementById('countLabel').textContent  = `${n} joueur${s}`;
});

document.getElementById('playBtn').addEventListener('click', joinGame);
document.getElementById('nameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinGame();
});

function joinGame() {
  const name = document.getElementById('nameInput').value.trim() || 'Anonyme';
  socket.emit('join', name);
}

socket.on('init', ({ id, gridW, gridH }) => {
  myId   = id;
  GRID_W = gridW;
  GRID_H = gridH;

  document.getElementById('lobby').style.display   = 'none';
  document.getElementById('gameUI').style.display  = 'flex';

  // Reading clientWidth forces a synchronous reflow — dimensions are correct immediately
  fitCanvas();
  requestAnimationFrame(render);
});

// ── Direction input ──────────────────────────────────────────────────

const KEY_DIR = {
  ArrowUp:    { x: 0, y: -1 }, w: { x: 0, y: -1 }, W: { x: 0, y: -1 },
  ArrowDown:  { x: 0, y:  1 }, s: { x: 0, y:  1 }, S: { x: 0, y:  1 },
  ArrowLeft:  { x: -1, y: 0 }, a: { x: -1, y: 0 }, A: { x: -1, y: 0 },
  ArrowRight: { x:  1, y: 0 }, d: { x:  1, y: 0 }, D: { x:  1, y: 0 },
};

document.addEventListener('keydown', e => {
  const dir = KEY_DIR[e.key];
  if (dir) { e.preventDefault(); socket.emit('dir', dir); }
});

canvas.addEventListener('touchstart', e => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });

canvas.addEventListener('touchend', e => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
  if (Math.abs(dx) > Math.abs(dy)) {
    socket.emit('dir', { x: dx > 0 ? 1 : -1, y: 0 });
  } else {
    socket.emit('dir', { x: 0, y: dy > 0 ? 1 : -1 });
  }
}, { passive: true });

// ── Respawn / quit ───────────────────────────────────────────────────

document.getElementById('respawnBtn').addEventListener('click', () => {
  socket.emit('respawn');
  document.getElementById('overlay').style.display = 'none';
});

document.getElementById('quitBtn').addEventListener('click', () => {
  location.reload();
});

// ── Game state ───────────────────────────────────────────────────────

socket.on('state', state => {
  prevState = gameState;
  gameState = state;

  if (!myId) return;

  const me = state.players[myId];
  const prevMe = prevState && prevState.players[myId];

  // Detect death
  if (prevMe && prevMe.alive && me && !me.alive) {
    document.getElementById('overlayScore').textContent = `Score final : ${me.score} pts`;
    document.getElementById('overlay').style.display   = 'flex';
  }

  // Detect food eaten (particle burst at food position)
  if (prevState) {
    const newSet = new Set(state.foods.map(f => `${f.x},${f.y}`));
    for (const f of prevState.foods) {
      if (!newSet.has(`${f.x},${f.y}`)) {
        const color = me ? me.color : '#00ff88';
        spawnParticles(f.x, f.y, color, f.special ? 14 : 7);
      }
    }
  }

  // Update HUD
  if (me) {
    document.getElementById('myScore').textContent = me.score;
    document.getElementById('myName').textContent  = me.name;
    document.getElementById('myColorBar').style.background = me.color;
  }

  // Leaderboard
  const sorted = Object.values(state.players)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const myRank = sorted.findIndex(p => p.name === (me && me.name));

  document.getElementById('lbList').innerHTML = sorted.map((p, i) => `
    <div class="lb-row ${myId && state.players[myId] && p.name === state.players[myId].name ? 'me' : ''}">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-dot" style="background:${p.color}"></span>
      <span class="lb-name">${esc(p.name)}${p.alive ? '' : ' 💀'}</span>
      <span class="lb-pts">${p.score}</span>
    </div>
  `).join('');
});

function esc(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Particles ────────────────────────────────────────────────────────

function spawnParticles(gx, gy, color, count = 8) {
  const cx = gx * CELL + CELL / 2;
  const cy = gy * CELL + CELL / 2;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 3 + 1;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      life: 1,
      size: Math.random() * 3 + 2,
    });
  }
}

// ── Render loop ──────────────────────────────────────────────────────

function render() {
  requestAnimationFrame(render);
  drawFrame();
}

function drawFrame() {
  const W = canvas.width;
  const H = canvas.height;

  // Background
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth   = 0.5;
  for (let x = 0; x <= GRID_W; x++) {
    ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, H); ctx.stroke();
  }
  for (let y = 0; y <= GRID_H; y++) {
    ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(W, y * CELL); ctx.stroke();
  }

  if (!gameState) return;

  // Foods
  const t = Date.now() / 1000;
  for (const f of gameState.foods) {
    const cx = f.x * CELL + CELL / 2;
    const cy = f.y * CELL + CELL / 2;
    const bob = Math.sin(t * 3 + f.x * 1.3 + f.y * 0.7) * 1.2;
    const r   = (f.special ? CELL * 0.42 : CELL * 0.32) + bob * 0.15;
    const color = f.special ? '#ffd166' : '#ff4d6d';

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur  = f.special ? 18 : 10;
    ctx.fillStyle   = color;
    ctx.beginPath();
    ctx.arc(cx, cy + bob, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Shine
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.28, cy + bob - r * 0.28, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  // Snakes
  for (const [id, p] of Object.entries(gameState.players)) {
    if (!p.body || p.body.length === 0) continue;
    const isMe = id === myId;
    drawSnake(p, isMe);
  }

  // Vignette (edge darkening)
  const vig = ctx.createRadialGradient(W/2, H/2, H*0.35, W/2, H/2, H*0.85);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // Solo hint
  const playerCount = Object.keys(gameState.players).length;
  if (playerCount === 1) {
    const pulse = 0.55 + 0.45 * Math.sin(Date.now() / 700);
    ctx.save();
    ctx.globalAlpha  = pulse * 0.7;
    ctx.fillStyle    = 'rgba(255,255,255,0.6)';
    ctx.font         = `${Math.max(11, CELL * 0.85)}px Segoe UI`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡ Partage le lien pour jouer en multijoueur !', W / 2, H - CELL * 1.5);
    ctx.restore();
  }

  // Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x  += p.vx;
    p.y  += p.vy;
    p.vx *= 0.88;
    p.vy *= 0.88;
    p.life -= 0.04;
    if (p.life <= 0) { particles.splice(i, 1); continue; }

    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle   = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur  = 6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ── Snake drawing ────────────────────────────────────────────────────

function drawSnake(p, isMe) {
  const alpha = p.alive ? 1 : 0.25;
  const len   = p.body.length;

  ctx.save();
  ctx.globalAlpha = alpha;

  for (let i = len - 1; i >= 0; i--) {
    const seg    = p.body[i];
    const isHead = i === 0;
    const fade   = 0.35 + 0.65 * (1 - i / len);

    const pad  = isHead ? 1 : 2;
    const size = CELL - pad * 2;
    const x    = seg.x * CELL + pad;
    const y    = seg.y * CELL + pad;
    const rad  = isHead ? Math.max(4, CELL * 0.38) : Math.max(2, CELL * 0.28);

    if (isHead && p.alive) {
      ctx.shadowColor = p.color;
      ctx.shadowBlur  = isMe ? 18 : 10;
    } else {
      ctx.shadowBlur = 0;
    }

    ctx.globalAlpha = alpha * fade;
    ctx.fillStyle   = p.color;
    roundRect(ctx, x, y, size, size, rad);
    ctx.fill();
  }

  // Eyes
  if (p.alive && p.body.length > 0 && p.dir) {
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = alpha;
    drawEyes(ctx, p);
  }

  // Name tag with outline for readability
  if (p.body.length > 0) {
    ctx.shadowBlur   = 0;
    ctx.globalAlpha  = alpha;
    const head = p.body[0];
    const hx   = head.x * CELL + CELL / 2;
    const hy   = head.y * CELL - 4;
    const fs   = Math.max(9, CELL * 0.72);
    ctx.font         = isMe ? `bold ${fs}px Segoe UI` : `${fs}px Segoe UI`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    // Dark outline
    ctx.strokeStyle  = 'rgba(0,0,0,0.8)';
    ctx.lineWidth    = 3;
    ctx.lineJoin     = 'round';
    ctx.strokeText(p.name, hx, hy);
    // Fill
    ctx.fillStyle = isMe ? '#ffffff' : p.color;
    ctx.fillText(p.name, hx, hy);
  }

  ctx.restore();
}

function drawEyes(ctx, p) {
  const head = p.body[0];
  const dir  = p.dir;
  const cx   = head.x * CELL + CELL / 2;
  const cy   = head.y * CELL + CELL / 2;
  const perp = { x: -dir.y, y: dir.x };

  const fw   = CELL * 0.18;
  const side = CELL * 0.24;
  const er   = Math.max(2, CELL * 0.18);

  const e1 = { x: cx + dir.x * fw + perp.x * side, y: cy + dir.y * fw + perp.y * side };
  const e2 = { x: cx + dir.x * fw - perp.x * side, y: cy + dir.y * fw - perp.y * side };

  ctx.fillStyle = '#fff';
  for (const e of [e1, e2]) {
    ctx.beginPath(); ctx.arc(e.x, e.y, er, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#111';
  for (const e of [e1, e2]) {
    ctx.beginPath(); ctx.arc(e.x + dir.x * er * 0.5, e.y + dir.y * er * 0.5, er * 0.55, 0, Math.PI * 2); ctx.fill();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h,     x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y,         x + r, y);
  ctx.closePath();
}
