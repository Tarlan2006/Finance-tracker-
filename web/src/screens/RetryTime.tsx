import { useEffect, useState } from 'react';

export default function RetryTime({ at }: { at?: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!at || at <= Date.now()) return;
    const tick = () => { if (!document.hidden) setNow(Date.now()); };
    tick();
    const timer = setInterval(() => { tick(); if (Date.now() >= at) clearInterval(timer); }, 1000);
    return () => clearInterval(timer);
  }, [at]);
  if (!at || at <= now) return null;
  return <small>Следующая попытка в {new Date(at).toLocaleTimeString('ru-RU')} · через {Math.ceil((at - now)/1000)} с</small>;
}
