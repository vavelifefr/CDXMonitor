# STATE — состояние разработки CDXMonitor

## Текущий статус: Этап 0 завершен, ждет утверждения. Реализации нет.

## Выполнено (2026-09-28)

- Аудит исходника `codex-context-monitor-main` (v0.11, 1262 строки + тесты 843 строки): карта
механизмов, схема JSONL, пробелы (weekly-лимит, cache-write, `compacted`, `plan_type`) — `docs/AUDIT.md`.
- Живая проверка на установленном Codex Desktop: 66 rollout, 51171 строка, окно 258400,
модели gpt-5.6-luna / gpt-6-luna / gpt-6-sol, каталог 272000 × 95%, primary 5h + secondary weekly.
- Каталог метрик Д/В/О/Н — `docs/METRICS.md`. Спецификация и приемка A1–A7 — `docs/SPEC.md`.
- Архитектура, стек, план E1–E8 — `docs/ARCHITECTURE.md`. Решения — `docs/DECISIONS.md`.
- Тесты Этапа 0: только чтение/пробы (probe1–5, синтетика не требовалась); probes лежат в
`%TEMP%\opencode\probe*.py` и не являются частью проекта.

## Известные ограничения (не блокеры аудита)

- Доступность `127.0.0.1` из встроенного браузера Codex не проверена (пункт приемки A7, Этап 2).
- `reasoning ⊆ output` — допущение автора исходника, независимо не подтверждено.
- `credits.balance` и семантика spend-флагов не интерпретированы (показываем как есть).
- Сумма локальных сессий ≠ статистика аккаунта (маркировка О).

## Выполнено: Этап 1 — TS-коллектор одного rollout (2026-09-28)

- `server/src/collector/`: `types`, `parse` (порт 1-в-1 + secondary-лимиты, cache-write,
`compacted`, unknown-счетчик), `classify`, `tail` (offset + partial-EOF), `snapshot`, `cli`.
- Зависимости: только `typescript` + `@types/node` (dev, локально). `tsc` чистый.
- Тесты: `npm test` — 20/20, 8 suites, только синтетика.
- A1: сверка с эталоном на живых файлах, точное совпадение целочисленных счетчиков —
105 КБ primary (27/27 полей), 418 МБ primary (23/23, время CLI 1.99 c). Legacy-файлов без
`token_usage_record` среди primary не найдено (10 файлов без них — не primary); legacy-ветка
покрыта синтетическими тестами.
- Проверки: `check_enc` чистый (BOM на .ts/.md, JSON без BOM, без CJK/mojibake).

## Выполнено: Этап 2 — HTTP API + SSE + stub + boot (2026-09-28)

- `server/src/server.ts` (stdlib `node:http`): `/api/health` (CORS `*`), `/api/snapshot`,
`/api/sessions` (id/kind/mtime/size), `/api/events` (SSE 1 Hz), `/boot`, `/` (stub).
`server/src/main.ts`: `--port` (default 8765), `--bind` (default 127.0.0.1), graceful shutdown.
- `web/boot.html`: работает по `file://`, кнопка `cdxmonitor://start`, опрос health 1 c,
автопереход; fallback — ручная команда с подставленным путем. `web/stub.html`: живые цифры по SSE.
- `scripts/launch.ps1` (скрытый старт + лог `%TEMP%`), `scripts/install-protocol.ps1` (HKCU, без админа).
- Тесты: `npm test` — 25/25 (20 коллектор + 5 сервер incl. SSE). `tsc` чистый.
- Smoke на живых данных: health ok, автовыбран newest primary, снапшот 46-МБ сессии
(gpt-6-sol/max, ctx 36.8%, 5h 81% / weekly 59%, compaction 14, tasks 34/33, unknown 0),
66 сессий в списке, boot отдается.
- Открыто: A7/R1 — проверка `http://127.0.0.1:8765/` и `boot.html` во встроенном браузере
панели Codex выполняется пользователем (результат сообщить).

## Выполнено: Этап 3 — компактный React UI (2026-09-28, v0.3.0)

