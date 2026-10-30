import { useEffect, type RefObject } from 'react';
export function useDialog(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open || !ref.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const targets = () => [...node.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,[tabindex="0"]')];
    targets()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') { const items = targets(), index = items.indexOf(document.activeElement as HTMLElement); if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1)?.focus(); } else if (!event.shiftKey && index === items.length - 1) { event.preventDefault(); items[0]?.focus(); } }
    };
    const back = () => close();
    node.addEventListener('keydown', key); window.addEventListener('popstate', back);
    return () => { node.removeEventListener('keydown', key); window.removeEventListener('popstate', back); previous?.focus(); };
  }, [open, ref, close]);
}
