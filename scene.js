// ─── Birthday cake (pixel-identical traced map) ────────────────────────────
const BLOW_HOLD_MS = 3500;
const SMOKE_DURATION_MS = 5200;
const SMOKE_HEADROOM = 32;

const cakeInteract = {
  base: null,
  display: null,
  flamePixels: [],
  candleHit: { x: 34, y: 0, w: 14, h: 28 },
  flameOrigin: { x: 39, y: 8 },
  blownOut: false,
  holding: false,
  holdStart: 0,
  blowProgress: 0,
  flickerT: 0,
  smokePuffs: [],
  displayScale: 1,
  pointerId: null,
};

function buildCakeSpriteFromEmbedded(data) {
  const canvas = document.createElement('canvas');
  canvas.width = data.w;
  canvas.height = data.h;
  const c = canvas.getContext('2d');
  const img = c.createImageData(data.w, data.h);
  const bin = atob(data.rgba_b64);
  for (let i = 0; i < bin.length; i++) {
    img.data[i] = bin.charCodeAt(i);
  }
  c.putImageData(img, 0, 0);
  return canvas;
}

function cropCanvasToOpaque(sourceCanvas) {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const src = sourceCanvas.getContext('2d').getImageData(0, 0, sw, sh).data;
  let minX = sw;
  let minY = sh;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (src[(y * sw + x) * 4 + 3] <= 20) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) {
    return { canvas: sourceCanvas, offsetX: 0, offsetY: 0 };
  }

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return { canvas, offsetX: minX, offsetY: minY };
}

function isFlamePixel(r, g, b, y, h) {
  return y < h * 0.18 && r > 195 && g > 130 && b < 185 && r >= g - 30;
}

function isWickPixel(r, g, b, y, x, centerX, h) {
  if (Math.abs(x - centerX) > 1) return false;
  if (r < 95 && g < 85 && b < 90) return true;
  if (y >= h * 0.12 && r < 200 && g < 150 && b < 100 && r > 70) return true;
  return false;
}

function collectExtinguishPixels(src, w, h, flamePixels) {
  if (!flamePixels.length) return [];

  const centerX = ((flamePixels.reduce((sum, p) => sum + p.x, 0)) / flamePixels.length) | 0;
  const maxFlameY = Math.max(...flamePixels.map((p) => p.y));
  const visited = new Set(flamePixels.map((p) => p.y * w + p.x));
  const queue = [...visited];

  while (queue.length) {
    const idx = queue.pop();
    const x = idx % w;
    const y = (idx / w) | 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (ny < 0 || ny > maxFlameY || nx < 0 || nx >= w) continue;
      const ni = ny * w + nx;
      if (visited.has(ni)) continue;
      const si = ni * 4;
      if (src[si + 3] <= 20) continue;
      if (isWickPixel(src[si], src[si + 1], src[si + 2], ny, nx, centerX, h)) continue;
      visited.add(ni);
      queue.push(ni);
    }
  }

  return [...visited].map((idx) => {
    const x = idx % w;
    const y = (idx / w) | 0;
    const i = idx * 4;
    return { x, y, r: src[i], g: src[i + 1], b: src[i + 2] };
  });
}

function initCakeInteract(baseCanvas) {
  const w = baseCanvas.width;
  const h = baseCanvas.height;
  const src = baseCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const flamePixels = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] === 0) continue;
      const r = src[i];
      const g = src[i + 1];
      const b = src[i + 2];
      if (isFlamePixel(r, g, b, y, h)) {
        flamePixels.push({ x, y, r, g, b });
      }
    }
  }

  if (flamePixels.length) {
    const xs = flamePixels.map((p) => p.x);
    const ys = flamePixels.map((p) => p.y);
    cakeInteract.flameOrigin = {
      x: ((Math.min(...xs) + Math.max(...xs)) / 2) | 0,
      y: ((Math.min(...ys) + Math.max(...ys)) / 2) | 0,
    };
  }

  cakeInteract.base = baseCanvas;
  cakeInteract.display = document.createElement('canvas');
  cakeInteract.display.width = w;
  cakeInteract.display.height = h + SMOKE_HEADROOM;
  cakeInteract.smokeHeadroom = SMOKE_HEADROOM;
  cakeInteract.flamePixels = flamePixels;
  cakeInteract.flamePixelSet = new Set(flamePixels.map((p) => p.y * w + p.x));
  cakeInteract.extinguishPixels = collectExtinguishPixels(src, w, h, flamePixels);
  cakeInteract.blownOut = false;
  cakeInteract.holding = false;
  cakeInteract.blowProgress = 0;
  cakeInteract.smokePuffs = [];
}

