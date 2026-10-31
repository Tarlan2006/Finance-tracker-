import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { activeItems, categoryLabel, moneySum } from '../../../shared/config';
import { colorIndex } from '../../../shared/analytics';
import { shiftMonth, today } from '../../../shared/logic';
import type { Bootstrap, Config, ConfigCategory, ConfigItem } from '../../../shared/types';
import { useDialog } from '../lib/dialog';
import Icon from './Icon';
const money = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₸`;
const emojis = ['🍔', '☕', '🚗', '🎁', '💊', '🛍️', '🎬', '📚', '🏠', '✈️', '🐾', '🏃', '🎮', '💻', '📱', '🎵', '🌿', '🧾', '🛠️', '💰', '👕', '🚌', '🍎', '⭐'];
export interface SettingsActions { changeConfig: (path: string, body: Record<string, unknown>) => Promise<{ config?: Config; count?: number; previewHash?: string }>; removeItem: (item: ConfigItem, month: string) => void }
type Editor = { type: 'setup' | 'item' | 'remove' | 'category' | 'archive'; category?: ConfigCategory; item?: ConfigItem; operationId: string };
export default function Settings({ data, back, changeConfig, removeItem }: { data: Bootstrap; back: () => void } & SettingsActions) {
  const [month, setMonth] = useState(today(data.tz).slice(0, 7)), [editor, setEditor] = useState<Editor | null>(null);
  const [name, setName] = useState(''), [amount, setAmount] = useState(''), [emoji, setEmoji] = useState(''), [kind, setKind] = useState('income'), [start, setStart] = useState(month), [scope, setScope] = useState('forward'), [target, setTarget] = useState('');
  const [count, setCount] = useState<number | null>(null), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [archive, setArchive] = useState(false);
  const previewHash = useRef('');
  const dialog = useRef<HTMLFormElement>(null), lock = useRef(false);
  const close = useCallback(() => { if (!lock.current) { setEditor(null); setError(''); } }, []);
  useDialog(dialog, !!editor, close);
  const config = data.config, items = activeItems(config?.items || [], month), categories = (config?.categories || []).slice().sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  function open(type: Editor['type'], value?: ConfigCategory | ConfigItem) {
    const category = value && 'emoji' in value ? value : undefined, item = value && 'kind' in value ? value : undefined;
    previewHash.current = '';
    setEditor({ type, category, item, operationId: crypto.randomUUID() }); setName(value?.name || ''); setAmount(String(category?.limit || item?.amount || '')); setEmoji(category?.emoji || ''); setKind(item?.kind || 'income'); setStart(month); setScope('forward'); setTarget(''); setCount(null); setConfirmed(false); setError('');
  }
  async function action(work: () => Promise<unknown>) { if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить'); } finally { lock.current = false; setBusy(false); } }
  const path = editor?.category ? `config/categories/${editor.category.id}` : editor?.item ? `config/items/${editor.item.id}` : editor?.type === 'category' ? 'config/categories' : 'config/items';
  async function submit() {
    if (!editor) return;
    await action(async () => {
      if (editor.type === 'setup') { await changeConfig('config/setup', {}); setEditor(null); return; }
      if (editor.type === 'remove') { removeItem(editor.item!, month); setEditor(null); return; }
      const body: Record<string, unknown> = { operationId: editor.operationId };
      if (editor.type === 'item') Object.assign(body, { month: editor.item ? month : start, amount, ...(editor.item ? { rev: editor.item.rev, scope } : { name, kind }) });
      else {
        Object.assign(body, editor.type === 'archive' ? { rev: editor.category!.rev, archived: true, ...(target ? { targetId: target } : {}) } : { name, emoji, limit: amount, ...(editor.category ? { rev: editor.category.rev } : {}) });
        const renaming = editor.category && (name !== editor.category.name || emoji !== editor.category.emoji);
        if (!confirmed && (editor.type === 'archive' || renaming)) {
          const preview = await changeConfig(`${path}?dry=1`, body);
          if (!preview.previewHash) throw new Error('Обновите приложение и повторите предпросмотр');
          previewHash.current = preview.previewHash;
          setCount(preview.count || 0);
          setConfirmed(true);
          return;
        }
      }
      if (confirmed) body.previewHash = previewHash.current;
      await changeConfig(path, body); setEditor(null);
    });
  }
  const title = editor?.type === 'setup' ? 'Создать настройки' : editor?.type === 'remove' ? 'Убрать статью' : editor?.type === 'archive' ? 'Удалить категорию' : editor?.type === 'category' ? editor.category ? 'Изменить категорию' : 'Добавить категорию' : editor?.item ? 'Изменить сумму' : 'Добавить статью';
  const income = moneySum(items.filter(i => i.kind === 'income').map(i => i.amount)), fixed = moneySum(items.filter(i => i.kind === 'fixed').map(i => i.amount));
  return <section className="config-screen"><div inert={!!editor}><button className="text-button config-back" onClick={back}><Icon name="back"/>Ещё</button><h1>Настройки</h1>
    {!config?.configured ? <div className="panel config-notice"><h2>Настройки не созданы.</h2><p>Сейчас приложение читает ваш прежний справочник и сводку доходов. Создайте настройки, чтобы менять статьи и категории здесь.</p><button className="primary" onClick={() => open('setup')}>Создать</button></div> : <>
      <div className="config-month month-picker"><button className="icon-button" aria-label="Предыдущий месяц настроек" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="back"/></button><label>Месяц настроек<input type="month" value={month} onChange={e => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setMonth(e.target.value); }}/></label><button className="icon-button" aria-label="Следующий месяц настроек" onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="next"/></button></div>
      <div className="config-columns"><div><h2 className="group-title">Доходы и ежемесячные расходы</h2>{(['income', 'fixed'] as const).map(group => <div className="panel" key={group}><h2>{group === 'income' ? 'Доходы' : 'Ежемесячные расходы'}</h2>{items.filter(i => i.kind === group).map(item => <article className="config-row" key={item.id} data-testid={`item-${item.name}`}><button className="config-row-main" onClick={() => open('item', item)}><span>{item.name}</span><strong>{money(item.amount)}</strong></button><button className="icon-button danger-action" aria-label={`Убрать ${item.name}`} onClick={() => open('remove', item)}><Icon name="close"/></button></article>)}{!items.some(i => i.kind === group) && <p className="muted">Нет действующих статей</p>}<div className="config-total"><span>Итого</span><strong>{money(group === 'income' ? income : fixed)}</strong></div></div>)}<button className="settings-action" onClick={() => open('item')}><Icon name="plus"/>Добавить статью</button><div className="panel"><p>Остаток при нулевых личных расходах</p><strong className="config-balance">{money(income - fixed)}</strong></div></div>
      <div><h2 className="group-title">Категории и лимиты</h2><div className="panel config-category-list">{categories.filter(c => c.archived === archive).map((category, index, list) => <article className="config-category" key={category.id}><div className="config-row"><button className="config-row-main" onClick={() => open('category', category)}><span><i className="config-dot" style={{ background: `var(--chart-${colorIndex(category.id)})` }}/>{categoryLabel(category)}{category.archived ? ' (архив)' : ''}<small>{data.history.filter(e => e.date.startsWith(month) && e.category === categoryLabel(category)).length} записей · {category.limit ? `лимит ${money(category.limit)}` : 'без лимита'}</small></span></button></div><div className="config-row-actions">{!archive && <><button disabled={busy || index === 0} aria-label={`Поднять ${category.name}`} onClick={() => void action(() => changeConfig(`config/categories/${category.id}`, { operationId: crypto.randomUUID(), rev: category.rev, move: -1 }))}>↑</button><button disabled={busy || index === list.length - 1} aria-label={`Опустить ${category.name}`} onClick={() => void action(() => changeConfig(`config/categories/${category.id}`, { operationId: crypto.randomUUID(), rev: category.rev, move: 1 }))}>↓</button></>}{archive ? <button disabled={busy} onClick={() => void action(() => changeConfig(`config/categories/${category.id}`, { operationId: crypto.randomUUID(), rev: category.rev, archived: false }))}>Вернуть</button> : <button className="danger-action" onClick={() => open('archive', category)}>Удалить</button>}</div></article>)}{!categories.some(c => c.archived === archive) && <p className="muted">{archive ? 'Архив пуст' : 'Добавьте первую категорию'}</p>}</div><div className="config-row-actions"><button onClick={() => open('category')}>Добавить категорию</button><button aria-pressed={archive} onClick={() => setArchive(!archive)}>{archive ? 'Активные категории' : 'Архив'}</button></div></div></div>
    </>}
    <p className="footnote config-help">Месяцы без данных используют последнее указанное значение статьи. Изменения сумм сохраняют прошлые месяцы.</p><p className="footnote config-help">Настройки хранятся в двух служебных листах FT. Выпадающий список категорий в Google Sheets по старому «Справочнику» может устаревать.</p>{error && !editor && <p role="alert" className="error">{error}</p>}
    </div>{editor && createPortal(<div className="modal-backdrop config-backdrop"><form ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={title} onSubmit={event => { event.preventDefault(); void submit(); }}><div className="section-heading"><h2>{title}</h2><button type="button" aria-label="Закрыть настройки" disabled={busy} onClick={close}><Icon name="close"/></button></div>
      {editor.type === 'setup' ? <p>Будут созданы два служебных листа. Старые листы не изменятся.</p> : editor.type === 'remove' ? <p>Убрать «{editor.item!.name}» начиная с {month}? Прошлые месяцы сохранятся. После подтверждения будет 5 секунд для отмены.</p> : editor.type === 'archive' ? <><p>{categoryLabel(editor.category!)}</p><label>Что сделать<select value={target} disabled={confirmed} onChange={e => setTarget(e.target.value)}><option value="">Архивировать</option>{categories.filter(c => !c.archived && c.id !== editor.category!.id).map(c => <option value={c.id} key={c.id}>Переместить записи в {categoryLabel(c)}</option>)}</select></label><p className="footnote">Архивная категория исчезнет из выбора. Старые траты останутся в отчётах.</p></> : confirmed ? <p>{emoji} {name}<br/>{amount ? `Месячный лимит: ${money(Number(amount.replace(',', '.')))}` : 'Без лимита'}</p> : <fieldset disabled={busy || confirmed} className="config-fields">
        {(editor.type === 'category' || !editor.item) && <label>Название<input value={name} onChange={e => setName(e.target.value)} maxLength={editor.type === 'category' ? 40 : 80} required/></label>}
        {editor.type === 'category' ? <><label>Эмодзи<input value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={32}/></label><div className="emoji-options" aria-label="Быстрый выбор эмодзи">{emojis.map(e => <button key={e} type="button" aria-label={`Эмодзи ${e}`} aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>)}</div></> : !editor.item ? <><label>Тип<select value={kind} onChange={e => setKind(e.target.value)}><option value="income">Доход</option><option value="fixed">Ежемесячный расход</option></select></label><label>С месяца<input type="month" value={start} onChange={e => setStart(e.target.value)} required/></label></> : <p>{editor.item.name} · {month}</p>}
        <label>{editor.type === 'category' ? 'Месячный лимит' : 'Сумма статьи'}<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} required={editor.type !== 'category'}/></label>{editor.type === 'category' ? <p className="footnote">0 или пусто — без лимита. Лимиты не меняют остаток бюджета.</p> : editor.item && <label>Период изменения<select value={scope} onChange={e => setScope(e.target.value)}><option value="forward">С этого месяца и дальше</option><option value="month">Только этот месяц</option></select></label>}
      </fieldset>}
      {confirmed && <p className="config-confirm">{editor.type === 'archive' && !target ? `В архиве сохранятся ${count} записей` : `Будет обновлено ${count} записей`}</p>}{error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : confirmed ? 'Подтвердить' : editor.type === 'setup' ? 'Создать настройки' : editor.type === 'remove' ? 'Убрать начиная с этого месяца' : editor.type === 'archive' ? 'Продолжить' : 'Сохранить'}</button><button type="button" disabled={busy} onClick={close}>Отмена</button>
    </form></div>, document.body)}</section>;
}
