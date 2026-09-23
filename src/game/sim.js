import {
  AIR_ACCEL,
  BOUNCE_KEEP,
  BOUNCE_START,
  DT,
  FRICTION,
  GRAVITY,
  GROUND_ACCEL,
  ICE_FRICTION,
  MAX_FALL,
  MAX_RUN,
  RADIUS,
  SLEEP_VX,
  STICK_VY,
  WALL_REST,
} from "./constants.js";

const SUBSTEPS = 2;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function circleHitsRect(x, y, r, rect) {
  const nx = clamp(x, rect.x, rect.x + rect.w);
  const ny = clamp(y, rect.y, rect.y + rect.h);
  const dx = x - nx;
  const dy = y - ny;
  return dx * dx + dy * dy <= r * r;
}

export function moverRect(mover) {
  const period = Math.max(2, mover.period);
  const t = ((mover.clock % period) + period) % period;
  const half = period / 2;
  const u = t <= half ? t / half : 1 - (t - half) / half;
  const along = u * mover.distance;
  return {
    id: mover.id,
    x: mover.x + (mover.axis === "x" ? along : 0),
    y: mover.y + (mover.axis === "y" ? along : 0),
    w: mover.w,
    h: mover.h,
    surface: mover.surface || "stone",
    mover: true,
  };
}

function blankPlate() {
  return {
    occupied: false,
    active: false,
    latched: false,
    until: -1,
    arm: -1,
    pending: false,
    rejected: false,
    wasOccupied: false,
  };
}

function blankDoor() {
  return { open: false, latched: false };
}

export function createSession(level) {
  return {
    level,
    frame: 0,
    time: 0,
    ball: {
      x: level.spawn.x,
      y: level.spawn.y,
      vx: 0,
      vy: 0,
      r: RADIUS,
      alive: true,
      grounded: false,
      groundId: null,
      surface: "stone",
      springLock: 0,
      dropping: false,
    },
    ghosts: [],
    recording: [{ x: level.spawn.x, y: level.spawn.y }],
    plates: Object.fromEntries(level.plates.map((p) => [p.id, blankPlate()])),
    doors: Object.fromEntries(level.doors.map((d) => [d.id, blankDoor()])),
    movers: (level.movers || []).map((m) => ({ ...m, clock: 0 })),
    won: false,
    dead: false,
    winFrame: 0,
  };
}

export function ghostPosition(ghost, frame) {
  if (!ghost.frames.length) return { x: 0, y: 0 };
  const i = Math.min(frame, ghost.frames.length - 1);
  return ghost.frames[i];
}

export function ghostFrozen(ghost, frame) {
  return frame >= ghost.frames.length - 1;
}

function resetAttempt(session) {
  const ghosts = session.ghosts;
  const next = createSession(session.level);
  next.ghosts = ghosts;
  for (const key of Object.keys(session)) delete session[key];
  Object.assign(session, next);
}

export function commitEcho(session) {
  if (session.won) return { ok: false, reason: "won" };
  if (session.ghosts.length >= session.level.maxGhosts) return { ok: false, reason: "full" };
  if (session.recording.length < 10) return { ok: false, reason: "short" };
  session.ghosts.push({
    frames: session.recording.map((f) => ({ x: f.x, y: f.y })),
  });
  resetAttempt(session);
  return { ok: true };
}

export function discardAttempt(session) {
  if (session.won) return;
  resetAttempt(session);
}

export function restartAll(session) {
  session.ghosts = [];
  resetAttempt(session);
}

export function eraseFrom(session, index) {
  session.ghosts = session.ghosts.slice(0, Math.max(0, index));
  resetAttempt(session);
}

function solidsFor(session, drop) {
  const list = [];
  for (const solid of session.level.solids) {
    if (drop && solid.grate) continue;
    list.push(solid);
  }
  for (const door of session.level.doors) {
    if (!session.doors[door.id].open) list.push({ ...door, id: door.id, surface: "door" });
  }
  for (const mover of session.movers) list.push(moverRect(mover));
  return list;
}

