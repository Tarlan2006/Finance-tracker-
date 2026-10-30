import { useEffect, useMemo, useRef, useState } from 'react';
import { nameSuggestions } from '../../../shared/logic';
import type { Expense } from '../../../shared/types';
export default function NameInput({ value, onChange, history }: { value: string; onChange: (value: string) => void; history: Expense[] }) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const wrapper = useRef<HTMLDivElement>(null);
  const choices = useMemo(() => nameSuggestions(history).filter(n => n.includes(value.trim().toLocaleLowerCase('ru'))).slice(0, 5), [history, value]);
  useEffect(() => { const outside = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside); }, []);
  function choose(name: string) { onChange(name); setOpen(false); setActive(-1); }
  return <div className="name-field" ref={wrapper}><label htmlFor="name">Название <span>необязательно</span></label>
    <div className="input-with-action"><input id="name" role="combobox" aria-autocomplete="list" aria-controls="name-options" aria-expanded={open && choices.length > 0} aria-activedescendant={active >= 0 && open ? `name-option-${active}` : undefined} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="Например, покушать" value={value} onFocus={() => setOpen(true)} onChange={event => { onChange(event.target.value); setOpen(true); setActive(-1); }} onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(index => Math.max(0, Math.min(choices.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); }
      if (event.key === 'Enter' && open && active >= 0 && choices[active]) { event.preventDefault(); choose(choices[active]); }
      if (event.key === 'Tab') setOpen(false);
    }}/></div>
    {open && choices.length > 0 && <ul id="name-options" className="name-options" role="listbox" aria-label="Подсказки названия">{choices.map((name, i) => <li key={name} id={`name-option-${i}`} role="option" aria-selected={active === i} onPointerDown={event => event.preventDefault()} onClick={() => choose(name)}>{name}</li>)}</ul>}
  </div>;
}
