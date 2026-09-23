import { RADIUS } from "./constants.js";
import { GHOST_STYLES } from "./palette.js";
import { ghostFrozen, ghostPosition, moverRect } from "./sim.js";

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawPattern(ctx, pattern, r) {
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = "rgba(12,14,19,0.75)";
  ctx.fillStyle = "rgba(12,14,19,0.75)";
  ctx.lineWidth = 2;
  if (pattern === "ring") {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2);
    ctx.stroke();
  } else if (pattern === "bars") {
    ctx.beginPath();
    for (let y = -r; y <= r; y += 6) {
      ctx.moveTo(-r, y);
      ctx.lineTo(r, y);
    }
    ctx.stroke();
  } else if (pattern === "dots") {
    for (const [x, y] of [[-5, -4], [5, -2], [0, 5], [-6, 4], [6, 5]]) {
      ctx.beginPath();
      ctx.arc(x, y, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (pattern === "cross") {
    ctx.beginPath();
    ctx.moveTo(-r * 0.45, 0);
    ctx.lineTo(r * 0.45, 0);
    ctx.moveTo(0, -r * 0.45);
    ctx.lineTo(0, r * 0.45);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-r * 0.4, -2);
    ctx.lineTo(0, r * 0.35);
    ctx.lineTo(r * 0.4, -2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBall(ctx, x, y, radius, style, squash) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(squash.x, squash.y);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = style.fill;
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.fill();
  if (style.stroke) {
    ctx.lineWidth = style.line || 2;
    ctx.strokeStyle = style.stroke;
    ctx.stroke();
  }
  ctx.globalAlpha = (style.alpha ?? 1) * 0.9;
  const gloss = ctx.createRadialGradient(-radius * 0.35, -radius * 0.4, 1, 0, 0, radius);
  gloss.addColorStop(0, "rgba(255,255,255,0.75)");
  gloss.addColorStop(0.4, "rgba(255,255,255,0.05)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  if (style.pattern) {
    ctx.globalAlpha = style.alpha ?? 1;
    drawPattern(ctx, style.pattern, radius);
  }
  ctx.restore();
}

function plateIcon(ctx, plate, cx, cy) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = "#1a140c";
  ctx.fillStyle = "#1a140c";
  ctx.lineWidth = 1.6;
  if (plate.who === "ghost") {
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.stroke();
  } else if (plate.who === "present") {
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (plate.mode === "pulse") {
    ctx.beginPath();
    ctx.arc(0, 0, 6, -Math.PI * 0.2, Math.PI * 1.2);
    ctx.stroke();
  } else if (plate.mode === "delay") {
    ctx.beginPath();
    ctx.moveTo(-5, -5);
    ctx.lineTo(5, -5);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.moveTo(-5, 5);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 0);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(5, 0);
    ctx.lineTo(0, 6);
    ctx.lineTo(-5, 0);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

export function drawWorld(ctx, view) {
  const { width, height, session, state, now } = view;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const scale = Math.min(width / 1280, height / 720);
  const ox = (width - 1280 * scale) / 2;
  const oy = (height - 720 * scale) / 2;
  const reduce = state.settings.reducedMotion;
  const contrast = state.settings.highContrast;
  const shake = !reduce && state.settings.shake ? state.fx.shake : 0;
  const sx = (Math.random() - 0.5) * shake;
  const sy = (Math.random() - 0.5) * shake;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#171b27");
  sky.addColorStop(1, "#090b10");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (ox + sx) * dpr, (oy + sy) * dpr);
  drawChamber(ctx, now, reduce);

  if (!session) return;

  const level = session.level;
  for (const plate of level.plates) {
    for (const target of plate.targets || []) {
      const door = level.doors.find((item) => item.id === target);
      if (!door) continue;
      const on = session.plates[plate.id].active || session.doors[door.id].open;
      ctx.strokeStyle = on ? "rgba(61,222,196,0.85)" : "rgba(224,176,122,0.28)";
      ctx.lineWidth = on ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(plate.x + plate.w / 2, plate.y + plate.h / 2);
      ctx.quadraticCurveTo((plate.x + door.x) / 2, plate.y - 50, door.x + door.w / 2, door.y + door.h / 2);
      ctx.stroke();
    }
  }

  for (const hazard of level.hazards || []) drawHazard(ctx, hazard, now, reduce);
  for (const solid of level.solids) drawSolid(ctx, solid, contrast);
  for (const mover of session.movers) drawSolid(ctx, { ...moverRect(mover), kind: "mover" }, contrast);

  for (const plate of level.plates) drawPlate(ctx, plate, session.plates[plate.id]);

  for (const door of level.doors) {
    const open = session.doors[door.id].open ? 1 : 0;
    const shown = state.doorAnim[door.id] ?? open;
    drawDoor(ctx, door, shown, contrast);
  }

  drawGoal(ctx, level.goal, now, session.won, reduce);

  for (const plaque of level.plaques || []) {
    ctx.fillStyle = "rgba(224,176,122,0.72)";
    ctx.font = "600 13px Outfit, Segoe UI, sans-serif";
    ctx.fillText(plaque.text, plaque.x, plaque.y);
  }

  session.ghosts.forEach((ghost, index) => {
    const pos = ghostPosition(ghost, session.frame);
    const style = GHOST_STYLES[index % GHOST_STYLES.length];
    const trail = state.trails[index] || [];
    ctx.strokeStyle = style.color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 3;
    ctx.beginPath();
    trail.forEach((point, i) => (i === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
    ctx.stroke();
    ctx.globalAlpha = 1;
    const frozen = ghostFrozen(ghost, session.frame);
    drawBall(ctx, pos.x, pos.y, RADIUS, {
      fill: style.color,
      alpha: contrast ? 0.92 : 0.78,
      stroke: contrast ? "#0c0e13" : "rgba(255,255,255,0.35)",
      line: contrast ? 3 : 1.5,
      pattern: style.pattern,
    }, { x: 1, y: 1 });
    drawTag(ctx, pos.x, pos.y - RADIUS - 16, style.label, style.color, frozen);
  });

  if (session.ball.alive || session.dead) {
    const ball = session.ball;
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(ball.x, ball.y + RADIUS + 6, RADIUS * 0.7, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    drawBall(ctx, ball.x, ball.y, RADIUS, {
      fill: "#f6f1e7",
      stroke: "#e08a52",
      line: contrast ? 4 : 3,
    }, { x: state.squash.x, y: state.squash.y });
    drawTag(ctx, ball.x, ball.y - RADIUS - 16, "NOW", "#f6f1e7", false);
  }

  for (const particle of state.particles) {
    ctx.globalAlpha = Math.max(0, particle.life);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (!reduce && state.fx.rewind > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(61,222,196,${state.fx.rewind * 0.18})`;
    ctx.fillRect(0, 0, 1280, 720);
    ctx.restore();
  }
}

function drawChamber(ctx, now, reduce) {
  ctx.save();
  ctx.strokeStyle = "rgba(224,176,122,0.12)";
  ctx.lineWidth = 1;
  const spin = reduce ? 0 : now * 0.15;
  ctx.translate(640, 360);
  ctx.rotate(spin);
  ctx.beginPath();
  ctx.arc(0, 0, 250, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 300, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 250, Math.sin(a) * 250);
    ctx.lineTo(Math.cos(a) * 268, Math.sin(a) * 268);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  for (let x = 0; x <= 1280; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 720);
    ctx.stroke();
  }
  for (let y = 0; y <= 720; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1280, y);
    ctx.stroke();
  }
}

function drawSolid(ctx, solid, contrast) {
  if (solid.kind === "mover") {
    ctx.fillStyle = "#3c465c";
    roundRect(ctx, solid.x, solid.y, solid.w, solid.h, 6);
    ctx.fill();
    ctx.strokeStyle = "#e0b07a";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    for (let x = solid.x + 8; x < solid.x + solid.w - 4; x += 12) {
      ctx.beginPath();
      ctx.moveTo(x, solid.y + 4);
      ctx.lineTo(x + 6, solid.y + solid.h - 4);
      ctx.stroke();
    }
    return;
  }
  const ice = solid.surface === "ice";
  const spring = solid.surface === "spring";
  const grate = solid.grate;
  ctx.fillStyle = grate ? "#121722" : ice ? "#243246" : spring ? "#5c3424" : "#232838";
  ctx.fillRect(solid.x, solid.y, solid.w, solid.h);
  ctx.fillStyle = grate ? "#8d98ad" : ice ? "#9fd7e8" : spring ? "#e08a52" : "#e0b07a";
  ctx.fillRect(solid.x, solid.y, solid.w, contrast ? 4 : 3);
  if (grate) {
    ctx.strokeStyle = "#8d98ad";
    ctx.lineWidth = 2;
    for (let x = solid.x + 8; x < solid.x + solid.w; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, solid.y + 4);
      ctx.lineTo(x, solid.y + solid.h - 3);
      ctx.stroke();
    }
  } else if (ice) {
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.moveTo(solid.x + 10, solid.y + 16);
    ctx.lineTo(solid.x + solid.w - 10, solid.y + 16);
    ctx.stroke();
  } else if (spring) {
    ctx.fillStyle = "#f0c14d";
    for (let i = 0; i < 3; i++) {
      const x = solid.x + 18 + i * 40;
      ctx.beginPath();
      ctx.moveTo(x, solid.y + 22);
      ctx.lineTo(x + 14, solid.y + 8);
      ctx.lineTo(x + 28, solid.y + 22);
      ctx.fill();
    }
  }
}

function drawPlate(ctx, plate, runtime) {
  const depressed = runtime.active || runtime.occupied;
  const y = plate.y + (depressed ? 6 : 0);
  ctx.fillStyle = runtime.rejected ? "#8a5a4a" : runtime.active ? "#3ddec4" : "#c9843a";
  roundRect(ctx, plate.x, y, plate.w, plate.h - (depressed ? 6 : 0), 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(20,12,6,0.45)";
  ctx.stroke();
  plateIcon(ctx, plate, plate.x + plate.w / 2, y + (plate.h - (depressed ? 6 : 0)) / 2);
}

function drawDoor(ctx, door, open, contrast) {
  const hidden = door.h * open;
  ctx.fillStyle = open > 0.85 ? "rgba(61,222,196,0.08)" : "#8b93a6";
  ctx.fillRect(door.x, door.y + hidden, door.w, Math.max(0, door.h - hidden));
  ctx.fillStyle = contrast ? "#f4efe6" : "#d5d8e2";
  ctx.fillRect(door.x, door.y + hidden, 4, Math.max(0, door.h - hidden));
}

function drawHazard(ctx, hazard, now, reduce) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(hazard.x, hazard.y, hazard.w, hazard.h);
  ctx.clip();
  ctx.fillStyle = "#3a1420";
  ctx.fillRect(hazard.x, hazard.y, hazard.w, hazard.h);
  ctx.fillStyle = "#ff5d73";
  const shift = reduce ? 0 : (now * 40) % 16;
  for (let x = hazard.x - 16 + shift; x < hazard.x + hazard.w; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, hazard.y + hazard.h);
    ctx.lineTo(x + 8, hazard.y + 4);
    ctx.lineTo(x + 16, hazard.y + hazard.h);
    ctx.fill();
  }
  ctx.restore();
}

function drawGoal(ctx, goal, now, won, reduce) {
  const cx = goal.x + goal.w / 2;
  const cy = goal.y + goal.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = won ? "#f6f1e7" : "#e0b07a";
  ctx.lineWidth = 3;
  const spin = reduce ? 0 : now;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.setLineDash(reduce ? [] : [5, 7]);
    ctx.lineDashOffset = -spin * (14 + i * 6);
    ctx.arc(0, 0, 16 + i * 10, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
  ctx.strokeStyle = "rgba(61,222,196,0.7)";
  ctx.lineWidth = 2;
  ctx.strokeRect(goal.x, goal.y, goal.w, goal.h);
}

function drawTag(ctx, x, y, text, color, frozen) {
  ctx.font = "700 11px Outfit, Segoe UI, sans-serif";
  const w = Math.max(28, ctx.measureText(text).width + 12);
  ctx.fillStyle = "rgba(9,11,16,0.82)";
  roundRect(ctx, x - w / 2, y - 8, w, 16, 8);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = frozen ? 2 : 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(text, x, y + 4);
  ctx.textAlign = "left";
}

export function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  return { width, height, dpr };
}