function overlap(ball, box) {
  const cx = clamp(ball.x, box.x, box.x + box.w);
  const cy = clamp(ball.y, box.y, box.y + box.h);
  const dx = ball.x - cx;
  const dy = ball.y - cy;
  return dx * dx + dy * dy < ball.r * ball.r - 0.05;
}

function resolveHorizontal(ball, box, events) {
  if (!overlap(ball, box)) return false;
  const prevBottom = ball.prevY + ball.r;
  const prevTop = ball.prevY - ball.r;
  if (prevBottom <= box.y + 1.5) return false;
  if (prevTop >= box.y + box.h - 1.5) return false;
  const fromLeft = ball.prevX + ball.r <= box.x + 1.25;
  const fromRight = ball.prevX - ball.r >= box.x + box.w - 1.25;
  if (!fromLeft && !fromRight) return false;
  if (fromLeft) ball.x = box.x - ball.r - 0.02;
  else ball.x = box.x + box.w + ball.r + 0.02;
  if (box.surface === "bumper") {
    const dir = fromLeft ? -1 : 1;
    ball.vx = dir * (box.bump || 760);
    events.push({ type: "bumper", speed: Math.abs(ball.vx) });
  } else {
    const impact = Math.abs(ball.vx);
    ball.vx = -ball.vx * (box.surface === "ice" ? 0.08 : WALL_REST);
    if (Math.abs(ball.vx) < 22) ball.vx = 0;
    if (impact > 80) events.push({ type: "bounce", speed: impact, axis: "x" });
  }
  return true;
}

function resolveVertical(ball, box, events) {
  if (!overlap(ball, box)) return false;
  const prevBottom = ball.prevY + ball.r;
  const prevTop = ball.prevY - ball.r;
  const landing = prevBottom <= box.y + 2.2 && ball.y >= ball.prevY;
  const ceiling = prevTop >= box.y + box.h - 2.2 && ball.y <= ball.prevY;
  if (landing) {
    const impact = Math.max(0, ball.vy);
    ball.y = box.y - ball.r;
    ball.grounded = true;
    ball.groundId = box.id || null;
    ball.surface = box.surface || "stone";
    if (box.surface === "spring" && ball.springLock <= 0) {
      ball.vy = -(box.launch || 1040);
      ball.grounded = false;
      ball.groundId = null;
      ball.springLock = 12;
      events.push({ type: "spring", speed: box.launch || 1040 });
    } else if (box.surface === "bumper") {
      ball.vy = -(box.bump || 820);
      ball.grounded = false;
      ball.groundId = null;
      events.push({ type: "bumper", speed: Math.abs(ball.vy) });
    } else if (impact > BOUNCE_START) {
      ball.vy = -impact * BOUNCE_KEEP;
      ball.grounded = false;
      ball.groundId = null;
      events.push({ type: "bounce", speed: impact, axis: "y" });
    } else {
      ball.vy = 0;
      if (impact > 40) events.push({ type: "bounce", speed: impact, axis: "y" });
    }
    return true;
  }
  if (ceiling) {
    ball.y = box.y + box.h + ball.r + 0.02;
    if (ball.vy < 0) ball.vy = 0;
    events.push({ type: "bounce", speed: 80, axis: "y" });
    return true;
  }
  return false;
}

