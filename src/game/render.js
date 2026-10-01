import { RADIUS, WORLD_H, WORLD_W } from "./constants.js";
import { GHOST_STYLES, INK, rgba } from "./palette.js";
import { ghostFrozen, ghostPosition, moverRect } from "./sim.js";
import { chapterArt, drawObservatory, drawRibbon, drawTitleArt } from "./art.js";

const TAU = Math.PI * 2;
const SHELL = new Set(["ceil", "wall-l", "wall-r"]);
// plate badges float above the catch volume, clear of the NOW and echo tags
const BADGE_LIFT = 76;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t) => {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Smooth pseudo-noise in [-1, 1] for camera shake (sum of detuned sines, no per-frame jitter).
function wave(t, seed) {
  return (
    Math.sin(t * 13.1 + seed) * 0.5 +
    Math.sin(t * 27.7 + seed * 2.3) * 0.3 +
    Math.sin(t * 41.3 + seed * 5.1) * 0.2
  );
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// Pre-rendered radial glow sprites, drawn additively. Much cheaper than shadowBlur.
const sprites = new Map();
function glowSprite(color) {
  let sprite = sprites.get(color);
  if (sprite) return sprite;
  sprite = document.createElement("canvas");
  sprite.width = sprite.height = 128;
  const g = sprite.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, rgba(color, 1));
  grad.addColorStop(0.22, rgba(color, 0.5));
  grad.addColorStop(0.55, rgba(color, 0.12));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  sprites.set(color, sprite);
  return sprite;
}

function glow(ctx, x, y, r, color, alpha) {
  if (alpha <= 0.003 || r <= 0.5) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
}

function additive(ctx, fn) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  fn();
  ctx.restore();
}

let grain = null;
function grainPattern(ctx) {
  if (grain) return grain;
  const tile = document.createElement("canvas");
  tile.width = tile.height = 96;
  const g = tile.getContext("2d");
  const img = g.createImageData(96, 96);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(hash(i * 0.37) * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grain = ctx.createPattern(tile, "repeat");
  return grain;
}

export function fitCamera(width, height, insets) {
  const side = insets.side ?? 12;
  const availW = Math.max(1, width - side * 2);
  const availH = Math.max(1, height - insets.top - insets.bottom);
  const scale = Math.min(availW / WORLD_W, availH / WORLD_H);
  return {
    scale,
    ox: (width - WORLD_W * scale) / 2,
    oy: insets.top + (availH - WORLD_H * scale) / 2,
  };
}

export function worldToScreen(cam, x, y) {
  return { x: cam.ox + x * cam.scale, y: cam.oy + y * cam.scale };
}

/* ---------- per-level geometry caches ---------- */

const levelCache = new WeakMap();

function surfaceBelow(level, x, y) {
  let best = Infinity;
  for (const s of level.solids) {
    if (x >= s.x && x <= s.x + s.w && s.y >= y - 4 && s.y < best) best = s.y;
  }
  return best;
}

function geometry(level) {
  let geo = levelCache.get(level);
  if (geo) return geo;
  const pads = {};
  for (const plate of level.plates) {
    const below = surfaceBelow(level, plate.x + plate.w / 2, plate.y);
    pads[plate.id] = Math.min(below, plate.y + plate.h);
  }
  const wires = [];
  const busUse = new Map();
  const addWire = (plate, points, kind) => {
    const dots = [];
    let travelled = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (let d = (12 - (travelled % 12)) % 12; d <= len; d += 12) {
        const t = len ? d / len : 0;
        dots.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), d: travelled + d });
      }
      travelled += len;
    }
    wires.push({ plate: plate.id, dots, points, kind, length: travelled });
  };
  for (const plate of level.plates) {
    const px = plate.x + plate.w / 2;
    const padY = pads[plate.id];
    for (const target of plate.targets || []) {
      const door = level.doors.find((item) => item.id === target);
      if (!door) continue;
      const lane = busUse.get(door.id) || 0;
      busUse.set(door.id, lane + 1);
      const busY = clamp(padY - BADGE_LIFT - 10 - lane * 14, door.y + 24, door.y + door.h - 24);
      const edge = px < door.x ? door.x - 6 : door.x + door.w + 6;
      addWire(plate, [{ x: px, y: padY - BADGE_LIFT + 14 }, { x: px, y: busY }, { x: edge, y: busY }], "door");
    }
  }
  for (const mover of level.movers || []) {
    if (!mover.requires) continue;
    const plate = level.plates.find((item) => item.id === mover.requires);
    if (!plate) continue;
    const px = plate.x + plate.w / 2;
    const padY = pads[plate.id];
    const my = mover.y + mover.h / 2;
    const busY = Math.min(padY - BADGE_LIFT - 10, my);
    addWire(plate, [{ x: px, y: padY - BADGE_LIFT + 14 }, { x: px, y: busY }, { x: mover.x - 10, y: busY }, { x: mover.x - 10, y: my }], "mover");
  }
  geo = { pads, wires };
  levelCache.set(level, geo);
  return geo;
}

const ghostPaths = new WeakMap();
function ghostPath(ghost) {
  let entry = ghostPaths.get(ghost);
  if (entry) return entry;
  const path = new Path2D();
  const frames = ghost.frames;
  path.moveTo(frames[0].x, frames[0].y);
  for (let i = 3; i < frames.length; i += 3) path.lineTo(frames[i].x, frames[i].y);
  const end = frames[frames.length - 1];
  path.lineTo(end.x, end.y);
  entry = { path, end };
  ghostPaths.set(ghost, entry);
  return entry;
}

function groundBelow(session, x, y) {
  let best = WORLD_H + 200;
  const test = (r) => {
    if (x >= r.x && x <= r.x + r.w && r.y >= y - 2 && r.y < best) best = r.y;
  };
  for (const s of session.level.solids) test(s);
  for (const door of session.level.doors) if (!session.doors[door.id].open) test(door);
  for (const mover of session.movers) test(moverRect(mover));
  return best;
}

/* ---------- entry point ---------- */

