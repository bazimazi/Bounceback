import { chapters, levels, nextLevel } from "./levels.js";
import { GHOST_STYLES } from "./palette.js";
import { createAudio } from "./audio.js";
import { loadSave, medalFor, writeSave } from "./save.js";
import { drawWorld } from "./render.js";
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
    fx: { shake: 0, rewind: 0 },
    trails: [],
    particles: [],
    doorAnim: {},
    squash: { x: 1, y: 1 },
    time: 0,
    winReveal: 0,
    attempts: 0,
    result: null,
    sig: "",
  };
  const ctx = canvas.getContext("2d");
  applySettings();

  function say(text) {
    live.textContent = text;
  }

  function note(text, seconds = 2.4) {
    state.message = text;
    state.messageT = seconds;
    say(text);
  }

  function applySettings() {
    document.documentElement.style.setProperty("--ui-scale", String(state.settings.scale));
    document.body.classList.toggle("contrast", state.settings.highContrast);
    document.body.classList.toggle("reduce", state.settings.reducedMotion);
    audio.setVolume(state.settings.volume);
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

  function openLevel(index) {
    state.levelIndex = index;
    state.session = createSession(levels[index]);
    state.speed = 1;
    state.hintOpen = false;
    state.attempts = 0;
    state.trails = [];
    state.particles = [];
    state.doorAnim = {};
    state.squash = { x: 1, y: 1 };
    state.result = null;
    state.message = "";
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
    if (!save.seenCaption[item.id] && item.caption) {
      save.seenCaption[item.id] = true;
      writeSave(save);
      note(item.caption, 4.5);
    }
    say(`${item.name}. ${item.objective}`);
  }

  function spawnBurst(x, y, color, count) {
    if (state.settings.reducedMotion) count = Math.min(count, 6);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      state.particles.push({
        x, y,
        vx: Math.cos(a) * (1.5 + (i % 3)),
        vy: Math.sin(a) * (1.5 + (i % 3)),
        life: 1,
        size: 2 + (i % 3),
        color,
      });
    }
    if (state.particles.length > 100) state.particles.splice(0, state.particles.length - 100);
  }

  function react(events) {
    let bounced = false;
    for (const event of events) {
      if (event.type === "bounce" && !bounced) {
        bounced = true;
        audio.bounce(event.speed);
        if (!state.settings.reducedMotion && event.speed > 180) {
          state.squash.x = 1.18;
          state.squash.y = 0.78;
        }
        if (state.settings.shake) state.fx.shake = Math.min(8, event.speed / 120);
      } else if (event.type === "plate") {
        audio.plate();
      } else if (event.type === "door") {
        audio.door();
      } else if (event.type === "spring" || event.type === "bumper") {
        audio.spring();
        state.fx.shake = 5;
      } else if (event.type === "die") {
        audio.die();
        buzz(30);
        note("This trace ended. Keep it as an echo, or discard it.");
      } else if (event.type === "win") {
        audio.win();
        buzz([12, 30, 18]);
        state.fx.shake = 7;
        spawnBurst(state.session.ball.x, state.session.ball.y, "#f4efe6", 18);
        state.winReveal = state.time + 0.9;
      }
    }
    const session = state.session;
    for (const plate of session.level.plates) {
      const runtime = session.plates[plate.id];
      if (runtime.active && !runtime.heard) {
        runtime.heard = true;
        audio.plate();
      }
      if (!runtime.active) runtime.heard = false;
    }
  }

  function pushTrails() {
    const session = state.session;
    if (!session) return;
    session.ghosts.forEach((ghost, index) => {
      const pos = ghostPosition(ghost, session.frame);
      const trail = state.trails[index] || [];
      trail.push({ x: pos.x, y: pos.y });
      state.trails[index] = trail.slice(-18);
    });
  }

  function tryEcho() {
    const session = state.session;
    const before = session.ghosts.length;
    const res = commitEcho(session);
    if (!res.ok) {
      audio.deny();
      note(res.reason === "full" ? "No echoes left. Erase one, or restart." : "Stay a moment longer, then echo.");
      return false;
    }
    state.attempts += 1;
    audio.echo();
    audio.setGhosts(session.ghosts.length);
    state.fx.rewind = 1;
    buzz(16);
    spawnBurst(levels[state.levelIndex].spawn.x, levels[state.levelIndex].spawn.y, GHOST_STYLES[before % 5].color, 12);
    state.trails = session.ghosts.map(() => []);
    note(`Echo ${session.ghosts.length} is holding your last trace.`);
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
    const events = step(session, {
      x: steer(),
      drop: keys.down || touchDrop,
      sensitivity: state.settings.sensitivity,
    });
    react(events);
    pushTrails();
  }

  function bank() {
    const session = state.session;
    const item = session.level;
    const seconds = Math.round((session.winFrame / 60) * 10) / 10;
    const ghosts = session.ghosts.length;
    const earned = medalFor(item, ghosts, seconds);
    const prev = save.cleared[item.id] || { medals: [], bestTime: 999, bestGhosts: 99 };
    save.cleared[item.id] = {
      medals: [...new Set([...(prev.medals || []), ...earned])],
      bestTime: Math.min(prev.bestTime ?? 999, seconds),
      bestGhosts: Math.min(prev.bestGhosts ?? 99, ghosts),
      time: seconds,
      ghosts,
    };
    writeSave(save);
    state.result = { seconds, ghosts, earned, medals: save.cleared[item.id].medals };
    say(`${item.name} resolved. ${ghosts} echoes. ${seconds} seconds.`);
  }

  function act(name, arg) {
    audio.unlock();
    if (name === "begin") openLevel(0);
    else if (name === "continue") openLevel(nextUnsolved());
    else if (name === "facility") state.mode = "facility";
    else if (name === "settings") {
      state.returnMode = state.mode === "settings" ? "title" : state.mode;
      state.mode = "settings";
    } else if (name === "back") state.mode = state.returnMode || "title";
    else if (name === "play") {
      const index = Number(arg);
      const open = index === 0 || save.cleared[levels[index - 1].id];
      if (open) openLevel(index);
    } else if (name === "enter-chapter") {
      save.seenChapter[chapterOf(level()).id] = true;
      writeSave(save);
      beginPlay();
    }     else if (name === "echo" && state.session && !state.session.won) tryEcho();
    else if (name === "retry" && state.session && !state.session.won) {
      discardAttempt(state.session);
      state.attempts += 1;
      state.mode = "play";
      note("This trace was discarded. Earlier echoes remain.");
    } else if (name === "restart" && state.session) {
      restartAll(state.session);
      state.attempts += 1;
      state.trails = [];
      state.mode = "play";
      audio.setGhosts(0);
      note("All echoes cleared.");
    } else if (name === "erase" && state.session?.ghosts.length) {
      eraseFrom(state.session, state.session.ghosts.length - 1);
      state.trails = [];
      state.mode = "play";
      audio.setGhosts(state.session.ghosts.length);
      note("Removed the latest echo, and anything that came after it.");
    } else if (name === "title-home") state.mode = "title";
    else if (name === "erase-at") {
      eraseFrom(state.session, Number(arg));
      state.trails = [];
      audio.setGhosts(state.session.ghosts.length);
      note("The past changed. Later echoes were cleared with it.");
    } else if (name === "speed") state.speed = state.speed === 3 ? 1 : state.speed + 1;
    else if (name === "hint") state.hintOpen = !state.hintOpen;
    else if (name === "hint-more") {
      const id = level().id;
      save.hints[id] = Math.min(5, (save.hints[id] || 0) + 1);
      writeSave(save);
      state.hintOpen = true;
    } else if (name === "pause") state.mode = "pause";
    else if (name === "resume") state.mode = "play";
    else if (name === "next") {
      const upcoming = nextLevel(level().id);
      if (!upcoming) state.mode = "facility";
      else openLevel(levels.indexOf(upcoming));
    } else if (name === "replay") openLevel(state.levelIndex);
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
    state.sig = "";
  }

  overlay.addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button || button.disabled) return;
    act(button.dataset.act, button.dataset.arg);
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
  });

  window.addEventListener("keydown", (event) => {
    if (event.repeat && ["Space", "KeyF", "KeyR", "KeyZ", "KeyH", "KeyQ", "Enter"].includes(event.code)) return;
    audio.unlock();
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
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
      if (event.code === "Escape") state.mode = "pause";
    } else if (event.code === "Escape" && state.mode === "pause") state.mode = "play";
    else if (event.code === "Enter" && state.mode === "title") act(progressCount() ? "continue" : "begin");
    else if (event.code === "Enter" && state.mode === "chapter") act("enter-chapter");
    else if (event.code === "Enter" && state.mode === "clear") act("next");
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
    if (state.mode === "play") state.mode = "pause";
  });

  function html() {
    if (state.mode === "title") return titleHtml();
    if (state.mode === "facility") return facilityHtml();
    if (state.mode === "settings") return settingsHtml();
    if (state.mode === "confirm") return confirmHtml();
    if (state.mode === "chapter") return chapterHtml();
    if (state.mode === "pause") return pauseHtml();
    if (state.mode === "clear") return clearHtml();
    return playHtml();
  }

  function titleHtml() {
    const has = progressCount() > 0;
    return `<div class="center"><div class="card">
      <p class="kicker">The Temporal Facility</p>
      <h1>Bounceback</h1>
      <p class="tag">Bounce through time, then cooperate with your past selves.</p>
      <div class="row">
        ${has ? `<button class="primary" data-act="continue">Continue</button><button data-act="facility">Facility</button>` : `<button class="primary" data-act="begin">Begin</button>`}
        <button data-act="settings">Settings</button>
      </div>
      <ol class="beats">
        <li>Steer the ball. It bounces on its own.</li>
        <li>Echo, and that run becomes a ghost that repeats you exactly.</li>
        <li>Leave your ghosts on plates, ferries, and each other.</li>
      </ol>
      ${has ? `<p class="tag">${progressCount()} / ${levels.length} chambers resolved.</p>` : ""}
    </div></div>`;
  }

  function settingsHtml() {
    const s = state.settings;
    return `<div class="center"><div class="card">
      <p class="kicker">Settings</p>
      <h1 style="font-size:2.4rem">How it feels</h1>
      <label class="field">Volume <input data-setting="volume" type="range" min="0" max="1" step="0.01" value="${s.volume}" /></label>
      <label class="field">Steer sensitivity <input data-setting="sensitivity" type="range" min="0.7" max="1.3" step="0.05" value="${s.sensitivity}" /></label>
      <label class="field">Interface scale <input data-setting="scale" type="range" min="0.85" max="1.35" step="0.05" value="${s.scale}" /></label>
      ${check("shake", "Screen shake", s.shake)}
      ${check("reducedMotion", "Reduced motion", s.reducedMotion)}
      ${check("highContrast", "High contrast", s.highContrast)}
      ${check("haptics", "Haptics", s.haptics)}
      <div class="row"><button class="primary" data-act="back">Done</button></div>
    </div></div>`;
  }

  function check(setting, label, on) {
    return `<label class="check"><input data-setting="${setting}" type="checkbox" ${on ? "checked" : ""} /> ${label}</label>`;
  }

  function confirmHtml() {
    return `<div class="center"><div class="card">
      <h1 style="font-size:2.6rem">Forget the facility?</h1>
      <p class="tag">Cleared chambers, hints, and medals will be erased from this browser.</p>
      <div class="row"><button data-act="confirm-yes">Erase progress</button><button class="primary" data-act="confirm-no">Keep it</button></div>
    </div></div>`;
  }

  function chapterHtml() {
    const chapter = chapterOf(level());
    return `<div class="center"><div class="card">
      <p class="kicker">Wing</p>
      <h1>${chapter.name}</h1>
      <p class="tag">${chapter.line}</p>
      <div class="row"><button class="primary" data-act="enter-chapter">Enter</button><button data-act="facility">Facility</button></div>
    </div></div>`;
  }

  function pauseHtml() {
    const item = level();
    return `<div class="center"><div class="card">
      <p class="kicker">${chapterOf(item).name}</p>
      <h1 style="font-size:3rem">${item.name}</h1>
      <p class="tag">${item.objective}</p>
      <div class="row">
        <button class="primary" data-act="resume">Resume</button>
        <button data-act="hint">Hints</button>
        <button data-act="restart">Restart</button>
        <button data-act="settings">Settings</button>
        <button data-act="facility">Facility</button>
      </div>
      <p class="tag">A/D or arrows steer. S or down drops through grates. Space echoes. R discards this trace. Z erases the latest echo. Q changes speed. The left and right halves of the screen steer on touch.</p>
    </div></div>`;
  }

  function countNoun(n, singular, plural) {
    return `${n} ${n === 1 ? singular : plural}`;
  }

  function clearHtml() {
    const item = level();
    const result = state.result || { seconds: 0, ghosts: 0, earned: [], medals: [] };
    const upcoming = nextLevel(item.id);
    return `<div class="center"><div class="card">
      <p class="kicker">Resolved</p>
      <h1 style="font-size:3.2rem">${item.name}</h1>
      <p class="tag">${countNoun(result.ghosts, "echo", "echoes")} · ${result.seconds}s · this visit took ${countNoun(state.attempts + 1, "trace", "traces")}</p>
      <p class="medals">${result.medals.map(labelMedal).join(" · ") || "Resolved"}</p>
      <p class="tag">Lean is ${countNoun(item.par.ghosts, "echo", "echoes")} or fewer. Swift is under ${item.par.seconds}s. Both are optional.</p>
      <div class="row">
        <button class="primary" data-act="next">${upcoming ? "Next chamber" : "Back to the facility"}</button>
        <button data-act="replay">Replay</button>
        <button data-act="facility">Facility</button>
      </div>
    </div></div>`;
  }

  function playHtml() {
    const item = level();
    const session = state.session;
    const chips = session.ghosts.map((ghost, index) => {
      const style = GHOST_STYLES[index % GHOST_STYLES.length];
      return `<button class="chip" data-act="erase-at" data-arg="${index}" style="--echo:${style.color}" aria-label="Erase echo ${index + 1} and every echo after it">
        <i class="mark ${style.pattern}"></i> ${style.label} <span>${(ghost.frames.length / 60).toFixed(1)}s</span>
      </button>`;
    }).join("");
    const seen = save.hints[item.id] || 0;
    const hints = item.hints.slice(0, seen).map((hint) => `<li>${hint}</li>`).join("");
    return `
      <header class="hud">
        <div><p class="kicker">${chapterOf(item).name}</p><h1>${item.name}</h1></div>
        <p class="objective">${item.objective}</p>
        <div><p class="count" id="echo-count"></p><p class="timer" id="timer"></p></div>
      </header>
      <p class="toast" id="toast"></p>
      ${session.dead ? `<div class="banner"><p>This trace ended.</p><div class="row"><button class="primary" data-act="echo">Keep this echo</button><button data-act="retry">Discard</button></div></div>` : ""}
      ${state.hintOpen ? `<div class="banner"><p>Hints, in order. Each one gives away a little more.</p><ol class="hint-list">${hints || "<li>No hint taken yet.</li>"}</ol><div class="row"><button data-act="hint-more" ${seen >= 5 ? "disabled" : ""}>${seen >= 5 ? "That is the shape of it" : "Deeper hint"}</button></div></div>` : ""}
      <footer class="dock">
        <div class="chips">${chips}<span class="now-chip">Now</span></div>
        <div class="actions">
          <button class="primary" data-act="echo" ${item.maxGhosts ? "" : "disabled"}>Echo</button>
          <button data-hold="drop">Drop</button>
          <button data-act="retry">Retry</button>
          <button data-act="restart">Restart</button>
          <button data-act="erase">Erase last</button>
          <button data-act="speed" id="speed">${state.speed}×</button>
          <button data-act="hint">Hint</button>
          <button data-act="pause">Pause</button>
        </div>
        <p class="legend">A/D steer · S drop · Space echo · R retry · Z erase last · Q speed · touch the sides to steer</p>
      </footer>`;
  }

  function labelMedal(medal) {
    if (medal === "lean") return "Lean";
    if (medal === "swift") return "Swift";
    return "Resolved";
  }

  function syncOverlay() {
    const session = state.session;
    const sig = [
      state.mode,
      state.levelIndex,
      session ? session.ghosts.length : 0,
      session?.dead ? 1 : 0,
      state.hintOpen ? 1 : 0,
      state.speed,
      save.hints[level()?.id] || 0,
      state.result ? 1 : 0,
    ].join("|");
    if (sig !== state.sig) {
      state.sig = sig;
      overlay.innerHTML = html();
    }
    const timer = overlay.querySelector("#timer");
    const count = overlay.querySelector("#echo-count");
    const toast = overlay.querySelector("#toast");
    const speed = overlay.querySelector("#speed");
    if (session && timer) {
      const left = Math.max(0, session.level.echoSeconds - session.frame / 60);
      timer.textContent = session.level.maxGhosts ? left.toFixed(1) : "";
      count.textContent = `Echoes ${session.ghosts.length} / ${session.level.maxGhosts}`;
    }
    if (toast) {
      toast.hidden = !(state.message && state.messageT > 0);
      toast.textContent = state.message;
    }
    if (speed) speed.textContent = `${state.speed}×`;
  }

  function facilityHtml() {
    const body = chapters.map((chapter) => {
      const nodes = levels.map((item, index) => ({ item, index })).filter((entry) => entry.item.chapter === chapter.id);
      const buttons = nodes.map(({ item, index }) => {
        const open = index === 0 || !!save.cleared[levels[index - 1].id];
        const done = save.cleared[item.id];
        return `<button class="node ${done ? "done" : ""}" data-act="play" data-arg="${index}" ${open ? "" : "disabled"}>
          <span class="idx">${String(index + 1).padStart(2, "0")}</span>
          <strong>${item.name}</strong>
          <span class="medals">${done ? done.medals.map(labelMedal).join(" · ") : open ? "Open" : "Sealed"}</span>
        </button>`;
      }).join("");
      return `<section class="wing"><h2>${chapter.name}</h2><p class="line">${chapter.line}</p><div class="nodes">${buttons}</div></section>`;
    }).join("");
    return `<div class="center"><div class="sheet">
      <p class="kicker">The Temporal Facility</p>
      <div class="row">
        <button data-act="title-home">Title</button>
        <button data-act="settings">Settings</button>
        ${progressCount() ? `<button data-act="reset">Reset progress</button>` : ""}
      </div>
      ${body}
    </div></div>`;
  }

  function present(dt) {
    const reduce = state.settings.reducedMotion;
    state.fx.shake *= reduce ? 0 : 0.86;
    state.fx.rewind = Math.max(0, state.fx.rewind - dt * 1.8);
    state.squash.x += (1 - state.squash.x) * (reduce ? 1 : 0.2);
    state.squash.y += (1 - state.squash.y) * (reduce ? 1 : 0.2);
    const session = state.session;
    if (session) {
      for (const door of session.level.doors) {
        const target = session.doors[door.id].open ? 1 : 0;
        const current = state.doorAnim[door.id] ?? target;
        state.doorAnim[door.id] = reduce ? target : current + (target - current) * 0.18;
      }
    }
    for (const particle of state.particles) {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.12;
      particle.life -= reduce ? 0.08 : 0.02;
    }
    state.particles = state.particles.filter((particle) => particle.life > 0);
  }

  let acc = 0;
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    state.time += dt;
    if (state.messageT > 0) state.messageT -= dt;
    if (state.mode === "play" && state.session && !state.session.won) {
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
    const hideWorld = state.mode === "title" || state.mode === "facility" || state.mode === "settings" || state.mode === "confirm";
    drawWorld(ctx, { width, height, dpr, session: hideWorld ? null : state.session, state, now: state.time });
    syncOverlay();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  return state;
}