function collideGhosts(ball, session, events) {
  if (!session.level.ghostSolid) return;
  for (let i = 0; i < session.ghosts.length; i++) {
    const g = ghostPosition(session.ghosts[i], session.frame);
    const dx = ball.x - g.x;
    const dy = ball.y - g.y;
    const min = ball.r + RADIUS;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1 || d2 > min * min) continue;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const top = g.y - RADIUS;
    const feet = ball.y + ball.r;
    const crest = feet >= top - 2 && feet - top <= ball.r * 2 + 4 && Math.abs(ball.vx) > 70;
    if (crest && ball.y >= g.y - ball.r) {
      ball.y = top - ball.r;
      ball.vy = 0;
      ball.grounded = true;
      ball.groundId = `ghost-${i}`;
      ball.surface = "ghost";
      events.push({ type: "bounce", speed: 120, axis: "y" });
      continue;
    }
    const above = ball.y < g.y - 2 && ball.vy >= -20;
    if (above) {
      ball.y = g.y - RADIUS - ball.r;
      ball.x += nx * 0.01;
      const impact = Math.max(0, ball.vy);
      if (impact > BOUNCE_START) {
        ball.vy = -impact * 0.42;
        events.push({ type: "bounce", speed: impact, axis: "y" });
      } else {
        ball.vy = 0;
        ball.grounded = true;
        ball.groundId = `ghost-${i}`;
        ball.surface = "ghost";
      }
    } else {
      const pen = min - d;
      ball.x += nx * pen;
      ball.y += ny * pen;
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        ball.vx -= 1.7 * vn * nx;
        ball.vy -= 1.7 * vn * ny;
        events.push({ type: "bounce", speed: -vn, axis: "x" });
      }
    }
  }
}

function plateOccupied(plate, session) {
  let present = false;
  let ghost = false;
  if (session.ball.alive && circleHitsRect(session.ball.x, session.ball.y, session.ball.r, plate)) {
    present = true;
  }
  for (const g of session.ghosts) {
    const p = ghostPosition(g, session.frame);
    if (circleHitsRect(p.x, p.y, RADIUS, plate)) ghost = true;
  }
  if (plate.who === "present") return { on: present, rejected: false };
  if (plate.who === "ghost") return { on: ghost, rejected: present && !ghost };
  return { on: present || ghost, rejected: false };
}

function linkedPlates(session, doorId) {
  return session.level.plates.filter((p) => (p.targets || []).includes(doorId));
}

function updatePlates(session) {
  const now = session.time;
  for (const plate of session.level.plates) {
    const rt = session.plates[plate.id];
    const { on, rejected } = plateOccupied(plate, session);
    const rose = on && !rt.wasOccupied;
    rt.wasOccupied = on;
    rt.occupied = on;
    rt.rejected = rejected;
    if (plate.mode === "hold") {
      rt.active = on;
    } else if (plate.mode === "latch") {
      if (on) rt.latched = true;
      rt.active = rt.latched;
    } else if (plate.mode === "pulse") {
      if (rose) rt.until = now + (plate.duration ?? 1.6);
      rt.active = now < rt.until;
    } else if (plate.mode === "delay") {
      if (rose && !rt.pending) {
        rt.pending = true;
        rt.arm = now + (plate.delay ?? 1.5);
      }
      if (rt.pending && now >= rt.arm && rt.until < 0) {
        rt.until = now + (plate.duration ?? 2);
      }
      rt.active = rt.until > 0 && now < rt.until;
    } else {
      rt.active = on;
    }
  }
}

function plateAllows(session, plate) {
  if (!plate.requires) return true;
  const req = session.plates[plate.requires];
  return !!req?.latched || !!req?.active;
}

function updateDoors(session, events) {
  for (const door of session.level.doors) {
    const rt = session.doors[door.id];
    const flags = linkedPlates(session, door.id).map((p) => {
      const allowed = plateAllows(session, p);
      return allowed && session.plates[p.id].active;
    });
    const any = flags.some(Boolean);
    const all = flags.length > 0 && flags.every(Boolean);
    let open = false;
    if (door.logic === "and") open = all;
    else if (door.logic === "and-latch") {
      if (all) rt.latched = true;
      open = rt.latched;
    } else open = any;
    if (open !== rt.open) {
      rt.open = open;
      events.push({ type: "door", id: door.id, open });
    }
  }
}