- `webapp/` (React 18 + Vite 7, без CDN в рантайме): вкладки Overview / Context / Tokens / Limits,
SSE-подписка, клиентский тик 1 c для обратных отсчетов, бейджи N/A, темная компактная верстка
(max-width 460 px). Сборка `npm run build:ui` → `web/app/` (gitignore, регенерация).
- Сервер: раздача `web/app` с realpath-защитой и allowlist расширений; `/` → app (fallback stub
без сборки); `/stub` сохранен для отладки. Тесты guard: index/assets/traversal.
- Проверки: `npm test` — 29/29 (incl. `typecheck:ui`); smoke на живых данных: `/` отдает app,
asset 200 JS, traversal 404, stub жив.
- Открыто: визуальная проверка в панели Codex пользователем (A7/R1); Sessions/History/
Diagnostics/Settings — этапы E4–E7.
- Хелп: `web/help.html` (один файл, без картинок: установка, запуск, вкладки, лимиты,
проблемы, приватность) на маршруте `/help`, ссылки из boot/stub; тест расширен.
- Фикс ссылок (баг): все межстраничные ссылки — явные `*.html`; сервер отдает алиасы
`/boot.html`, `/help.html` (тесты); футер хелпа protocol-aware (по file:// вместо ссылки
на монитор — подсказка); ссылка «Помощь» в футере React-приложения. Проверено: цели ссылок
существуют на диске, алиасы 200, ссылка в бандле.
- `web/Statistic.html`: файл-алиас на `http://127.0.0.1:8765/` (meta-refresh + JS с `?port=`,
маршрут `/Statistic.html`, тест); в boot.html обе ссылки с пояснением (прямая при запущенном
сервере + алиас для закладок); входит в пакет.
- Фикс установщика (баг): `Copy-Item` каталога в существующий каталог вкладывал его внутрь
(`web\web`) — теперь копируется содержимое; плюс миграция артефактов старого установщика.
Проверен полный цикл с нуля в TEMP.
- Протокол `cdxmonitor://` регистрирует `install.ps1` (команда → `start.cmd` установки),
`uninstall.ps1` снимает регистрацию. Проверено в реестре: регистрация → запуск по команде
протокола → удаление регистрации.
- Абсолютные ссылки: `install.ps1` переписывает межстраничные href в установленной копии
на машинно-специфичные `file:///...` (идемпотентно, `.bak`, серверные/mailto/cdxmonitor
не трогает); страницы содержат shim, возвращающий серверные алиасы при работе по HTTP
(браузеры блокируют переход http→file). Алиас `/stub.html` добавлен. Проверено в TEMP.
- Lock-файл `data/server.lock`: Node ставит SO_REUSEADDR, и на Windows два сервера могут
молча делить порт (наблюдалось: ответы от «мертвых» процессов) — второй экземпляр на том же
data-dir теперь отказывается явно (проверка живости PID, takeover stale). `stop.cmd` чистит
lock. Тест spawn×2.
- Команда `cdxm` (`packaging/cdxm.cmd` + `cdxm.ps1`): без аргументов — поднять и показать URL,
`--open` — открыть в браузере по умолчанию, `stop`/`status`/`help`. `install.ps1` добавляет
папку в user PATH (с согласия, + broadcast), `uninstall.ps1` убирает. Сервер терпит BOM
в JSON-конфиге. Проверено в TEMP: help/status/start/stop, PATH туда-обратно чисто.
`--open` живьем не тестировался (открывает браузер).
- `stop.cmd` дописывает `stopped via stop.cmd` в лог (taskkill /F не дает серверу
записаться самому). Проверено: строка в логе, порт закрыт, pid/lock убраны.
- Скрытый запуск (баг «окно терминала»): `start.cmd` поднимает сервер без окна консоли
(powershell Start-Process Hidden), ждет health до 10 c и сообщает итог; диагностика —
`--log-file` (`data/cdxmonitor.log`, старт/ошибки/fatal). Протокол тоже запускает скрыто.
Проверено: MainWindowHandle=0, лог пишется, stop.cmd останавливает. Тест `--log-file`
через spawn. Попутно fixed: `--port 0` теперь означает эфемерный порт (был fallback).

## Git (2026-09-28)

- Локальный репозиторий: `main`, коммит `4b7fbb7`, 68 файлов (LICENSE MIT, без
node_modules/dist/web-app). Remote `origin` → `https://github.com/vavelifefr/CDXMonitor.git`.
- Push невозможен: репозитория на GitHub еще нет (404), создать его без gh/токена не могу.
Жду создания пустого `CDXMonitor` в `vavelifefr`, затем `git push -u origin main`.

## Релиз v0.5.0 (2026-09-28)

Состав: E1–E3, boot/Statistic/help, cdxm, скрытый запуск, lock-файл, переносимый пакет,
плагин Codex ($cdx-stats/$cdx-open), setup.exe. Проверки ниже — все зеленые.

## Категории v0.5.0 — Turns/Tools/Sessions/CodexDB (2026-09-28)

- Коллектор: turnStats/turnModels (по `turn_id`), toolCalls (`response_item`), series (cap 10000);
A1-семантика не тронута. Тесты 43/43 (incl. synthetic SQLite через `node:sqlite`).
- API: `/api/turns` (кэш 30 c + `?refresh=1`), `/api/activity` (tools + series),
`/api/reviews` (on-demand скан auxiliary, кэш), `/api/codex/*` (ro SQLite/JSON, вручную).
- UI: вкладки Turns (фильтр по модели, авто 30 c + кнопка), Tools (счетчики + цена review
кнопкой), Sessions (ось контекста + список файлов), CodexDB (кнопка: проекты, сессии,
туры по кнопке, окна каталога); флаги лимитов уже были в Limits.
- Каденс снижен: SSE/снапшот 1 c → 5 c, rescan 5 c → 15 c (события минутные; отсчеты и
LIVE считаются клиентом из меток — потерь нет). Boot-опрос 1 c оставлен (до перехода).
- Живая проверка: 43 тура, tools (reasoning 2503, custom_tool_call 1603…), 60 review-файлов
за 0.2 c (23.6M in), проекты CtrlVave/Dental Tech Calendar, каталог 9 моделей.