function spawnSmokePuffs() {
  const { x, y } = cakeInteract.flameOrigin;
  const baseY = y + cakeInteract.smokeHeadroom;
  for (let i = 0; i < 10; i++) {
    cakeInteract.smokePuffs.push({
      x: x + (Math.random() - 0.5) * 6,
      y: baseY + Math.random() * 2,
      vy: -0.22 - Math.random() * 0.18,
      vx: (Math.random() - 0.5) * 0.08,
      life: 0,
      maxLife: SMOKE_DURATION_MS * (0.65 + Math.random() * 0.5),
      seed: Math.random() * 100,
      size: 2 + (Math.random() * 2) | 0,
    });
  }
}

function updateCakeInteract(now, dt) {
  cakeInteract.flickerT += dt;

  if (cakeInteract.holding && !cakeInteract.blownOut) {
    cakeInteract.blowProgress = Math.min(1, (now - cakeInteract.holdStart) / BLOW_HOLD_MS);
    if (cakeInteract.blowProgress >= 1) {
      cakeInteract.blowProgress = 1;
      cakeInteract.holding = false;
      cakeInteract.blownOut = true;
      cakeInteract.pointerId = null;
      spawnSmokePuffs();
      showCelebration();
    }
  } else if (!cakeInteract.blownOut && cakeInteract.blowProgress > 0) {
    cakeInteract.blowProgress = Math.max(0, cakeInteract.blowProgress - dt / 350);
  }

  cakeInteract.smokePuffs = cakeInteract.smokePuffs.filter((puff) => {
    puff.life += dt;
    puff.x += puff.vx;
    puff.y += puff.vy;
    puff.vy *= 0.998;
    return puff.life < puff.maxLife;
  });
}

function cakeNeedsAnimation() {
  if (cakeInteract.holding) return true;
  if (!cakeInteract.blownOut && cakeInteract.blowProgress > 0) return true;
  if (cakeInteract.smokePuffs.length > 0) return true;
  if (!cakeInteract.blownOut) return true;
  return false;
}

function renderCakeDisplay() {
  if (!cakeInteract.base || !cakeInteract.display) return cakeInteract.base;

  const canvas = cakeInteract.display;
  const w = canvas.width;
  const h = canvas.height;
  const head = cakeInteract.smokeHeadroom;
  const cx = canvas.getContext('2d');
  cx.imageSmoothingEnabled = false;
  cx.clearRect(0, 0, w, h);
  cx.drawImage(cakeInteract.base, 0, head);

  const img = cx.getImageData(0, 0, w, h);
  const d = img.data;
  const t = cakeInteract.flickerT;
  const progress = cakeInteract.blowProgress;

  for (const p of cakeInteract.extinguishPixels) {
    const i = ((p.y + head) * w + p.x) * 4;
    const isFlame = cakeInteract.flamePixelSet.has(p.y * w + p.x);

    if (cakeInteract.blownOut) {
      d[i + 3] = 0;
      continue;
    }

    if (progress <= 0 && !cakeInteract.holding) continue;

    const flicker = isFlame
      ? (cakeInteract.holding
        ? 0.55 + 0.45 * Math.sin(t * 0.028 + p.x * 1.7 + p.y * 2.3)
        : 0.78 + 0.22 * Math.sin(t * 0.011 + p.x * 0.9 + p.y))
      : 1;

    const dim = 1 - progress * 0.92;
    const alpha = Math.max(0, Math.min(1, flicker * dim));
    if (alpha <= 0.02) {
      d[i + 3] = 0;
      continue;
    }

    if (isFlame) {
      const heat = 1 - progress * 0.35;
      d[i] = Math.min(255, (p.r * heat) | 0);
      d[i + 1] = Math.min(255, (p.g * (0.85 + progress * 0.1)) | 0);
      d[i + 2] = Math.min(255, (p.b * (1 + progress * 0.15)) | 0);
    } else {
      d[i] = p.r;
      d[i + 1] = p.g;
      d[i + 2] = p.b;
    }
    d[i + 3] = (alpha * 255) | 0;
  }

  cx.putImageData(img, 0, 0);
  drawCakeSmoke(cx);
  return canvas;
}

