# AUDIT — аудит исходного проекта codex-context-monitor

Дата: 2026-09-28. Этап 0 (аудит и проектирование). Реализации нет.

Исходник: `C:\Users\vaveMain\Documents\OC\Codex_widget\codex-context-monitor-main` (только чтение).
Все ссылки ниже — на файл `codex_context_monitor.py`, если не указано иное.

## 1. Объект аудита

- Один файл Python (stdlib only, без зависимостей): `codex_context_monitor.py`, 1262 строки, v0.11.
- Тесты: `tests/test_monitor.py`, 843 строки, `unittest`, только синтетические записи (без реальных логов).
- Документация: `README.md` (369 строк), `CHANGELOG.md` (v0.1–v0.11), `CONTRIBUTING.md`, `LICENSE` (MIT), `docs/*.png`.
- Запуск: `py -3 .\codex_context_monitor.py` (терминальный TUI, ширина до 60 колонок, цикл 1 Hz).

## 2. Карта механизмов получения данных

| Механизм | Файл:строки | Функция / участок |
|---|---|---|
| Корень сессий Codex (`~/.codex/sessions` или `$CODEX_HOME/sessions`) | 1151–1155 | `default_sessions_root` |
| Поиск новейшего rollout, пропуск review-детей | 745–784 | `RolloutFollower.newest_rollout` |
| Классификация primary/auxiliary по первым 256 строкам (`thread_source`, `parent_thread_id`, `codex-auto-review`) | 643–717 | `classify_rollout` |
| Полное сканирование файла при старте/переключении | 786–814 | `_scan_full_file` |
| Инкрементальное дочитывание по byte-offset, сохранение незавершенной EOF-строки | 848–881 | `read_new` |
| Предфильтр строк по байтовым иглам (без JSON-парсинга) | 627–640 | `line_might_matter` |
| Первичный разбор usage: `token_usage_record.usage` как сумматор, `token_count` как согласуемый fallback через `max()` | 462–613 | `update_state_from_obj` |
| Модель/усилие только из thread-уровня (`session_meta`, `turn_context`, `world_state`, `thread_settings_applied`) | 255–330 | `update_authoritative_model` |
| Границы TASK: `task_started` с новым `turn_id`; закрытие по `task_complete` / `turn_aborted` с тем же `turn_id` | 362–399 | `update_turn_counters` |
| Реконструкция TASK-базлайна (`total - last`) для переживания рестарта | 402–459 | `_first_task_baseline`, `update_task_usage` |
| Лимиты: только `rate_limits.primary` + `plan_type` | 591–609 | хвост `update_state_from_obj` |
| Отрисовка TURN / TASK / ROLLOUT, бары, `WEEK`/`LIMIT`, футер uptime/activity | 898–1136 | `render` |
| Главный цикл: rescan throttle 5 c, line-diff перерисовка | 1191–1258 | `main`, константы 32–34 |

Ключевой вывод: единственный источник данных — локальные `rollout-*.jsonl`. Официальных API, сетевых вызовов, перехвата трафика нет. Запись в `.codex` отсутствует (монитор, не инжектор).

## 3. Схема данных rollout-*.jsonl (проверено на живых данных)

Живая проверка 2026-09-28: 66 файлов, 51171 строка, период 2026-09-21…28, крупнейший файл 46 МБ.
Codex Desktop (MSIX `OpenAI.Codex_26.924.2738.0_x64`), CLI `0.155–0.158`, процессы `codex.exe` активны.

Топ-уровень `type`: `session_meta`, `response_item`, `event_msg`, `world_state`, `turn_context`, `token_usage_record`, `compacted`, редко `realtime_item`, `inter_agent_communication_metadata`.

Полезные `event_msg.payload.type`: `token_count` (515 событий), `task_started` (373), `task_complete` (366), `turn_aborted` (3), `thread_settings_applied` (425), `user_message` (112), `agent_message`, `message`, `reasoning`. `token_usage_record`: 512 событий в 56 из 66 файлов (есть и старые файлы без них — fallback нужен).

`token_count.info`: `last_token_usage` + `total_token_usage` (`input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`) + `model_context_window` (вживую всегда 258400).

`token_count.rate_limits`: `primary{used_percent, window_minutes=300, resets_at}`, `secondary{used_percent, window_minutes=10080, resets_at}`, `credits{has_credits, unlimited, balance}`, `limit_name`, `limit_id`, `individual_limit`, `rate_limit_reached_type`, `spend_control_reached`. В newest-файле `plan_type` отсутствует (None).

`session_meta`: `thread_source` (`user` / `guardian_review`), `source`, `originator` (`Codex Desktop`), `cwd`, `cli_version`, `id`/`session_id`, `parent_thread_id` у детей. Поле `model` может отсутствовать — тогда модель берется из `turn_context` (проверено: `gpt-5.6-luna`, effort `max`).

