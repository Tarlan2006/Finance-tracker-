import { useEffect, type RefObject } from 'react';
// Only non-destructive dismissal, from the edge or the explicit sheet handle.
export function useDismissGesture(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    const node = ref.current; if (!open || !node) return;
    let start: { x: number; y: number; kind: 'edge' | 'sheet' } | null = null;
    const down = (e: TouchEvent) => { if (e.touches.length !== 1) { start = null; return; } const p = e.touches[0], target = e.target as HTMLElement; const handle = !!target.closest('[data-drag-handle]'); start = p.clientX <= 20 ? { x: p.clientX, y: p.clientY, kind: 'edge' } : handle ? { x: p.clientX, y: p.clientY, kind: 'sheet' } : null; };
    const end = (e: TouchEvent) => { if (!start) return; const p = e.changedTouches[0], dx = p.clientX - start.x, dy = p.clientY - start.y; if (start.kind === 'edge' ? dx > 80 && Math.abs(dy) < 40 : dy > 80 && Math.abs(dx) < 40) close(); start = null; };
    const cancel = () => { start = null; };
    node.addEventListener('touchstart', down, { passive: true }); node.addEventListener('touchend', end, { passive: true }); node.addEventListener('touchcancel', cancel);
    return () => { node.removeEventListener('touchstart', down); node.removeEventListener('touchend', end); node.removeEventListener('touchcancel', cancel); };
  }, [ref, open, close]);
}