function drawCakeSmoke(cx) {
  const smokeColors = ['#9aa0a8', '#787e88', '#5a6068', '#c4c8cc'];
  for (const puff of cakeInteract.smokePuffs) {
    const lifeT = puff.life / puff.maxLife;
    const alpha = lifeT < 0.15 ? lifeT / 0.15 : 1 - (lifeT - 0.15) / 0.85;
    if (alpha <= 0) continue;

    const wobble = Math.sin(cakeInteract.flickerT * 0.006 + puff.seed) * 1.2;
    const px = (puff.x + wobble) | 0;
    const py = puff.y | 0;
    const col = smokeColors[((puff.seed * 10) | 0) % smokeColors.length];

    cx.globalAlpha = alpha * 0.55;
    for (let dy = 0; dy < puff.size; dy++) {
      for (let dx = 0; dx < puff.size; dx++) {
        if ((dx + dy + puff.seed) % 2 > 0.4) continue;
        cx.fillStyle = col;
        cx.fillRect(px + dx, py + dy, 1, 1);
      }
    }
  }
  cx.globalAlpha = 1;
}

async function loadCakeSprite() {
  const res = await fetch('assets/cake-embedded.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load cake data: ${res.status}`);
  const data = await res.json();
  const raw = buildCakeSpriteFromEmbedded(data);
  const { canvas: base, offsetX, offsetY } = cropCanvasToOpaque(raw);
  cakeInteract.candleHit = {
    x: 34 - offsetX,
    y: Math.max(0, -offsetY),
    w: 14,
    h: 28,
  };
  initCakeInteract(base);
  return renderCakeDisplay();
}

// ─── App flow, hints, confetti, celebration ────────────────────────────────
const TITLE_MIN_PX = 16;
const TITLE_MAX_PX = 52;
const TITLE_HPAD_PX = 32;
const NOTE_MIN_PX = 8;

function getTitleSizePx() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--title-size').trim();
  const parsed = parseFloat(raw);
  if (parsed) return parsed;
  const title = document.getElementById('birthday-title');
  return title ? parseFloat(getComputedStyle(title).fontSize) : TITLE_MIN_PX;
}

const CONFETTI_COLORS = [
  '#f94144', '#f3722c', '#f8961e', '#f9c74f',
  '#90be6d', '#43aa8b', '#577590', '#ff6bcb', '#b5179e',
];

const confetti = { particles: [], active: false };
let awaitingCelebrationConfettiEnd = false;
let wishButtonShown = false;

let overlayFrame = null;
let lastFrameTime = 0;

function mainScreenActive() {
  const main = document.getElementById('main-screen');
  return main && !main.hidden;
}

function getViewportSize() {
  const vv = window.visualViewport;
  return {
    w: Math.floor(vv ? vv.width : window.innerWidth),
    h: Math.floor(vv ? vv.height : window.innerHeight),
  };
}

function initConfetti() {
  resizeConfettiCanvas();
  window.addEventListener('resize', resizeConfettiCanvas);
}

function resizeConfettiCanvas() {
  const c = document.getElementById('confetti-canvas');
  if (!c) return;
  const { w, h } = getViewportSize();
  c.width = w;
  c.height = h;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
}

function spawnConfetti(count = 120) {
  const { w, h } = getViewportSize();
  for (let i = 0; i < count; i++) {
    confetti.particles.push({
      x: Math.random() * w,
      y: -20 - Math.random() * h * 0.4,
      w: 4 + (Math.random() * 5 | 0),
      h: 5 + (Math.random() * 6 | 0),
      vx: (Math.random() - 0.5) * 1.8,
      vy: 1.5 + Math.random() * 3.5,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.15,
      color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      life: 0,
      maxLife: 3500 + Math.random() * 2500,
    });
  }
  confetti.active = true;
  startOverlayLoop();
}

function updateConfetti(dt) {
  const { h } = getViewportSize();
  const hadParticles = confetti.particles.length > 0;
  confetti.particles = confetti.particles.filter((p) => {
    p.life += dt;
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.018;
    p.rot += p.vr;
    return p.life < p.maxLife && p.y < h + 30;
  });
  if (confetti.particles.length === 0) {
    if (confetti.active || hadParticles) onConfettiFinished();
    confetti.active = false;
  }
}