export function drawFrame(ctx, view) {
  const { width, height, dpr, state, now, session, cam } = view;
  const reduce = state.settings.reducedMotion;
  const contrast = state.settings.highContrast;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  drawBackdrop(ctx, width, height, now, reduce);

  if (session) {
    const fx = state.fx;
    const shakeOn = !reduce && state.settings.shake;
    const trauma = fx.trauma * fx.trauma;
    const sx = shakeOn ? 16 * trauma * wave(now, 1) + fx.kickX : 0;
    const sy = shakeOn ? 16 * trauma * wave(now, 7) + fx.kickY : 0;
    const rot = shakeOn ? 0.01 * trauma * wave(now, 13) : 0;
    const w = WORLD_W * cam.scale;
    const h = WORLD_H * cam.scale;

    drawWorldFrame(ctx, cam, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cam.ox, cam.oy, w, h);
    ctx.clip();
    ctx.translate(cam.ox + w / 2 + sx, cam.oy + h / 2 + sy);
    ctx.rotate(rot);
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-WORLD_W / 2, -WORLD_H / 2);
    drawScene(ctx, session, state, now, reduce, contrast);
    ctx.restore();

    drawWorldPost(ctx, cam, w, h, state, now, reduce);
  } else if (state.mode === "title") {
    drawTitleArt(ctx, width, height, now, reduce);
  }

  drawVignette(ctx, width, height);
  drawIris(ctx, width, height, state, reduce);
}

/* ---------- screen space ---------- */

function drawBackdrop(ctx, w, h, now, reduce) {
  const g = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.hypot(w, h) * 0.62);
  g.addColorStop(0, "#172e38");
  g.addColorStop(0.5, "#0c1b25");
  g.addColorStop(1, "#050c13");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const step = 34;
  const drift = reduce ? 0 : now * 5;
  const offX = drift % step;
  const offY = (drift * 0.6) % step;
  ctx.fillStyle = "rgba(224,176,122,0.07)";
  for (let x = -step + offX; x < w + step; x += step) {
    for (let y = -step + offY; y < h + step; y += step) ctx.fillRect(x, y, 1.5, 1.5);
  }

  additive(ctx, () => {
    for (let i = 0; i < 28; i++) {
      const speed = 4 + hash(i + 3) * 10;
      const x = ((hash(i) * w + (reduce ? 0 : Math.sin(now * 0.2 + i) * 24)) % w + w) % w;
      const y = ((hash(i + 9) * h - (reduce ? 0 : now * speed)) % h + h) % h;
      const tw = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(now * (0.8 + hash(i + 5)) + i);
      glow(ctx, x, y, 6 + hash(i + 1) * 8, INK.brass, 0.05 + tw * 0.08);
    }
  });
}

function drawWorldFrame(ctx, cam, w, h) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, cam.ox - 2, cam.oy + 6, w + 4, h + 8, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(224,176,122,0.28)";
  ctx.lineWidth = 1;
  roundRect(ctx, cam.ox - 5.5, cam.oy - 5.5, w + 11, h + 11, 10);
  ctx.stroke();
  // corner ticks
  ctx.strokeStyle = "rgba(224,176,122,0.7)";
  ctx.lineWidth = 2;
  const k = 14;
  const corners = [
    [cam.ox - 6, cam.oy - 6, 1, 1],
    [cam.ox + w + 6, cam.oy - 6, -1, 1],
    [cam.ox - 6, cam.oy + h + 6, 1, -1],
    [cam.ox + w + 6, cam.oy + h + 6, -1, -1],
  ];
  ctx.beginPath();
  for (const [x, y, dx, dy] of corners) {
    ctx.moveTo(x, y + dy * k);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * k, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawWorldPost(ctx, cam, w, h, state, now, reduce) {
  const fx = state.fx;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cam.ox, cam.oy, w, h);
  ctx.clip();
  if (fx.rewind > 0) {
    const r = fx.rewind;
    ctx.fillStyle = `rgba(61,222,196,${r * (reduce ? 0.06 : 0.1)})`;
    ctx.fillRect(cam.ox, cam.oy, w, h);
    if (!reduce) {
      ctx.fillStyle = `rgba(0,0,0,${r * 0.22})`;
      const off = (now * 90) % 4;
      for (let y = cam.oy + off; y < cam.oy + h; y += 4) ctx.fillRect(cam.ox, y, w, 1.5);
      // tracking band, like a tape rewinding
      const band = cam.oy + ((now * 420) % (h + 80)) - 40;
      ctx.fillStyle = `rgba(244,239,230,${r * 0.08})`;
      ctx.fillRect(cam.ox, band, w, 18);
    }
  }
  if (fx.flash > 0) {
    ctx.fillStyle = rgba(fx.flashColor || "#ffffff", fx.flash * (reduce ? 0.12 : 0.3));
    ctx.fillRect(cam.ox, cam.oy, w, h);
  }
  ctx.globalAlpha = 0.035;
  ctx.fillStyle = grainPattern(ctx);
  ctx.translate(reduce ? 0 : Math.floor(hash(Math.floor(now * 24)) * 96), reduce ? 0 : Math.floor(hash(Math.floor(now * 24) + 1) * 96));
  ctx.fillRect(cam.ox - 96, cam.oy - 96, w + 192, h + 192);
  ctx.restore();
}

