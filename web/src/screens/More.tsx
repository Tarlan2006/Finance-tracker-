import { useState } from 'react';
import { today } from '../../../shared/logic';
import type { Bootstrap } from '../../../shared/types';
import type { Queued } from '../lib/queue';
import MonthPicker from './MonthPicker';
import Icon from './Icon';
import Settings, { type SettingsActions } from './Settings';
export default function More({ data, queue, theme, setTheme, sync, exportCsv, logout, settingsOpen, setSettingsOpen, changeConfig, removeItem }: { settingsOpen: boolean; setSettingsOpen: (open: boolean) => void; data: Bootstrap; queue: Queued[]; theme: string; setTheme: (theme: string) => void; sync: () => Promise<void>; exportCsv: (month: string) => Promise<void>; logout: () => void } & SettingsActions) {
  const current = today(data.tz).slice(0, 7), [month, setMonth] = useState(current), earliest = data.history.reduce((min, e) => e.date.slice(0, 7) < min ? e.date.slice(0, 7) : min, current);
  if (settingsOpen) return <Settings data={data} back={() => setSettingsOpen(false)} changeConfig={changeConfig} removeItem={removeItem}/>;
  return <section className="more-screen"><h1>Ещё</h1><button className="panel settings-action settings-entry" onClick={() => setSettingsOpen(true)}>Настройки<Icon name="next"/></button><div className="settings-grid"><div>
    <h2 className="group-title">Синхронизация</h2><div className="panel"><div className="label-row"><span>{queue.length ? `${queue.length} записей в очереди` : 'Все записи отправлены'}</span><Icon name="check"/></div><button className="settings-action" onClick={() => void sync()}><Icon name="refresh"/>Синхронизировать<Icon name="next"/></button></div><p className="footnote">Очередь отправляется при открытом приложении и доступной сети. После выхода она зашифрована и откроется с прежним кодом.</p>
    <h2 className="group-title">Оформление</h2><div className="panel"><label className="settings-row">Тема<select aria-label="Тема" value={theme} onChange={e => setTheme(e.target.value)}><option value="system">Как в системе</option><option value="dark">Тёмная</option><option value="light">Светлая</option></select></label></div>
    <h2 className="group-title">Данные</h2><div className="panel"><MonthPicker month={month} setMonth={setMonth} earliest={earliest} current={current}/><button className="settings-action" onClick={() => void exportCsv(month)}><Icon name="download"/>Экспорт CSV за месяц<Icon name="next"/></button></div><p className="footnote">Доходы, ежемесячные расходы и категории — в настройках.</p>
  </div><div><h2 className="group-title">Запись из уведомления</h2><div className="panel"><h3>Из платежа — в журнал</h3><p>MacroDroid открывает ссылку с суммой и магазином. Проверьте категорию и сохраните.</p><a className="settings-action" href="/MACRODROID.md" target="_blank" rel="noreferrer">Настроить MacroDroid<Icon name="arrow"/></a></div>
    <h2 className="group-title">Код доступа</h2><div className="panel"><p>Выход удалит код и сохранённую историю с этого устройства.</p><button className="settings-action danger-action" onClick={logout}><Icon name="logout"/>Выйти<Icon name="next"/></button></div><p className="footnote">Очистка данных сайта удалит неотправленные записи. Перед сменой кода отправьте очередь.</p>
  </div></div><p className="version">Finance Tracker · {data.tz}<br/>Ваши записи — в вашей таблице.</p></section>;
}