function onConfettiFinished() {
  if (awaitingCelebrationConfettiEnd) {
    awaitingCelebrationConfettiEnd = false;
    showWishButton();
  }
}

function drawConfetti() {
  const c = document.getElementById('confetti-canvas');
  if (!c) return;
  const cx = c.getContext('2d');
  const { w, h } = getViewportSize();
  cx.clearRect(0, 0, w, h);
  for (const p of confetti.particles) {
    cx.save();
    cx.translate(p.x, p.y);
    cx.rotate(p.rot);
    cx.fillStyle = p.color;
    cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    cx.restore();
  }
}

function initIntro() {
  const sw = document.getElementById('light-switch');
  if (!sw) return;
  sw.addEventListener('click', turnOnLight);
}

function turnOnLight() {
  const intro = document.getElementById('intro-screen');
  const main = document.getElementById('main-screen');
  const sw = document.getElementById('light-switch');
  if (!intro || !main || !sw || sw.disabled) return;

  sw.disabled = true;
  sw.classList.add('on');

  setTimeout(() => {
    intro.classList.add('hidden');
    main.hidden = false;
    document.body.classList.remove('intro-active');
    document.body.classList.add('cake-active');
    resize();
    spawnConfetti(140);
    updateBlowHintPosition();
    startOverlayLoop();
  }, 280);
}

function updateBlowHintPosition() {
  const hint = document.getElementById('blow-hint');
  if (!hint || hint.classList.contains('hidden') || !layout || !spriteReady()) return;

  const head = cakeInteract.smokeHeadroom || 0;
  const rect = canvas.getBoundingClientRect();
  const fx = (cakeInteract.flameOrigin.x + 0.5) / cakeSprite.width;
  const fy = (cakeInteract.flameOrigin.y + head + 0.5) / cakeSprite.height;
  const flameX = rect.left + fx * rect.width;
  const flameY = rect.top + fy * rect.height;

  hint.style.left = `${flameX}px`;
  hint.style.top = `${Math.max(12, flameY - hint.offsetHeight - 32)}px`;
  hint.style.transform = 'translateX(-50%)';
}

function fitSceneTitle(titleEl) {
  if (!titleEl) return;

  const maxWidth = Math.max(120, getViewportSize().w - TITLE_HPAD_PX);
  const saved = {
    maxHeight: titleEl.style.maxHeight,
    overflow: titleEl.style.overflow,
    position: titleEl.style.position,
    left: titleEl.style.left,
  };

  titleEl.style.maxHeight = 'none';
  titleEl.style.overflow = 'visible';
  titleEl.style.position = 'absolute';
  titleEl.style.left = '-9999px';

  let size = TITLE_MIN_PX;
  for (let px = TITLE_MAX_PX; px >= TITLE_MIN_PX; px--) {
    titleEl.style.fontSize = `${px}px`;
    if (titleEl.offsetWidth <= maxWidth) {
      size = px;
      break;
    }
  }

  document.documentElement.style.setProperty('--title-size', `${size}px`);
  titleEl.style.fontSize = '';
  titleEl.style.maxHeight = saved.maxHeight;
  titleEl.style.overflow = saved.overflow;
  titleEl.style.position = saved.position;
  titleEl.style.left = saved.left;
}

function fitSurpriseTitle() {
  fitSceneTitle(document.getElementById('surprise-title'));
}

function fitBirthdayTitle() {
  fitSceneTitle(document.getElementById('birthday-title'));
}

function layoutCelebrationPosition() {
  const celebration = document.getElementById('celebration-text');
  if (!celebration || !celebration.classList.contains('visible')) return;

  celebration.style.top = '12px';
  celebration.style.maxHeight = 'none';
}

function fitBirthdayNote() {
  const note = document.getElementById('birthday-note');
  const celebration = document.getElementById('celebration-text');
  const title = document.getElementById('birthday-title');
  if (!note || !celebration || !celebration.classList.contains('visible') || !title) return;

  layoutCelebrationPosition();

  const titleWidth = title.offsetWidth;
  document.documentElement.style.setProperty('--note-width', `${titleWidth}px`);

  const noteSize = Math.max(NOTE_MIN_PX, Math.round(getTitleSizePx() * 0.4));
  document.documentElement.style.setProperty('--note-size', `${noteSize}px`);
}

