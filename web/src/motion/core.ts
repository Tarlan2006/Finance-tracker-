// Pure timing utilities; the scheduler is injected so cancellation is testable.
export const stagger = (index: number, step = 20, count = 10) => Math.max(0, Math.min(index, count - 1)) * step;
export const interpolate = (from: number, to: number, progress: number) => {
  const p = Math.min(1, Math.max(0, progress));
  return p === 1 ? to : from + (to - from) * (1 - (1 - p) ** 3);
};
export interface Frames { now: () => number; request: (fn: (time: number) => void) => number; cancel: (id: number) => void }
export function counter(initial: number, frames: Frames, render: (value: number) => void) {
  let value = initial, frame = 0, generation = 0;
  const stop = () => { generation++; frames.cancel(frame); };
  return {
    stop,
    to(target: number, duration: number) {
      stop(); const token = generation, from = value, start = frames.now();
      const tick = (time: number) => {
        if (token !== generation) return;
        const p = duration <= 0 ? 1 : Math.min(1, (time - start) / duration);
        value = interpolate(from, target, p); render(value);
        if (p < 1) frame = frames.request(tick);
      };
      if (duration <= 0) tick(start); else frame = frames.request(tick);
    }
  };
}
