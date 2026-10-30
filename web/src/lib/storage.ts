// Preferences and read caches are optional. Durable expense writes still require IndexedDB.
export const storage = {
  getItem(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key: string, value: string): boolean { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  removeItem(key: string): boolean { try { localStorage.removeItem(key); return true; } catch { return false; } },
  keys(): string[] { try { return Object.keys(localStorage); } catch { return []; } }
};
