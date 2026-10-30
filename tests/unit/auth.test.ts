import { expect, it } from 'vitest';
import { Auth } from '../../worker/src/auth';
it('блокировка снимается через 15 минут; успешный ключ сбрасывает серию', async () => {
  let now = 100000;
  const auth = new Auth('correct-test-code', () => now);
  const request = (key: string) => new Request('https://app.test/api/health', { headers: { 'X-App-Key': key, 'CF-Connecting-IP': '192.0.2.1' } });
  for (let i = 0; i < 9; i++) await expect(auth.check(request('wrong'))).rejects.toMatchObject({ status: 401 });
  await auth.check(request('correct-test-code'));
  await expect(auth.check(request('wrong'))).rejects.toMatchObject({ status: 401 });
  for (let i = 0; i < 9; i++) await auth.check(request('wrong')).catch(() => undefined);
  await expect(auth.check(request('correct-test-code'))).rejects.toMatchObject({ status: 429 });
  now += 900001;
  await expect(auth.check(request('correct-test-code'))).resolves.toBeUndefined();
});
