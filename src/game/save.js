const KEY = "bounceback.v1";

function motionPreference() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function defaultSave() {
  const reduce = motionPreference();
  return {
    version: 1,
    cleared: {},
    seenChapter: {},
    seenCaption: {},
    hints: {},
    settings: {
      volume: 0.8,
      reducedMotion: reduce,
      highContrast: false,
      shake: !reduce,
      haptics: true,
      sensitivity: 1,
      scale: 1,
    },
  };
}

export function loadSave() {
  const base = defaultSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    return {
      ...base,
      ...parsed,
      cleared: parsed.cleared || {},
      seenChapter: parsed.seenChapter || {},
      seenCaption: parsed.seenCaption || {},
      hints: parsed.hints || {},
      settings: { ...base.settings, ...(parsed.settings || {}) },
    };
  } catch {
    return base;
  }
}

export function writeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* private mode */
  }
}

export function medalFor(level, ghosts, seconds) {
  const medals = ["clear"];
  if (ghosts <= level.par.ghosts) medals.push("lean");
  if (seconds <= level.par.seconds) medals.push("swift");
  return medals;
}
