/* ══════════════════════════════════════════════════════════════════
   Snake Multiplayer — Client
══════════════════════════════════════════════════════════════════ */

const socket = io();
const canvas  = document.getElementById('canvas');
const ctx     = canvas.getContext('2d');

let GRID_W = 50, GRID_H = 40, CELL = 14;
let myId = null, gameState = null, prevState = null;

// ── Skins ─────────────────────────────────────────────────────────────────────

const SKINS = {
  classic: {
    name: 'Classique', icon: '🐍',
    barClass: 'bar-classic',
    seg(p, i, len) { return p.color; },
    glow(p, isHead) { return isHead ? 14 : 0; },
  },
  neon: {
    name: 'Néon', icon: '⚡',
    barClass: 'bar-neon',
    seg(p, i, len) { return p.color; },
    glow(p, isHead) { return isHead ? 28 : 10; },
    pulse: true,
  },
  rainbow: {
    name: 'Arc-en-ciel', icon: '🌈',
    barClass: 'bar-rainbow',
    seg(p, i, len, t) { return `hsl(${(t * 60 + i * 14) % 360},100%,60%)`; },
    glow(p, isHead) { return isHead ? 14 : 4; },
  },
  fire: {
    name: 'Feu', icon: '🔥',
    barClass: 'bar-fire',
    seg(p, i, len, t) {
      const pct = i / Math.max(len - 1, 1);
      return `hsl(${15 + pct * 40},100%,${50 + pct * 22}%)`;
    },
    glow(p, isHead) { return isHead ? 22 : 8; },
  },
  ice: {
    name: 'Glace', icon: '❄️',
    barClass: 'bar-ice',
    seg(p, i, len, t) {
      const pct = i / Math.max(len - 1, 1);
      return `hsl(200,${85 - pct * 30}%,${55 + pct * 35}%)`;
    },
    glow(p, isHead) { return isHead ? 18 : 6; },
  },
  ghost: {
    name: 'Fantôme', icon: '👻',
    barClass: 'bar-ghost',
    seg(p, i, len, t) {
      const a = 0.35 + 0.65 * (1 - i / Math.max(len - 1, 1));
      return `rgba(200,200,255,${a})`;
    },
    glow(p, isHead) { return isHead ? 20 : 8; },
    ghostly: true,
  },
};

// ── Skin picker ───────────────────────────────────────────────────────────────

let selectedSkin = 'classic';

function buildSkinPicker() {
  const picker = document.getElementById('skinPicker');
  Object.entries(SKINS).forEach(([key, s]) => {
    const div = document.createElement('div');
    div.className = 'skin-opt' + (key === 'classic' ? ' active' : '');
    div.dataset.skin = key;
    div.innerHTML = `
      <span class="skin-icon">${s.icon}</span>
      <div class="skin-bar ${s.barClass}"></div>
      <span class="skin-name">${s.name}</span>
    `;
    div.addEventListener('click', () => {
      document.querySelectorAll('.skin-opt').forEach(el => el.classList.remove('active'));
      div.classList.add('active');
      selectedSkin = key;
      playSound('click');
    });
    picker.appendChild(div);
  });
}
buildSkinPicker();

// ── Canvas sizing ─────────────────────────────────────────────────────────────

function fitCanvas() {
  const wrap = document.getElementById('canvasWrap');
  const maxW = wrap.clientWidth  || window.innerWidth  - 226;
  const maxH = wrap.clientHeight || window.innerHeight - 60;
  CELL = Math.max(6, Math.min(Math.floor(maxW / GRID_W), Math.floor(maxH / GRID_H)));
  canvas.width  = GRID_W * CELL;
  canvas.height = GRID_H * CELL;
}
window.addEventListener('resize', () => requestAnimationFrame(fitCanvas));

// ── Lobby / join ──────────────────────────────────────────────────────────────

