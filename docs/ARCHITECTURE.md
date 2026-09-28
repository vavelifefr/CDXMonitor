# ARCHITECTURE — архитектура CDXMonitor

Статус: проект, на согласовании. Стек подтверждается Этапом 1–2, смена — через `docs/DECISIONS.md`.

## 1. Стек (предпочтительный)

- Сервер: TypeScript + Node.js 24 (проверено: v24.21.0). Без PowerShell в ядре мониторинга.
- UI: React + Vite (SPA, темная тема, Stats-for-Nerds: плотность, мини-бары, цифры первым).
- API: HTTP JSON + SSE-пуш (1 Hz тик, diff на клиенте). WebSocket не нужен.
- История: встроенный `node:sqlite` (без нативных аддонов вроде better-sqlite3).
- Тесты: `node:test` + синтетические JSONL-фикстуры; `tsc --noEmit` в CI-скрипте.

Альтернатива (если TS-реплей упрется в perf на 46-МБ файлах): коллектор на Python-stdlib
(порт 1-в-1), сервер тот же. Решение — после замера Этапа 1.

## 2. Модули сервера (`server/src/`)

```
collector/   watcher (tail по offset, rescan 5 c) + parser (JSONL → события) + classifier
metrics/     нормализация: TURN/TASK/ROLLOUT, max-согласование, baseline TASK, percents
store/       node:sqlite: сырые события (опц.), минутные агрегаты, offsets, compaction-лог
api/         REST: /api/snapshot, /api/sessions, /api/history?range&group, /api/limits, /api/health
push/        SSE /api/events (snapshot-diff + alerts: compaction, смена схемы, сброс бейджа)
diag/        счетчики unknown-записей, ошибок, версий схем; детектор смены формата
```

Адаптеры источников изолированы: `rollout-jsonl` (обязательный), `codex-sqlite` (опциональный,
только `threads`/`thread_turns`/`logs`-агрегаты, read-only `mode=ro`), `models-cache` (окна каталога).
Смена недокументированного формата роняет только свой адаптер + пишет в diag.

## 3. UI (`web/`, React + Vite)

Стартовая страница `boot.html` — вне сборки: чистый HTML + inline JS/CSS, работает по `file://`
без сервера (контракт — раздел 8). Основной UI — React SPA (ниже).

```
views: Overview | Context | Tokens | Limits | Sessions | History | Diagnostics | Settings
store: SSE-подписка, compact/full режимы (compact ≤ 380 px без прокрутки первого экрана)
badges: EST (оценка), N/A (нет данных), DEMO (синтетика), AUX (review-дети)
```

Первый экран (compact): модель, окно `занято/всего`, % + бар, fresh/cache, TURN/TASK/ROLLOUT-строки,
5h/weekly бары с обратным отсчетом, last activity. Графики — только в History/расширенном.

## 4. Поток данных

```
rollout-*.jsonl ──tail──▶ parser ──events──▶ metrics ──snapshot──▶ SSE ──▶ React
        │                              │              (store: агрегаты + offsets)
        └──────── rescan/классификация ─┘
models_cache.json ──▶ окна каталога (справочно)      codex-sqlite ──ro──▶ sessions/turns (опц.)
```

## 5. Ключевые решения (подробности — DECISIONS.md)

- Порт семантики Python-монитора 1-в-1 (включая max-согласование и TASK-baseline), сверка A1.
- `compacted` — первоклассное событие; тексты истории не читаем (белый список полей).
- Secondary-лимит — первоклассный (исправляем пробел исходника).
- Мультисессионность: снапшот активной + ленивые агрегаты остальных (не держать 66 файлов открытыми).
- История CDXMonitor ≠ сумма файлов: хранить свои агрегаты наблюдений с меткой источника.

## 6. Риски

R1. Встроенный браузер Codex может не открывать `127.0.0.1` — проверка на Этапе 2; запасной путь:
тот же UI во внешнем браузере (функционал не теряется, удобство — да).
R2. Смена внутренней схемы Codex — митигация: diag-счетчики + изолированные адаптеры + синтетические тесты.
R3. Стартовый реплей больших файлов — потоковый парсинг, прогресс в /api/health.
R4. План/лимиты ChatGPT-авторизации могут менять окна (прецеденты 353K→258K) — окно всегда из событий, не хардкод.

## 8. Boot-контракт (старт без сервера, требование пользователя)

- `web/boot.html`: ноль зависимостей, inline CSS/JS, открывается напрямую (двойной клик / `file://`)
при остановленном сервере. Показывает статус сервера и кнопку запуска.
- Кнопка → кастомный протокол `cdxmonitor://start` → регистрация в HKCU (install-скрипт,
без прав администратора) → скрытый запуск `node server`. Лаунчер на PowerShell — допустимое
вспомогательное исключение (ядро мониторинга без PowerShell, по ТЗ).
- `GET /api/health` отдает `Access-Control-Allow-Origin: *`; boot опрашивает его каждую секунду
и при 200 делает `location.replace('http://127.0.0.1:<порт>/')`.
- Fallback без протокола: boot показывает ручную команду запуска и продолжает опрос —
переход автоматический, как только сервер поднялся.
- Порт по умолчанию фиксирован (значение — на E2); кастомный порт — ручной URL (детали на E2).
- Сервер также отдает тот же `boot.html` по `/boot` для консистентности.