## Этап P — плагин Codex + setup.exe (2026-09-28, v0.3.0→v0.4.0)

- `codex-plugin/cdx-monitor/`: portable `plugin.json`, skills `$cdx-stats` (таблица снапшота,
только явный вызов) и `$cdx-open` (Chrome с фолбэком, `-DryRun`, `-Page help`).
- `install.ps1`: установка плагина с согласия (`-Force` без спроса, `-SkipPlugin` отказ,
`-HomeRoot` для тестов): копия в `.codex\plugins`, merge персонального marketplace
(точно по документации, `.bak`, без дублей). `uninstall.ps1` вычищает оба.
- `setup.exe`: компилируется `build-release` штатным Framework `csc` (без SDK на целевой
машине); `--version`/`--help`; делегирует `install.ps1`.
- Проверено в TEMP-HOME: установка/переустановка (одна запись), живые цифры `$cdx-stats`
по поднятому серверу, `open.ps1 -DryRun` (URL + путь Chrome), удаление (каталог и запись
исчезли, реальный HOME не тронут). Открыто: появление плагина в UI Codex после рестарта
(проверяет пользователь); песочница Codex для локальных скриптов скилла — при первом вызове.
- Найдено: `$dict.key += $x` молча теряется на OrderedDictionary в PS 5.1 — только явное
присваивание.
- `uninstall.exe` (пара к `setup.exe`): `--keep-data`/`--remove-data`/`--home-root`,
самокопирование в TEMP (образ нельзя удалить запущенным), fire-and-forget (ожидание
блокирует удаление), отложенная чистка stage, проброс HomeRoot для чистки плагина.
- Удаление корня: свежие бинарники минутами лочатся AV/индексатором (ручное удаление позже —
ок) — retry 10×500мс + отложенный скрытый `rd`-цикл ~10 мин + честное сообщение.
Проверено: keep-data (файлы ушли включая exe, data цела), remove-data (отложенно).

## Исследование интеграции (2026-09-28, без изменений в Codex)

Источники: `developers.openai.com/codex/app/browser` (In-app browser), `/app/local-environments`
(Actions), issues openai/codex #32334 (краш webview с локальной страницей на старых сборках —
закрыт; наша 26.924 новее, держать в уме), #24107 (`codex://new` — лишь запрос фичи, не механизм).

Выводы:
- Документированного способа программно открыть URL / зарегистрировать страницу нет:
браузер открывается из тулбара, по клику URL, вручную или Ctrl+Shift+B; Actions выполняют
только скрипты во встроенном терминале; наш сценарий (локальный сервер + file://) явно
входит в поддерживаемые (local dev servers, file-backed previews).
- Архитектура интеграции = fallback (утверждена в SPEC F15/F17, ARCHITECTURE §9):
одна команда, стабильный URL, готовая инструкция; `chrome-native-hosts-v2.json`, расширения
и недокументированные внедрения запрещены.
- Persistence вкладки: доки упоминают отсутствие поддержки «existing tabs» — вероятно,
не сохраняется; проверяется вручную по протоколу (ARCHITECTURE §9), без заявлений до факта.
- В план внесены: F16/F17, A12/A13, реестр `.cdxmonitor-install.json`, независимые тоглы.

Статус: ждет согласования архитектуры интеграции. Установку Codex не трогал.

## Дополнение: переносимая сборка и интеграция Codex (2026-09-28, принято, без установки)

- Требования F12–F15 / A9–A11 внесены в SPEC; раскладка `release/CDXMonitor/` и E8 — в ARCHITECTURE §9–10.
- Порт по умолчанию сменен на 8765 (сервер, boot, launch.ps1); занятый порт — явная ошибка exit 1.
- Actions: официальный механизм подтвержден (действия выполняются во встроенном терминале,
конфиг в `.codex` проекта) — инструкция войдет в release-README на E8.
- Persistence вкладки с локальным URL после перезапуска Codex — не подтверждена, проверяется на E8.
- Установка в каталоги Codex НЕ выполнялась и не будет без явного утверждения расположения.
- Node runtime для сборки (PATH vs bundled node.exe) — решение на E8.
- Пакет v0.3.0 собран досрочно (`scripts\build-release.ps1` + `packaging/`): --config/--pid-file/
--data-dir в сервере, маркер `.cdxmonitor-release`, install с сохранением `data/`, uninstall
с защитой маркера. Полный цикл проверен в TEMP: install → reinstall (data цела) → start.cmd →
health/help/app 200 → stop.cmd (порт закрыт) → uninstall (data цела) → uninstall -RemoveData.
Codex-каталоги не тронуты. Хелп §8 — конкретный состав пакета, цели, запуск.

## Изменения после ревью (2026-09-28)

- Требование пользователя: boot-страница работает без сервера (кнопка запуска +
опрос статуса + автопереход). Внесено: SPEC F11/A8, ARCHITECTURE §3/§8 + E2, DECISIONS.

## Следующий шаг

E4: мультисессии (список + переключение + суммарный вид, Sessions-вкладка).
