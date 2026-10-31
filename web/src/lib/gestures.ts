import { useEffect, type RefObject } from 'react';
import { animate, duration, reducedMotion, token } from '../motion';
// Pointer capture is restricted to handles. Normal content keeps native scrolling.
export function useDismissGesture(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    const node = ref.current; if (!open || !node) return;
    let drag: { id: number; x: number; y: number; time: number; edge: boolean; base: string; handle: HTMLElement } | null = null;
    const reset = () => { node.style.removeProperty('transform'); node.style.removeProperty('will-change'); };
    const down = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0 || matchMedia('(min-width:1024px)').matches) return;
      const target = e.target as HTMLElement, handle = target.closest<HTMLElement>('[data-drag-handle],[data-edge-handle]');
      if (!handle || target.closest('button,input,select,textarea')) return;
      const base = getComputedStyle(node).transform;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now(), edge: handle.hasAttribute('data-edge-handle'), base: base === 'none' ? '' : base, handle };
      handle.setPointerCapture(e.pointerId);
      if (!reducedMotion()) node.style.willChange = 'transform';
    };
    const move = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const distance = Math.max(0, drag.edge ? e.clientX - drag.x : e.clientY - drag.y);
      if (!reducedMotion()) node.style.transform = `${drag.base} translate${drag.edge ? 'X' : 'Y'}(${distance}px)`;
    };
    const finish = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const distance = Math.max(0, drag.edge ? e.clientX - drag.x : e.clientY - drag.y), velocity = distance / Math.max(1, performance.now() - drag.time);
      const from = getComputedStyle(node).transform, base = drag.base || 'none';
      drag = null;
      if (e.type === 'pointerup' && (distance > 80 || distance > 24 && velocity > .45)) { close(); reset(); }
      else { reset(); animate(node, [{ transform: from }, { transform: base }], { duration: duration('dur-slow'), easing: token('spring') }); }
    };
    const hide = () => { if (document.hidden) { drag = null; reset(); } };
    node.addEventListener('pointerdown', down); node.addEventListener('pointermove', move); node.addEventListener('pointerup', finish); node.addEventListener('pointercancel', finish); node.addEventListener('lostpointercapture', finish); document.addEventListener('visibilitychange', hide);
    return () => { node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', finish); node.removeEventListener('pointercancel', finish); node.removeEventListener('lostpointercapture', finish); document.removeEventListener('visibilitychange', hide); reset(); };
  }, [ref, open, close]);
}
