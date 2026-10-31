import { describe, expect, it } from 'vitest';
import { counter, interpolate, stagger } from '../../web/src/motion/core';
describe('motion timing', () => {
  it('interpolates monotonically in both directions with exact endpoints', () => {
    for (const [from, to] of [[0, 1234.56], [1000, -42]]) {
      const values = Array.from({ length: 101 }, (_, i) => interpolate(from, to, i / 100));
      expect(values[0]).toBe(from); expect(values.at(-1)).toBe(to);
      values.slice(1).forEach((v, i) => expect((v - values[i]) * Math.sign(to - from)).toBeGreaterThanOrEqual(0));
    }
  });
  it('caps stagger to the first ten rows and bounds the chart cascade', () => {
    expect(stagger(-1)).toBe(0); expect(stagger(9)).toBe(180); expect(stagger(100)).toBe(180);
    expect(stagger(30, 8, 31) + 240).toBeLessThanOrEqual(500);
  });
  it('retargets from the current value and cancels stale callbacks', () => {
    let now = 0, id = 0; const callbacks = new Map<number, (t: number) => void>(), values: number[] = [];
    const c = counter(0, { now: () => now, request: fn => { callbacks.set(++id, fn); return id; }, cancel: n => { callbacks.delete(n); } }, n => values.push(n));
    c.to(100, 400); now = 200; callbacks.get(id)!(now); const midway = values.at(-1)!; const stale = callbacks.get(id)!;
    c.to(200, 400); stale(600); expect(values.at(-1)).toBe(midway);
    now = 400; callbacks.get(id)!(now); expect(values.at(-1)).toBeGreaterThan(midway);
    now = 600; callbacks.get(id)!(now); expect(values.at(-1)).toBe(200);
    c.to(12.34, 0); expect(values.at(-1)).toBe(12.34); c.stop();
  });
});
