import assert from "node:assert/strict";
import { levels } from "../src/game/levels.js";
import {
  commitEcho,
  createSession,
  eraseFrom,
  ghostPosition,
  moverRect,
  restartAll,
  step,
} from "../src/game/sim.js";

function plateCenter(level, id) {
  const plate = level.plates.find((item) => item.id === id);
  return plate.x + plate.w / 2;
}

function settleAt(tx) {
  return (s) => {
    const ball = s.ball;
    const dx = tx - ball.x;
    const settled = s.frame > 12 && ball.grounded && Math.abs(ball.vx) < 28 && Math.abs(ball.vy) < 140;
    if (settled && Math.abs(dx) < 52) return { echo: true };
    if (Math.abs(dx) < 44) return { x: 0 };
    if (Math.abs(ball.vx) > 200 && Math.sign(ball.vx) === Math.sign(dx)) return { x: 0 };
    return { x: dx > 0 ? 1 : -1 };
  };
}

function dropInto(level, plateId) {
  const grate = level.solids.find((solid) => solid.id === `grate-${plateId}`);
  const tx = plateCenter(level, plateId);
  return (s) => {
    const ball = s.ball;
    if (ball.y > grate.y + grate.h + 40) {
      if (ball.grounded && Math.abs(ball.vx) < 24 && Math.abs(ball.vy) < 140) return { echo: true };
      if (ball.x < tx - 8) return { x: 1 };
      if (ball.x > tx + 8) return { x: -1 };
      return { x: 0 };
    }
    const over = ball.x > grate.x + 16 && ball.x < grate.x + grate.w - 16;
    const falling = ball.y > grate.y + 1;
    if (falling || (over && ball.grounded && Math.abs(ball.vx) < 20)) return { drop: true, x: 0 };
    if (!over) return { x: ball.x < grate.x + grate.w / 2 ? 1 : -1 };
    return { x: 0 };
  };
}

function advance(s) {
  const ahead = s.level.doors
    .filter((door) => !s.doors[door.id].open && door.x + door.w > s.ball.x - 6)
    .sort((a, b) => a.x - b.x)[0];
  if (ahead && s.ball.x > ahead.x - 78) return { x: -1 };
  if (s.ball.x < s.level.goal.x + 30) return { x: 1 };
  return { x: 0 };
}

function standUntilOpen(level, plateId, doorId) {
  const tx = plateCenter(level, plateId);
  return (s) => {
    if (s.doors[doorId].open) return advance(s);
    const ball = s.ball;
    if (Math.abs(ball.x - tx) < 14 && ball.grounded && Math.abs(ball.vx) < 22) return { x: 0 };
    return { x: ball.x < tx ? 1 : -1 };
  };
}

function sprintWhenClear(s) {
  const door = s.level.doors.find((item) => !s.doors[item.id].open && item.x > s.ball.x - 10);
  if (door && s.ball.x > door.x - 84) return { x: -1 };
  return { x: 1 };
}

function slideToWall(s) {
  const ball = s.ball;
  if (ball.x < 78 && ball.grounded && Math.abs(ball.vx) < 20 && Math.abs(ball.vy) < 100) return { echo: true };
  return { x: -1 };
}

function againstDais(s) {
  const dais = s.level.solids.find((solid) => solid.id === "dais");
  const ball = s.ball;
  if (ball.x > dais.x - 40 && ball.grounded && Math.abs(ball.vx) < 18 && Math.abs(ball.vy) < 100) {
    return { echo: true };
  }
  return { x: 1 };
}

