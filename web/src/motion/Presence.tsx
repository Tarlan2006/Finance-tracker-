import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { animate, duration } from './index';
// Keep only the outgoing pixels, never an actionable or announced old message.
export default function Presence({ children }: { children: ReactNode }) {
  const [last, setLast] = useState(children), ref = useRef<HTMLDivElement>(null), revision = useRef(0);
  useLayoutEffect(() => {
    const current = ++revision.current;
    if (children) { setLast(children); return; }
    const node = ref.current?.firstElementChild;
    const effect = animate(node || null, [{ opacity: 1 }, { opacity: 0 }], { duration: duration('dur-exit') });
    const finish = () => { if (revision.current === current) setLast(null); };
    if (effect) void effect.finished.then(finish, finish); else finish();
    return () => { revision.current++; effect?.cancel(); };
  }, [children]);
  return children || last ? <div ref={ref} style={{ display: 'contents' }} inert={!children} aria-hidden={!children || undefined}>{children || last}</div> : null;
}
