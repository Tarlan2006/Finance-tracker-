import type { APIRequestContext, Page } from '@playwright/test';
let requestNumber = 0;
export async function mockSession(request: APIRequestContext) { const response = await request.post('/api/login', { headers: { 'CF-Connecting-IP': `192.0.2.${++requestNumber % 250 + 1}` }, data: { login: 'tarlan', password: 'mock-local-key' } }); if (response.status() !== 200) throw new Error(`Mock login failed: HTTP ${response.status()}`); return response.json(); }
const tokens = new WeakMap<APIRequestContext, Promise<string>>();
export async function mockToken(request: APIRequestContext) { let token = tokens.get(request); if (!token) { token = mockSession(request).then(s => s.token as string); tokens.set(request, token); } return token; }
export async function initMockSession(page: Page) { const s = await mockSession(page.request); await page.addInitScript(s => { localStorage.setItem('account-session', JSON.stringify(s)); localStorage.setItem('app-key', s.token); }, s); }
