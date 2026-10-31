# Отчёт о выпуске Finance Tracker · 31 октября 2026

На [боевом адресе](https://finance-tracker.tarlan-b06.workers.dev) опубликован коммит `3808201c1922b8b718d48ffb4d466a9e6c90a89d`. Cloudflare Version ID — `07d9238c-45ec-49f8-bb16-2842f657675a`.

## Проверки перед публикацией

| Проверка | Результат |
|---|---|
| `npm.cmd run check` | ESLint и TypeScript прошли. Все 183 модульных и API-теста прошли. |
| `npm.cmd run test:e2e` | Все 102 сценария Playwright прошли на mock в светлой и тёмной темах. |
| `npm.cmd run build` | Локальная сборка завершилась успешно. |
| Штатное сканирование секретов | Проверены 499 отслеживаемых файлов и история из 1517 Git-объектов. Совпадений нет. |
| `npm.cmd run deploy` | Повторная проверка в predeploy прошла. Wrangler опубликовал Worker и статические файлы. |

Проверки приложения, сборка и деплой выполнены из чистой локальной копии релизного коммита. Неотслеживаемый файл `MULTIUSER_PROMPT.md` остался в исходном рабочем каталоге и в выпуск не вошёл.

## Проверка боевого адреса

Штатная команда `node scripts/verify-deployment.mjs https://finance-tracker.tarlan-b06.workers.dev` завершилась успешно. Проверка работоспособности API прошла, закрытый API вернул HTTP 401 без сессии, формат публичного списка аккаунтов, защитные заголовки и запрет кэширования API прошли проверку. Повторных запросов из-за ошибок платформы не потребовалось.

Проверочные учётные данные `VERIFY_LOGIN` и `VERIFY_PASSWORD` не были доступны полной парой. Чтение журнала пропущено. Ожидаемые 157 расходов и совпадение месячных сумм на боевой таблице не подтверждены. При проверке записей в таблицу — 0, административных вызовов — 0. Проверок на физических устройствах не было.

Главная страница ссылается на те же JS и CSS, что и локальная сборка. Все три файла, включая service worker, скачаны с боевого адреса и побайтно совпали с файлами из локального `dist`.

| Путь | Байты | SHA-256 |
|---|---:|---|
| `/assets/index-DUqKDAkK.css` | 40488 | `438aae2b35950f628e633b53c9a3c678ae6e6fbd9eac1dd5241d86e93f810592` |
| `/assets/index-ea1W_ESZ.js` | 323609 | `7f8c0ab67c927bd447e695e433cbfea0e81090c28bdf79c3a51aa59eabfd0858` |
| `/sw.js` | 1579 | `e67468d9b783610c8d9519398f177c9bf961543f37bce97ddcc007ae5acd1c32` |

## Git

Адреса чтения и отправки `origin` совпали с `https://github.com/Tarlan2006/Finance-tracker-.git`. После проверки боевого адреса первый обычный `git push origin main` отправил 11 коммитов.

| Момент | Локальная main (HEAD) | origin/main |
|---|---|---|
| До первого push | `3808201c1922b8b718d48ffb4d466a9e6c90a89d` | `737c8cae592409a2936f3e9e4ae7a4b43be125ec` |
| После первого push | `3808201c1922b8b718d48ffb4d466a9e6c90a89d` | `3808201c1922b8b718d48ffb4d466a9e6c90a89d` |

Первый push содержит следующие коммиты, от нового к старому.

```text
3808201 Record release stopped by untracked project file
c6cefbe Record audit resolution and verify offline relinking in both themes
df073c0 Keep only bounded row digests in category operation receipts
213f7e6 Gate releases on mock tests and stream the security audit
62cf27b Bind category confirmation to the previewed expenses
a2a2af3 Reuse the legacy journal read during cold bootstrap
3eac65d Reconcile uncertain writes by reading only the affected journal row
5edb041 Recover from malformed rows and restrict account and operator access
159883e Bind queued writes to sheet versions and protect replayed expense IDs
33e2872 Preserve unchanged cells and guard journal mutations
afc9c04 Document finance tracker audit and data integrity findings
```

Этот отчёт оформлен отдельным коммитом поверх проверенной версии для второго обычного `git push origin main`.
