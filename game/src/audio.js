// All sound in Solmarina is synthesized live with WebAudio: no audio files are shipped.
// Engine hum, sirens, gunshots, pickups and a soft sunset pad, all from oscillators and
// filtered noise. Audio starts only after the player's first click (browser rule).
SM.audio = (function audio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let sirenOsc = null;
  let sirenGain = null;
  let padOsc = null;
  let muted = false;
  let sirenOn = false;
  let sirenPhase = 0;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      // Engine: two detuned saws through a lowpass, gain follows speed.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineOsc2 = ctx.createOscillator();
      engineOsc2.type = 'sawtooth';
      engineOsc2.frequency.value = 82;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 420;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(filt);
      engineOsc2.connect(filt);
      filt.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      engineOsc2.start();
      // Police siren: one sine that wails between two tones.
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'sine';
      sirenOsc.frequency.value = 720;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
      // Sunset pad: two slow detuned triangles, very quiet, always on.
      padOsc = ctx.createOscillator();
      padOsc.type = 'triangle';
      padOsc.frequency.value = 110;
      const pad2 = ctx.createOscillator();
      pad2.type = 'triangle';
      pad2.frequency.value = 164.8;
      const padGain = ctx.createGain();
      padGain.gain.value = 0.035;
      padOsc.connect(padGain);
      pad2.connect(padGain);
      padGain.connect(master);
      padOsc.start();
      pad2.start();
    } catch (e) {
      ctx = null;
      return false;
    }
    return true;
  }

  function blip(freq, dur, type, vol, when) {
    if (!ctx || muted) return;
    const t0 = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, filterFreq) {
    if (!ctx || muted) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = filterFreq || 1800;
    const g = ctx.createGain();
    g.gain.value = vol || 0.3;
    src.connect(filt);
    filt.connect(g);
    g.connect(master);
    src.start();
  }

  return {
    /** Call from a click handler: creates the context and resumes it. */
    unlock: function unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    },
    toggleMute: function toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    isMuted: function isMuted() { return muted; },
    /** Engine hum follows the car's speed 0..1; silent on foot. */
    engine: function engine(speed01, on) {
      if (!ctx) return;
      const target = on && !muted ? 0.05 + speed01 * 0.11 : 0;
      engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
      engineOsc.frequency.setTargetAtTime(48 + speed01 * 130, ctx.currentTime, 0.1);
      engineOsc2.frequency.setTargetAtTime(72 + speed01 * 195, ctx.currentTime, 0.1);
    },
    /** Police siren: call every frame with the nearest police distance. */
    siren: function siren(nearestDist) {
      if (!ctx) return;
      const active = nearestDist !== null && nearestDist < 90;
      sirenPhase += 1 / 60;
      if (active) {
        const tone = Math.sin(sirenPhase * Math.PI * 2 * 0.9) > 0 ? 950 : 700;
        sirenOsc.frequency.setTargetAtTime(tone, ctx.currentTime, 0.05);
        const vol = SM.clamp(1 - nearestDist / 90, 0.05, 0.5) * 0.16;
        sirenGain.gain.setTargetAtTime(muted ? 0 : vol, ctx.currentTime, 0.1);
      } else {
        sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      }
      sirenOn = active;
    },
    shoot: function shoot() { noise(0.14, 0.5, 2600); blip(190, 0.08, 'square', 0.12); },
    punch: function punch() { noise(0.09, 0.35, 700); },
    crash: function crash(hard) { noise(hard ? 0.35 : 0.18, hard ? 0.5 : 0.25, 500); },
    pickup: function pickup() { blip(660, 0.12, 'sine', 0.22); blip(990, 0.16, 'sine', 0.2, 0.09); },
    cash: function cash() { blip(880, 0.1, 'triangle', 0.22); blip(1174, 0.12, 'triangle', 0.22, 0.08); blip(1568, 0.2, 'triangle', 0.2, 0.16); },
    mission: function mission() {
      blip(523, 0.14, 'triangle', 0.25); blip(659, 0.14, 'triangle', 0.25, 0.12);
      blip(784, 0.2, 'triangle', 0.25, 0.24); blip(1046, 0.3, 'triangle', 0.22, 0.36);
    },
    busted: function busted() { blip(392, 0.3, 'sawtooth', 0.18); blip(311, 0.45, 'sawtooth', 0.18, 0.28); },
    click: function click() { blip(740, 0.06, 'sine', 0.15); },
    denied: function denied() { blip(160, 0.16, 'square', 0.14); },
  };
})();
