import { describe, expect, it } from 'vitest';
import { parseWalletNotification } from '../../shared/parse-notification';

describe('Google Wallet notification', () => {
  it.each([
    ['SMALL SUPERMARKET AST111 KZT360.00 with Akatsuki Visa Rewards ••9613', 360, 'SMALL SUPERMARKET AST111', 'KZT'],
    ['Kaspi Magnum KZT12 500.50 with Visa ••1234', 12500.50, 'Kaspi Magnum', 'KZT'],
    ['COFFEE & CO USD4.50 with Visa ••1234', 4.5, 'COFFEE & CO', 'USD'],
    ['TEST SHOP KZT1,250.00 with Visa', 1250, 'TEST SHOP', 'KZT'],
    ['  Кофе  #1   KZT 360  ', 360, 'Кофе #1', 'KZT'],
    ['Shop 360 ₸', 360, 'Shop', 'KZT'],
    ['Shop AST111 360 ₸', 360, 'Shop AST111', 'KZT'],
    ['Shop -360 ₸', 360, 'Shop', 'KZT'],
    ['Shop KZT−12\u202f500,50', 12500.50, 'Shop', 'KZT'],
    ['Shop KZT1,250', 1250, 'Shop', 'KZT'],
    ['Shop EUR+4,50', 4.5, 'Shop', 'EUR'],
  ])('parses %s', (text, amount, merchant, currency) => {
    expect(parseWalletNotification(text)).toEqual({ amount, merchant, currency });
  });

  it.each(['Акция! Скидки до 50%', 'Shop KZT0', 'Shop KZT100000001', 'Shop KZT1.234', 'Shop KZT1 250.999x'])('ignores %s', text => {
    expect(parseWalletNotification(text)).toBeNull();
  });
});