function rideTo(done) {
  return (s) => {
    if (s.dead) return { x: 0 };
    const mover = s.movers[0];
    const rect = moverRect(mover);
    const left = s.level.solids.find((solid) => solid.id === "left");
    const right = s.level.solids.find((solid) => solid.id === "right");
    const ball = s.ball;
    const waitX = Math.min(mover.x + 36, left.x + left.w - 30);
    const carried = rect.x > mover.x + 12;
    if (!s.plates.p1.active || !carried) {
      if (Math.abs(ball.x - waitX) <= 12 && ball.grounded && Math.abs(ball.vx) < 20) return { x: 0 };
      if (Math.abs(ball.x - waitX) < 40) return { x: 0 };
      return { x: ball.x < waitX ? 1 : -1 };
    }
    const docked = rect.x + rect.w > right.x + 30 && rect.x < right.x + 80;
    if (!docked) {
      const front = rect.x + rect.w - 46;
      if (ball.x < front - 6) return { x: 1 };
      if (ball.x > front + 8) return { x: -1 };
      return { x: 0 };
    }
    if (ball.x < right.x + 70) return { x: 1 };
    return done(s);
  };
}

function describe(session) {
  const ball = session.ball;
  const doors = Object.entries(session.doors)
    .map(([id, door]) => `${id}:${door.open ? "open" : "shut"}`)
    .join(" ");
  const plates = Object.entries(session.plates)
    .map(([id, plate]) => `${id}:${plate.active ? "on" : "off"}`)
    .join(" ");
  return `frame ${session.frame} ball (${ball.x.toFixed(1)}, ${ball.y.toFixed(1)}) v (${ball.vx.toFixed(1)}, ${ball.vy.toFixed(1)}) ground ${ball.groundId} alive ${ball.alive} ${doors} ${plates}`;
}

function play(level, policies, limit = 1800) {
  const session = createSession(level);
  const trace = [];
  for (let attempt = 0; attempt < policies.length; attempt++) {
    const policy = policies[attempt];
    let echoed = false;
    for (let frame = 0; frame < limit && !session.won; frame++) {
      if (frame % 20 === 0) trace.push(`a${attempt} ${describe(session)}`);
      if (session.dead) {
        const action = policy(session, frame) || {};
        if (action.echo) {
          const res = commitEcho(session);
          assert.equal(res.ok, true, `${level.id} echo rejected after death (${res.reason})`);
          echoed = true;
          break;
        }
        throw new Error(`${level.id} died\n${describe(session)}\n${trace.slice(-8).join("\n")}`);
      }
      const action = policy(session, frame) || {};
      if (action.echo) {
        const res = commitEcho(session);
        assert.equal(res.ok, true, `${level.id} echo rejected (${res.reason}) ${describe(session)}`);
        echoed = true;
        break;
      }
      step(session, { x: action.x || 0, drop: !!action.drop });
    }
    if (session.won) return session;
    if (!echoed) {
      throw new Error(`${level.id} attempt ${attempt + 1} stalled\n${describe(session)}\n${trace.slice(-12).join("\n")}`);
    }
  }
  throw new Error(`${level.id} unfinished\n${describe(session)}\n${trace.slice(-12).join("\n")}`);
}

const scripts = {
  "first-bounce": [() => ({ x: 1 })],
  "keep-the-door": [(s) => settleAt(plateCenter(s.level, "p1"))(s), advance],
  "leave-yourself": [(s) => dropInto(s.level, "p1")(s), advance],
  handoff: [(s) => dropInto(s.level, "p1")(s), (s) => dropInto(s.level, "p2")(s), advance],
  "echoes-only": [(s) => settleAt(plateCenter(s.level, "p1"))(s), advance],
  "at-once": [(s) => dropInto(s.level, "p1")(s), (s) => standUntilOpen(s.level, "pNow", "d1")(s)],
  "a-short-while": [(s) => settleAt(plateCenter(s.level, "p1"))(s), advance],
  "the-ferry": [(s) => settleAt(plateCenter(s.level, "p1"))(s), rideTo(advance)],
  "late-arrival": [(s) => settleAt(plateCenter(s.level, "p1"))(s), advance],
  "the-oath": [(s) => dropInto(s.level, "p1")(s), sprintWhenClear],
  "black-ice": [slideToWall, advance],
  "three-voices": [
    (s) => dropInto(s.level, "p1")(s),
    (s) => dropInto(s.level, "p2")(s),
    (s) => dropInto(s.level, "p3")(s),
    advance,
  ],
  duet: [(s) => dropInto(s.level, "p1")(s), (s) => dropInto(s.level, "p2")(s), advance],
  "a-place-to-stand": [againstDais, () => ({ x: 1 })],
  downstream: [
    (s) => settleAt(plateCenter(s.level, "p1"))(s),
    rideTo((s) => settleAt(plateCenter(s.level, "p2"))(s)),
    rideTo(advance),
  ],
  "the-core": [
    (s) => dropInto(s.level, "p1")(s),
    (s) => dropInto(s.level, "p2")(s),
    (s) => dropInto(s.level, "p3")(s),
    (s) => standUntilOpen(s.level, "pNow", "d3")(s),
  ],
};

