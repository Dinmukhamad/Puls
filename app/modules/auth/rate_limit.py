from __future__ import annotations

from dataclasses import dataclass
from threading import Lock
from time import monotonic


@dataclass(slots=True)
class LoginPenalty:
    failures: int = 0
    blocked_until: float = 0


class LoginRateLimiter:
    """Small process-local guard keyed by both account and trusted client IP."""

    def __init__(self, *, threshold: int = 5, maximum_delay: int = 300) -> None:
        self.threshold = threshold
        self.maximum_delay = maximum_delay
        self._entries: dict[str, LoginPenalty] = {}
        self._lock = Lock()

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
                penalty.failures += 1
                if penalty.failures >= self.threshold:
                    delay = min(
                        self.maximum_delay,
                        2 ** (penalty.failures - self.threshold),
                    )
                    penalty.blocked_until = max(penalty.blocked_until, moment + delay)

    def success(self, account: str, client_ip: str) -> None:
        with self._lock:
            self._entries.pop(f"account:{account.casefold()}", None)
            self._entries.pop(f"ip:{client_ip}", None)


login_rate_limiter = LoginRateLimiter()
