# CDXMonitor

Локальный монитор статистики Codex Desktop с веб-интерфейсом для боковой панели Codex.
Открывается по `http://127.0.0.1:8765/` во встроенном браузере. Только чтение данных Codex,
без сети, патчей и сбора текстов диалогов.

Статус: v0.5.0 (коллектор, сервер + SSE, React UI, boot/help/Statistic, `cdxm`, пакет,
плагин Codex). Полная инструкция — `web/help.html` (маршрут `/help`).

## Требования

Windows 11 x64, установленный Codex Desktop, Node.js 24+ в PATH.

## Быстрый старт (из исходников)

```powershell
npm install
npm test        # сборка + проверки
npm run build:ui
npm run serve   # http://127.0.0.1:8765/
```

## Переносимая сборка

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-release.ps1
```

Папка `release/CDXMonitor/` переносится целиком: `setup.exe` (установка),
`start.cmd` (скрытый запуск) / `stop.cmd`, `cdxm` (терминал), `codex-plugin/`
(скиллы `$cdx-stats` / `$cdx-open`). Цели: `%LOCALAPPDATA%\OpenAI\Codex\CDXMonitor`
(основной) или `%LOCALAPPDATA%\CDXMonitor` (запасной). Файлы Codex не затрагиваются.

## Интерфейс

Overview / Context / Tokens / Limits (лимиты 5h + weekly, флаги) / Turns (потурнево,
фильтр по модели) / Tools (инструменты, цена review) / Sessions (ось контекста, файлы) /
CodexDB (проекты, сессии, туры, окна каталога — вручную). Данные обновляются автоматически.

## Документы

- `docs/AUDIT.md` — аудит исходного монитора и живых данных Codex.
- `docs/METRICS.md` — каталог метрик (достоверные / вычисляемые / оценочные / недоступные).
- `docs/SPEC.md` — спецификация и критерии приемки.
- `docs/ARCHITECTURE.md` — стек, модули, план этапов.
- `docs/DECISIONS.md` — журнал решений.
- `docs/STATE.md` — текущее состояние.
- `AGENTS.md` — инструкции для LLM-агентов.

Исходник для анализа (только чтение, не редактировать):
`C:\Users\vaveMain\Documents\OC\Codex_widget\codex-context-monitor-main`

Git: https://github.com/vavelifefr/CDXMonitor (MIT).
Autor: Vave© 2026 · vave@yandex.ru
