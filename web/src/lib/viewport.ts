import { useEffect } from 'react';
// Android Chrome may resize only the visual viewport, not layout viewport.
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      const inputFocused = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') && (document.activeElement as HTMLInputElement).inputMode !== 'none';
      const keyboard = inputFocused && (window.innerHeight - height > 120 || height < 600);
      document.documentElement.style.setProperty('--viewport-bottom', `${Math.max(0, window.innerHeight - height - top)}px`);
      document.documentElement.style.setProperty('--viewport-top', `${top}px`);
      document.documentElement.style.setProperty('--viewport-height', `${height}px`);
      document.documentElement.dataset.keyboard = keyboard ? 'open' : 'closed';
    };
    viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update); document.addEventListener('focusin', update); document.addEventListener('focusout', update); update();
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update); document.removeEventListener('focusin', update); document.removeEventListener('focusout', update); };
  }, []);
}