socket.on('count', n => {
  const s = n === 1 ? '' : 's';
  document.getElementById('onlineCount').textContent  = `⚡ ${n} joueur${s} en ligne`;
  document.getElementById('countLabel').textContent   = `${n} joueur${s}`;
});

document.getElementById('playBtn').addEventListener('click', joinGame);

document.getElementById('nameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinGame();
});

function joinGame() {
  const name = document.getElementById('nameInput').value.trim() || 'Anonyme';
  socket.emit('join', { name, skin: selectedSkin });
}

socket.on('init', ({ id, gridW, gridH }) => {
  myId   = id;
  GRID_W = gridW;
  GRID_H = gridH;
  document.getElementById('lobby').style.display   = 'none';
  document.getElementById('gameUI').style.display  = 'flex';
  fitCanvas();
  requestAnimationFrame(render);
});

// ── Input — BUG FIX: ignore keys when typing in an input ─────────────────────

const KEY_DIR = {
  ArrowUp:   {x:0,y:-1}, w:{x:0,y:-1}, W:{x:0,y:-1},
  ArrowDown: {x:0,y:1},  s:{x:0,y:1},  S:{x:0,y:1},
  ArrowLeft: {x:-1,y:0}, a:{x:-1,y:0}, A:{x:-1,y:0},
  ArrowRight:{x:1,y:0},  d:{x:1,y:0},  D:{x:1,y:0},
};

let boosting = false;

document.addEventListener('keydown', e => {
  // ← FIX: ne pas capturer les touches quand on tape dans un champ
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  const dir = KEY_DIR[e.key];
  if (dir) { e.preventDefault(); socket.emit('dir', dir); }

  if (e.code === 'Space' && !boosting) {
    e.preventDefault();
    boosting = true;
    socket.emit('boost', true);
    startBoostBar();
    playSound('boost');
  }
});

document.addEventListener('keyup', e => {
  if (e.code === 'Space' && boosting) {
    boosting = false;
    socket.emit('boost', false);
    stopBoostBar();
  }
});

// Touch controls
let touchStart = null;
canvas.addEventListener('touchstart', e => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  // double-tap for boost
}, { passive: true });

canvas.addEventListener('touchend', e => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
  if (Math.abs(dx) > Math.abs(dy)) socket.emit('dir', { x: dx > 0 ? 1 : -1, y: 0 });
  else                             socket.emit('dir', { x: 0, y: dy > 0 ? 1 : -1 });
}, { passive: true });

// ── Boost bar ─────────────────────────────────────────────────────────────────

let boostInterval = null;
let boostPct = 100;

function startBoostBar() {
  const bar  = document.getElementById('boostBar');
  const fill = document.getElementById('boostFill');
  bar.style.display = 'flex';
  boostPct = 100;
  fill.style.width = '100%';
  boostInterval = setInterval(() => {
    boostPct = Math.max(0, boostPct - 2);
    fill.style.width = boostPct + '%';
    if (boostPct <= 0) {
      boosting = false;
      socket.emit('boost', false);
      stopBoostBar();
    }
  }, 80);
}

function stopBoostBar() {
  clearInterval(boostInterval);
  document.getElementById('boostBar').style.display = 'none';
}

// ── Respawn / quit ────────────────────────────────────────────────────────────

document.getElementById('respawnBtn').addEventListener('click', () => {
  socket.emit('respawn');
  document.getElementById('overlay').style.display = 'none';
  playSound('click');
});

document.getElementById('quitBtn').addEventListener('click', () => location.reload());

// ── Kill feed ─────────────────────────────────────────────────────────────────

socket.on('kill', ({ killer, victim, killerColor, victimColor }) => {
  const feed = document.getElementById('killFeed');
  const el   = document.createElement('div');
  el.className = 'kill-entry';
  el.innerHTML = `<span style="color:${killerColor}">${esc(killer)}</span> ☠️ <span style="color:${victimColor}">${esc(victim)}</span>`;
  feed.prepend(el);
  setTimeout(() => el.remove(), 4000);
  playSound('kill');
});

