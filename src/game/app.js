import { chapters, levels, nextLevel } from "./levels.js";
import { GHOST_STYLES, INK } from "./palette.js";
import { RADIUS } from "./constants.js";
import { createAudio } from "./audio.js";
import { loadSave, medalFor, writeSave } from "./save.js";
import { drawFrame, easeOutCubic, fitCamera, worldToScreen } from "./render.js";
import {
  commitEcho,
  createSession,
  discardAttempt,
  echoLimit,
  eraseFrom,
  ghostPosition,
  restartAll,
  step,
} from "./sim.js";

const DT = 1 / 60;
const TAU = Math.PI * 2;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

const ICON = {
  echo: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="12" r="5.5"/><circle cx="15.5" cy="12" r="5.5" stroke-dasharray="2.2 2.6"/></svg>`,
  retry: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>`,
  restart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14"/><path d="M19 5 9 12l10 7z"/></svg>`,
  erase: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6H9l-5 6 5 6h11z"/><path d="m12.5 9.5 5 5m0-5-5 5"/></svg>`,
  speed: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 6 8 6-8 6z"/><path d="m12 6 8 6-8 6z"/></svg>`,
  hint: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>`,
  drop: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12"/><path d="m6 11 6 6 6-6"/><path d="M5 20h14"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3 5 14h6l-1 7 8-11h-6z"/></svg>`,
  lean: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>`,
  map: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="17" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="19" cy="15" r="2"/><path d="m6.2 15.4 4.6-6.8M13.4 8.4l4.3 5.2"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l12-7z"/></svg>`,
};

