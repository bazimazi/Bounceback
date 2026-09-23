export function createAudio() {
  let ctx = null;
  let master = null;
  let music = null;
  let volume = 0.8;
  let ghostCount = 0;

  function context() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone({ freq = 440, dur = 0.08, type = "sine", gain = 0.08, slide = 0, delay = 0 }) {
    const audio = context();
    if (!audio || volume <= 0.001) return;
    const t = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp);
    amp.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function setVolume(value) {
    volume = value;
    if (master) master.gain.value = value;
  }

  function ensureMusic() {
    const audio = context();
    if (!audio || music) return;
    music = [110, 164.8, 220, 277.2].map((freq, index) => {
      const osc = audio.createOscillator();
      const amp = audio.createGain();
      osc.type = index === 0 ? "sine" : "triangle";
      osc.frequency.value = freq;
      amp.gain.value = index === 0 ? 0.018 : 0;
      osc.connect(amp);
      amp.connect(master);
      osc.start();
      return amp;
    });
  }

  function applyGhosts(count) {
    ghostCount = count;
    if (!music || !ctx) return;
    music.forEach((amp, index) => {
      const target = index === 0 ? 0.02 : index <= count ? 0.012 : 0;
      amp.gain.cancelScheduledValues(ctx.currentTime);
      amp.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.4);
    });
  }

  return {
    unlock() {
      context();
      ensureMusic();
      applyGhosts(ghostCount);
    },
    setVolume,
    setGhosts(count) {
      ensureMusic();
      applyGhosts(count);
    },
    bounce(speed = 200) {
      tone({ freq: 140 + Math.min(240, speed * 0.25), dur: 0.07, type: "triangle", gain: 0.05 });
    },
    plate() {
      tone({ freq: 520, dur: 0.06, type: "square", gain: 0.03 });
      tone({ freq: 780, dur: 0.08, type: "sine", gain: 0.04, delay: 0.02 });
    },
    door() {
      tone({ freq: 180, dur: 0.18, type: "sawtooth", gain: 0.03, slide: 80 });
    },
    spring() {
      tone({ freq: 220, dur: 0.16, type: "sine", gain: 0.06, slide: 280 });
    },
    echo() {
      tone({ freq: 640, dur: 0.28, type: "sine", gain: 0.05, slide: -420 });
      tone({ freq: 320, dur: 0.22, type: "triangle", gain: 0.03, slide: -180, delay: 0.04 });
    },
    die() {
      tone({ freq: 120, dur: 0.2, type: "sine", gain: 0.06, slide: -70 });
    },
    win() {
      [523, 659, 784, 1046].forEach((freq, index) => {
        tone({ freq, dur: 0.18, type: "sine", gain: 0.05, delay: index * 0.07 });
      });
      if (music) {
        music.forEach((amp) => {
          amp.gain.cancelScheduledValues(ctx.currentTime);
          amp.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 0.2);
        });
      }
    },
    deny() {
      tone({ freq: 90, dur: 0.09, type: "square", gain: 0.03 });
    },
  };
}