`turn_context`: `model`, `effort`, `cwd`, `collaboration_mode`, `turn_id`, `root_turn_id`.

`compacted` (топ-уровень): `window_number`, `window_id` / `previous_window_id` / `first_window_id`, `timestamp`, `latest_token_usage_record{usage, thread_token_usage, turn_token_usage}`. Внимание: `replacement_history`/`guardian_history` содержат полный текст диалога — CDXMonitor их не читает (приватность, см. SPEC).

`models_cache.json`: 9 моделей, `slug`, `context_window=272000`, `max_context_window=872000` (GPT-6), `effective_context_window_percent=95`. Формула окна: 272000 × 0.95 = 258400 — подтверждена живыми событиями и открытыми источниками (openai/codex `models.json`, `openai_models.rs`).

SQLite рядом (недокументированные, только read-only и с изоляцией адаптера): `state_5.sqlite.threads` (`id`, `rollout_path`, `model`, `reasoning_effort`, `tokens_used`, `cwd`, `title`, метки времени, `thread_source`, `archived`), `thread_history_1.sqlite` (`thread_turns`: `status`, `duration_ms`, `started_at`/`completed_at`; `thread_items`), `logs_2.sqlite` (`logs`: `level`, `target`, `thread_id`). Плюс `session_index.jsonl` (`id`, `thread_name`, `updated_at`) и `archived_sessions/`.

Модели вживую: `gpt-5.6-luna`, `gpt-6-luna`, `gpt-6-sol`, `codex-auto-review` (дети).

## 4. Расхождения и пробелы исходного монитора (важно для CDXMonitor)

1. Weekly-лимит не отображается. Монитор читает только `primary` (окно 300 мин = 5 часов) и показывает `WEEK` лишь при `window_minutes >= 10000`. Недельный лимит (`secondary`, 10080 мин) игнорируется полностью. Утверждение README про weekly — неточно для текущей схемы.
2. Игнорируется `cache_write_input_tokens` (есть в обеих usage-структурах).
3. Игнорируются `limit_name`, `limit_id`, `credits`, флаги `spend_control_reached` / `rate_limit_reached_type`.
4. `plan_type` ненадежен (отсутствует в свежих файлах).
5. `compacted`-записи не парсятся (иглы `line_might_matter` их не содержат): счетчика compaction, времени и изменения контекста после сжатия нет — только косвенный отрицательный `Context Δ`.
6. Один выбранный rollout, а не все сессии; суммы по аккаунту нет (и не может быть из локальных файлов).
7. `reasoning_output_tokens` входят в `output_tokens` (по наблюдению автора; независимо не проверено — считать допущением).

## 5. Что переносим в CDXMonitor

- Источник и root-правило (`~/.codex/sessions`, `$CODEX_HOME`).
- Классификатор primary/auxiliary + эвристику newest-mtime (с кэшем).
- Семантику TURN/TASK/ROLLOUT и max-согласование `token_usage_record` vs `token_count` (защита от двойного счета и от потери compaction-usage).
- Границы TASK по `turn_id`, реконструкцию базлайна при рестарте.
- Авторитетные источники модели (thread-уровень), игнор `codex-auto-review`.
- Инкрементальное чтение по offset + partial-EOF, троттлинг rescan, read-only.
- Синтетические тесты без реальных логов (приватность: cwd/имена файлов не коммитить).

## 6. Что делаем иначе

- Парсим `compacted` как первоклассное событие (счетчик, время, окно, usage-снапшот; без текста истории).
- Показываем оба лимита: primary 5h и secondary weekly + полный набор полей `rate_limits`.
- Учитываем `cache_write_input_tokens` отдельной строкой.
- Мультисессионность: все primary-rollout + агрегаты по моделям/проектам (cwd).
- SQLite-источники (`threads`, `thread_turns`) — опциональный второй адаптер, изолированный, с детектором смены схемы.
- Сервер + SSE + веб-UI вместо TUI; демо-режим строго отделен от реальных данных.

## 7. Риски и неизвестные

- Схема JSONL внутренняя и меняется (уже менялась: `token_usage_record`, `compacted`, `cache_write_*`). Нужен детектор неизвестных записей.
- `resets_at`/`used_percent` — единственные сигналы лимитов; семантики ручного сброса в схеме не видно.
- Фокусный тред Codex Desktop извне не определяется — только эвристика newest-mtime.
- Сумма локальных сессий — не статистика аккаунта.
- Доступность `127.0.0.1` из встроенного браузера правой панели Codex — не проверена, тестируется на Этапе 2.