function fitCelebrationText() {
  const celebration = document.getElementById('celebration-text');
  if (!celebration || !celebration.classList.contains('visible')) return;
  layoutCelebrationPosition();
  fitBirthdayNote();
}

function showCelebration() {
  const celebration = document.getElementById('celebration-text');
  if (!celebration || celebration.classList.contains('visible')) return;

  const blowHint = document.getElementById('blow-hint');
  if (blowHint) blowHint.classList.add('hidden');

  const surprise = document.getElementById('surprise-text');
  if (surprise) surprise.classList.add('hidden');

  celebration.classList.add('visible');
  celebration.setAttribute('aria-hidden', 'false');
  fitCelebrationText();
  requestAnimationFrame(() => fitCelebrationText());
  awaitingCelebrationConfettiEnd = true;
  spawnConfetti(160);
  startOverlayLoop();
}

function updateWishButtonPosition() {
  const btn = document.getElementById('wish-button');
  if (!btn || btn.hidden) return;

  const rect = canvas.getBoundingClientRect();
  btn.style.left = `${rect.left + rect.width / 2}px`;
  btn.style.top = `${rect.bottom + 16}px`;
}

function showWishButton() {
  const btn = document.getElementById('wish-button');
  const celebration = document.getElementById('celebration-text');
  if (!btn || wishButtonShown || !celebration || !celebration.classList.contains('visible')) return;

  wishButtonShown = true;
  btn.hidden = false;
  updateWishButtonPosition();
  requestAnimationFrame(() => btn.classList.add('visible'));
}

function openWishNote() {
  const overlay = document.getElementById('wish-note-overlay');
  const input = document.getElementById('wish-input');
  if (!overlay || !input) return;

  overlay.hidden = false;
  input.value = '';
  requestAnimationFrame(() => input.focus());
}

function closeWishNote() {
  const overlay = document.getElementById('wish-note-overlay');
  const input = document.getElementById('wish-input');
  if (!overlay) return;

  overlay.hidden = true;
  if (input) input.value = '';
}

function initWishFlow() {
  const btn = document.getElementById('wish-button');
  const overlay = document.getElementById('wish-note-overlay');
  const submit = document.getElementById('wish-submit');
  const input = document.getElementById('wish-input');

  if (btn) {
    btn.addEventListener('click', openWishNote);
  }

  if (submit) {
    submit.addEventListener('click', closeWishNote);
  }

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeWishNote();
    });
  }

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeWishNote();
    });
  }
}

