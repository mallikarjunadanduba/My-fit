/**
 * End-of-rest feedback: a short WebAudio beep and a vibration where supported.
 * Mobile browsers only allow audio after a user gesture, so call `unlockAudio()` from a click handler
 * (e.g. when the timer is started) before the beep is needed.
 */

type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;

function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  return (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) || null;
}

export function unlockAudio(): void {
  try {
    const Ctor = audioCtor();
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    // Audio not available — the visual + vibration alert still works.
  }
}

export function playBeep(times = 3): void {
  try {
    const Ctor = audioCtor();
    if (!Ctor) return;
    ctx ??= new Ctor();
    const c = ctx;
    if (c.state === 'suspended') void c.resume();
    for (let i = 0; i < times; i++) {
      const start = c.currentTime + i * 0.28;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === times - 1 ? 1175 : 880;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(start + 0.22);
    }
  } catch {
    // ignore
  }
}

export function vibrate(pattern: number | number[] = [200, 100, 200]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    // ignore
  }
}
