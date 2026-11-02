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
      const root = document.documentElement;
      for (const [name, value] of [['--viewport-bottom', `${Math.max(0, window.innerHeight - height - top)}px`], ['--viewport-top', `${top}px`], ['--viewport-height', `${height}px`]]) if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
      const state = keyboard ? 'open' : 'closed'; if (root.dataset.keyboard !== state) root.dataset.keyboard = state;
      if (keyboard) requestAnimationFrame(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!active || !/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
        const surface = active.closest<HTMLElement>('.modal, .scroll-surface') || window;
        const panel = surface instanceof HTMLElement ? surface.querySelector<HTMLElement>('.save-bar') : null;
        const panelHeight = panel?.getBoundingClientRect().height || 0;
        const rect = active.getBoundingClientRect(), bottom = top + height - panelHeight - 12;
        const options = active.getAttribute('aria-controls');
        const suggestions = options ? document.getElementById(options) : null;
        const fieldBottom = rect.bottom + (suggestions ? suggestions.getBoundingClientRect().height + 4 : 0);
        if (fieldBottom > bottom) surface.scrollBy(0, fieldBottom - bottom);
        else if (rect.top < top + 12) surface.scrollBy(0, rect.top - top - 12);
      });
    };
    viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update); document.addEventListener('focusin', update); document.addEventListener('focusout', update); document.addEventListener('input', update); update();
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update); document.removeEventListener('focusin', update); document.removeEventListener('focusout', update); document.removeEventListener('input', update); };
  }, []);
}