export function createApp({ canvas, overlay, live }) {
  const save = loadSave();
  const audio = createAudio();
  const keys = { left: false, right: false, down: false };
  const pointers = new Map();
  let touchDrop = false;
  const state = {
    mode: "title",
    settings: save.settings,
    levelIndex: 0,
    session: null,
    speed: 1,
    hintOpen: false,
    message: "",
    messageT: 0,
    fx: { trauma: 0, kickX: 0, kickY: 0, rewind: 0, rewindFrames: null, rewindColor: INK.teal, flash: 0, flashColor: "#ffffff" },
    ballFx: { qx: 0, qy: 0, vx: 0, vy: 0, roll: 0, rimFlash: 0 },
    trails: [],
    nowTrail: [],
    particles: [],
    doorAnim: {},
    doorVel: {},
    plateAnim: {},
    springAnim: {},
    time: 0,
    freeze: 0,
    levelT0: -9,
    spawnT: -9,
    winT0: 0,
    winReveal: 0,
    clearT0: 0,
    attempts: 0,
    result: null,
    sig: "",
    screenKey: "",
    trans: null,
    cam: null,
    insets: { top: 84, bottom: 112, side: 14 },
    measured: false,
    lastTick: 99,
    lastChips: 0,
  };
  const ctx = canvas.getContext("2d");
  overlay.innerHTML = `<div id="screen"></div><p class="toast" id="toast"></p><div class="intro" id="intro"></div>`;
  const screen = overlay.querySelector("#screen");
  const toastEl = overlay.querySelector("#toast");
  const introEl = overlay.querySelector("#intro");
  let shownMessage = "";
  applySettings();

  function say(text) {
    live.textContent = text;
  }

  function note(text, seconds = 2.6) {
    state.message = text;
    state.messageT = seconds;
    say(text);
  }

  function applySettings() {
    document.documentElement.style.setProperty("--ui-scale", String(state.settings.scale));
    document.body.classList.toggle("contrast", state.settings.highContrast);
    document.body.classList.toggle("reduce", state.settings.reducedMotion);
    audio.setVolume(state.settings.volume);
    state.measured = false;
    writeSave(save);
  }

  function buzz(ms) {
    if (!state.settings.haptics || state.settings.reducedMotion) return;
    navigator.vibrate?.(ms);
  }

  function level() {
    return levels[state.levelIndex];
  }

  function chapterOf(item) {
    return chapters.find((chapter) => chapter.id === item.chapter);
  }

  function progressCount() {
    return Object.keys(save.cleared).length;
  }

  function nextUnsolved() {
    const index = levels.findIndex((item) => !save.cleared[item.id]);
    return index === -1 ? 0 : index;
  }

  /* ---------- effects ---------- */

  function reduced() {
    return state.settings.reducedMotion;
  }

  function addTrauma(amount) {
    state.fx.trauma = Math.min(1, state.fx.trauma + amount);
  }

  function kick(x, y) {
    state.fx.kickX += x;
    state.fx.kickY += y;
  }

  function hitstop(seconds) {
    if (!reduced()) state.freeze = Math.max(state.freeze, seconds);
  }

  function emit(particle) {
    state.particles.push({
      life: 1, decay: 1.6, vx: 0, vy: 0, grav: 0, drag: 0, rot: 0, vr: 0,
      size: 3, kind: "dot", add: false, expand: 0, ...particle,
    });
  }

  function burst(x, y, opts) {
    const count = reduced() ? Math.min(3, opts.count) : opts.count;
    const spread = opts.spread ?? TAU;
    const dir = opts.dir ?? 0;
    for (let i = 0; i < count; i++) {
      const a = dir - spread / 2 + spread * ((i + Math.random() * 0.8) / count);
      const speed = opts.speed * (0.45 + Math.random() * 0.75);
      emit({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        size: opts.size * (0.6 + Math.random() * 0.7),
        color: Array.isArray(opts.color) ? opts.color[i % opts.color.length] : opts.color,
        kind: opts.kind || "dot",
        add: opts.add ?? false,
        decay: opts.decay ?? 1.6,
        grav: opts.grav ?? 0,
        drag: opts.drag ?? 0,
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 16,
        grow: opts.grow,
        alpha: opts.alpha,
      });
    }
  }

  function ring(x, y, color, size = 10, expand = 220, decay = 2.2, add = true) {
    emit({ x, y, kind: "ring", color, size, expand, decay, add });
  }

  function springUnder(session) {
    const ball = session.ball;
    return session.level.solids.find((solid) =>
      (solid.surface === "spring" || solid.surface === "bumper") &&
      ball.x >= solid.x - RADIUS && ball.x <= solid.x + solid.w + RADIUS &&
      Math.abs(ball.y + RADIUS - solid.y) < 60);
  }

  function react(events) {
    const session = state.session;
    const ball = session.ball;
    const fx = state.ballFx;
    let bounced = false;
    for (const event of events) {
      if (event.type === "bounce" && !bounced) {
        bounced = true;
        audio.bounce(event.speed);
        if (event.axis === "y") {
          if (event.speed > 120) fx.qy = Math.max(fx.qy, Math.min(0.34, event.speed / 1700));
          if (event.speed > 520) {
            burst(ball.x, ball.y + RADIUS, { count: 8, color: "rgba(190,180,165,0.5)", speed: 140, spread: Math.PI * 0.9, dir: -Math.PI / 2, size: 5, decay: 2.2, drag: 3, grow: 1.4 });
            kick(0, Math.min(4, event.speed / 260));
            addTrauma(Math.min(0.25, event.speed / 5000));
          }
        } else {
          fx.qx = Math.max(fx.qx, Math.min(0.28, event.speed / 1500));
          if (event.speed > 180) {
            const side = ball.vx > 0 ? -1 : 1;
            burst(ball.x - side * RADIUS, ball.y, { count: 5, color: INK.brass, speed: 220, spread: 1.4, dir: side > 0 ? Math.PI : 0, size: 2, add: true, kind: "spark", decay: 3.5 });
            kick(-side * 2, 0);
          }
        }
      } else if (event.type === "door") {
        audio.door(event.open);
        const door = session.level.doors.find((item) => item.id === event.id);
        if (door) {
          burst(door.x + door.w / 2, door.y + door.h, { count: 7, color: "rgba(170,165,155,0.5)", speed: 90, spread: Math.PI, dir: -Math.PI / 2, size: 6, decay: 1.8, drag: 2, grow: 1.2 });
          addTrauma(0.08);
        }
      } else if (event.type === "spring" || event.type === "bumper") {
        audio.spring();
        const pad = springUnder(session);
        if (pad) state.springAnim[pad.id] = 1;
        fx.qy = -0.3;
        fx.rimFlash = 1;
        burst(ball.x, ball.y + RADIUS, { count: 12, color: [INK.spring, INK.copper], speed: 380, spread: 1.1, dir: -Math.PI / 2, size: 2.5, add: true, kind: "spark", decay: 2.6, grav: 600 });
        ring(ball.x, ball.y + RADIUS, INK.copper, 8, 260, 3);
        addTrauma(0.3);
        kick(0, -4);
        hitstop(0.05);
      } else if (event.type === "die") {
        audio.die();
        buzz(30);
        burst(ball.x, ball.y, { count: 16, color: [INK.ball, INK.copper, "#d6c9b3"], speed: 380, size: 5, kind: "shard", decay: 0.9, grav: 1400, drag: 0.6 });
        ring(ball.x, ball.y, INK.danger, 14, 300, 2);
        state.fx.flash = 1;
        state.fx.flashColor = INK.danger;
        addTrauma(0.55);
        hitstop(0.09);
        say("This trace ended. Keep it as an echo, or discard it.");
      } else if (event.type === "win") {
        audio.win();
        buzz([12, 30, 18]);
        const goal = session.level.goal;
        const gx = goal.x + goal.w / 2;
        const gy = goal.y + goal.h / 2;
        state.winT0 = state.time;
        state.winReveal = state.time + 1.15;
        state.fx.flash = 0.8;
        state.fx.flashColor = "#ffffff";
        addTrauma(0.35);
        hitstop(0.06);
        ring(gx, gy, INK.bone, 30, 520, 1.4);
        ring(gx, gy, INK.teal, 20, 340, 1.1);
        burst(gx, gy, { count: 28, color: [INK.teal, INK.brass, INK.bone], speed: 420, size: 3, add: true, decay: 1.1, drag: 1.4 });
      }
    }
    for (const plate of session.level.plates) {
      const runtime = session.plates[plate.id];
      if (runtime.active && !runtime.heard) {
        runtime.heard = true;
        audio.plate();
        ring(plate.x + plate.w / 2, plate.y + plate.h - 10, INK.teal, 12, 160, 2.6);
      }
      if (!runtime.active) runtime.heard = false;
    }
  }

  /* ---------- flow ---------- */

  function screenPoint(x, y) {
    if (!state.cam) return { x: undefined, y: undefined };
    return worldToScreen(state.cam, x, y);
  }

  function transition(fn, from) {
    if (state.trans) return;
    const at = from || {};
    state.trans = { phase: "out", t: 0, cx: at.x, cy: at.y, fn };
    audio.whoosh(false);
  }

  function resetFx() {
    state.trails = [];
    state.nowTrail = [];
    state.particles = [];
    state.doorAnim = {};
    state.doorVel = {};
    state.plateAnim = {};
    state.springAnim = {};
    state.ballFx = { qx: 0, qy: 0, vx: 0, vy: 0, roll: 0, rimFlash: 0 };
    state.fx.rewind = 0;
    state.fx.flash = 0;
    state.fx.trauma = 0;
  }

  function openLevel(index) {
    state.levelIndex = index;
    state.session = createSession(levels[index]);
    state.speed = 1;
    state.hintOpen = false;
    state.attempts = 0;
    state.result = null;
    state.message = "";
    state.messageT = 0;
    state.lastTick = 99;
    state.lastChips = 0;
    resetFx();
    state.levelT0 = state.time + 0.15;
    state.spawnT = state.time + 0.55;
    const item = levels[index];
    const chapter = chapterOf(item);
    if (!save.seenChapter[chapter.id]) {
      state.mode = "chapter";
      say(`${chapter.name}. ${chapter.line}`);
      return;
    }
    beginPlay();
  }

  function beginPlay() {
    const item = level();
    state.mode = "play";
    audio.setGhosts(0);
    introEl.innerHTML = `<span class="kicker">Chamber ${String(state.levelIndex + 1).padStart(2, "0")}</span><strong>${item.name}</strong><span class="intro-line">${item.objective}</span>`;
    restartAnim(introEl, "show");
    if (!save.seenCaption[item.id] && item.caption) {
      save.seenCaption[item.id] = true;
      writeSave(save);
      setTimeout(() => {
        if (state.mode === "play" && level() === item) note(item.caption, 4.5);
      }, reduced() ? 200 : 3300);
    }
    say(`${item.name}. ${item.objective}`);
  }

  function restartAnim(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function pushTrails() {
    const session = state.session;
    if (!session) return;
    session.ghosts.forEach((ghost, index) => {
      const pos = ghostPosition(ghost, session.frame);
      const trail = state.trails[index] || [];
      const last = trail[trail.length - 1];
      if (!last || Math.hypot(last.x - pos.x, last.y - pos.y) > 1.5) trail.push({ x: pos.x, y: pos.y });
      else trail.shift();
      state.trails[index] = trail.slice(-14);
    });
    const ball = session.ball;
    const last = state.nowTrail[state.nowTrail.length - 1];
    if (!last || Math.hypot(last.x - ball.x, last.y - ball.y) > 2) state.nowTrail.push({ x: ball.x, y: ball.y });
    else state.nowTrail.shift();
    if (state.nowTrail.length > 9) state.nowTrail.shift();
  }

  function respawnFx(color) {
    const spawn = level().spawn;
    state.spawnT = state.time + state.freeze;
    state.nowTrail = [];
    state.ballFx.qx = state.ballFx.qy = 0;
    ring(spawn.x, spawn.y, color, 6, 180, 2.4);
  }

  function tryEcho() {
    const session = state.session;
    const before = session.ghosts.length;
    const res = commitEcho(session);
    if (!res.ok) {
      audio.deny();
      state.ballFx.qx = 0.2;
      note(res.reason === "full" ? "No echoes left. Erase one, or restart." : "Stay a moment longer, then echo.");
      return false;
    }
    const style = GHOST_STYLES[before % GHOST_STYLES.length];
    const ghost = session.ghosts[session.ghosts.length - 1];
    state.attempts += 1;
    audio.echo();
    audio.setGhosts(session.ghosts.length);
    state.fx.rewind = 1;
    state.fx.rewindFrames = ghost.frames;
    state.fx.rewindColor = style.color;
    state.freeze = reduced() ? 0 : 0.45;
    const end = ghost.frames[ghost.frames.length - 1];
    ring(end.x, end.y, style.color, 8, 240, 2.4);
    burst(end.x, end.y, { count: 14, color: style.color, speed: 260, size: 2.5, add: true, decay: 2, drag: 2 });
    buzz(16);
    state.trails = session.ghosts.map(() => []);
    state.lastTick = 99;
    respawnFx(style.color);
    note(`Echo ${ROMAN[session.ghosts.length - 1]} is replaying your last trace.`);
    return true;
  }

  function steer() {
    let left = keys.left;
    let right = keys.right;
    const rect = canvas.getBoundingClientRect();
    for (const x of pointers.values()) {
      const p = (x - rect.left) / rect.width;
      if (p < 0.4) left = true;
      else if (p > 0.6) right = true;
    }
    if (left === right) return 0;
    return left ? -1 : 1;
  }

  function physics() {
    const session = state.session;
    if (!session || session.won || session.dead || session.expired) return;
    const limit = echoLimit(session.level);
    if (session.level.maxGhosts > 0 && session.frame >= limit) {
      session.expired = true;
      if (!tryEcho()) note("Time is up. Retry, or erase an echo.");
      return;
    }
    const beforeX = session.ball.x;
    const events = step(session, {
      x: steer(),
      drop: keys.down || touchDrop,
      sensitivity: state.settings.sensitivity,
    });
    state.ballFx.roll += (session.ball.x - beforeX) / RADIUS;
    react(events);
    pushTrails();
    if (session.level.maxGhosts > 0 && !session.won) {
      const left = Math.ceil(session.level.echoSeconds - session.frame / 60);
      if (left <= 3 && left < state.lastTick) {
        state.lastTick = left;
        if (left > 0) audio.tick(left);
      }
    }
  }

  function bank() {
    const session = state.session;
    const item = session.level;
    const seconds = Math.round((session.winFrame / 60) * 10) / 10;
    const ghosts = session.ghosts.length;
    const earned = medalFor(item, ghosts, seconds);
    const had = save.cleared[item.id];
    const prev = had || { medals: [], bestTime: 999, bestGhosts: 99 };
    save.cleared[item.id] = {
      medals: [...new Set([...(prev.medals || []), ...earned])],
      bestTime: Math.min(prev.bestTime ?? 999, seconds),
      bestGhosts: Math.min(prev.bestGhosts ?? 99, ghosts),
      time: seconds,
      ghosts,
    };
    writeSave(save);
    const best = !!had && seconds < (prev.bestTime ?? 999);
    state.result = { seconds, ghosts, earned, medals: save.cleared[item.id].medals, best, traces: state.attempts + 1 };
    state.clearT0 = state.time;
    ["clear", "lean", "swift"].forEach((medal, i) => {
      if (earned.includes(medal)) setTimeout(() => audio.medal(i), 420 + i * 320);
    });
    say(`${item.name} resolved. ${ghosts} echoes. ${seconds} seconds.`);
  }

  function act(name, arg) {
    audio.unlock();
    if (state.trans && state.trans.phase === "out") return;
    const session = state.session;
    const fromBall = session ? screenPoint(session.ball.x, session.ball.y) : null;
    if (name === "begin") transition(() => openLevel(0));
    else if (name === "continue") transition(() => openLevel(nextUnsolved()));
    else if (name === "facility") transition(() => { state.mode = "facility"; });
    else if (name === "settings") {
      state.returnMode = state.mode === "settings" ? "title" : state.mode;
      state.mode = "settings";
    } else if (name === "back") state.mode = state.returnMode || "title";
    else if (name === "play") {
      const index = Number(arg);
      const open = index === 0 || save.cleared[levels[index - 1].id];
      if (open) transition(() => openLevel(index));
      else audio.deny();
    } else if (name === "enter-chapter") {
      save.seenChapter[chapterOf(level()).id] = true;
      writeSave(save);
      beginPlay();
    } else if (name === "echo" && session && !session.won) tryEcho();
    else if (name === "retry" && session && !session.won) {
      discardAttempt(session);
      state.attempts += 1;
      state.mode = "play";
      state.lastTick = 99;
      audio.whoosh(true);
      respawnFx(INK.bone);
      note("Trace discarded. Earlier echoes remain.");
    } else if (name === "restart" && session) {
      restartAll(session);
      state.attempts += 1;
      state.trails = [];
      state.mode = "play";
      state.lastTick = 99;
      audio.setGhosts(0);
      audio.whoosh(true);
      respawnFx(INK.bone);
      note("All echoes cleared.");
    } else if (name === "erase" && session?.ghosts.length) {
      eraseFrom(session, session.ghosts.length - 1);
      state.trails = [];
      state.mode = "play";
      state.lastTick = 99;
      audio.setGhosts(session.ghosts.length);
      audio.whoosh(true);
      respawnFx(INK.bone);
      note("Removed the latest echo.");
    } else if (name === "title-home") transition(() => { state.mode = "title"; });
    else if (name === "erase-at" && session) {
      eraseFrom(session, Number(arg));
      state.trails = [];
      state.lastTick = 99;
      audio.setGhosts(session.ghosts.length);
      audio.whoosh(true);
      respawnFx(INK.bone);
      note(`Erased echo ${ROMAN[Number(arg)]} and everything after it.`);
    } else if (name === "speed") state.speed = state.speed === 3 ? 1 : state.speed + 1;
    else if (name === "hint") {
      if (state.mode === "pause") {
        state.mode = "play";
        state.hintOpen = true;
      } else state.hintOpen = !state.hintOpen;
    }
    else if (name === "hint-more") {
      const id = level().id;
      save.hints[id] = Math.min(5, (save.hints[id] || 0) + 1);
      writeSave(save);
      state.hintOpen = true;
    } else if (name === "pause") {
      state.mode = "pause";
      audio.duck(true);
    } else if (name === "resume") {
      state.mode = "play";
      audio.duck(false);
    } else if (name === "next") {
      const upcoming = nextLevel(level().id);
      const goal = level().goal;
      const at = goal ? screenPoint(goal.x + goal.w / 2, goal.y + goal.h / 2) : null;
      transition(() => {
        if (!upcoming) state.mode = "facility";
        else openLevel(levels.indexOf(upcoming));
      }, at);
    } else if (name === "replay") transition(() => openLevel(state.levelIndex), fromBall);
    else if (name === "reset") state.mode = "confirm";
    else if (name === "confirm-no") state.mode = "facility";
    else if (name === "confirm-yes") {
      save.cleared = {};
      save.seenChapter = {};
      save.seenCaption = {};
      save.hints = {};
      writeSave(save);
      state.mode = "title";
      note("The facility forgot every trace.");
    }
    if (name !== "pause" && name !== "resume" && state.mode === "play") audio.duck(false);
    state.sig = "";
  }

  overlay.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button || button.disabled) return;
    audio.click();
    act(button.dataset.act, button.dataset.arg);
    if (state.mode === "play") button.blur?.();
  });
  overlay.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-hold='drop']")) touchDrop = true;
  });
  window.addEventListener("pointerup", () => {
    touchDrop = false;
  });
  overlay.addEventListener("input", (event) => {
    const setting = event.target.dataset.setting;
    if (!setting) return;
    const value = event.target.type === "range" ? Number(event.target.value) : event.target.checked;
    state.settings[setting] = value;
    if (setting === "reducedMotion" && value) state.settings.shake = false;
    applySettings();
    if (setting === "reducedMotion") state.sig = "";
  });

  window.addEventListener("keydown", (event) => {
    if (event.repeat && ["Space", "KeyF", "KeyR", "KeyZ", "KeyH", "KeyQ", "Enter", "Backspace"].includes(event.code)) return;
    audio.unlock();
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code) && state.mode === "play") event.preventDefault();
    if (event.code === "ArrowLeft" || event.code === "KeyA") keys.left = true;
    if (event.code === "ArrowRight" || event.code === "KeyD") keys.right = true;
    if (event.code === "ArrowDown" || event.code === "KeyS") keys.down = true;
    if (state.mode === "play") {
      if (event.code === "Space" || event.code === "KeyF") act("echo");
      if (event.code === "KeyR") act("retry");
      if (event.code === "Backspace") act("restart");
      if (event.code === "KeyZ") act("erase");
      if (event.code === "KeyQ") act("speed");
      if (event.code === "KeyH") act("hint");
      if (event.code === "Escape") act("pause");
    } else if (event.code === "Escape" && state.mode === "pause") act("resume");
    else if (event.code === "Enter" && state.mode === "title" && !event.target.closest?.("button")) act(progressCount() ? "continue" : "begin");
    else if (event.code === "Enter" && state.mode === "chapter" && !event.target.closest?.("button")) act("enter-chapter");
    else if (event.code === "Enter" && state.mode === "clear" && !event.target.closest?.("button")) act("next");
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "ArrowLeft" || event.code === "KeyA") keys.left = false;
    if (event.code === "ArrowRight" || event.code === "KeyD") keys.right = false;
    if (event.code === "ArrowDown" || event.code === "KeyS") keys.down = false;
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (state.mode !== "play") return;
    pointers.set(event.pointerId, event.clientX);
    try { canvas.setPointerCapture(event.pointerId); } catch { /* synthetic pointers */ }
    audio.unlock();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, event.clientX);
  });
  canvas.addEventListener("pointerup", (event) => pointers.delete(event.pointerId));
  canvas.addEventListener("pointercancel", (event) => pointers.delete(event.pointerId));
  window.addEventListener("blur", () => {
    keys.left = keys.right = keys.down = false;
    pointers.clear();
    if (state.mode === "play") act("pause");
  });
  window.addEventListener("resize", () => {
    state.measured = false;
  });

  /* ---------- overlay ---------- */

  function html(fresh) {
    const enter = fresh ? " enter" : "";
    if (state.mode === "title") return titleHtml(enter);
    if (state.mode === "facility") return facilityHtml(enter);
    if (state.mode === "settings") return settingsHtml(enter);
    if (state.mode === "confirm") return confirmHtml(enter);
    if (state.mode === "chapter") return chapterHtml(enter);
    if (state.mode === "pause") return pauseHtml(enter);
    if (state.mode === "clear") return clearHtml(enter);
    return playHtml(enter);
  }

  function stagger(items) {
    return items.map((item, i) => item.replace(/^<(\w+)/, `<$1 style="--i:${i}"`)).join("");
  }

  function titleHtml(enter) {
    const has = progressCount() > 0;
    const pct = Math.round((progressCount() / levels.length) * 100);
    const letters = "Bounceback".split("").map((c, i) => `<span style="--i:${i}">${c}</span>`).join("");
    return `<div class="center${enter}"><div class="card title-card">
      ${stagger([
        `<p class="kicker">The Temporal Facility</p>`,
        `<h1 class="logo" aria-label="Bounceback"><span aria-hidden="true">${letters}</span></h1>`,
        `<p class="tag">Bounce through time, then cooperate with your past selves.</p>`,
        `<div class="row">
          ${has ? `<button class="primary big" data-act="continue">${ICON.play}Continue</button><button data-act="facility">${ICON.map}Facility</button>` : `<button class="primary big" data-act="begin">${ICON.play}Begin</button>`}
          <button data-act="settings">${ICON.gear}Settings</button>
        </div>`,
        `<ol class="beats">
          <li><i class="beat-ball"></i><span><b>Steer.</b> The ball bounces on its own.</span></li>
          <li><i class="beat-ball ghost"></i><span><b>Echo.</b> That run becomes a ghost that repeats you exactly.</span></li>
          <li><i class="beat-ball chorus"></i><span><b>Cooperate.</b> Leave ghosts on plates, ferries, and each other.</span></li>
        </ol>`,
        has ? `<div class="progress"><span class="bar"><span style="width:${pct}%"></span></span><span>${progressCount()} / ${levels.length} chambers</span></div>` : `<p class="press">Press <kbd>Enter</kbd> to begin</p>`,
      ])}
    </div></div>`;
  }

  function settingsHtml(enter) {
    const s = state.settings;
    return `<div class="center${enter}"><div class="card">
      ${stagger([
        `<p class="kicker">Settings</p>`,
        `<h2 class="card-title">How it feels</h2>`,
        `<div class="settings-grid">
          ${range("volume", "Volume", 0, 1, 0.01, s.volume)}
          ${range("sensitivity", "Steer sensitivity", 0.7, 1.3, 0.05, s.sensitivity)}
          ${range("scale", "Interface scale", 0.85, 1.35, 0.05, s.scale)}
        </div>`,
        `<div class="switches">
          ${toggle("shake", "Screen shake", s.shake)}
          ${toggle("reducedMotion", "Reduced motion", s.reducedMotion)}
          ${toggle("highContrast", "High contrast", s.highContrast)}
          ${toggle("haptics", "Haptics", s.haptics)}
        </div>`,
        `<div class="row"><button class="primary" data-act="back">Done</button></div>`,
      ])}
    </div></div>`;
  }

  function range(setting, label, min, max, stepSize, value) {
    return `<label class="field"><span>${label}</span><input data-setting="${setting}" type="range" min="${min}" max="${max}" step="${stepSize}" value="${value}" /></label>`;
  }

  function toggle(setting, label, on) {
    return `<label class="switch"><input data-setting="${setting}" type="checkbox" role="switch" ${on ? "checked" : ""} /><i></i><span>${label}</span></label>`;
  }

  function confirmHtml(enter) {
    return `<div class="center${enter}"><div class="card danger-card">
      ${stagger([
        `<p class="kicker">Reset</p>`,
        `<h2 class="card-title">Forget the facility?</h2>`,
        `<p class="tag">Cleared chambers, hints, and medals will be erased from this browser.</p>`,
        `<div class="row"><button class="danger" data-act="confirm-yes">Erase progress</button><button class="primary" data-act="confirm-no">Keep it</button></div>`,
      ])}
    </div></div>`;
  }

  function chapterHtml(enter) {
    const chapter = chapterOf(level());
    return `<div class="center${enter}"><div class="card chapter-card">
      ${stagger([
        `<p class="kicker">Wing ${ROMAN[chapter.id - 1]}</p>`,
        `<h1 class="chapter-name">${chapter.name}</h1>`,
        `<span class="rule"></span>`,
        `<p class="tag">${chapter.line}</p>`,
        `<div class="row"><button class="primary big" data-act="enter-chapter">${ICON.play}Enter</button><button data-act="facility">${ICON.map}Facility</button></div>`,
      ])}
    </div></div>`;
  }

  function pauseHtml(enter) {
    const item = level();
    const keysList = [
      ["A D", "Steer"], ["S", "Drop through grate"], ["Space", "Echo"], ["R", "Discard this trace"],
      ["Z", "Erase latest echo"], ["⌫", "Restart chamber"], ["Q", "Playback speed"], ["H", "Hints"],
    ];
    return `<div class="center${enter} dim"><div class="card">
      ${stagger([
        `<p class="kicker">Paused · ${chapterOf(item).name}</p>`,
        `<h2 class="card-title">${item.name}</h2>`,
        `<p class="tag">${item.objective}</p>`,
        `<div class="row">
          <button class="primary big" data-act="resume">${ICON.play}Resume</button>
          <button data-act="hint">${ICON.hint}Hints</button>
          <button data-act="restart">${ICON.restart}Restart</button>
          <button data-act="settings">${ICON.gear}Settings</button>
          <button data-act="facility">${ICON.map}Facility</button>
        </div>`,
        `<dl class="keys">${keysList.map(([k, v]) => `<div><dt>${k.split(" ").map((x) => `<kbd>${x}</kbd>`).join("")}</dt><dd>${v}</dd></div>`).join("")}</dl>`,
        `<p class="legend">On touch screens, hold the left or right side of the chamber to steer.</p>`,
      ])}
    </div></div>`;
  }

  function countNoun(n, singular, plural) {
    return `${n} ${n === 1 ? singular : plural}`;
  }

  function clearHtml(enter) {
    const item = level();
    const result = state.result || { seconds: 0, ghosts: 0, earned: [], medals: [], traces: 1 };
    const upcoming = nextLevel(item.id);
    const medals = [
      { id: "clear", name: "Resolved", need: "Reach the aperture", icon: ICON.check },
      { id: "lean", name: "Lean", need: `${countNoun(item.par.ghosts, "echo", "echoes")} or fewer`, icon: ICON.lean },
      { id: "swift", name: "Swift", need: `Under ${item.par.seconds}s`, icon: ICON.bolt },
    ];
    const badges = medals.map((medal, i) => {
      const now = result.earned.includes(medal.id);
      const before = !now && result.medals.includes(medal.id);
      const cls = now ? "won" : before ? "kept" : "missed";
      return `<li class="medal ${cls}" style="--d:${420 + i * 320}ms">
        <span class="coin">${medal.icon}</span>
        <strong>${medal.name}</strong>
        <small>${now ? "Earned" : before ? "Earned before" : medal.need}</small>
      </li>`;
    }).join("");
    return `<div class="center${enter}"><div class="card clear-card">
      ${stagger([
        `<p class="kicker">Chamber resolved${result.best ? ` · <span class="best">New best</span>` : ""}</p>`,
        `<h2 class="card-title">${item.name}</h2>`,
        `<div class="stats">
          <div><b data-count="${result.ghosts}" data-dec="0">0</b><span>${result.ghosts === 1 ? "echo" : "echoes"}</span></div>
          <div><b data-count="${result.seconds}" data-dec="1">0.0</b><span>seconds</span></div>
          <div><b data-count="${result.traces}" data-dec="0">0</b><span>${result.traces === 1 ? "trace" : "traces"}</span></div>
        </div>`,
        `<ul class="medals">${badges}</ul>`,
        `<div class="row">
          <button class="primary big" data-act="next">${ICON.play}${upcoming ? "Next chamber" : "Back to the facility"}</button>
          <button data-act="replay">${ICON.retry}Replay</button>
          <button data-act="facility">${ICON.map}Facility</button>
        </div>`,
        `<p class="press">Press <kbd>Enter</kbd> to continue</p>`,
      ])}
    </div></div>`;
  }

  function playHtml(enter) {
    const item = level();
    const session = state.session;
    const echoes = item.maxGhosts > 0;
    const count = session.ghosts.length;
    const chips = session.ghosts.map((ghost, index) => {
      const style = GHOST_STYLES[index % GHOST_STYLES.length];
      const fresh = index === count - 1 && state.lastChips < count ? " new" : "";
      return `<button class="chip${fresh}" data-act="erase-at" data-arg="${index}" data-i="${index}" style="--echo:${style.color}" aria-label="Echo ${style.label}, ${(ghost.frames.length / 60).toFixed(1)} seconds. Erase it and every echo after it">
        <i class="mark ${style.pattern}"></i><span class="chip-label">${style.label}</span><span class="chip-bar"><span></span></span><span class="chip-x">${ICON.close}</span>
      </button>`;
    }).join("");
    const slots = Array.from({ length: Math.max(0, item.maxGhosts - count) }, () => `<span class="slot" aria-hidden="true"></span>`).join("");
    state.lastChips = count;
    const seen = save.hints[item.id] || 0;
    const hints = item.hints.slice(0, seen).map((hint) => `<li>${hint}</li>`).join("");
    return `<div class="play${enter}">
      <header class="hud">
        <div class="hud-title"><p class="kicker">${chapterOf(item).name} · ${String(state.levelIndex + 1).padStart(2, "0")}</p><h1>${item.name}</h1></div>
        <p class="objective">${item.objective}</p>
        <div class="hud-right">
          ${echoes ? `<div class="clock" id="clock" aria-hidden="true">
            <svg viewBox="0 0 48 48"><circle class="track" cx="24" cy="24" r="20"/><circle class="fill" id="clock-fill" cx="24" cy="24" r="20" pathLength="100"/></svg>
            <span id="timer">0.0</span>
          </div>` : ""}
        </div>
      </header>
      ${session.dead ? `<div class="banner dead" role="alertdialog" aria-label="Trace ended"><p><b>This trace ended.</b> Keep it as an echo, or discard it.</p><div class="row"><button class="primary" data-act="echo" ${echoes ? "" : "disabled"}>${ICON.echo}Keep as echo</button><button data-act="retry">${ICON.retry}Discard</button></div></div>` : ""}
      ${state.hintOpen ? `<aside class="hint-panel" aria-label="Hints">
        <div class="hint-head"><p class="kicker">Hints</p><button class="icon-btn small" data-act="hint" aria-label="Close hints">${ICON.close}</button></div>
        <p class="legend">Each one gives away a little more.</p>
        <ol class="hint-list">${hints || "<li class=\"none\">No hint taken yet.</li>"}</ol>
        <div class="row"><button data-act="hint-more" ${seen >= 5 ? "disabled" : ""}>${seen >= 5 ? "That is the shape of it" : "Deeper hint"}</button></div>
      </aside>` : ""}
      <p class="rotate-hint" aria-hidden="true">Turn your device sideways for a bigger chamber.</p>
      <div class="touch-zone left" aria-hidden="true"></div><div class="touch-zone right" aria-hidden="true"></div>
      <footer class="dock">
        <div class="timeline">
          ${echoes ? `${chips}<span class="now-chip"><i class="rec"></i><span class="chip-label">Now</span><span class="chip-bar"><span></span></span></span>${slots}` : `<span class="legend">Steer with <kbd>A</kbd><kbd>D</kbd> or the arrow keys.</span>`}
        </div>
        ${echoes ? `<button class="echo-btn" data-act="echo" aria-label="Echo (Space)">${ICON.echo}<span>Echo</span><kbd>Space</kbd></button>` : ""}
        <div class="actions">
          <button class="icon-btn touch-only" data-hold="drop" aria-label="Drop through grate (S)" data-key="S">${ICON.drop}</button>
          <button class="icon-btn" data-act="retry" aria-label="Discard this trace (R)" data-key="R">${ICON.retry}</button>
          ${echoes ? `<button class="icon-btn" data-act="erase" aria-label="Erase latest echo (Z)" data-key="Z" ${count ? "" : "disabled"}>${ICON.erase}</button>` : ""}
          <button class="icon-btn" data-act="restart" aria-label="Restart chamber (Backspace)" data-key="⌫">${ICON.restart}</button>
          <button class="icon-btn speed" data-act="speed" aria-label="Playback speed (Q)" data-key="Q"><span id="speed">${state.speed}×</span></button>
          <button class="icon-btn" data-act="hint" aria-label="Hints (H)" data-key="H" aria-pressed="${state.hintOpen}">${ICON.hint}</button>
          <button class="icon-btn" data-act="pause" aria-label="Pause (Esc)" data-key="Esc">${ICON.pause}</button>
        </div>
      </footer>
    </div>`;
  }

  function facilityHtml(enter) {
    const next = nextUnsolved();
    const body = chapters.map((chapter, ci) => {
      const nodes = levels.map((item, index) => ({ item, index })).filter((entry) => entry.item.chapter === chapter.id);
      const done = nodes.filter(({ item }) => save.cleared[item.id]).length;
      const stations = nodes.map(({ item, index }) => {
        const open = index === 0 || !!save.cleared[levels[index - 1].id];
        const cleared = save.cleared[item.id];
        const medals = cleared?.medals || [];
        const cls = cleared ? "done" : open ? "open" : "sealed";
        const here = index === next && open && !cleared ? " next" : "";
        const pips = ["clear", "lean", "swift"].map((m) => `<i class="${medals.includes(m) ? "on" : ""}"></i>`).join("");
        const status = cleared ? `${medals.length} of 3 medals` : open ? "open" : "sealed";
        return `<li class="station ${cls}${here}">
          <button data-act="play" data-arg="${index}" ${open ? "" : "disabled"} aria-label="${String(index + 1).padStart(2, "0")} ${item.name}, ${status}">
            <span class="stop">${open ? String(index + 1).padStart(2, "0") : ICON.lock}</span>
            <span class="name">${item.name}</span>
            <span class="pips">${pips}</span>
          </button>
        </li>`;
      }).join("");
      return `<section class="wing" style="--i:${ci + 1}">
        <header><span class="wing-no">${ROMAN[chapter.id - 1]}</span><div><h2>${chapter.name}</h2><p class="line">${chapter.line}</p></div><span class="wing-count">${done}/${nodes.length}</span></header>
        <ol class="line-map">${stations}</ol>
      </section>`;
    }).join("");
    const pct = Math.round((progressCount() / levels.length) * 100);
    return `<div class="center${enter}"><div class="sheet">
      <div class="sheet-head" style="--i:0">
        <div><p class="kicker">The Temporal Facility</p><h2 class="card-title">Chambers</h2></div>
        <div class="progress"><span class="bar"><span style="width:${pct}%"></span></span><span>${progressCount()} / ${levels.length}</span></div>
        <div class="row">
          <button data-act="title-home">Title</button>
          <button data-act="settings">${ICON.gear}Settings</button>
          ${progressCount() ? `<button class="danger ghost-btn" data-act="reset">Reset</button>` : ""}
        </div>
      </div>
      ${body}
    </div></div>`;
  }

  function measureInsets(width, height) {
    const hud = screen.querySelector(".hud");
    const dock = screen.querySelector(".dock");
    if (!hud || !dock) return;
    // offset metrics ignore the slide-in transforms, so the chamber never fits a half-animated HUD
    const top = hud.offsetTop + hud.offsetHeight + 10;
    const bottom = height - dock.offsetTop + 10;
    state.insets = { top, bottom, side: width < 720 ? 8 : 18 };
    state.measured = true;
  }

  function syncOverlay(width, height) {
    const session = state.session;
    const sig = [
      state.mode,
      state.levelIndex,
      session ? session.ghosts.length : 0,
      session?.dead ? 1 : 0,
      state.hintOpen ? 1 : 0,
      save.hints[level()?.id] || 0,
      state.result ? 1 : 0,
      state.settings.reducedMotion ? 1 : 0,
    ].join("|");
    if (sig !== state.sig) {
      state.sig = sig;
      const key = `${state.mode}|${state.levelIndex}`;
      const fresh = key !== state.screenKey;
      state.screenKey = key;
      const focused = document.activeElement?.dataset?.act;
      screen.innerHTML = html(fresh);
      if (state.mode !== "play") {
        const again = focused && screen.querySelector(`[data-act="${focused}"]`);
        const primary = again || screen.querySelector(".primary");
        if (fresh || again) primary?.focus({ preventScroll: true });
      }
      if (state.mode === "play") state.measured = false;
    }
    if (state.mode === "play" && !state.measured) measureInsets(width, height);

    if (session && state.mode === "play") {
      const item = session.level;
      const total = item.echoSeconds;
      const left = Math.max(0, total - session.frame / 60);
      const timer = screen.querySelector("#timer");
      if (timer) {
        timer.textContent = left.toFixed(1);
        screen.querySelector("#clock-fill").style.strokeDashoffset = String(100 * (1 - left / total));
        screen.querySelector("#clock").classList.toggle("low", left < 3 && !session.won);
      }
      const limit = echoLimit(item);
      for (const chip of screen.querySelectorAll(".chip[data-i]")) {
        const ghost = session.ghosts[Number(chip.dataset.i)];
        if (!ghost) continue;
        chip.style.setProperty("--p", String(Math.min(1, session.frame / Math.max(1, ghost.frames.length - 1))));
        chip.style.setProperty("--len", String(ghost.frames.length / limit));
      }
      const now = screen.querySelector(".now-chip");
      if (now) {
        now.style.setProperty("--p", String(Math.min(1, session.frame / limit)));
        now.classList.toggle("live", !session.dead && !session.won);
      }
      const speed = screen.querySelector("#speed");
      if (speed) speed.textContent = `${state.speed}×`;
    }
    if (state.mode === "clear") {
      const t = Math.min(1, Math.max(0, (state.time - state.clearT0 - 0.15) / 0.8));
      for (const el of screen.querySelectorAll("[data-count]")) {
        const value = Number(el.dataset.count) * easeOutCubic(t);
        el.textContent = value.toFixed(Number(el.dataset.dec));
      }
    }

    const visible = state.message && state.messageT > 0 && (state.mode === "play" || state.mode === "title");
    if (visible && state.message !== shownMessage) {
      shownMessage = state.message;
      toastEl.textContent = state.message;
      restartAnim(toastEl, "show");
    } else if (!visible && shownMessage) {
      shownMessage = "";
      toastEl.classList.remove("show");
    }
    const chamberTop = state.cam && state.mode !== "title" ? state.cam.oy : state.insets.top;
    overlay.style.setProperty("--chamber-top", `${Math.round(chamberTop)}px`);
    toastEl.style.top = `${Math.max(12, chamberTop + 12)}px`;
    introEl.style.top = `${chamberTop + (state.cam ? state.cam.scale * 90 : 60)}px`;
    if (state.mode !== "play") introEl.classList.remove("show");
  }

  /* ---------- animation ---------- */

  function present(dt) {
    const reduce = reduced();
    const fx = state.fx;
    fx.trauma = Math.max(0, fx.trauma - dt * 1.5);
    const damp = Math.exp(-dt * 14);
    fx.kickX *= damp;
    fx.kickY *= damp;
    fx.flash = Math.max(0, fx.flash - dt * 3.2);
    if (fx.rewind > 0) fx.rewind = Math.max(0, fx.rewind - dt / 0.45);

    // damped springs: squash that wobbles back through the rest shape
    const b = state.ballFx;
    const steps = Math.ceil(dt / (1 / 120));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      b.vy += (-900 * b.qy - 17 * b.vy) * h;
      b.qy += b.vy * h;
      b.vx += (-900 * b.qx - 17 * b.vx) * h;
      b.qx += b.vx * h;
    }
    if (reduce) b.qx = b.qy = b.vx = b.vy = 0;
    b.rimFlash = Math.max(0, b.rimFlash - dt / 0.12);

    const session = state.session;
    if (session) {
      for (const door of session.level.doors) {
        const target = session.doors[door.id].open ? 1 : 0;
        let pos = state.doorAnim[door.id] ?? target;
        let vel = state.doorVel[door.id] ?? 0;
        if (reduce) pos = target;
        else {
          for (let i = 0; i < steps; i++) {
            vel += (220 * (target - pos) - 30 * vel) * h;
            pos += vel * h;
          }
        }
        state.doorAnim[door.id] = pos;
        state.doorVel[door.id] = vel;
      }
      for (const plate of session.level.plates) {
        const rt = session.plates[plate.id];
        const target = rt.active || rt.occupied ? 1 : 0;
        const cur = state.plateAnim[plate.id] ?? 0;
        state.plateAnim[plate.id] = reduce ? target : cur + (target - cur) * (1 - Math.exp(-dt * 18));
      }
      for (const id of Object.keys(state.springAnim)) state.springAnim[id] = Math.max(0, state.springAnim[id] - dt / 0.45);
    }

    const cap = reduce ? 40 : 280;
    for (const p of state.particles) {
      p.vx /= 1 + p.drag * dt;
      p.vy /= 1 + p.drag * dt;
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.expand) p.size += p.expand * dt;
      p.life -= p.decay * dt;
    }
    state.particles = state.particles.filter((p) => p.life > 0);
    if (state.particles.length > cap) state.particles.splice(0, state.particles.length - cap);

    if (state.trans) {
      const tr = state.trans;
      const speed = reduce ? 1 / 0.18 : tr.phase === "out" ? 1 / 0.38 : 1 / 0.5;
      tr.t += dt * speed;
      if (tr.phase === "out" && tr.t >= 1) {
        tr.fn?.();
        audio.duck(state.mode === "pause");
        state.sig = "";
        tr.phase = "in";
        tr.t = 0;
        const s = state.session;
        const worldShown = s && !["title", "facility", "settings", "confirm"].includes(state.mode);
        const at = worldShown ? screenPoint(s.level.spawn.x, s.level.spawn.y) : null;
        tr.cx = at?.x;
        tr.cy = at?.y;
      } else if (tr.phase === "in" && tr.t >= 1) state.trans = null;
    }
  }

  function updateCamera(width, height, dt, snap) {
    const target = fitCamera(width, height, state.insets);
    if (!state.cam || snap) {
      state.cam = target;
      return;
    }
    const k = 1 - Math.exp(-dt * 12);
    state.cam = {
      scale: state.cam.scale + (target.scale - state.cam.scale) * k,
      ox: state.cam.ox + (target.ox - state.cam.ox) * k,
      oy: state.cam.oy + (target.oy - state.cam.oy) * k,
    };
  }

  let acc = 0;
  let last = performance.now();
  let lastSize = "";
  function frame(nowMs) {
    const dt = Math.min(0.05, (nowMs - last) / 1000);
    last = nowMs;
    state.time += dt;
    if (state.messageT > 0) state.messageT -= dt;
    const playing = state.mode === "play" && state.session && !state.session.won && !state.trans;
    if (state.freeze > 0) {
      state.freeze = Math.max(0, state.freeze - dt);
      acc = 0;
    } else if (playing) {
      acc += dt;
      let guard = 0;
      while (acc >= DT && guard < 5) {
        for (let i = 0; i < state.speed; i++) physics();
        acc -= DT;
        guard++;
      }
    } else acc = 0;
    if (state.session?.won && state.mode === "play" && state.time >= state.winReveal) {
      bank();
      state.mode = "clear";
      state.sig = "";
    }
    present(dt);

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const bufferW = Math.round(width * dpr);
    const bufferH = Math.round(height * dpr);
    if (canvas.width !== bufferW || canvas.height !== bufferH) {
      canvas.width = bufferW;
      canvas.height = bufferH;
    }
    syncOverlay(width, height);
    const size = `${width}x${height}`;
    updateCamera(width, height, dt, size !== lastSize);
    lastSize = size;
    const hideWorld = ["title", "facility", "settings", "confirm"].includes(state.mode);
    drawFrame(ctx, {
      width, height, dpr,
      session: hideWorld ? null : state.session,
      state,
      now: state.time,
      cam: state.cam,
    });
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  return state;
}