function updateMovers(session) {
  for (const mover of session.movers) {
    if (mover.requires && !session.plates[mover.requires]?.active) continue;
    mover.clock += 1;
  }
}

function checkEnd(session, events) {
  const ball = session.ball;
  if (!ball.alive || session.won) return;
  for (const hazard of session.level.hazards || []) {
    if (circleHitsRect(ball.x, ball.y, ball.r * 0.72, hazard)) {
      ball.alive = false;
      ball.vx = 0;
      ball.vy = 0;
      session.dead = true;
      events.push({ type: "die" });
      return;
    }
  }
  const goal = session.level.goal;
  if (goal && circleHitsRect(ball.x, ball.y, ball.r * 0.55, goal)) {
    session.won = true;
    session.winFrame = session.frame;
    ball.vx = 0;
    ball.vy = 0;
    events.push({ type: "win" });
  }
}

function integrate(session, input, sdt, events) {
  const ball = session.ball;
  if (!ball.alive) return;
  if (ball.springLock > 0) ball.springLock -= sdt / DT;
  const sensitivity = input.sensitivity ?? 1;
  const maxRun = MAX_RUN * sensitivity;
  ball.prevX = ball.x;
  ball.prevY = ball.y;
  ball.grounded = false;
  const prevGround = ball.groundId;
  const prevSurface = ball.surface;

  if (prevGround) ball.vy = STICK_VY;
  else ball.vy = Math.min(MAX_FALL, ball.vy + GRAVITY * sdt);

  const accel = prevGround ? GROUND_ACCEL : AIR_ACCEL;
  if (input.x) {
    ball.vx += input.x * accel * sdt;
    ball.vx = clamp(ball.vx, -maxRun, maxRun);
  } else if (prevGround) {
    const fr = prevSurface === "ice" ? ICE_FRICTION : prevSurface === "ghost" ? 900 : FRICTION;
    if (ball.vx > 0) ball.vx = Math.max(0, ball.vx - fr * sdt);
    else ball.vx = Math.min(0, ball.vx + fr * sdt);
  }
  if (prevGround && !input.x && Math.abs(ball.vx) < SLEEP_VX && prevSurface !== "ice") ball.vx = 0;

  ball.x += ball.vx * sdt;
  const drop = !!input.drop;
  for (const box of solidsFor(session, drop)) resolveHorizontal(ball, box, events);

  ball.prevY = ball.prevY;
  ball.y += ball.vy * sdt;
  ball.groundId = null;
  for (const box of solidsFor(session, drop)) resolveVertical(ball, box, events);
  collideGhosts(ball, session, events);
}

export function step(session, input = {}) {
  const events = [];
  if (session.won) return events;
  if (!session.ball.alive) return events;

  const carry = new Map();
  for (const mover of session.movers) {
    const before = moverRect(mover);
    carry.set(mover.id, before);
  }
  updateMovers(session);
  for (const mover of session.movers) {
    const before = carry.get(mover.id);
    const after = moverRect(mover);
    if (session.ball.groundId === mover.id) {
      session.ball.x += after.x - before.x;
      session.ball.y += after.y - before.y;
    }
  }

  if (input.drop) session.ball.dropping = true;
  const slice = DT / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) {
    integrate(session, { ...input, drop: session.ball.dropping }, slice, events);
  }
  if (session.ball.grounded && session.ball.groundId) {
    const stood = session.level.solids.find((solid) => solid.id === session.ball.groundId);
    if (!stood?.grate) session.ball.dropping = false;
  }

  updatePlates(session);
  updateDoors(session, events);
  checkEnd(session, events);

  session.frame += 1;
  session.time += DT;
  session.recording.push({ x: session.ball.x, y: session.ball.y });
  return events;
}

export function echoLimit(level) {
  return Math.round((level.echoSeconds ?? 16) * 60);
}