// ─── Scene layout ──────────────────────────────────────────────────────────
const canvas = document.getElementById('scene-canvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

let cakeSprite = null;
let layout = null;

function spriteReady() {
  return cakeSprite !== null;
}

function getLayoutConfig(viewportW, viewportH) {
  const narrow = viewportW < 600;
  const padSide = narrow ? 8 : 48;
  const padTop = narrow ? 16 : 28;
  const padBottom = narrow ? 20 : 36;
  const maxScale = narrow ? 4 : 6;

  const availW = viewportW - padSide * 2;
  const availH = viewportH - padTop - padBottom;

  const scaleByW = Math.floor(availW / cakeSprite.width);
  const scaleByH = Math.floor(availH / cakeSprite.height);

  let pixelScale = Math.min(scaleByW, scaleByH, maxScale);
  pixelScale = Math.max(1, pixelScale);

  if (narrow && pixelScale < 2) {
    const fitsW = cakeSprite.width * 2 + padSide * 2 <= viewportW;
    const fitsH = cakeSprite.height * 2 + padTop + padBottom <= viewportH;
    if (fitsW && fitsH) pixelScale = 2;
  }

  return { pixelScale };
}

function measureLayout() {
  if (!spriteReady()) return null;

  const { w: viewportW, h: viewportH } = getViewportSize();
  const { pixelScale } = getLayoutConfig(viewportW, viewportH);

  const w = cakeSprite.width * pixelScale;
  const h = cakeSprite.height * pixelScale;

  const item = {
    key: 'cake',
    sprite: cakeSprite,
    w,
    h,
    x: 0,
    y: 0,
  };

  return { item, sceneW: w, sceneH: h, pixelScale };
}

function scenePointFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = layout.sceneW / rect.width;
  const scaleY = layout.sceneH / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function spritePointFromScene(sceneX, sceneY) {
  const scale = layout.pixelScale;
  return {
    x: sceneX / scale,
    y: sceneY / scale,
  };
}

function hitCandle(sceneX, sceneY) {
  if (!layout || cakeInteract.blownOut) return false;
  const local = spritePointFromScene(sceneX, sceneY);
  const hit = cakeInteract.candleHit;
  const head = cakeInteract.smokeHeadroom || 0;
  return local.x >= hit.x
    && local.x < hit.x + hit.w
    && local.y >= hit.y + head
    && local.y < hit.y + head + hit.h;
}

function startCandleHold(pointerId, clientX, clientY) {
  const pt = scenePointFromClient(clientX, clientY);
  if (!hitCandle(pt.x, pt.y)) return false;

  cakeInteract.holding = true;
  cakeInteract.holdStart = performance.now();
  cakeInteract.pointerId = pointerId;
  startOverlayLoop();
  return true;
}

function endCandleHold(pointerId) {
  if (cakeInteract.pointerId !== pointerId) return;
  cakeInteract.holding = false;
  cakeInteract.pointerId = null;
  if (!cakeInteract.blownOut && cakeInteract.blowProgress < 1) {
    startOverlayLoop();
  }
}

function needsAnimationFrame() {
  if (confetti.active) return true;
  if (mainScreenActive() && (cakeNeedsAnimation() || cakeInteract.holding)) return true;
  return false;
}

function startOverlayLoop() {
  if (overlayFrame !== null) return;
  lastFrameTime = performance.now();
  overlayFrame = requestAnimationFrame(overlayTick);
}

function overlayTick(now) {
  const dt = now - lastFrameTime;
  lastFrameTime = now;

  if (mainScreenActive()) {
    updateCakeInteract(now, dt);
    cakeSprite = renderCakeDisplay();
    drawScene();
  }

  if (confetti.active) {
    updateConfetti(dt);
    drawConfetti();
  }

  if (needsAnimationFrame()) {
    overlayFrame = requestAnimationFrame(overlayTick);
  } else {
    overlayFrame = null;
  }
}

function resize() {
  if (!spriteReady() || !mainScreenActive()) return;

  ctx.imageSmoothingEnabled = false;
  layout = measureLayout();
  if (!layout) return;

  const { sceneW, sceneH } = layout;
  const { w: viewportW, h: viewportH } = getViewportSize();
  const fitScale = Math.min(viewportW / sceneW, viewportH / sceneH);
  const displayScale = Math.max(1, Math.floor(fitScale));
  const displayW = sceneW * displayScale;
  const displayH = sceneH * displayScale;

  canvas.width = displayW;
  canvas.height = displayH;
  canvas.style.width = `${displayW}px`;
  canvas.style.height = `${displayH}px`;

  ctx.setTransform(displayScale, 0, 0, displayScale, 0, 0);
  cakeInteract.displayScale = displayScale;

  const celebration = document.getElementById('celebration-text');
  if (celebration && celebration.classList.contains('visible')) {
    fitCelebrationText();
  } else {
    fitSurpriseTitle();
  }

  updateBlowHintPosition();
  updateWishButtonPosition();
  cakeSprite = renderCakeDisplay();
  drawScene();
}

function drawScene() {
  if (!layout) return;

  const { item, sceneW, sceneH } = layout;
  const sprite = renderCakeDisplay();

  ctx.clearRect(0, 0, sceneW, sceneH);
  ctx.drawImage(
    sprite,
    0, 0, sprite.width, sprite.height,
    item.x, item.y, item.w, item.h
  );
}

canvas.addEventListener('pointerdown', (e) => {
  if (!mainScreenActive() || !layout || !spriteReady()) return;
  if (startCandleHold(e.pointerId, e.clientX, e.clientY)) {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }
});

canvas.addEventListener('pointerup', (e) => {
  endCandleHold(e.pointerId);
});

canvas.addEventListener('pointercancel', (e) => {
  endCandleHold(e.pointerId);
});

canvas.addEventListener('pointerleave', (e) => {
  if (cakeInteract.pointerId === e.pointerId) endCandleHold(e.pointerId);
});

window.addEventListener('resize', resize);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resize);
  window.visualViewport.addEventListener('scroll', resize);
}

loadCakeSprite()
  .then((cake) => {
    cakeSprite = cake;
    return document.fonts.load('16px "Pixelated Display"');
  })
  .then(() => {
    initConfetti();
    initIntro();
    initWishFlow();
  })
  .catch((err) => {
    console.error(err);
  });