function drawVignette(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawIris(ctx, w, h, state, reduce) {
  const trans = state.trans;
  if (!trans) return;
  const t = clamp(trans.t, 0, 1);
  const open = trans.phase === "in" ? t : 1 - t;
  if (reduce) {
    ctx.fillStyle = `rgba(5,6,10,${1 - open})`;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const cx = trans.cx ?? w / 2;
  const cy = trans.cy ?? h / 2;
  const far = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
  const r = far * easeInOutCubic(open);
  ctx.save();
  ctx.fillStyle = "#05060a";
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.arc(cx, cy, Math.max(0, r), 0, TAU, true);
  ctx.fill("evenodd");
  if (r > 1 && open < 1) {
    ctx.strokeStyle = "rgba(224,176,122,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = "rgba(61,222,196,0.35)";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------- world space ---------- */

function drawScene(ctx, session, state, now, reduce, contrast) {
  const level = session.level;
  const geo = geometry(level);
  const intro = reduce ? 1 : clamp((now - (state.levelT0 ?? -9)) / 0.85, 0, 1);
  const sweep = lerp(-40, WORLD_H + 60, easeOutCubic(intro));

  drawObservatory(ctx, session, now, reduce, contrast);
  drawPlaques(ctx, level);
  drawWires(ctx, session, geo, now, reduce);
  drawRails(ctx, session);
  for (const [i, ghost] of session.ghosts.entries()) drawGhostPath(ctx, ghost, i, session);
  drawGoal(ctx, level.goal, session, state, now, reduce);

  ctx.save();
  if (intro < 1) {
    ctx.beginPath();
    ctx.rect(-50, -50, WORLD_W + 100, sweep + 50);
    ctx.clip();
  }
  for (const hazard of level.hazards || []) drawHazard(ctx, hazard, now, reduce);
  for (const solid of level.solids) drawSolid(ctx, solid, contrast, state, now, reduce);
  for (const mover of session.movers) drawMover(ctx, mover, session, now, reduce);
  for (const door of level.doors) {
    const shown = state.doorAnim[door.id] ?? (session.doors[door.id].open ? 1 : 0);
    drawDoor(ctx, door, shown, session.doors[door.id].open, contrast);
  }
  for (const plate of level.plates) {
    drawPlate(ctx, plate, session.plates[plate.id], geo.pads[plate.id], state.plateAnim[plate.id] ?? 0, session, now, reduce);
  }
  ctx.restore();

  if (intro < 1) {
    additive(ctx, () => {
      ctx.globalAlpha = 0.9 * (1 - intro);
      ctx.fillStyle = INK.teal;
      ctx.fillRect(0, sweep - 1, WORLD_W, 2);
      ctx.save();
      ctx.translate(WORLD_W / 2, sweep);
      ctx.scale(WORLD_W / 120, 0.35);
      glow(ctx, 0, 0, 60, INK.teal, 0.5 * (1 - intro));
      ctx.restore();
    });
  }

  session.ghosts.forEach((ghost, i) => drawGhost(ctx, ghost, i, session, state, now, reduce, contrast));
  drawPresent(ctx, session, state, now, reduce, contrast);
  drawParticles(ctx, state.particles);
  drawRewindPath(ctx, state);
  drawDust(ctx, now, reduce);
}

function drawPlaques(ctx, level) {
  ctx.save();
  ctx.font = "650 13px Outfit, Segoe UI, sans-serif";
  ctx.textBaseline = "alphabetic";
  for (const plaque of level.plaques || []) {
    const w = ctx.measureText(plaque.text).width;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, plaque.x - 8, plaque.y - 16, w + 16, 24, 4);
    ctx.fill();
    ctx.strokeStyle = "rgba(224,176,122,0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(224,176,122,0.8)";
    ctx.fillText(plaque.text, plaque.x, plaque.y);
  }
  ctx.restore();
}

// Indicator dots in the spirit of Portal: dim when idle, lit and flowing when powered.
function drawWires(ctx, session, geo, now, reduce) {
  for (const wire of geo.wires) {
    const on = session.plates[wire.plate]?.active;
    ctx.fillStyle = on ? "rgba(61,222,196,0.55)" : "rgba(224,176,122,0.2)";
    for (const dot of wire.dots) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, on ? 2.4 : 1.8, 0, TAU);
      ctx.fill();
    }
    if (on) {
      additive(ctx, () => {
        for (const dot of wire.dots) {
          const pulse = reduce ? 0.5 : Math.max(0, Math.sin(dot.d * 0.04 - now * 7));
          glow(ctx, dot.x, dot.y, 7 + pulse * 5, INK.teal, 0.12 + pulse * 0.35);
        }
      });
    }
  }
}

function drawRails(ctx, session) {
  ctx.save();
  for (const mover of session.movers) {
    const y = mover.y + mover.h / 2;
    const x0 = mover.axis === "x" ? mover.x + 8 : mover.x + mover.w / 2;
    const y0 = mover.axis === "x" ? y : mover.y + 8;
    const x1 = mover.axis === "x" ? mover.x + mover.distance + mover.w - 8 : x0;
    const y1 = mover.axis === "x" ? y : mover.y + mover.distance + mover.h - 8;
    ctx.strokeStyle = "rgba(224,176,122,0.18)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(224,176,122,0.35)";
    for (const [x, yy] of [[x0, y0], [x1, y1]]) {
      ctx.beginPath();
      ctx.arc(x, yy, 4, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawGhostPath(ctx, ghost, index, session) {
  if (!ghost.frames.length) return;
  const style = GHOST_STYLES[index % GHOST_STYLES.length];
  const { path, end } = ghostPath(ghost);
  ctx.save();
  ctx.strokeStyle = rgba(style.color, 0.22);
  ctx.lineWidth = 2;
  ctx.setLineDash([2, 7]);
  ctx.lineCap = "round";
  ctx.stroke(path);
  ctx.setLineDash([]);
  const frozen = ghostFrozen(ghost, session.frame);
  ctx.strokeStyle = rgba(style.color, frozen ? 0.2 : 0.55);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(end.x, end.y, RADIUS + 4, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawGoal(ctx, goal, session, state, now, reduce) {
  if (!goal) return;
  const cx = goal.x + goal.w / 2;
  const cy = goal.y + goal.h / 2;
  const floorY = goal.y + goal.h;
  const pulse = reduce ? 0.5 : Math.sin(now * 2.2) * 0.5 + 0.5;
  const wt = session.won ? clamp((now - state.winT0) / 0.9, 0, 1) : 0;
  const spin = reduce ? 0 : now;

  // A physical aperture housing anchors the vortex to the chamber floor.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "#091820";
  ctx.lineWidth = 13;
  ctx.beginPath(); ctx.arc(0, 0, 74, 0, TAU); ctx.stroke();
  ctx.strokeStyle = rgba(INK.brass, 0.55);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = rgba(INK.brass, 0.25);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, 81, 0, TAU); ctx.stroke();
  for (let i = 0; i < 8; i++) {
    ctx.save(); ctx.rotate(i * TAU / 8);
    ctx.fillStyle = "#314e55";
    ctx.fillRect(-5, -79, 10, 10);
    ctx.fillStyle = INK.teal;
    ctx.fillRect(-2, -77, 4, 3);
    ctx.restore();
  }
  ctx.restore();

  additive(ctx, () => {
    ctx.save();
    ctx.translate(cx, floorY);
    ctx.scale(1, 0.16);
    glow(ctx, 0, 0, 150, INK.teal, 0.4 + pulse * 0.1);
    ctx.restore();
    glow(ctx, cx, cy, 120 + pulse * 12 + wt * 260, INK.teal, 0.26 + wt * 0.5);
    glow(ctx, cx, cy, 70, INK.brass, 0.14 + pulse * 0.06);
  });

  // event horizon
  const disc = ctx.createRadialGradient(cx, cy, 2, cx, cy, 34);
  disc.addColorStop(0, "#020306");
  disc.addColorStop(0.7, "rgba(6,20,24,0.95)");
  disc.addColorStop(1, rgba(INK.teal, 0.55));
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, 34 + wt * 10, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 7; i++) {
    const phase = (spin * 0.22 + i / 7) % 1;
    ctx.save();
    ctx.rotate(spin * 0.32 + i * 0.6);
    ctx.strokeStyle = rgba(INK.teal, (1 - phase) * 0.35);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 5 + phase * 29, 3 + phase * 23, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = "round";
  const rings = [
    { r: 42, dash: [18, 10], speed: 0.9, color: INK.teal, w: 3 },
    { r: 54, dash: [4, 9], speed: -0.6, color: INK.brass, w: 2.5 },
    { r: 66, dash: [30, 22], speed: 0.35, color: rgba(INK.brass, 0.55), w: 1.5 },
  ];
  for (const ring of rings) {
    ctx.save();
    ctx.rotate(spin * ring.speed);
    ctx.setLineDash(ring.dash);
    ctx.strokeStyle = session.won ? INK.bone : ring.color;
    ctx.lineWidth = ring.w;
    ctx.beginPath();
    ctx.arc(0, 0, ring.r + wt * 20, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  ctx.setLineDash([]);
  ctx.restore();

  additive(ctx, () => {
    for (let i = 0; i < 20; i++) {
      const k = (spin * 0.3 + i / 20) % 1;
      const r = 80 * (1 - k);
      const a = i * 2.4 + spin * 1.6 + k * 5;
      const fade = k < 0.15 ? k / 0.15 : 1 - k;
      glow(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 5, i % 3 ? INK.teal : INK.brass, 0.7 * fade);
    }
  });

  // corner brackets mark the aperture's catch volume
  ctx.strokeStyle = rgba(INK.teal, 0.35 + pulse * 0.2);
  ctx.lineWidth = 2;
  const k = 14;
  ctx.beginPath();
  for (const [x, y, dx, dy] of [
    [goal.x, goal.y, 1, 1],
    [goal.x + goal.w, goal.y, -1, 1],
    [goal.x, floorY, 1, -1],
    [goal.x + goal.w, floorY, -1, -1],
  ]) {
    ctx.moveTo(x, y + dy * k);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * k, y);
  }
  ctx.stroke();
}

function drawHazard(ctx, hazard, now, reduce) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(hazard.x, hazard.y - 40, hazard.w, hazard.h + 40);
  ctx.clip();
  ctx.fillStyle = "#1e0a11";
  ctx.fillRect(hazard.x, hazard.y + hazard.h * 0.55, hazard.w, hazard.h);
  const grad = ctx.createLinearGradient(0, hazard.y, 0, hazard.y + hazard.h);
  grad.addColorStop(0, "#ff8a9a");
  grad.addColorStop(0.35, "#e0405a");
  grad.addColorStop(1, "#4a1320");
  ctx.fillStyle = grad;
  const n = Math.max(1, Math.round(hazard.w / 18));
  const sw = hazard.w / n;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = hazard.x + i * sw;
    ctx.moveTo(x, hazard.y + hazard.h);
    ctx.lineTo(x + sw / 2, hazard.y + 2);
    ctx.lineTo(x + sw, hazard.y + hazard.h);
  }
  ctx.fill();
  additive(ctx, () => {
    const beat = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(now * 3);
    for (let x = hazard.x + 20; x < hazard.x + hazard.w; x += 40) glow(ctx, x, hazard.y + 6, 34, INK.danger, 0.1 + beat * 0.08);
    if (!reduce) {
      for (let i = 0; i < Math.ceil(hazard.w / 50); i++) {
        const k = (now * 0.5 + hash(i + hazard.x)) % 1;
        const x = hazard.x + hash(i * 3 + hazard.x) * hazard.w + Math.sin(now * 2 + i) * 6;
        glow(ctx, x, hazard.y - k * 36, 4, "#ff9a6a", 0.6 * (1 - k));
      }
    }
  });
  ctx.restore();
}

function drawSolid(ctx, solid, contrast, state, now, reduce) {
  const { x, y, w, h } = solid;
  if (solid.grate) return drawGrate(ctx, solid, now, reduce);
  if (solid.surface === "spring") return drawSpring(ctx, solid, state.springAnim[solid.id] ?? 0, now, reduce);
  const ice = solid.surface === "ice";
  const shell = SHELL.has(solid.id);

  const body = ctx.createLinearGradient(0, y, 0, y + Math.min(h, 160));
  if (ice) {
    body.addColorStop(0, "#2d4d66");
    body.addColorStop(1, "#142230");
  } else if (shell) {
    body.addColorStop(0, "#121620");
    body.addColorStop(1, "#0c0f16");
  } else {
    body.addColorStop(0, "#3b535b");
    body.addColorStop(0.15, "#263d47");
    body.addColorStop(1, "#101e29");
  }
  ctx.fillStyle = body;
  ctx.fillRect(x, y, w, h);

  // seams
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let sx = x + 64; sx < x + w - 8; sx += 64) {
    ctx.moveTo(sx + 0.5, y + 8);
    ctx.lineTo(sx + 0.5, y + h);
  }
  ctx.stroke();

  if (shell) {
    ctx.fillStyle = "rgba(224,176,122,0.18)";
    if (solid.id === "ceil") ctx.fillRect(x, y + h - 2, w, 2);
    else if (solid.id === "wall-l") ctx.fillRect(x + w - 2, y, 2, h);
    else ctx.fillRect(x, y, 2, h);
    return;
  }

  // bevel: lit top, dark sides
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(x, y, 2, h);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(x + w - 2, y, 2, h);
  const lip = contrast ? 4 : 3;
  ctx.fillStyle = ice ? INK.ice : contrast ? INK.bone : INK.brass;
  ctx.fillRect(x, y, w, lip);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x, y + lip, w, 1);

  if (ice) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = "rgba(200,240,255,0.12)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (let sx = x - h; sx < x + w; sx += 70) {
      ctx.moveTo(sx, y + h);
      ctx.lineTo(sx + h, y);
    }
    ctx.stroke();
    const glint = reduce ? x + w * 0.3 : x + ((now * 160) % (w + 400)) - 200;
    additive(ctx, () => {
      ctx.save();
      ctx.translate(glint, y + 2);
      ctx.scale(2.5, 0.3);
      glow(ctx, 0, 0, 30, "#dff6ff", 0.8);
      ctx.restore();
    });
    ctx.restore();
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let rx = x + 12; rx < x + w - 6; rx += 64) ctx.fillRect(rx, y + 12, 3, 3);
    // Recessed service panels and warm metal edging give platforms real thickness.
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    for (let px = x + 22; h >= 40 && px < x + w - 20; px += 128) {
      ctx.fillStyle = "rgba(3,12,19,0.5)";
      roundRect(ctx, px, y + 24, Math.min(94, x + w - px - 8), Math.min(31, h - 28), 3);
      ctx.fill();
      ctx.fillStyle = "rgba(143,211,213,0.12)";
      for (let vent = 0; vent < 5; vent++) ctx.fillRect(px + 9 + vent * 7, y + 31, 2, 14);
      ctx.fillStyle = rgba(chapterArt(state.session.level.chapter).light, 0.6);
      ctx.fillRect(px + 72, y + 34, 10, 2);
    }
    ctx.fillStyle = "rgba(224,176,122,0.12)";
    ctx.fillRect(x, y + 6, w, 5);
    ctx.restore();
  }
}

