import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent } from 'react';

// One pending gesture for the journal. Native scrolling keeps ownership of the pointer.
export function useHoldToSelect() {
  const pending = useRef<{ timer: number; id: number; x: number; y: number } | null>(null);
  const skipClick = useRef(false);
  const finish = useCallback(() => {
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
  }, []);
  const cancel = useCallback(() => {
    if (pending.current) skipClick.current = true;
    finish();
  }, [finish]);
  useEffect(() => {
    const nextPress = (event: globalThis.PointerEvent) => {
      cancel();
      if (event.isPrimary) skipClick.current = false;
    };
    // Revealing the toolbar can move a different button underneath the finger.
    const consumeRelease = (event: MouseEvent) => {
      if (!skipClick.current || event.detail === 0) return;
      skipClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('pointerdown', nextPress, true);
    document.addEventListener('click', consumeRelease, true);
    document.addEventListener('scroll', cancel, true);
    document.addEventListener('visibilitychange', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      finish();
      document.removeEventListener('pointerdown', nextPress, true);
      document.removeEventListener('click', consumeRelease, true);
      document.removeEventListener('scroll', cancel, true);
      document.removeEventListener('visibilitychange', cancel);
      window.removeEventListener('blur', cancel);
    };
  }, [cancel, finish]);

  return (onHold: (() => void) | null, onTap: () => void) => ({
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (!event.isPrimary) return;
      if (event.button !== 0 || !onHold) return;
      const button = event.currentTarget;
      pending.current = {
        id: event.pointerId, x: event.clientX, y: event.clientY,
        timer: window.setTimeout(() => {
          cancel();
          if (button.isConnected && !document.hidden && !button.closest('[inert]')) onHold();
        }, 500),
      };
    },
    onPointerMove(event: PointerEvent<HTMLButtonElement>) {
      const press = pending.current;
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) cancel();
    },
    onPointerCancel: cancel, onPointerLeave: cancel, onLostPointerCapture: cancel,
    onPointerUp: finish,
    onContextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
      if (pending.current || skipClick.current) event.preventDefault();
    },
    onClick: onTap,
  });
}