socket.on('shieldBroke', ({ id }) => {
  if (id === myId) {
    shakeScreen();
    playSound('shield');
  }
});

socket.on('foodEaten', ({ x, y, color, type }) => {
  spawnParticles(x, y, color, type === 'gold' ? 14 : type === 'speed' ? 10 : 7);
  const snd = type === 'gold' ? 'eatGold' : type === 'speed' ? 'eatSpeed' : type === 'shield' ? 'eatShield' : 'eat';
  playSound(snd);
});

// ── Game state ────────────────────────────────────────────────────────────────

socket.on('state', state => {
  prevState = gameState;
  gameState = state;
  if (!myId) return;

  const me     = state.players[myId];
  const prevMe = prevState?.players?.[myId];

  // Death detection
  if (prevMe?.alive && me && !me.alive) {
    document.getElementById('overlayScore').textContent = `Score : ${me.score} pts`;
    document.getElementById('overlayKills').textContent = me.kills ? `☠️ ${me.kills} kills` : '';
    document.getElementById('overlay').style.display   = 'flex';
    shakeScreen();
    playSound('death');
  }

  // Update score / kills
  if (me) {
    document.getElementById('myScore').textContent    = me.score;
    document.getElementById('myName').textContent     = me.name;
    document.getElementById('myColorBar').style.background = me.color;
    document.getElementById('killCount').textContent  = me.kills || 0;
  }

  // Effects HUD
  updateEffects(me);

  // Leaderboard
  const sorted = Object.values(state.players).sort((a, b) => b.score - a.score).slice(0, 10);
  document.getElementById('lbList').innerHTML = sorted.map((p, i) => `
    <div class="lb-row ${myId && state.players[myId]?.name === p.name ? 'me' : ''}">
      <span class="lb-rank">${i+1}</span>
      <span class="lb-dot" style="background:${p.color}"></span>
      <span class="lb-name">${esc(p.name)}${p.alive?'':'💀'}</span>
      <span class="lb-pts">${p.score}</span>
    </div>`).join('');
});

function updateEffects(me) {
  const card = document.getElementById('effectsCard');
  const list = document.getElementById('effectsList');
  if (!me) { card.style.display = 'none'; return; }
  const rows = [];
  if (me.effects?.speedTicks > 0) {
    const pct = Math.round(me.effects.speedTicks / 55 * 100);
    rows.push(`<div class="effect-row effect-speed">⚡ Vitesse
      <div class="effect-bar"><div class="effect-bar-fill speed-fill" style="width:${pct}%"></div></div></div>`);
  }
  if (me.effects?.shield) {
    rows.push(`<div class="effect-row effect-shield">🛡️ Bouclier actif</div>`);
  }
  if (me.boosting) {
    rows.push(`<div class="effect-row effect-boost">🚀 Boost !</div>`);
  }
  list.innerHTML = rows.join('');
  card.style.display = rows.length ? '' : 'none';
}

// ── Particles ─────────────────────────────────────────────────────────────────

const particles = [];

function spawnParticles(gx, gy, color, count = 8) {
  const cx = gx * CELL + CELL / 2;
  const cy = gy * CELL + CELL / 2;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const speed = Math.random() * 3.5 + 1;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color, life: 1,
      size: Math.random() * 3.5 + 1.5,
    });
  }
}

// ── Screen shake ──────────────────────────────────────────────────────────────

let shakeAmt = 0;
function shakeScreen() { shakeAmt = 8; }

// ── Sound (Web Audio API) ─────────────────────────────────────────────────────

let audioCtx = null;

function getAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  return audioCtx;
}

