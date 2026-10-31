import { AppError } from '../../shared/logic';
export const PASSWORD_ITERATIONS = 100000;
const encoder = new TextEncoder();
export const randomSecret = (bytes = 32) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), n => n.toString(16).padStart(2, '0')).join('');
export const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), n => n.toString(16).padStart(2, '0')).join('');
export async function constantEqual(a: string, b: string) { const [left, right] = await Promise.all([digest(a), digest(b)]); let diff = 0; for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i); return diff === 0; }
export interface PasswordHash { salt: string; iterations: number; hash: string }
export function validatePassword(password: unknown): asserts password is string { if (typeof password !== 'string' || [...password].length < 5 || [...password].length > 128) throw new AppError(422, 'password', 'Пароль должен содержать от 5 до 128 символов'); }
export async function hashPassword(password: string, salt = randomSecret(16), iterations = PASSWORD_ITERATIONS): Promise<PasswordHash> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations }, key, 256);
  return { salt, iterations, hash: Array.from(new Uint8Array(bits), n => n.toString(16).padStart(2, '0')).join('') };
}
export async function verifyPassword(password: string, stored: PasswordHash) { return constantEqual((await hashPassword(password, stored.salt, stored.iterations)).hash, stored.hash); }