function drawGrate(ctx, solid, now, reduce) {
  const { x, y, w, h } = solid;
  ctx.fillStyle = "rgba(8,10,15,0.55)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#39414f";
  ctx.fillRect(x, y, w, 4);
  ctx.fillRect(x, y + h - 4, w, 4);
  ctx.fillStyle = "#8d98ad";
  for (let bx = x + 6; bx < x + w - 2; bx += 12) ctx.fillRect(bx, y + 4, 3, h - 8);
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(x, y, w, 1);
  // pulsing drop chevrons
  const beat = reduce ? 0.6 : 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(now * 4));
  ctx.strokeStyle = rgba(INK.brass, beat);
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    const cy = y - 22 + i * 7 + (reduce ? 0 : ((now * 10) % 7));
    ctx.moveTo(x + w / 2 - 7, cy);
    ctx.lineTo(x + w / 2, cy + 6);
    ctx.lineTo(x + w / 2 + 7, cy);
  }
  ctx.stroke();
}

function drawSpring(ctx, solid, anim, now, reduce) {
  const { x, y, w, h } = solid;
  const housing = ctx.createLinearGradient(0, y, 0, y + h);
  housing.addColorStop(0, "#5a3322");
  housing.addColorStop(1, "#24140e");
  ctx.fillStyle = housing;
  ctx.fillRect(x, y, w, h);
  const lift = Math.sin(clamp(anim, 0, 1) * Math.PI) * 16;
  // coil
  if (lift > 0.5) {
    ctx.strokeStyle = "#c9843a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    const turns = 6;
    for (let i = 0; i <= turns; i++) {
      const cy = y - lift + (lift * i) / turns;
      ctx.lineTo(i % 2 ? x + w * 0.3 : x + w * 0.7, cy);
    }
    ctx.stroke();
  }
  ctx.fillStyle = INK.copper;
  roundRect(ctx, x + 2, y - lift, w - 4, 8, 3);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(x + 6, y - lift + 1, w - 12, 1.5);
  const beat = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(now * 5);
  ctx.fillStyle = rgba(INK.spring, 0.55 + beat * 0.25 + anim * 0.4);
  const n = Math.max(1, Math.floor((w - 16) / 36));
  for (let i = 0; i < n; i++) {
    const cx = x + (w / n) * (i + 0.5);
    ctx.beginPath();
    ctx.moveTo(cx - 12, y + 30);
    ctx.lineTo(cx, y + 16);
    ctx.lineTo(cx + 12, y + 30);
    ctx.lineTo(cx, y + 24);
    ctx.closePath();
    ctx.fill();
  }
  additive(ctx, () => {
    ctx.save();
    ctx.translate(x + w / 2, y);
    ctx.scale(w / 70, 0.4);
    glow(ctx, 0, 0, 50, INK.copper, 0.25 + anim * 0.6);
    ctx.restore();
  });
}