function playTone(freq, freq2, dur, vol = 0.12, type = 'sine') {
  const ac = getAudio(); if (!ac) return;
  try {
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (freq2) osc.frequency.exponentialRampToValueAtTime(freq2, ac.currentTime + dur);
    gain.gain.setValueAtTime(vol, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.start(); osc.stop(ac.currentTime + dur + 0.05);
  } catch(e) {}
}

function playSound(type) {
  switch(type) {
    case 'eat':       playTone(440, 660, 0.08, 0.10); break;
    case 'eatGold':   playTone(550, 1100, 0.15, 0.15); break;
    case 'eatSpeed':  playTone(800, 1600, 0.12, 0.12, 'sawtooth'); break;
    case 'eatShield': playTone(350, 700, 0.18, 0.13, 'triangle'); break;
    case 'death':     playTone(300, 60, 0.5, 0.25); break;
    case 'kill':      playTone(600, 1200, 0.12, 0.10); break;
    case 'shield':    playTone(200, 400, 0.25, 0.18, 'triangle'); break;
    case 'boost':     playTone(300, 600, 0.1, 0.07, 'sawtooth'); break;
    case 'click':     playTone(800, 1000, 0.06, 0.06); break;
  }
}

// ── Render loop ───────────────────────────────────────────────────────────────

function render() {
  requestAnimationFrame(render);
  drawFrame();
}

function drawFrame() {
  const W = canvas.width, H = canvas.height;
  const t = Date.now() / 1000;

  // Screen shake
  ctx.save();
  if (shakeAmt > 0) {
    const sx = (Math.random() - 0.5) * shakeAmt;
    const sy = (Math.random() - 0.5) * shakeAmt;
    ctx.translate(sx, sy);
    shakeAmt *= 0.78;
    if (shakeAmt < 0.3) shakeAmt = 0;
  }

  // Background
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.022)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= GRID_W; x++) { ctx.beginPath(); ctx.moveTo(x*CELL,0); ctx.lineTo(x*CELL,H); ctx.stroke(); }
  for (let y = 0; y <= GRID_H; y++) { ctx.beginPath(); ctx.moveTo(0,y*CELL); ctx.lineTo(W,y*CELL); ctx.stroke(); }

  if (gameState) {
    drawFoods(t);
    drawSnakes(t);
    drawParticles();
    drawVignette(W, H);
    drawSoloHint(W, H, t);
  }

  ctx.restore();
}

// ── Food rendering ────────────────────────────────────────────────────────────

function drawFoods(t) {
  for (const f of gameState.foods) {
    const cx  = f.x * CELL + CELL / 2;
    const cy  = f.y * CELL + CELL / 2;
    const bob = Math.sin(t * 3.2 + f.x * 1.7 + f.y * 0.9) * 1.3;

    ctx.save();
    switch (f.type) {
      case 'normal': drawNormalFood(cx, cy + bob, t); break;
      case 'gold':   drawGoldFood  (cx, cy + bob, t); break;
      case 'speed':  drawSpeedFood (cx, cy + bob, t); break;
      case 'shield': drawShieldFood(cx, cy + bob, t); break;
    }
    ctx.restore();
  }
}

function foodGlow(color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }

function drawNormalFood(cx, cy, t) {
  const r = CELL * 0.33;
  foodGlow('#ff4d6d', 10);
  ctx.fillStyle = '#ff4d6d';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.beginPath(); ctx.arc(cx - r*.28, cy - r*.28, r*.3, 0, Math.PI*2); ctx.fill();
}

function drawGoldFood(cx, cy, t) {
  const r = CELL * 0.4;
  foodGlow('#ffd700', 18);
  drawStar(cx, cy, 5, r, r * 0.5, '#ffd700');
  ctx.fillStyle = 'rgba(255,255,255,.4)';
  ctx.beginPath(); ctx.arc(cx - r*.2, cy - r*.2, r*.22, 0, Math.PI*2); ctx.fill();
}

