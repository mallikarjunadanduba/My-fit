/**
 * Short alarm chime via WebAudio. Browsers block audio until the user has interacted with the page;
 * in that case `playAlarm` resolves false and the caller shows a visual-only alarm.
 */
let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/** Call from a user gesture (e.g. a click) so later alarms can play sound. */
export async function unlockAudio(): Promise<void> {
  const c = audioContext();
  if (c && c.state === 'suspended') {
    try {
      await c.resume();
    } catch {
      /* ignored: still blocked */
    }
  }
}

export async function playAlarm(repeats = 3): Promise<boolean> {
  const c = audioContext();
  if (!c) return false;
  if (c.state === 'suspended') {
    try {
      await c.resume();
    } catch {
      return false;
    }
  }
  if (c.state !== 'running') return false;
  const start = c.currentTime + 0.05;
  for (let i = 0; i < repeats; i++) {
    for (const [offset, freq] of [
      [0, 880],
      [0.18, 1175],
    ] as const) {
      const t = start + i * 0.9 + offset;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    }
  }
  return true;
}