function drawMover(ctx, mover, session, now, reduce) {
  const r = moverRect(mover);
  const powered = !mover.requires || session.plates[mover.requires]?.active;
  const color = powered ? INK.teal : INK.danger;
  additive(ctx, () => {
    if (powered) {
      glow(ctx, r.x + 18, r.y + r.h + 4, 16, INK.teal, 0.5);
      glow(ctx, r.x + r.w - 18, r.y + r.h + 4, 16, INK.teal, 0.5);
    }
  });
  const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  g.addColorStop(0, "#46516e");
  g.addColorStop(1, "#222838");
  ctx.fillStyle = g;
  roundRect(ctx, r.x, r.y, r.w, r.h, 5);
  ctx.fill();
  ctx.fillStyle = INK.brass;
  ctx.fillRect(r.x + 4, r.y, r.w - 8, 3);
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let sx = r.x + 14; sx < r.x + r.w - 8; sx += 14) {
    ctx.moveTo(sx, r.y + 8);
    ctx.lineTo(sx + 6, r.y + r.h - 4);
  }
  ctx.stroke();
  const blink = reduce || !powered ? 1 : 0.55 + 0.45 * Math.sin(now * 6);
  ctx.fillStyle = color;
  for (const lx of [r.x + 6, r.x + r.w - 10]) ctx.fillRect(lx, r.y + r.h / 2 - 2, 4, 4);
  additive(ctx, () => {
    glow(ctx, r.x + 8, r.y + r.h / 2, 12, color, 0.6 * blink);
    glow(ctx, r.x + r.w - 8, r.y + r.h / 2, 12, color, 0.6 * blink);
  });
}

