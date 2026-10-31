import { useLayoutEffect, useRef } from 'react';
import { animate } from './index';
export default function Progress({ value }: { value: number }) {
  const ref = useRef<HTMLElement>(null), previous = useRef(0);
  const ratio = Math.min(1, Math.max(0, value));
  useLayoutEffect(() => {
    const node = ref.current;
    const from = node?.getAnimations().length ? getComputedStyle(node).transform : `scaleX(${previous.current})`;
    animate(node, [{ transform: from }, { transform: `scaleX(${ratio})` }]); previous.current = ratio;
  }, [ratio]);
  return <i ref={ref} style={{ transform: `scaleX(${ratio})` }}/>;
}
