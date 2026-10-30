import { expect, it } from 'vitest';
import { isExpense, readCachedBootstrap } from '../../web/src/lib/data';
it.each(['{', '{}', 'null', '{"history":[],"expenses":[]}'])('invalid cache %s does not reach rendering', value => expect(readCachedBootstrap(value)).toBeNull());
it('invalid calendar data cannot crash a date formatter', () => expect(isExpense({ id: '', row: 2, date: '2026-02-30', amount: 1, name: '', category: '', comment: '', source: '', fp: '' })).toBe(false));