function drawDoor(ctx, door, open, logicalOpen, contrast) {
  const closedH = door.h * (1 - clamp(open, 0, 1));
  // guide rails
  ctx.fillStyle = "#0e1118";
  ctx.fillRect(door.x - 5, door.y, 4, door.h);
  ctx.fillRect(door.x + door.w + 1, door.y, 4, door.h);
  ctx.fillStyle = "rgba(224,176,122,0.18)";
  ctx.fillRect(door.x - 5, door.y, 1, door.h);
  ctx.fillRect(door.x + door.w + 4, door.y, 1, door.h);

  if (closedH > 0.5) {
    const g = ctx.createLinearGradient(door.x, 0, door.x + door.w, 0);
    if (contrast) {
      g.addColorStop(0, "#c9ccd6");
      g.addColorStop(1, "#f4efe6");
    } else {
      g.addColorStop(0, "#5a6379");
      g.addColorStop(0.45, "#99a2b8");
      g.addColorStop(1, "#4e566a");
    }
    ctx.fillStyle = g;
    ctx.fillRect(door.x, door.y, door.w, closedH);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    for (let sy = door.y + closedH - 30; sy > door.y; sy -= 26) ctx.fillRect(door.x, sy, door.w, 2);
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    for (let sy = door.y + closedH - 28; sy > door.y; sy -= 26) ctx.fillRect(door.x, sy, door.w, 1);

    // hazard stripe on the leading edge
    const stripeY = door.y + closedH - 16;
    if (stripeY > door.y) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(door.x, stripeY, door.w, 13);
      ctx.clip();
      ctx.fillStyle = "#1a1712";
      ctx.fillRect(door.x, stripeY, door.w, 13);
      ctx.fillStyle = INK.spring;
      ctx.beginPath();
      for (let sx = door.x - 20; sx < door.x + door.w + 20; sx += 14) {
        ctx.moveTo(sx, stripeY + 13);
        ctx.lineTo(sx + 7, stripeY + 13);
        ctx.lineTo(sx + 20, stripeY);
        ctx.lineTo(sx + 13, stripeY);
      }
      ctx.fill();
      ctx.restore();
    }
    const edge = logicalOpen ? INK.teal : INK.danger;
    ctx.fillStyle = edge;
    ctx.fillRect(door.x, door.y + closedH - 3, door.w, 3);
    additive(ctx, () => {
      ctx.save();
      ctx.translate(door.x + door.w / 2, door.y + closedH);
      ctx.scale(1.2, 0.5);
      glow(ctx, 0, 0, 34, edge, 0.55);
      ctx.restore();
    });
  }
  // housing lip at the ceiling
  ctx.fillStyle = "#2a3040";
  roundRect(ctx, door.x - 10, door.y - 2, door.w + 20, 12, 3);
  ctx.fill();
  ctx.fillStyle = logicalOpen ? INK.teal : INK.danger;
  ctx.fillRect(door.x + door.w / 2 - 6, door.y + 3, 12, 3);
}

