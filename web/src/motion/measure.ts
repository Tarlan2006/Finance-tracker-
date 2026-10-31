interface Measurement { node: HTMLElement; full: string; short: string; base: number; done: (compact: boolean, size: number) => void }
const pending = new Map<HTMLElement, Measurement>();
let scheduled = false;
// One read/write batch for every visible monetary label, instead of two forced
// document layouts per label. The isolated probes preserve tabular font metrics.
export function measureMoney(job: Measurement) {
  pending.set(job.node, job);
  if (!scheduled) { scheduled = true; queueMicrotask(flush); }
  return () => pending.delete(job.node);
}
function flush() {
  scheduled = false;
  const jobs = [...pending.values()].filter(j => j.node.isConnected); pending.clear();
  if (!jobs.length) return;
  const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const readings = jobs.map(j => {
    const style = getComputedStyle(j.node), probe = document.createElement('span'), desired = rootSize * j.base / 16;
    Object.assign(probe.style, { position: 'absolute', whiteSpace: 'nowrap', width: 'max-content', fontWeight: style.fontWeight, fontFamily: style.fontFamily, fontVariantNumeric: style.fontVariantNumeric, letterSpacing: style.letterSpacing, fontSize: `${desired}px` });
    probe.textContent = j.full;
    return { ...j, probe, desired, width: Math.max(0, j.node.clientWidth - 1), compact: false, measured: 0 };
  });
  const container = document.createElement('div');
  Object.assign(container.style, { position: 'fixed', left: '-9999px', top: '0', width: '0', height: '0', contain: 'strict', visibility: 'hidden', pointerEvents: 'none' });
  readings.forEach(r => container.append(r.probe)); document.body.append(container);
  readings.forEach(r => { r.compact = r.probe.getBoundingClientRect().width > r.width; });
  readings.forEach(r => { if (r.compact) r.probe.textContent = r.short; });
  readings.forEach(r => { r.measured = r.probe.getBoundingClientRect().width; });
  container.remove();
  readings.forEach(r => r.done(r.compact, Math.min(r.desired, r.desired * r.width / Math.max(1, r.measured))));
}
