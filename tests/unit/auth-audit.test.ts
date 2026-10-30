import { expect, it } from 'vitest';
import { Auth } from '../../worker/src/auth';
it('parallel invalid attempts accumulate and only block their IP', async () => {
  const auth = new Auth('correct-code');
  const request = (ip: string, key = 'wrong') => new Request('https://test/api/health', { headers: { 'CF-Connecting-IP': ip, 'X-App-Key': key } });
  await Promise.allSettled(Array.from({ length: 10 }, () => auth.check(request('192.0.2.1'))));
  await expect(auth.check(request('192.0.2.1'))).rejects.toMatchObject({ status: 429 });
  await expect(auth.check(request('192.0.2.2', 'correct-code'))).resolves.toBeUndefined();
});
