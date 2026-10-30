import { useEffect, useState } from 'react';
import { palette } from '../../../shared/analytics';
import { storage } from './storage';
export function useAppearance() {
  const [theme, setTheme] = useState(storage.getItem('theme') || 'system');
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: light)');
    const apply = () => { const light = theme === 'light' || theme === 'system' && media.matches; document.documentElement.dataset.theme = light ? 'light' : 'dark'; palette[light ? 'light' : 'dark'].forEach((color, i) => document.documentElement.style.setProperty(`--chart-${i}`, color)); document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#F5F5F7' : '#000000'); };
    apply(); storage.setItem('theme', theme); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply);
  }, [theme]);
  return { theme, setTheme };
}
