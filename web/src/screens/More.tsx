import type { AccountView } from '../../../shared/accounts';
import { syncText, type SyncResult } from '../lib/sync-result';
import Account from './Account';
import { useState } from 'react';
import { today } from '../../../shared/logic';
import type { Bootstrap } from '../../../shared/types';
import type { Queued } from '../lib/queue';
import MonthPicker from './MonthPicker';
import RetryTime from './RetryTime';
import Icon from './Icon';
import Settings, { type SettingsActions } from './Settings';
export default function More({ data, queue, lastSync, theme, setTheme, sync, exportCsv, logout, settingsOpen, setSettingsOpen, changeConfig, removeItem, account, token, changePassword }: { account: AccountView; token: string; changePassword: (current: string, next: string, repeat: string) => Promise<void>; settingsOpen: boolean; setSettingsOpen: (open: boolean) => void; data: Bootstrap; queue: Queued[]; lastSync?: SyncResult; theme: string; setTheme: (theme: string) => void; sync: () => Promise<void>; exportCsv: (month: string) => Promise<void>; logout: () => void } & SettingsActions) {
  const confirmed = queue.length === 0 && lastSync?.kind === 'sent';
  const errors = queue.filter(row => row.status === 'error').length;
  const [accountOpen, setAccountOpen] = useState(false);
  const current = today(data.tz).slice(0, 7), [month, setMonth] = useState(current), earliest = data.history.reduce((min, e) => e.date.slice(0, 7) < min ? e.date.slice(0, 7) : min, current);
  if (accountOpen) return <Account account={account} token={token} change={changePassword} logout={logout} back={() => setAccountOpen(false)}/>;
  if (settingsOpen) return <Settings data={data} back={() => setSettingsOpen(false)} changeConfig={changeConfig} removeItem={removeItem}/>;
  return <section className="more-screen"><h1>Ещё</h1><button className="panel settings-action settings-entry" onClick={() => setAccountOpen(true)}>Аккаунт · {account.displayName}<Icon name="next"/></button><button className="panel settings-action settings-entry" onClick={() => setSettingsOpen(true)}>Настройки<Icon name="next"/></button><div className="settings-grid"><div>
    <h2 className="group-title">Синхронизация</h2>
    <div className="panel sync-panel">
      <div className="label-row"><span>{queue.length ? `В очереди — ${queue.length}` : confirmed ? 'Все записи отправлены' : 'Очередь пуста'}</span>{confirmed && <span aria-label="Отправка подтверждена"><Icon name="check"/></span>}</div>
      {errors > 0 && <p className="error" role="status">Требуют исправления — {errors}. Откройте «Траты», чтобы повторить отправку, исправить или убрать запись.</p>}
      <div className="label-row"><span>Последняя попытка</span><span>{lastSync ? new Date(lastSync.at).toLocaleString('ru-RU') : '—'}</span></div>
      <div className="label-row"><span>Результат</span><span role="status">{lastSync ? syncText(lastSync) + (lastSync.status ? ' · HTTP ' + lastSync.status : '') : 'Отправка ещё не запускалась'}</span></div>
      {queue.length > 0 && <RetryTime at={lastSync?.nextAt}/>}
      <button className="settings-action" onClick={() => void sync()}><Icon name="refresh"/>Синхронизировать<Icon name="next"/></button>
    </div><p className="footnote">Очередь отправляется при открытом приложении и доступной сети. После выхода она зашифрована и откроется после входа в этот аккаунт.</p>
    <h2 className="group-title">Оформление</h2><div className="panel"><label className="settings-row">Тема<select aria-label="Тема" value={theme} onChange={e => setTheme(e.target.value)}><option value="system">Как в системе</option><option value="dark">Тёмная</option><option value="light">Светлая</option></select></label></div>
    <h2 className="group-title">Данные</h2><div className="panel"><MonthPicker month={month} setMonth={setMonth} earliest={earliest} current={current}/><button className="settings-action" onClick={() => void exportCsv(month)}><Icon name="download"/>Экспорт CSV за месяц<Icon name="next"/></button></div><p className="footnote">Доходы, ежемесячные расходы и категории — в настройках.</p>
  </div><div><h2 className="group-title">Запись из уведомления</h2><div className="panel"><h3>Из платежа — в журнал</h3><p>MacroDroid открывает ссылку с суммой и магазином. Проверьте категорию и сохраните.</p><a className="settings-action" href="/MACRODROID.md" target="_blank" rel="noreferrer">Настроить MacroDroid<Icon name="arrow"/></a></div>
    <h2 className="group-title">Аккаунт</h2><div className="panel"><p>Выход завершит сеанс и уберёт историю с этого устройства.</p><button className="settings-action danger-action" onClick={logout}><Icon name="logout"/>Выйти<Icon name="next"/></button></div><p className="footnote">Очистка данных сайта удалит неотправленные записи. Перед очисткой отправьте очередь.</p>
  </div></div><p className="version">Finance Tracker · {data.tz}<br/>Ваши записи — в вашей таблице.</p></section>;
}
