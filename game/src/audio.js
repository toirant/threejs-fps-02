// Synthesised sound effects, WebAudio only — no audio files, no network. The
// context is created on the first user gesture; every call before that is a
// no-op, so headless renders and screenshots never throw.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBuffer(seconds) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function burst(freq, seconds, gain, type = 'lowpass') {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(seconds);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + seconds);
  }

  function tone(freq, seconds, gain, slideTo) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + seconds);
  }

  return {
    unlock() { ensure(); },
    shot(far) {
      burst(far ? 500 : 1600, far ? 0.18 : 0.11, far ? 0.25 : 0.8);
      tone(140, 0.09, 0.5, 60);
    },
    dry() { tone(1200, 0.03, 0.25); },
    reload() { tone(700, 0.05, 0.2); tone(500, 0.05, 0.2); },
    hit() { tone(1900, 0.05, 0.35); },
    kill() { tone(880, 0.09, 0.3); tone(1320, 0.12, 0.25); },
    hurt() { tone(220, 0.14, 0.4, 110); },
    plant() { tone(980, 0.08, 0.3); },
    beep() { tone(1180, 0.07, 0.28); },
    defuse() { tone(760, 0.1, 0.3); },
    explosion() {
      burst(220, 0.7, 1.0);
      tone(70, 0.6, 0.8, 32);
    },
    roundWin() { tone(523, 0.12, 0.3); tone(659, 0.12, 0.3); tone(784, 0.22, 0.3); },
    roundLose() { tone(392, 0.14, 0.3); tone(311, 0.2, 0.3); },
    buy() { tone(1046, 0.06, 0.25); },
  };
}
