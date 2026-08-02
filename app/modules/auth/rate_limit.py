"""Защита логина от перебора: скользящее окно по аккаунту и по IP.

Почему окно, а не вечный счётчик:

1. Записи обязаны истекать. Раньше словарь чистился только при успешном
   входе, поэтому каждая неудачная попытка с новым логином оставляла запись
   навсегда — перебор случайных логинов надувал память до OOM.
2. Успешный вход больше не снимает блокировку по IP. Раньше атакующий с
   любой валидной учёткой сбрасывал IP-счётчик и продолжал перебор чужого
   аккаунта. Теперь IP-штраф истекает сам, по времени.

Чтобы п.2 не блокировал офис за общим NAT, у IP отдельный, более щедрый
порог: пять опечаток коллег не должны запирать всех.

Хранилище процесс-локальное. При нескольких воркерах лимит действует в
каждом отдельно — для распределённого нужен Redis.
"""
from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from time import monotonic

# Неудачи забываются через это время после последней попытки.
WINDOW_SECONDS = 900.0
# Жёсткий потолок на размер словаря — страховка от всплеска уникальных ключей.
MAX_ENTRIES = 10_000


@dataclass(slots=True)
class LoginPenalty:
    failures: int = 0
    blocked_until: float = 0.0
    last_seen: float = 0.0


class LoginRateLimiter:
    """Process-local guard keyed by both account and trusted client IP."""

    def __init__(
        self,
        *,
        threshold: int = 5,
        maximum_delay: int = 300,
        ip_threshold: int | None = None,
        window: float = WINDOW_SECONDS,
        max_entries: int = MAX_ENTRIES,
    ) -> None:
        self.threshold = threshold
        # IP делят коллеги за общим NAT, поэтому порог выше аккаунтного.
        self.ip_threshold = ip_threshold if ip_threshold is not None else threshold * 2
        self.maximum_delay = maximum_delay
        self.window = window
        self.max_entries = max_entries
        self._entries: dict[str, LoginPenalty] = {}
        self._lock = Lock()

    # ── внутреннее (вызывается под локом) ────────────────────────────────

    def _is_stale(self, penalty: LoginPenalty, moment: float) -> bool:
        """Штраф отбыт и новых попыток давно не было — запись можно выкинуть."""
        return moment >= penalty.blocked_until and moment - penalty.last_seen > self.window

    def _prune(self, moment: float) -> None:
        for key in [k for k, v in self._entries.items() if self._is_stale(v, moment)]:
            del self._entries[key]
        # Если всплеск уникальных ключей всё же переполнил словарь — выкидываем
        # самые старые, иначе память растёт неограниченно.
        overflow = len(self._entries) - self.max_entries
        if overflow > 0:
            oldest = sorted(self._entries.items(), key=lambda item: item[1].last_seen)
            for key, _ in oldest[:overflow]:
                del self._entries[key]

    def _threshold_for(self, key: str) -> int:
        return self.ip_threshold if key.startswith("ip:") else self.threshold

    # ── публичный API ────────────────────────────────────────────────────

    def retry_after(self, account: str, client_ip: str, now: float | None = None) -> int:
        moment = monotonic() if now is None else now
        with self._lock:
            penalties = [
                self._entries.get(f"account:{account.casefold()}"),
                self._entries.get(f"ip:{client_ip}"),
            ]
            blocked_until = max(
                (penalty.blocked_until for penalty in penalties if penalty), default=0
            )
        return max(0, int(blocked_until - moment + 0.999))

    def failure(self, account: str, client_ip: str, now: float | None = None) -> None:
        moment = monotonic() if now is None else now
        with self._lock:
            for key in (f"account:{account.casefold()}", f"ip:{client_ip}"):
                penalty = self._entries.setdefault(key, LoginPenalty())
                # Окно прошло без новых попыток — счётчик начинается заново.
                if penalty.last_seen and moment - penalty.last_seen > self.window:
                    penalty.failures = 0
                    penalty.blocked_until = 0.0
                penalty.failures += 1
                penalty.last_seen = moment
                threshold = self._threshold_for(key)
                if penalty.failures >= threshold:
                    delay = min(self.maximum_delay, 2 ** (penalty.failures - threshold))
                    penalty.blocked_until = max(penalty.blocked_until, moment + delay)
            self._prune(moment)

    def success(self, account: str, client_ip: str, now: float | None = None) -> None:
        """Снимает штраф с аккаунта. IP намеренно не трогаем: иначе любой,
        у кого есть хоть одна валидная учётка, обнулял бы IP-лимит и спокойно
        перебирал чужие пароли. IP-штраф истечёт сам через окно."""
        moment = monotonic() if now is None else now
        with self._lock:
            self._entries.pop(f"account:{account.casefold()}", None)
            self._prune(moment)

    def entry_count(self) -> int:
        """Размер хранилища — для тестов и диагностики."""
        with self._lock:
            return len(self._entries)


login_rate_limiter = LoginRateLimiter()
