export function createAudio() {
  let ctx = null;
  let master = null;
  let fxBus = null;
  let musicBus = null;
  let musicFilter = null;
  let music = null;
  let noise = null;
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
      fxBus = ctx.createGain();
      fxBus.connect(master);
      // a short feedback echo gives tones a sense of the chamber
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.19;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.28;
      const wet = ctx.createGain();
      wet.gain.value = 0.22;
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 2400;
      fxBus.connect(delay);
      delay.connect(tone);
      tone.connect(feedback);
      feedback.connect(delay);
      tone.connect(wet);
      wet.connect(master);
      musicFilter = ctx.createBiquadFilter();
      musicFilter.type = "lowpass";
      musicFilter.frequency.value = 1800;
      musicBus = ctx.createGain();
      musicBus.gain.value = 1;
      musicBus.connect(musicFilter);
      musicFilter.connect(master);
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      noise = buffer;
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone({ freq = 440, dur = 0.08, type = "sine", gain = 0.08, slide = 0, delay = 0, wet = false }) {
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
    amp.connect(wet ? fxBus : master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function hiss({ dur = 0.2, gain = 0.05, from = 800, to = 200, q = 1, type = "bandpass", delay = 0 }) {
    const audio = context();
    if (!audio || volume <= 0.001) return;
    const t = audio.currentTime + delay;
    const src = audio.createBufferSource();
    src.buffer = noise;
    const filter = audio.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    const amp = audio.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.04, dur / 3));
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  function setVolume(value) {
    volume = value;
    if (master) master.gain.value = value;
  }

  function ensureMusic() {
    const audio = context();
    if (!audio || music) return;
    // one voice per echo: the chord fills in as the past joins you
    music = [110, 164.8, 220, 277.2, 329.6, 415.3].map((freq, index) => {
      const osc = audio.createOscillator();
      const amp = audio.createGain();
      const lfo = audio.createOscillator();
      const depth = audio.createGain();
      const swell = audio.createGain();
      osc.type = index === 0 ? "sine" : "triangle";
      osc.frequency.value = freq;
      osc.detune.value = (index % 2 ? 1 : -1) * 4;
      lfo.frequency.value = 0.07 + index * 0.03;
      depth.gain.value = 0.3;
      swell.gain.value = 1;
      lfo.connect(depth);
      depth.connect(swell.gain);
      amp.gain.value = index === 0 ? 0.018 : 0;
      osc.connect(amp);
      amp.connect(swell);
      swell.connect(musicBus);
      osc.start();
      lfo.start();
      return amp;
    });
  }

  function applyGhosts(count) {
    ghostCount = count;
    if (!music || !ctx) return;
    music.forEach((amp, index) => {
      const target = index === 0 ? 0.02 : index <= count ? 0.011 : 0;
      amp.gain.cancelScheduledValues(ctx.currentTime);
      amp.gain.setValueAtTime(amp.gain.value, ctx.currentTime);
      amp.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.6);
    });
  }

  const semitone = (n) => Math.pow(2, n / 12);

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
    duck(on) {
      if (!ctx || !musicFilter) return;
      const t = ctx.currentTime;
      musicFilter.frequency.cancelScheduledValues(t);
      musicFilter.frequency.setValueAtTime(musicFilter.frequency.value, t);
      musicFilter.frequency.exponentialRampToValueAtTime(on ? 380 : 1800, t + 0.35);
    },
    bounce(speed = 200) {
      const jitter = 1 + (Math.random() - 0.5) * 0.06;
      tone({ freq: (140 + Math.min(260, speed * 0.25)) * jitter, dur: 0.07, type: "triangle", gain: 0.045 + Math.min(0.03, speed / 30000) });
      if (speed > 520) hiss({ dur: 0.09, gain: 0.05, from: 500, to: 120, type: "lowpass" });
    },
    plate() {
      tone({ freq: 520, dur: 0.06, type: "square", gain: 0.025 });
      tone({ freq: 780, dur: 0.14, type: "sine", gain: 0.04, delay: 0.02, wet: true });
    },
    door(open = true) {
      tone({ freq: open ? 150 : 230, dur: 0.22, type: "sawtooth", gain: 0.022, slide: open ? 90 : -90 });
      hiss({ dur: 0.28, gain: 0.03, from: open ? 300 : 900, to: open ? 900 : 300, q: 2 });
    },
    spring() {
      tone({ freq: 220, dur: 0.18, type: "sine", gain: 0.06, slide: 320 });
      tone({ freq: 440, dur: 0.12, type: "triangle", gain: 0.02, slide: 500, delay: 0.02 });
    },
    echo() {
      tone({ freq: 660, dur: 0.34, type: "sine", gain: 0.05, slide: -440, wet: true });
      tone({ freq: 330, dur: 0.3, type: "triangle", gain: 0.03, slide: -200, delay: 0.05, wet: true });
      hiss({ dur: 0.42, gain: 0.05, from: 3200, to: 260, q: 3 });
    },
    whoosh(back = false) {
      hiss({ dur: back ? 0.26 : 0.34, gain: back ? 0.035 : 0.03, from: back ? 2400 : 300, to: back ? 300 : 2000, q: 1.5 });
    },
    die() {
      tone({ freq: 140, dur: 0.26, type: "sine", gain: 0.07, slide: -90 });
      hiss({ dur: 0.3, gain: 0.07, from: 2600, to: 400, q: 0.8 });
    },
    win() {
      [523, 659, 784, 1046].forEach((freq, index) => {
        tone({ freq, dur: 0.24, type: "sine", gain: 0.045, delay: index * 0.07, wet: true });
      });
      hiss({ dur: 0.6, gain: 0.03, from: 400, to: 4000, q: 2 });
      if (music) {
        music.forEach((amp) => {
          amp.gain.cancelScheduledValues(ctx.currentTime);
          amp.gain.setValueAtTime(amp.gain.value, ctx.currentTime);
          amp.gain.linearRampToValueAtTime(0.024, ctx.currentTime + 0.3);
        });
      }
    },
    medal(index) {
      const base = 784 * semitone(index * 2);
      tone({ freq: base, dur: 0.3, type: "sine", gain: 0.05, wet: true });
      tone({ freq: base * 1.5, dur: 0.22, type: "triangle", gain: 0.018, delay: 0.03, wet: true });
    },
    tick(left) {
      tone({ freq: 880 * semitone(3 - left), dur: 0.05, type: "square", gain: 0.018 });
    },
    click() {
      tone({ freq: 1400, dur: 0.025, type: "triangle", gain: 0.015 });
    },
    deny() {
      tone({ freq: 90, dur: 0.1, type: "square", gain: 0.03 });
    },
  };
}
