# Повторное прохождение миссий

## Состояния

`locked → available → in_progress → completed`

- `locked`: запуск и replay запрещены, пока не выполнены prerequisites.
- `available`: первая попытка создаётся с `reward_eligible=true`.
- `in_progress`: повторный запуск возвращает активную попытку.
- `completed`: история сохраняется; replay создаёт новую попытку с
  `reward_eligible=false` и `replay_of_attempt_id`.
- restart переводит текущую попытку в `cancelled` с `close_reason=user_restart`
  и создаёт новую.

## Контракт карточки

`GET /api/missions`, `/api/missions/worlds` и
`/api/missions/worlds/{code}` возвращают:

- `status`, `can_start`, `can_replay`, `active_attempt_id`;
- `attempts_count`, `completed_attempts_count`, `best_score`, `completed_at`;
- `reward_coins`, `reward_claimed`, `reward_eligible`, `reward_state`;
- `sort_order` и `action_label`.

## Запуск и replay

`POST /api/missions/{code}/start`

Обязательный заголовок: `Idempotency-Key`.

Сервер сам определяет режим:

- возвращает существующую `in_progress`;
- создаёт первую попытку для `available`;
- создаёт replay для `completed`, если `MISSIONS_REPLAY_ENABLED=true`;
- возвращает `409 MISSION_LOCKED` для заблокированной миссии.

## Действия, подсказки и restart

Все изменяющие endpoints требуют `Idempotency-Key`:

- `POST /api/missions/attempts/{id}/actions`;
- `POST /api/missions/attempts/{id}/hint`;
- `POST /api/missions/attempts/{id}/restart`.

Повтор запроса с тем же ключом не создаёт второе действие или подсказку.

## Защита награды

`mission_reward_grants` содержит одну запись на
`operator_id + mission_id + mission_version`. Уникальное ограничение является
последней линией защиты от refresh, double-click, повторного HTTP-запроса,
replay и параллельных вкладок. Начисление ledger и создание grant выполняются
в одной транзакции.

## Активное время

`last_activity_at` обновляется на start/resume/action/hint. Каждый промежуток
между активностями ограничен 15 минутами. Записи с полной длительностью более
4 часов помечаются `duration_anomalous` и не участвуют в среднем времени.
Незавершённые попытки без активности дольше `MISSION_ATTEMPT_STALE_HOURS`
закрываются с `close_reason=stale_cleanup`, без удаления истории.

## Rollback

Для отключения только новых replay установите
`MISSIONS_REPLAY_ENABLED=false`. История попыток и защита единственной награды
сохраняются; миграцию откатывать не требуется.