function drawSpeedFood(cx, cy, t) {
  const r = CELL * 0.36;
  foodGlow('#00ccff', 16);
  ctx.fillStyle = '#00ccff';
  // lightning bolt
  ctx.beginPath();
  ctx.moveTo(cx + r*.25, cy - r);
  ctx.lineTo(cx - r*.1, cy - r*.05);
  ctx.lineTo(cx + r*.2, cy - r*.05);
  ctx.lineTo(cx - r*.25, cy + r);
  ctx.lineTo(cx + r*.1, cy + r*.05);
  ctx.lineTo(cx - r*.2, cy + r*.05);
  ctx.closePath();
  ctx.fill();
}

function drawShieldFood(cx, cy, t) {
  const r = CELL * 0.38;
  foodGlow('#b39dff', 16);
  ctx.fillStyle = '#a29bfe';
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.bezierCurveTo(cx+r, cy-r, cx+r, cy+r*.2, cx, cy+r);
  ctx.bezierCurveTo(cx-r, cy+r*.2, cx-r, cy-r, cx, cy-r);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  ctx.font = `bold ${Math.max(8, CELL*.55)}px Arial`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('✦', cx, cy);
}

function drawStar(cx, cy, pts, outer, inner, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const r   = i % 2 === 0 ? outer : inner;
    const ang = (i * Math.PI) / pts - Math.PI / 2;
    i === 0 ? ctx.moveTo(cx + r*Math.cos(ang), cy + r*Math.sin(ang))
            : ctx.lineTo(cx + r*Math.cos(ang), cy + r*Math.sin(ang));
  }
  ctx.closePath(); ctx.fill();
}

// ── Snake rendering ───────────────────────────────────────────────────────────

function drawSnakes(t) {
  for (const [id, p] of Object.entries(gameState.players)) {
    if (!p.body || !p.body.length) continue;
    drawSnake(p, id === myId, t);
  }
}

function drawSnake(p, isMe, t) {
  const skin  = SKINS[p.skin] || SKINS.classic;
  const alpha = p.alive ? 1 : 0.22;
  const len   = p.body.length;

  // Boost trail
  if (p.boosting && p.alive) drawBoostTrail(p, t);

  ctx.save();
  ctx.globalAlpha = alpha;

  for (let i = len - 1; i >= 0; i--) {
    const seg    = p.body[i];
    const isHead = i === 0;
    const fade   = 0.3 + 0.7 * (1 - i / len);
    const color  = skin.seg(p, i, len, t);
    const glowV  = isHead && p.alive ? skin.glow(p, true) : (skin.glow(p, false) > 0 && p.alive ? skin.glow(p, false) * fade : 0);
    const pulse  = skin.pulse && isHead ? 1 + Math.sin(t * 6) * 0.08 : 1;

    const pad  = isHead ? 1 : 2;
    const size = (CELL - pad * 2) * (isHead ? pulse : 1);
    const x    = seg.x * CELL + pad + (CELL - pad*2 - size) / 2;
    const y    = seg.y * CELL + pad + (CELL - pad*2 - size) / 2;
    const r    = isHead ? Math.max(4, CELL*.38) : Math.max(2, CELL*.28);

    ctx.globalAlpha = alpha * (isHead ? 1 : fade);
    ctx.shadowColor = color;
    ctx.shadowBlur  = glowV;
    ctx.fillStyle   = color;

    if (skin.ghostly) ctx.globalAlpha *= 0.75;

    roundRect(ctx, x, y, size, size, r);
    ctx.fill();

    // Speed shimmer on body
    if (p.effects?.speedTicks > 0 && !isHead) {
      ctx.globalAlpha = alpha * fade * 0.35 * Math.sin(t * 10 + i * 0.5);
      ctx.fillStyle = '#00ccff';
      ctx.shadowColor = '#00ccff'; ctx.shadowBlur = 8;
      roundRect(ctx, x+1, y+1, size-2, size-2, r);
      ctx.fill();
    }
  }

  // Shield aura
  if (p.effects?.shield && p.alive && p.body[0]) {
    const h = p.body[0];
    const cx = h.x * CELL + CELL/2, cy = h.y * CELL + CELL/2;
    const ra = CELL * (1.4 + Math.sin(t * 4) * 0.1);
    ctx.globalAlpha = alpha * (0.3 + Math.sin(t * 4) * 0.15);
    ctx.strokeStyle = '#b39dff'; ctx.lineWidth = 2.5;
    ctx.shadowColor = '#b39dff'; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(cx, cy, ra, 0, Math.PI*2); ctx.stroke();
  }

  // Eyes
  if (p.alive && p.body[0] && p.dir) {
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = alpha;
    drawEyes(p);
  }

  // Name tag
  if (p.body[0]) {
    ctx.shadowBlur   = 0;
    ctx.globalAlpha  = alpha;
    const head = p.body[0];
    const hx   = head.x * CELL + CELL/2;
    const hy   = head.y * CELL - 4;
    const fs   = Math.max(9, CELL * 0.72);
    ctx.font         = `${isMe ? 'bold ' : ''}${fs}px Segoe UI`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.strokeStyle  = 'rgba(0,0,0,.85)';
    ctx.lineWidth    = 3; ctx.lineJoin = 'round';
    ctx.strokeText(p.name, hx, hy);
    ctx.fillStyle = isMe ? '#ffffff' : (SKINS[p.skin]?.seg(p, 0, 1, Date.now()/1000) || p.color);
    ctx.fillText(p.name, hx, hy);
  }

  ctx.restore();
}

