import { rgba } from "./palette.ts";
import type { Point, Session } from "./types.ts";

type Ctx = CanvasRenderingContext2D;

const TAU = Math.PI * 2;
const palettes: [light: string, metal: string, shade: string, name: string][] = [
  ["#77e6d2", "#dcb788", "#163b43", "ARRIVAL"],
  ["#91bcff", "#e7c793", "#223755", "CALIBRATION"],
  ["#c4a0ff", "#f3b6ba", "#342a4c", "ECHO CHAMBERS"],
  ["#8bdff6", "#dcbd86", "#1c3e52", "MOMENTUM LABS"],
  ["#ed9ecf", "#b5e0ce", "#46293f", "CHORUS"],
  ["#82e4c1", "#e5ce8c", "#1b403b", "SYNCHRONY"],
  ["#ffc095", "#abe0db", "#48362e", "CONTACT"],
  ["#b5a5ff", "#efa4ce", "#302a50", "PARADOX WING"],
  ["#f2d68e", "#a3f8e5", "#494333", "THE CORE"],
];

export function chapterArt(chapter = 1): { light: string; metal: string; shade: string; name: string } {
  const [light, metal, shade, name] = palettes[(chapter - 1) % palettes.length];
  return { light, metal, shade, name };
}

const hash = (n: number) => { const v = Math.sin(n * 127.1 + 42) * 43758.5453; return v - Math.floor(v); };

function circle(ctx: Ctx, x: number, y: number, r: number, color: string, width = 1) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function halo(ctx: Ctx, x: number, y: number, radius: number, color: string, strength: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, rgba(color, strength));
  g.addColorStop(0.4, rgba(color, strength * 0.3));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

// Cached architecture: geometry is independent of animation and render resolution.
const architecture = new Map<number, HTMLCanvasElement>();
function room(chapter: number): HTMLCanvasElement {
  const cached = architecture.get(chapter);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d")!;
  const { light, metal, shade, name } = chapterArt(chapter);
  const bg = ctx.createLinearGradient(0, 0, 0, 720);
  bg.addColorStop(0, "#07131d");
  bg.addColorStop(0.5, shade);
  bg.addColorStop(1, "#09171e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1280, 720);
  halo(ctx, 680, 310, 550, light, 0.16);

  // Tall observation windows, distant towers and suspended walkways.
  for (let i = 0; i < 7; i++) {
    const x = 44 + i * 186;
    ctx.fillStyle = "#081720";
    ctx.beginPath();
    ctx.roundRect(x, 66, 158, 522, [79, 79, 4, 4]);
    ctx.fill();
    ctx.save();
    ctx.clip();
    const glass = ctx.createLinearGradient(x, 80, x + 158, 530);
    glass.addColorStop(0, rgba(light, 0.14));
    glass.addColorStop(0.55, rgba(shade, 0.3));
    glass.addColorStop(1, rgba(light, 0.035));
    ctx.fillStyle = glass;
    ctx.fillRect(x, 60, 158, 530);
    for (let j = 0; j < 5; j++) {
      const bx = x + j * 38 - 10;
      const top = 310 + hash(i * 7 + j) * 100;
      ctx.fillStyle = "#0b202a";
      ctx.fillRect(bx, top, 27, 300);
      ctx.fillStyle = rgba(light, 0.16);
      ctx.fillRect(bx + 6, top + 12, 2, 70);
      ctx.fillRect(bx + 14, top + 28, 2, 45);
    }
    ctx.strokeStyle = rgba(light, 0.13);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 440); ctx.lineTo(x + 158, 410);
    ctx.moveTo(x, 456); ctx.lineTo(x + 158, 426);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = rgba(metal, 0.18);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, 66, 158, 522, [79, 79, 4, 4]);
    ctx.stroke();
    ctx.fillStyle = rgba(metal, 0.09);
    ctx.fillRect(x + 76, 80, 5, 508);
  }

  // Architectural perspective, framing the machinery without obscuring puzzles.
  for (let i = 0; i < 4; i++) {
    const pad = i * 34;
    ctx.strokeStyle = rgba(metal, 0.06 + i * 0.018);
    ctx.lineWidth = i === 0 ? 10 : 2;
    ctx.beginPath();
    ctx.moveTo(pad, 640);
    ctx.lineTo(pad, 52 + pad * 0.38);
    ctx.lineTo(1280 - pad, 52 + pad * 0.38);
    ctx.lineTo(1280 - pad, 640);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(5,14,20,.48)";
  ctx.fillRect(28, 530, 1224, 190);
  ctx.strokeStyle = rgba(light, 0.07);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -900; x < 2300; x += 140) {
    ctx.moveTo(640 + (x - 640) * 0.16, 530);
    ctx.lineTo(x, 720);
  }
  for (const y of [540, 557, 583, 623, 682]) {
    ctx.moveTo(28, y); ctx.lineTo(1252, y);
  }
  ctx.stroke();
  ctx.font = "500 11px Outfit, sans-serif";
  ctx.letterSpacing = "3px";
  ctx.fillStyle = rgba(metal, 0.5);
  ctx.fillText(`TEMPORAL OBSERVATORY  /  ${name}`, 60, 50);
  ctx.textAlign = "right";
  ctx.fillText(`SECTOR ${String(chapter).padStart(2, "0")}   ·   ECHO ARRAY`, 1218, 50);
  architecture.set(chapter, canvas);
  return canvas;
}