function plateIcon(ctx, plate, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  if (plate.who === "ghost") {
    ctx.arc(0, 0, 5.5, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(0, 0, 8.5, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (plate.who === "present") {
    ctx.arc(0, 0, 5, 0, TAU);
    ctx.fill();
  } else if (plate.mode === "pulse") {
    ctx.moveTo(-6, 1);
    ctx.lineTo(-2, 1);
    ctx.lineTo(0, -5);
    ctx.lineTo(2, 5);
    ctx.lineTo(4, 1);
    ctx.lineTo(6, 1);
    ctx.stroke();
  } else if (plate.mode === "delay") {
    ctx.moveTo(-5, -6);
    ctx.lineTo(5, -6);
    ctx.lineTo(-5, 6);
    ctx.lineTo(5, 6);
    ctx.closePath();
    ctx.stroke();
  } else {
    ctx.moveTo(0, -6);
    ctx.lineTo(6, 0);
    ctx.lineTo(0, 6);
    ctx.lineTo(-6, 0);
    ctx.closePath();
    ctx.stroke();
  }
}

function drawPlate(ctx, plate, rt, padY, anim, session, now, reduce) {
  const color = rt.rejected ? INK.danger : rt.active ? INK.teal : rt.occupied ? INK.spring : INK.brass;
  const top = plate.y;
  const fieldH = padY - top;

  // trigger field, so the catch volume reads without a solid box
  const field = ctx.createLinearGradient(0, top, 0, padY);
  field.addColorStop(0, rgba(color, 0));
  field.addColorStop(1, rgba(color, rt.active ? 0.24 : 0.09));
  ctx.fillStyle = field;
  ctx.fillRect(plate.x, top, plate.w, fieldH);
  ctx.fillStyle = rgba(color, rt.active ? 0.4 : 0.16);
  ctx.fillRect(plate.x, top + fieldH * 0.35, 1, fieldH * 0.65);
  ctx.fillRect(plate.x + plate.w - 1, top + fieldH * 0.35, 1, fieldH * 0.65);

  // housing and pad
  ctx.fillStyle = "#0d1017";
  roundRect(ctx, plate.x - 4, padY - 8, plate.w + 8, 10, 3);
  ctx.fill();
  const press = anim * 5;
  const pad = ctx.createLinearGradient(0, padY - 13 + press, 0, padY - 5 + press);
  pad.addColorStop(0, color);
  pad.addColorStop(1, rgba(color, 0.55));
  ctx.fillStyle = pad;
  roundRect(ctx, plate.x + 2, padY - 13 + press, plate.w - 4, 8, 3);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillRect(plate.x + 8, padY - 12 + press, plate.w - 16, 1);

  if (rt.active || rt.rejected) {
    additive(ctx, () => {
      ctx.save();
      ctx.translate(plate.x + plate.w / 2, padY - 9);
      ctx.scale(plate.w / 90, 0.35);
      glow(ctx, 0, 0, 60, color, 0.7);
      ctx.restore();
    });
  }

  // floating badge
  const bob = reduce ? 0 : Math.sin(now * 2 + plate.x) * 2;
  const bx = plate.x + plate.w / 2;
  const by = padY - BADGE_LIFT + bob;
  ctx.strokeStyle = rgba(color, 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx, by + 12);
  ctx.lineTo(bx, Math.max(by + 12, top));
  ctx.stroke();
  ctx.fillStyle = "rgba(9,11,16,0.85)";
  ctx.beginPath();
  ctx.arc(bx, by, 12, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(color, 0.9);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // timers for brief and delayed plates
  const time = session.time;
  let frac = 0;
  let arcColor = color;
  if (plate.mode === "pulse" && rt.until > time) frac = (rt.until - time) / (plate.duration ?? 1.6);
  else if (plate.mode === "delay") {
    if (rt.pending && rt.until < 0) {
      frac = 1 - (rt.arm - time) / (plate.delay ?? 1.5);
      arcColor = INK.spring;
    } else if (rt.until > time) frac = (rt.until - time) / (plate.duration ?? 2);
  }
  if (frac > 0) {
    ctx.strokeStyle = arcColor;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(bx, by, 16, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(frac, 0, 1));
    ctx.stroke();
    ctx.lineCap = "butt";
  }
  ctx.save();
  ctx.translate(bx, by);
  plateIcon(ctx, plate, rt.rejected ? INK.danger : INK.bone);
  ctx.restore();
}

/* ---------- actors ---------- */

function drawTag(ctx, x, y, text, color, alpha = 1, caret = false) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = "700 11px Outfit, Segoe UI, sans-serif";
  const w = Math.max(28, ctx.measureText(text).width + 14);
  ctx.fillStyle = "rgba(9,11,16,0.85)";
  roundRect(ctx, x - w / 2, y - 9, w, 18, 9);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  if (caret) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 4, y + 11);
    ctx.lineTo(x + 4, y + 11);
    ctx.lineTo(x, y + 16);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

function drawPattern(ctx, pattern, r, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (pattern === "ring") {
    ctx.arc(0, 0, r * 0.48, 0, TAU);
    ctx.stroke();
  } else if (pattern === "bars") {
    for (let y = -r + 3; y <= r; y += 6) {
      ctx.moveTo(-r, y);
      ctx.lineTo(r, y);
    }
    ctx.stroke();
  } else if (pattern === "dots") {
    for (const [x, y] of [[-5, -4], [5, -2], [0, 5], [-6, 4], [6, 5], [0, -7]]) {
      ctx.moveTo(x + 1.8, y);
      ctx.arc(x, y, 1.8, 0, TAU);
    }
    ctx.fill();
  } else if (pattern === "cross") {
    ctx.moveTo(-r * 0.45, 0);
    ctx.lineTo(r * 0.45, 0);
    ctx.moveTo(0, -r * 0.45);
    ctx.lineTo(0, r * 0.45);
    ctx.stroke();
  } else {
    ctx.moveTo(-r * 0.4, -2);
    ctx.lineTo(0, r * 0.35);
    ctx.lineTo(r * 0.4, -2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawShadow(ctx, session, x, y, alpha) {
  const gy = groundBelow(session, x, y + RADIUS - 2);
  const lift = gy - (y + RADIUS);
  if (lift > 260 || lift < -4) return;
  const s = 1 - Math.max(0, lift) / 260;
  ctx.fillStyle = `rgba(0,0,0,${0.42 * s * alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, gy + 1, RADIUS * (0.45 + 0.6 * s), 3 + 2 * s, 0, 0, TAU);
  ctx.fill();
}

function stretchFor(vx, vy) {
  const speed = Math.hypot(vx, vy);
  const k = clamp(speed / 2400, 0, 0.2);
  return { k, angle: Math.atan2(vy, vx) };
}

function drawGhost(ctx, ghost, index, session, state, now, reduce, contrast) {
  const style = GHOST_STYLES[index % GHOST_STYLES.length];
  const frame = Math.min(session.frame, ghost.frames.length - 1);
  const current = ghost.frames[frame] || ghostPosition(ghost, session.frame);
  const prev = ghost.frames[Math.max(0, frame - 1)];
  const frozen = ghostFrozen(ghost, session.frame);
  const mix = frozen ? 1 : state.renderAlpha;
  const pos = { x: lerp(prev.x, current.x, mix), y: lerp(prev.y, current.y, mix) };
  const flicker = reduce ? 1 : 0.88 + 0.12 * wave(now * 0.6, index * 3.1);
  const trail = state.trails[index] || [];

  drawShadow(ctx, session, pos.x, pos.y, 0.6);
  if (!reduce) drawRibbon(ctx, trail, style.color, 12, frozen ? 0.3 : 0.7);

  additive(ctx, () => {
    for (let i = 0; i < trail.length; i++) {
      const k = (i + 1) / trail.length;
      glow(ctx, trail[i].x, trail[i].y, RADIUS * (0.6 + 0.8 * k), style.color, 0.07 * k);
    }
    glow(ctx, pos.x, pos.y, RADIUS * 3, style.color, (frozen ? 0.12 : 0.3) * flicker);
  });

  const st = frozen || reduce ? { k: 0, angle: 0 } : stretchFor((current.x - prev.x) * 60, (current.y - prev.y) * 60);
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(st.angle);
  ctx.scale(1 + st.k, 1 / (1 + st.k));
  ctx.rotate(-st.angle);
  ctx.beginPath();
  ctx.arc(0, 0, RADIUS, 0, TAU);
  ctx.globalAlpha = (contrast ? 0.9 : frozen ? 0.28 : 0.42) * flicker;
  ctx.fillStyle = style.color;
  ctx.fill();
  ctx.save();
  ctx.clip();
  if (!contrast) {
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#05070b";
    const off = reduce ? 0 : (now * 24) % 4;
    for (let y = -RADIUS - 4 + off; y < RADIUS; y += 4) ctx.fillRect(-RADIUS, y, RADIUS * 2, 1.5);
  }
  ctx.globalAlpha = contrast ? 0.85 : 0.9;
  drawPattern(ctx, style.pattern, RADIUS, contrast ? "#0c0e13" : "rgba(244,239,230,0.75)");
  ctx.restore();
  ctx.globalAlpha = frozen ? 0.6 : 1;
  ctx.lineWidth = contrast ? 3 : 2;
  ctx.strokeStyle = contrast ? "#0c0e13" : style.color;
  if (frozen) ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(0, 0, RADIUS, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  drawTag(ctx, pos.x, pos.y - RADIUS - 16, frozen ? `${style.label} ‖` : style.label, style.color, frozen ? 0.6 : 0.95);
}

function drawPresent(ctx, session, state, now, reduce, contrast) {
  const ball = session.ball;
  const fx = state.ballFx;
  const prev = state.previousBall || ball;
  const mix = session.won || session.dead ? 1 : state.renderAlpha;
  let x = lerp(prev.x, ball.x, mix);
  let y = lerp(prev.y, ball.y, mix);
  let size = 1;
  let spinExtra = 0;
  const goal = session.level.goal;
  if (session.won && goal) {
    const wt = clamp((now - state.winT0) / 0.75, 0, 1);
    const gx = goal.x + goal.w / 2;
    const gy = goal.y + goal.h / 2;
    const e = easeInOutCubic(wt);
    const swirl = reduce ? 0 : (1 - e) * 26;
    x = lerp(ball.x, gx, e) + Math.cos(wt * 12) * swirl * wt;
    y = lerp(ball.y, gy, e) + Math.sin(wt * 12) * swirl * wt;
    size = 1 - easeInCubic(wt);
    spinExtra = reduce ? 0 : wt * 14;
    if (size <= 0.01) return;
  }
  const appear = reduce ? 1 : clamp((now - (state.spawnT ?? -9)) / 0.4, 0, 1);
  size *= appear < 1 ? easeOutBack(appear) : 1;
  const dead = session.dead;
  const alpha = dead ? 0.22 : 1;
  const showTag = session.level.maxGhosts > 0 && !session.won;

  if (!session.won) drawShadow(ctx, session, x, y, alpha);

  const echoing = session.level.maxGhosts > 0;
  const left = echoing ? session.level.echoSeconds - session.frame / 60 : 99;
  const danger = !dead && !session.won && left < 3 ? (reduce ? 0.65 : 0.5 + 0.5 * Math.sin(now * 14)) : 0;
  if (!reduce) drawRibbon(ctx, state.nowTrail, "#ffe3b5", 10, alpha);

  additive(ctx, () => {
    const trail = state.nowTrail;
    for (let i = 0; i < trail.length; i++) {
      const k = (i + 1) / trail.length;
      glow(ctx, trail[i].x, trail[i].y, RADIUS * (0.5 + 0.7 * k), "#ffe2c0", 0.06 * k * alpha);
    }
    glow(ctx, x, y, RADIUS * 4 * size, "#ffd9b0", 0.22 * alpha);
    if (danger) glow(ctx, x, y, RADIUS * 3.4, INK.danger, 0.35 * danger);
    if (appear < 1) {
      ctx.strokeStyle = rgba(INK.bone, 1 - appear);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, RADIUS * (1 + (1 - appear) * 3), 0, TAU);
      ctx.stroke();
    }
  });

  const st = session.won || dead || reduce ? { k: 0, angle: 0 } : stretchFor(ball.vx, ball.grounded ? 0 : ball.vy);
  const sx = 1 + fx.qy - fx.qx;
  const sy = 1 - fx.qy + fx.qx;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y + RADIUS * fx.qy * size);
  ctx.rotate(st.angle);
  ctx.scale(1 + st.k, 1 / (1 + st.k));
  ctx.rotate(-st.angle);
  ctx.scale(sx * size, sy * size);

  const body = ctx.createRadialGradient(-RADIUS * 0.35, -RADIUS * 0.4, RADIUS * 0.1, 0, 0, RADIUS);
  body.addColorStop(0, "#ffffff");
  body.addColorStop(0.55, INK.ball);
  body.addColorStop(1, "#d6c9b3");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, RADIUS, 0, TAU);
  ctx.fill();

  // rolling seam
  ctx.save();
  ctx.rotate(fx.roll + spinExtra);
  ctx.strokeStyle = rgba(INK.copper, 0.85);
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, RADIUS * 0.58, -0.7, 0.7);
  ctx.stroke();
  ctx.fillStyle = rgba(INK.copper, 0.85);
  ctx.beginPath();
  ctx.arc(-RADIUS * 0.58, 0, 2.2, 0, TAU);
  ctx.fill();
  ctx.restore();

  // A small illuminated lens makes the present self recognizable at game scale.
  ctx.save();
  ctx.translate(Math.max(-4, Math.min(4, ball.vx / 85)), -1);
  ctx.fillStyle = "#31434a";
  ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 5.5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#b5ffed";
  ctx.beginPath(); ctx.ellipse(1, -1, 3, 2.5, 0, 0, TAU); ctx.fill();
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.ellipse(-RADIUS * 0.38, -RADIUS * 0.45, RADIUS * 0.22, RADIUS * 0.13, -0.6, 0, TAU);
  ctx.fill();

  const rimFlash = clamp(fx.rimFlash, 0, 1);
  ctx.strokeStyle = rimFlash > 0 ? "#ffffff" : danger ? INK.danger : INK.copper;
  ctx.lineWidth = contrast ? 4 : 3;
  ctx.beginPath();
  ctx.arc(0, 0, RADIUS, 0, TAU);
  ctx.stroke();
  if (dead) {
    ctx.strokeStyle = INK.danger;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, -10);
    ctx.lineTo(0, -1);
    ctx.lineTo(-4, 6);
    ctx.lineTo(4, 12);
    ctx.moveTo(0, -1);
    ctx.lineTo(9, -5);
    ctx.stroke();
  }
  ctx.restore();

  if (showTag && !dead) drawTag(ctx, x, y - RADIUS - 20, "NOW", INK.bone, appear, true);
}

function drawParticles(ctx, particles) {
  if (!particles.length) return;
  ctx.save();
  for (const p of particles) {
    const a = clamp(p.life, 0, 1);
    if (p.add) continue;
    ctx.globalAlpha = a * (p.alpha ?? 1);
    ctx.fillStyle = p.color;
    ctx.strokeStyle = p.color;
    if (p.kind === "shard") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.moveTo(-p.size, -p.size * 0.6);
      ctx.lineTo(p.size, 0);
      ctx.lineTo(-p.size * 0.4, p.size * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (p.kind === "ring") {
      ctx.lineWidth = 2 + 3 * a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (p.grow ? 1 + (1 - a) * p.grow : 1), 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
  additive(ctx, () => {
    for (const p of particles) {
      if (!p.add) continue;
      const a = clamp(p.life, 0, 1) * (p.alpha ?? 1);
      if (p.kind === "spark") {
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else if (p.kind === "ripple") {
        ctx.globalAlpha = a * 0.6;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1 + a * 2;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size, p.size * 0.17, 0, 0, TAU);
        ctx.stroke();
      } else if (p.kind === "ring") {
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1 + 4 * a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.stroke();
      } else {
        glow(ctx, p.x, p.y, p.size * 3, p.color, a);
      }
    }
  });
}

// On Echo, the trace just recorded rewinds back into the spawn point.
function drawRewindPath(ctx, state) {
  const fx = state.fx;
  if (!fx.rewindFrames || fx.rewind <= 0) return;
  const frames = fx.rewindFrames;
  const head = Math.floor((frames.length - 1) * easeInCubic(clamp(fx.rewind, 0, 1)));
  if (head < 1) return;
  additive(ctx, () => {
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = fx.rewindColor;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(frames[0].x, frames[0].y);
    for (let i = 2; i <= head; i += 2) ctx.lineTo(frames[i].x, frames[i].y);
    ctx.stroke();
    const p = frames[head];
    glow(ctx, p.x, p.y, 40, fx.rewindColor, 0.9);
    glow(ctx, p.x, p.y, 14, "#ffffff", 0.8);
  });
}

function drawDust(ctx, now, reduce) {
  additive(ctx, () => {
    for (let i = 0; i < 36; i++) {
      const speed = 6 + (i % 5) * 3;
      const x = hash(i + 40) * WORLD_W + (reduce ? 0 : Math.sin(now * 0.25 + i) * 30);
      const y = ((hash(i + 80) * WORLD_H - (reduce ? 0 : now * speed)) % WORLD_H + WORLD_H) % WORLD_H;
      const tw = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(now * (0.7 + hash(i)) + i * 2);
      glow(ctx, x, y, 3 + hash(i + 7) * 3, "#f4e2c8", 0.05 + tw * 0.1);
    }
  });
}
