import { useState } from 'react';
import Logo from './Logo';

export default function TableConnection({ state, error, check, prepare, logout }: {
  state: string;
  error: string;
  check: () => Promise<void>;
  prepare: () => Promise<void>;
  logout: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [checked, setChecked] = useState(false);
  const unlinked = state === 'sheet_unlinked';
  async function run(action: () => Promise<void>) {
    setPending(true);
    setChecked(false);
    try { await action(); setChecked(true); }
    finally { setPending(false); }
  }
  return <main className="login table-connection" aria-busy={pending}>
    <Logo className="login-logo"/>
    <h1>{unlinked ? 'Таблица ещё не подключена' : 'Таблица готова к настройке'}</h1>
    <p>{unlinked ? 'Попросите администратора подключить вашу Google-таблицу, затем проверьте подключение.' : 'Создайте журнал и начальные категории. Доходы и ежемесячные расходы можно добавить позже в настройках.'}</p>
    <div className="connection-actions">
      <button className="primary" disabled={pending} onClick={() => void run(unlinked ? check : prepare)}>{pending ? 'Проверяем таблицу…' : unlinked ? 'Проверить подключение' : 'Подготовить таблицу'}</button>
      {!unlinked && <button disabled={pending} onClick={() => void run(check)}>Проверить подключение</button>}
      <button className="text-button" disabled={pending} onClick={logout}>Выйти</button>
    </div>
    {error ? <p role="alert" className="error">{error}</p> : checked && <p role="status">{unlinked ? 'Проверено — ожидаем подключения администратором' : 'Подключение работает — можно подготовить таблицу'}</p>}
  </main>;
}