export function drawObservatory(ctx: Ctx, session: Session, now: number, reduce: boolean, contrast: boolean) {
  const chapter = session.level.chapter;
  const { light, metal } = chapterArt(chapter);
  const t = reduce ? 12 : now;
  ctx.drawImage(room(chapter), 0, 0);
  ctx.save();
  ctx.globalAlpha = contrast ? 0.3 : 0.72;
  // Slow machinery gives the chamber a sense of depth; all colliders remain still.
  const px = contrast || reduce ? 0 : (session.ball.x - 640) * 0.008;
  ctx.translate(640 - px, 310);
  drawAstrolabe(ctx, 210, t * 0.16, light, metal);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 4; i++) {
    const x = 170 + i * 312;
    const sway = Math.sin(t * 0.22 + i) * 18;
    const shaft = ctx.createLinearGradient(0, 72, 0, 610);
    shaft.addColorStop(0, rgba(light, contrast ? 0.02 : 0.09));
    shaft.addColorStop(1, rgba(light, 0));
    ctx.fillStyle = shaft;
    ctx.beginPath();
    ctx.moveTo(x - 10, 73); ctx.lineTo(x + 10, 73);
    ctx.lineTo(x + 170 + sway, 620); ctx.lineTo(x + 36 + sway, 620);
    ctx.fill();
    halo(ctx, x, 74, 38, light, 0.18);
    ctx.fillStyle = rgba(light, 0.65);
    ctx.fillRect(x - 12, 72, 24, 2);
  }
  ctx.restore();
}

export function drawAstrolabe(ctx: Ctx, r: number, t: number, light: string, metal: string) {
  circle(ctx, 0, 0, r * 1.18, rgba(metal, 0.15));
  circle(ctx, 0, 0, r * 1.12, rgba(metal, 0.28), 3);
  circle(ctx, 0, 0, r * 1.09, rgba(metal, 0.12));
  ctx.save();
  ctx.rotate(t * 0.19);
  ctx.strokeStyle = rgba(metal, 0.48);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 96; i++) {
    const a = i / 96 * TAU;
    const inner = r * (i % 8 ? 1.035 : 0.99);
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * r * 1.07, Math.sin(a) * r * 1.07);
  }
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.rotate(i / 8 * TAU);
    ctx.fillStyle = rgba(metal, 0.6);
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.17); ctx.lineTo(4, -r * 1.2);
    ctx.lineTo(0, -r * 1.23); ctx.lineTo(-4, -r * 1.2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate(t * (i % 2 ? -0.18 : 0.12) + i * 1.04);
    ctx.strokeStyle = rgba(i % 2 ? metal : light, 0.3);
    ctx.lineWidth = i === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.92, r * (0.27 + i * 0.1), 0, 0, TAU);
    ctx.stroke();
    const a = t * 0.5 + i * 2;
    const x = Math.cos(a) * r * 0.92;
    const y = Math.sin(a) * r * (0.27 + i * 0.1);
    halo(ctx, x, y, 12, light, 0.65);
    ctx.fillStyle = light;
    ctx.beginPath(); ctx.arc(x, y, 2, 0, TAU); ctx.fill();
    ctx.restore();
  }
  circle(ctx, 0, 0, r * 0.32, rgba(light, 0.22));
  halo(ctx, 0, 0, r * 0.65, light, 0.08);
}