function validateLevel(level) {
  const ids = new Set(level.doors.map((door) => door.id));
  for (const plate of level.plates) {
    for (const target of plate.targets || []) {
      assert.ok(ids.has(target), `${level.id} plate ${plate.id} targets missing door ${target}`);
    }
  }
  for (const mover of level.movers || []) {
    if (mover.requires) {
      assert.ok(
        level.plates.some((plate) => plate.id === mover.requires),
        `${level.id} mover requires ${mover.requires}`
      );
    }
  }
  assert.ok(level.goal, `${level.id} missing goal`);
  assert.equal(level.hints.length, 5, `${level.id} hints`);
}

function testDeterminism() {
  const level = levels.find((item) => item.id === "keep-the-door");
  const run = () => {
    const session = createSession(level);
    for (let i = 0; i < 180; i++) step(session, { x: i < 90 ? 1 : 0 });
    return session.recording.map((frame) => `${frame.x.toFixed(4)},${frame.y.toFixed(4)}`).join("|");
  };
  assert.equal(run(), run());
}

function testGhostMatchesRecording() {
  const level = levels[1];
  const session = createSession(level);
  for (let i = 0; i < 100; i++) step(session, { x: 1 });
  const recorded = session.recording.map((frame) => ({ ...frame }));
  const res = commitEcho(session);
  assert.equal(res.ok, true);
  for (let frame = 0; frame < recorded.length; frame++) {
    const ghost = ghostPosition(session.ghosts[0], frame);
    assert.equal(ghost.x, recorded[frame].x);
    assert.equal(ghost.y, recorded[frame].y);
  }
  const frozen = ghostPosition(session.ghosts[0], 9999);
  assert.equal(frozen.x, recorded[recorded.length - 1].x);
}

function testEraseKeepsEarlierGhosts() {
  const level = levels.find((item) => item.id === "handoff");
  const session = createSession(level);
  for (let i = 0; i < 40; i++) step(session, { x: 1 });
  commitEcho(session);
  for (let i = 0; i < 40; i++) step(session, { x: 1 });
  commitEcho(session);
  assert.equal(session.ghosts.length, 2);
  eraseFrom(session, 1);
  assert.equal(session.ghosts.length, 1);
  restartAll(session);
  assert.equal(session.ghosts.length, 0);
}

const failures = [];
for (const level of levels) {
  validateLevel(level);
  if (!scripts[level.id]) {
    failures.push(`${level.id}: no script`);
    continue;
  }
  try {
    const session = play(level, scripts[level.id]);
    assert.equal(session.won, true);
    console.log(`ok  ${level.id.padEnd(18)} ghosts ${session.ghosts.length}  ${session.winFrame / 60}s`);
  } catch (error) {
    failures.push(error.message);
    console.error(`FAIL ${level.id}`);
  }
}

try {
  testDeterminism();
  testGhostMatchesRecording();
  testEraseKeepsEarlierGhosts();
  console.log("ok  determinism, replay fidelity, erase");
} catch (error) {
  failures.push(error.message);
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s)\n`);
  for (const failure of failures) console.error(failure + "\n");
  process.exit(1);
}

console.log(`\n${levels.length} levels solved`);
