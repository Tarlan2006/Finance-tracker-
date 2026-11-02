import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { counter, stagger } from './core';

const query = () => matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = () => query().matches || document.hidden;
const subscribe = (fn: () => void) => { const media = query(); media.addEventListener('change', fn); return () => media.removeEventListener('change', fn); };
export const usePrefersReducedMotion = () => useSyncExternalStore(subscribe, () => query().matches, () => true);
const tokens = new Map<string, string>();
export function token(name: string) {
  let value = tokens.get(name);
  if (value === undefined) { value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim(); tokens.set(name, value); }
  return value;
}
export const duration = (name = 'dur-base') => parseFloat(token(name)) || 0;
const active = new Map<Element, Animation>();
export function animate(node: Element | null, frames: Keyframe[], options: KeyframeAnimationOptions = {}) {
  if (!node) return;
  active.get(node)?.cancel(); active.delete(node);
  if (reducedMotion() || !node.animate) return;
  const animation = node.animate(frames, { duration: duration(), easing: token('ease-out'), ...options });
  active.set(node, animation);
  const clear = () => { if (active.get(node) === animation) active.delete(node); };
  void animation.finished.then(() => { clear(); animation.cancel(); }, clear);
  return animation;
}
export function useMotionLifecycle() {
  useEffect(() => {
    const stop = () => { document.documentElement.dataset.motionPaused = String(document.hidden); if (reducedMotion()) { active.forEach(a => a.cancel()); active.clear(); document.querySelectorAll('[data-motion-ghost]').forEach(n => n.remove()); } };
    const media = query(); document.addEventListener('visibilitychange', stop); media.addEventListener('change', stop);
    return () => { document.removeEventListener('visibilitychange', stop); media.removeEventListener('change', stop); active.forEach(a => a.cancel()); active.clear(); };
  }, []);
}
let screenAnimation: Animation | undefined;
export function finishScreenTransition() { screenAnimation?.cancel(); screenAnimation = undefined; }
export function transitionScreen(update: () => void) {
  finishScreenTransition();
  // Commit navigation immediately. Only the live content fades, so fixed
  // navigation and headings never become overlapping full-page snapshots.
  flushSync(update);
  screenAnimation = animate(document.querySelector('.main-content'), [{ opacity: .25 }, { opacity: 1 }]);
}
// Exit pixels are inert, aria-hidden and detached from layout. Data/focus updates
// happen immediately; no action waits for the decorative animation to finish.
export function exitSnapshot(node: HTMLElement | null, collapse = false) {
  if (!node || reducedMotion()) return;
  const box = node.getBoundingClientRect(); if (!box.width || !box.height) return;
  const clone = node.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id'); clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  clone.setAttribute('aria-hidden', 'true'); clone.inert = true; clone.dataset.motionGhost = '';
  Object.assign(clone.style, { position: 'fixed', margin: '0', inset: 'auto', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, transform: 'none', pointerEvents: 'none', zIndex: '90', transformOrigin: 'top center' });
  document.body.append(clone);
  const a = animate(clone, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: collapse ? 'scaleY(.05)' : `translateY(${token('motion-distance')}) scale(${token('dialog-scale')})` }], { duration: duration('dur-exit') });
  void a?.finished.then(() => clone.remove(), () => clone.remove());
}
export function useEnter(ref: RefObject<HTMLElement | null>, visible: unknown, kind: 'sheet' | 'fade' = 'fade') {
  useLayoutEffect(() => {
    const node = ref.current; if (!node || !visible) return;
    const desktop = matchMedia('(min-width:1024px)').matches;
    const from = kind === 'sheet' && !desktop ? `translateY(${token('motion-sheet')})` : `scale(${token('dialog-scale')})`;
    // Add to the desktop's CSS centering transform without a synchronous layout
    // read of a previously hidden sheet.
    const a = animate(node, [{ transform: from }, { transform: 'none' }], { composite: 'add', duration: duration('dur-slow'), easing: token('spring') });
    return () => a?.cancel();
  }, [ref, visible, kind]);
}
export function useFlip(ref: RefObject<HTMLElement | null>, key: unknown, selector: string, cascade = false) {
  const previous = useRef(new Map<string, { box: DOMRect; node: HTMLElement }>());
  useLayoutEffect(() => {
    const next = new Map<string, { box: DOMRect; node: HTMLElement }>();
    const nodes = [...(ref.current?.querySelectorAll<HTMLElement>(selector) || [])];
    if (!cascade && !previous.current.size) {
      // Chart bars already grow with CSS; don't also animate/measure 31 parents.
      nodes.forEach(node => next.set(node.dataset.motionKey!, { box: new DOMRect(), node })); previous.current = next;
      return () => { next.forEach(item => { if (item.node.isConnected) item.box = item.node.getBoundingClientRect(); }); };
    }
    nodes.forEach(node => active.get(node)?.cancel());
    // Batch geometry reads before any animation writes.
    nodes.forEach(node => next.set(node.dataset.motionKey!, { box: node.getBoundingClientRect(), node }));
    next.forEach(({ box, node }, id) => {
      const old = previous.current.get(id);
      if (old) {
        const x = old.box.left - box.left, y = old.box.top - box.top;
        if (Math.abs(x) + Math.abs(y) > 1) animate(node, [{ transform: `translate(${x}px,${y}px)` }, { transform: 'none' }]);
      } else if (!cascade || nodes.indexOf(node) < 10) {
        animate(node, [{ opacity: 0, transform: `translateY(${token('motion-distance')})` }, { opacity: 1, transform: 'none' }], { delay: previous.current.size ? 0 : stagger(nodes.indexOf(node), duration('dur-stagger')), fill: 'backwards' });
        if (cascade && previous.current.size && !reducedMotion()) {
          node.classList.add('motion-new');
          node.addEventListener('animationend', () => node.classList.remove('motion-new'), { once: true });
        }
      }
    });
    previous.current = next;
    return () => { next.forEach(item => { if (item.node.isConnected) item.box = item.node.getBoundingClientRect(); }); };
  }, [ref, key, selector, cascade]);
}
export function useNumber(ref: RefObject<HTMLElement | null>, value: number, format: (n: number) => string) {
  const state = useRef<ReturnType<typeof counter> | null>(null), latest = useRef(value);
  const reduce = usePrefersReducedMotion();
  useLayoutEffect(() => {
    state.current = counter(latest.current, { now: () => performance.now(), request: fn => requestAnimationFrame(fn), cancel: id => cancelAnimationFrame(id) }, n => { if (ref.current) ref.current.textContent = format(n); });
    return () => state.current?.stop();
  }, [ref, format]);
  useLayoutEffect(() => { latest.current = value; state.current?.to(value, reduce || document.hidden ? 0 : duration('dur-counter')); }, [value, reduce, format]);
  useEffect(() => { const hide = () => { if (document.hidden) state.current?.to(latest.current, 0); }; document.addEventListener('visibilitychange', hide); return () => document.removeEventListener('visibilitychange', hide); }, []);
}