function drawBoostTrail(p, t) {
  ctx.save();
  for (let i = 1; i < Math.min(p.body.length, 8); i++) {
    const seg  = p.body[i];
    const cx   = seg.x * CELL + CELL/2;
    const cy   = seg.y * CELL + CELL/2;
    const a    = (1 - i / 8) * 0.5;
    ctx.globalAlpha = a;
    ctx.fillStyle   = '#ffd700';
    ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 0.2 * (1 - i/8), 0, Math.PI*2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEyes(p) {
  const head = p.body[0];
  const dir  = p.dir;
  const cx   = head.x * CELL + CELL/2;
  const cy   = head.y * CELL + CELL/2;
  const perp = { x: -dir.y, y: dir.x };
  const fw   = CELL * 0.18;
  const side = CELL * 0.24;
  const er   = Math.max(2, CELL * 0.18);

  const e1 = { x: cx + dir.x*fw + perp.x*side, y: cy + dir.y*fw + perp.y*side };
  const e2 = { x: cx + dir.x*fw - perp.x*side, y: cy + dir.y*fw - perp.y*side };

  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  for (const e of [e1, e2]) { ctx.beginPath(); ctx.arc(e.x, e.y, er, 0, Math.PI*2); ctx.fill(); }
  ctx.fillStyle = '#000';
  for (const e of [e1, e2]) { ctx.beginPath(); ctx.arc(e.x + dir.x*er*.5, e.y + dir.y*er*.5, er*.55, 0, Math.PI*2); ctx.fill(); }
}

// ── Particles ─────────────────────────────────────────────────────────────────

function drawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.87; p.vy *= 0.87;
    p.life -= 0.045;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha  = p.life;
    ctx.fillStyle    = p.color;
    ctx.shadowColor  = p.color;
    ctx.shadowBlur   = 8;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }
}

// ── Vignette & solo hint ──────────────────────────────────────────────────────

function drawVignette(W, H) {
  const g = ctx.createRadialGradient(W/2, H/2, H*.32, W/2, H/2, H*.9);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

function drawSoloHint(W, H, t) {
  const n = Object.keys(gameState.players).length;
  if (n > 1) return;
  ctx.save();
  ctx.globalAlpha  = 0.55 + 0.45 * Math.sin(t * 1.5);
  ctx.fillStyle    = 'rgba(255,255,255,.6)';
  ctx.font         = `${Math.max(11, CELL * .82)}px Segoe UI`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⚡ Partage le lien pour jouer en multijoueur !', W/2, H - CELL*1.6);
  ctx.restore();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