## 9. Переносимая сборка (реализация — Этап 8)

```
release/CDXMonitor/
  web/            ui-bundle + boot.html + pages/*.html
  server/         dist + production-зависимости (npm ci --omit=dev)
  config/         cdxmonitor.json (port default 8765, bind 127.0.0.1, dataDir ../data)
  data/           создается при старте (SQLite E5, offsets); обновлениями не затирается
  start.cmd       запуск двойным кликом (node из PATH или bundled node.exe — решение на E8)
  stop.cmd        завершение по PID-файлу
  install.ps1     проверки (каталог, права, существующие файлы) + копирование с подтверждением
                  цели: %LOCALAPPDATA%\OpenAI\Codex\CDXMonitor, fallback %LOCALAPPDATA%\CDXMonitor
  uninstall.ps1   удаляет только дерево CDXMonitor
  README.md       установка, запуск, подключение к Codex, действие Start CDXMonitor
```

- Сервер читает `--config` (JSON: port/bind/sessions/dataDir/pidFile, CLI перекрывает);
`--data-dir` создает каталог (история — E5); `--pid-file` для `stop.cmd`.
- Сборка: `scripts\build-release.ps1` (tsc + vite + раскладка) из `packaging/`-шаблонов;
маркер `.cdxmonitor-release` защищает install/uninstall от чужих каталогов.
- Страницы: `GET /api/pages` (список) + `GET /pages/<имя>.html` с realpath-защитой
(basename, суффикс `.html`, файл обязан лежать внутри `web/pages/`); rescan при старте,
watcher — опционально позже. Главная (E3+) показывает переключатель из `/api/pages`.
- Интеграция Codex: инструкция «Start CDXMonitor» через Local Environments → Actions
(официальный механизм: действие запускает `start.cmd` во встроенном терминале; конфиг в `.codex`
проекта). Persistence вкладки с локальным URL после перезапуска Codex — не подтверждена,
проверяется на E8 и фиксируется как есть. Автозапуск в Windows — опция, default off.
- Реестр установки `.cdxmonitor-install.json` (корень установки): `schemaVersion`,
`packageVersion`, `installDir`, `url`, `port`, `bind`, `autostart:{server,openTab}`,
`codexAction:{configured,projectPath}`, `installedAt`, `updatedAt`. Атомарная запись
(temp + rename), бэкап `.bak` перед обновлением. Поток install: маркер+реестр есть →
обновление (файлы, версия, пути; `data/` и настройки целы); нет → новая установка.
- Автооткрытие вкладки: документированного механизма нет (исследование 2026-09-28, ниже) —
архитектура = fallback: одна команда (`start.cmd` / Action), постоянный URL
`http://127.0.0.1:8765/`, готовая инструкция открытия (boot/Statistic/help). Если в документации
появится механизм регистрации страницы — использовать его, при переустановке обновлять
регистрацию вместо дубликата. Запрещены: `chrome-native-hosts-v2.json`, расширения Codex,
недокументированные внедрения.
- Проверка persistence вкладки (только вручную, без заявлений до факта): открыть URL во
встроенном браузере → перезапустить Codex → зафиксировать есть/нет → записать в STATE.
- Установка в каталоги Codex выполняется только после явного утверждения расположения
пользователем; подготовка пакета ≠ разрешение на установку.

## 10. План этапов (уточненный)

- E0. Аудит и проект (этот документ). Готово, ждет утверждения.
- E1. TS-коллектор одного rollout → CLI-снапшот JSON; сверка A1 с Python-монитором; тесты на синтетике.
- E2. HTTP API + SSE + stub-страница + `boot.html` + `/api/health` (CORS `*`); проверка `127.0.0.1` из панели Codex (R1).
- E3. Компактный UI: Overview/Context/Tokens/Limits.
- E4. Мультисессии + Sessions-вид.
- E5. SQLite-история + History/графики.
- E6. Compaction-метр + полный блок лимитов + доп. метрики.
- E7. Диагностика, perf (46 МБ), детектор схемы.
- E8. Упаковка: `release/CDXMonitor/` + install/uninstall + release-README + инструкция
Start CDXMonitor (Actions) + полный чек-лист §6 дополнения (установка, запуск без dev-среды,
API, страницы, история после рестарта, обновление без потери data, stop, чистое удаление,
persistence вкладки). Установка в каталоги Codex — только после утверждения расположения.

Каждый этап: рабочий результат + smoke + `tsc` + регрессия + запись в STATE.md.
