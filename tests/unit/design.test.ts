import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { categoryColor, palette } from '../../shared/analytics';
import { mockCategories } from '../../worker/src/mock-sheets';
const luminance = (hex: string) => { const value = hex.length === 4 ? hex.slice(1).split('').map(x => x + x).join('') : hex.slice(1); return value.match(/../g)!.map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((s, x, i) => s + x * [.2126, .7152, .0722][i], 0); };
const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
it('all nine dictionary categories have distinct stable swatches', () => expect(new Set(mockCategories.map(c => categoryColor(c.name))).size).toBe(9));
it('both themes meet AA for primary/secondary/action text and 3:1 for chart marks', () => {
  const css = readFileSync('web/src/tokens.css', 'utf8');
  for (const [i, block] of [...css.matchAll(/:root[^{}]*\{([^}]+)\}/g)].entries()) {
    const tokens = Object.fromEntries([...block[1].matchAll(/--([\w-]+):\s*(#[\da-f]+)/gi)].map(m => [m[1], m[2]]));
    for (const background of ['bg', 'card', 'raised']) for (const foreground of ['text', 'secondary', 'accent', 'danger', 'warning']) expect(contrast(tokens[foreground], tokens[background]), `${i}:${foreground}/${background}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens['on-accent'], tokens.accent)).toBeGreaterThanOrEqual(4.5);
    for (const swatch of i ? palette.light : palette.dark) expect(contrast(swatch, tokens.card)).toBeGreaterThanOrEqual(3);
    expect(contrast(tokens.bar, tokens.card)).toBeGreaterThanOrEqual(3);
  }
});