export function drawTitleArt(ctx: Ctx, w: number, h: number, now: number, reduce: boolean) {
  const compact = w <= 760;
  const t = reduce ? 9 : now;
  const cx = compact ? w * 0.78 : w * 0.74;
  const cy = compact ? h * 0.28 : h * 0.46;
  const r = compact ? Math.min(w * 0.4, 190) : Math.min(w * 0.18, h * 0.27);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = compact ? 0.27 : 1;
  halo(ctx, 0, 0, r * 2.1, "#52d9c3", 0.14);
  halo(ctx, r * 0.5, -r * 0.4, r * 1.3, "#c9a7f2", 0.1);
  drawAstrolabe(ctx, r, t, "#79e9d5", "#dcb788");
  // Three time-offset bodies follow the same orbit, leaving luminous ribbons.
  for (let i = 2; i >= 0; i--) {
    const a = t * 0.3 - i * 0.78;
    const color = ["#fff1d5", "#77e6d2", "#b5a0ed"][i];
    const orbit = (angle: number): Point => ({ x: Math.cos(angle) * r * 0.76, y: Math.sin(angle * 2) * r * 0.37 });
    ctx.lineCap = "round";
    for (let j = 24; j > 0; j--) {
      const p = orbit(a - j * 0.015), q = orbit(a - (j - 1) * 0.015);
      ctx.strokeStyle = rgba(color, (1 - j / 25) * 0.4);
      ctx.lineWidth = (i ? 2 : 3) * (1 - j / 26);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
    const p = orbit(a);
    const radius = r * (i ? 0.08 : 0.125);
    halo(ctx, p.x, p.y, radius * 4, color, 0.32);
    const body = ctx.createRadialGradient(p.x - radius * 0.4, p.y - radius * 0.5, 0, p.x, p.y, radius);
    body.addColorStop(0, i ? rgba(color, 0.6) : "#ffffff");
    body.addColorStop(0.55, i ? rgba(color, 0.17) : "#f2dfbc");
    body.addColorStop(1, i ? rgba(color, 0.04) : "#aa815a");
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, TAU); ctx.fill();
    circle(ctx, p.x, p.y, radius, rgba(color, 0.85), 1.5);
    circle(ctx, p.x, p.y, radius * 0.65, rgba(i ? color : "#8b6546", 0.5), 1);
    if (!i) {
      ctx.fillStyle = "#324c51";
      ctx.beginPath(); ctx.ellipse(p.x + radius * 0.08, p.y, radius * 0.27, radius * 0.24, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#b5ffed";
      ctx.beginPath(); ctx.arc(p.x + radius * 0.11, p.y - radius * 0.04, radius * 0.12, 0, TAU); ctx.fill();
    }
    if (!compact) {
      ctx.font = "500 10px Outfit, sans-serif";
      ctx.letterSpacing = "2px";
      ctx.textAlign = "center";
      ctx.fillStyle = rgba(color, 0.7);
      ctx.fillText(["YOU / NOW", "ECHO / 01", "ECHO / 02"][i], p.x, p.y + radius + 22);
    }
  }
  ctx.restore();
}

export function drawRibbon(ctx: Ctx, trail: Point[], color: string, width: number, alpha = 1) {
  if (trail.length < 2) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let i = 1; i < trail.length; i++) {
    const p = trail[i - 1], q = trail[i];
    if (Math.hypot(q.x - p.x, q.y - p.y) > 100) continue;
    const k = i / trail.length;
    ctx.strokeStyle = rgba(color, k * k * alpha * 0.32);
    ctx.lineWidth = width * k;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    ctx.strokeStyle = rgba(color, k * k * alpha * 0.7);
    ctx.lineWidth = Math.max(0.5, width * k * 0.2);
    ctx.stroke();
  }
  ctx.restore();
}
