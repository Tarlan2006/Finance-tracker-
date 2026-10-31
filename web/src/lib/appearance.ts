import { useEffect, useState } from 'react';
import { duration } from '../motion';
import { palette } from '../../../shared/analytics';
import { storage } from './storage';
export function useAppearance(accountId?: string) {
  const preference = accountId ? `theme:${accountId}` : "theme:login";
  const [theme, setTheme] = useState(storage.getItem(preference) || 'system');
  useEffect(() => { setTheme(storage.getItem(preference) || "system"); }, [preference]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)');
    let timer: ReturnType<typeof setTimeout>;
    const apply = () => { const light = theme === 'light' || theme === 'system' && media.matches; document.documentElement.dataset.theme = light ? 'light' : 'dark'; palette[light ? 'light' : 'dark'].forEach((color, i) => document.documentElement.style.setProperty(`--chart-${i}`, color)); document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#F5F5F7' : '#000000'); };
    const change = () => { if (theme !== 'system') return; clearTimeout(timer); document.documentElement.classList.add('theme-changing'); apply(); timer = setTimeout(() => document.documentElement.classList.remove('theme-changing'), duration('dur-theme')); };
    apply(); storage.setItem(preference, theme); media.addEventListener('change', change); return () => { clearTimeout(timer); document.documentElement.classList.remove('theme-changing'); media.removeEventListener('change', change); };
  }, [theme, preference]);
  return { theme, setTheme };
}
