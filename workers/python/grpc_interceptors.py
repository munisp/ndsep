"""
NDSEP gRPC Interceptors for Python Workers
============================================
Production-grade interceptor chain:
  - Circuit breaker (CLOSED → OPEN → HALF_OPEN) per service
  - Retry with exponential backoff + jitter
  - Deadline propagation (configurable per-call, default 5s)
  - Prometheus-compatible metrics collection
  - Internal service auth token injection
  - HTTP/gRPC-Web bridge for transcoded endpoints

Usage:
    interceptor = GrpcInterceptor("compliance-ai")
    result = await interceptor.execute(lambda: call_service(req))

    # Or with HTTP bridge:
    result = await grpc_http_call("compliance-ai", "QueryCompliance", url, body)
"""

import asyncio
import logging
import math
import os
import random
import time
from dataclasses import dataclass, field
from enum import IntEnum
from threading import Lock
from typing import Any, Callable, Awaitable, Optional

import httpx

log = logging.getLogger("ndsep.grpc")

# ─── gRPC Status Codes ──────────────────────────────────────────────────────

class GrpcCode(IntEnum):
    OK = 0
    CANCELLED = 1
    UNKNOWN = 2
    INVALID_ARGUMENT = 3
    DEADLINE_EXCEEDED = 4
    NOT_FOUND = 5
    ALREADY_EXISTS = 6
    PERMISSION_DENIED = 7
    RESOURCE_EXHAUSTED = 8
    ABORTED = 10
    INTERNAL = 13
    UNAVAILABLE = 14
    DATA_LOSS = 15
    UNAUTHENTICATED = 16

    def is_retryable(self) -> bool:
        return self in {
            GrpcCode.UNAVAILABLE,
            GrpcCode.DEADLINE_EXCEEDED,
            GrpcCode.RESOURCE_EXHAUSTED,
            GrpcCode.ABORTED,
            GrpcCode.INTERNAL,
        }

    @staticmethod
    def from_http_status(status: int) -> "GrpcCode":
        mapping = {
            400: GrpcCode.INVALID_ARGUMENT,
            401: GrpcCode.UNAUTHENTICATED,
            403: GrpcCode.PERMISSION_DENIED,
            404: GrpcCode.NOT_FOUND,
            409: GrpcCode.ALREADY_EXISTS,
            429: GrpcCode.RESOURCE_EXHAUSTED,
            500: GrpcCode.INTERNAL,
            503: GrpcCode.UNAVAILABLE,
            504: GrpcCode.DEADLINE_EXCEEDED,
        }
        return mapping.get(status, GrpcCode.UNKNOWN)


class GrpcError(Exception):
    def __init__(self, code: GrpcCode, message: str):
        self.code = code
        self.message = message
        super().__init__(f"grpc {code.name}: {message}")


# ─── Circuit Breaker ────────────────────────────────────────────────────────

class CircuitState:
    CLOSED = "CLOSED"
    OPEN = "OPEN"
    HALF_OPEN = "HALF_OPEN"


@dataclass
class CircuitBreaker:
    name: str
    failure_threshold: int = 5
    success_threshold: int = 2
    reset_timeout_s: float = 30.0
    _state: str = field(default=CircuitState.CLOSED, init=False)
    _failures: int = field(default=0, init=False)
    _successes: int = field(default=0, init=False)
    _last_opened_at: Optional[float] = field(default=None, init=False)
    _lock: Lock = field(default_factory=Lock, init=False)

    @property
    def state(self) -> str:
        return self._state

    def allow(self) -> bool:
        if self._state == CircuitState.CLOSED:
            return True
        if self._state == CircuitState.OPEN:
            if self._last_opened_at and (time.monotonic() - self._last_opened_at >= self.reset_timeout_s):
                with self._lock:
                    if self._state == CircuitState.OPEN:
                        self._state = CircuitState.HALF_OPEN
                        self._successes = 0
                        log.info(f"[gRPC:circuit:{self.name}] HALF_OPEN — probing recovery")
                return True
            return False
        return True  # HALF_OPEN allows probe

    def record_success(self) -> None:
        self._failures = 0
        if self._state == CircuitState.HALF_OPEN:
            with self._lock:
                self._successes += 1
                if self._successes >= self.success_threshold:
                    self._state = CircuitState.CLOSED
                    log.info(f"[gRPC:circuit:{self.name}] CLOSED — service recovered")

    def record_failure(self) -> None:
        with self._lock:
            self._failures += 1
            if self._state == CircuitState.HALF_OPEN or self._failures >= self.failure_threshold:
                self._state = CircuitState.OPEN
                self._last_opened_at = time.monotonic()
                log.warning(
                    f"[gRPC:circuit:{self.name}] OPEN — {self._failures} failures "
                    f"(threshold: {self.failure_threshold})"
                )

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "state": self._state,
            "failures": self._failures,
        }


# ─── Circuit Breaker Registry ───────────────────────────────────────────────

_cb_registry: dict[str, CircuitBreaker] = {}
_cb_lock = Lock()


def get_circuit_breaker(
    name: str,
    failure_threshold: int = 5,
    reset_timeout_s: float = 30.0,
) -> CircuitBreaker:
    with _cb_lock:
        if name not in _cb_registry:
            _cb_registry[name] = CircuitBreaker(
                name=name,
                failure_threshold=failure_threshold,
                reset_timeout_s=reset_timeout_s,
            )
        return _cb_registry[name]


def all_circuit_breaker_states() -> list[dict]:
    with _cb_lock:
        return [cb.to_dict() for cb in _cb_registry.values()]


# ─── Retry Config ────────────────────────────────────────────────────────────

@dataclass
class RetryConfig:
    max_attempts: int = 3
    initial_backoff_s: float = 0.1
    max_backoff_s: float = 5.0
    backoff_multiplier: float = 2.0
    jitter_factor: float = 0.2

    def backoff_duration(self, attempt: int) -> float:
        base = self.initial_backoff_s * math.pow(self.backoff_multiplier, attempt - 1)
        capped = min(base, self.max_backoff_s)
        jitter = capped * self.jitter_factor * random.random()
        return capped + jitter


# ─── Metrics ─────────────────────────────────────────────────────────────────

@dataclass
class _GrpcMetrics:
    total_calls: int = 0
    success_calls: int = 0
    failed_calls: int = 0
    retry_count: int = 0
    cb_trips: int = 0
    latency_sum_ms: float = 0.0
    latency_count: int = 0
    _lock: Lock = field(default_factory=Lock, init=False)

    def record(self, success: bool, latency_ms: float) -> None:
        with self._lock:
            self.total_calls += 1
            if success:
                self.success_calls += 1
            else:
                self.failed_calls += 1
            self.latency_sum_ms += latency_ms
            self.latency_count += 1

    def snapshot(self) -> dict:
        avg = self.latency_sum_ms / self.latency_count if self.latency_count > 0 else 0
        return {
            "total_calls": self.total_calls,
            "success_calls": self.success_calls,
            "failed_calls": self.failed_calls,
            "retry_count": self.retry_count,
            "circuit_breaker_trips": self.cb_trips,
            "avg_latency_ms": round(avg, 2),
        }


_metrics = _GrpcMetrics()


def grpc_metrics_snapshot() -> dict:
    return _metrics.snapshot()


# ─── Interceptor ─────────────────────────────────────────────────────────────

class GrpcInterceptor:
    """Execute gRPC calls through circuit breaker + retry interceptor chain."""

    def __init__(
        self,
        service_name: str,
        retry_config: Optional[RetryConfig] = None,
        cb_failure_threshold: int = 5,
        cb_reset_timeout_s: float = 30.0,
    ):
        self.service_name = service_name
        self.retry = retry_config or RetryConfig()
        self.cb = get_circuit_breaker(
            f"grpc:{service_name}",
            failure_threshold=cb_failure_threshold,
            reset_timeout_s=cb_reset_timeout_s,
        )

    async def execute(self, call: Callable[[], Awaitable[Any]]) -> Any:
        if not self.cb.allow():
            _metrics.cb_trips += 1
            raise GrpcError(
                GrpcCode.UNAVAILABLE,
                f"circuit breaker OPEN for {self.service_name}",
            )

        last_err: Optional[GrpcError] = None
        start = time.monotonic()

        for attempt in range(1, self.retry.max_attempts + 1):
            try:
                result = await call()
                latency = (time.monotonic() - start) * 1000
                _metrics.record(success=True, latency_ms=latency)
                self.cb.record_success()
                return result
            except GrpcError as err:
                latency = (time.monotonic() - start) * 1000
                _metrics.record(success=False, latency_ms=latency)
                last_err = err

                if not err.code.is_retryable() or attempt >= self.retry.max_attempts:
                    self.cb.record_failure()
                    raise

                _metrics.retry_count += 1
                backoff = self.retry.backoff_duration(attempt)
                log.warning(
                    f"[gRPC:retry:{self.service_name}] Attempt {attempt}/{self.retry.max_attempts} "
                    f"failed ({err.code.name}) — retrying in {backoff:.0f}ms"
                )
                await asyncio.sleep(backoff)

                if not self.cb.allow():
                    _metrics.cb_trips += 1
                    raise GrpcError(
                        GrpcCode.UNAVAILABLE,
                        f"circuit breaker opened during retry for {self.service_name}",
                    )
            except Exception as err:
                latency = (time.monotonic() - start) * 1000
                _metrics.record(success=False, latency_ms=latency)
                self.cb.record_failure()
                raise GrpcError(GrpcCode.INTERNAL, str(err)) from err

        self.cb.record_failure()
        raise last_err or GrpcError(GrpcCode.UNKNOWN, "all retries exhausted")


# ─── HTTP/gRPC-Web Bridge ───────────────────────────────────────────────────

_http_client: Optional[httpx.AsyncClient] = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=10.0)
    return _http_client


async def grpc_http_call(
    service_name: str,
    method: str,
    url: str,
    body: dict,
    retry_config: Optional[RetryConfig] = None,
    deadline_s: float = 5.0,
) -> dict:
    """Execute an HTTP call to a gRPC-transcoded endpoint with full interceptor chain."""
    interceptor = GrpcInterceptor(service_name, retry_config)
    internal_token = os.environ.get("INTERNAL_SERVICE_TOKEN", "")

    async def _call() -> dict:
        client = _get_http_client()
        headers = {
            "Content-Type": "application/json",
            "x-grpc-service": service_name,
            "x-grpc-method": method,
        }
        if internal_token:
            headers["x-internal-auth"] = internal_token

        try:
            resp = await client.post(url, json=body, headers=headers, timeout=deadline_s)
        except httpx.ConnectError:
            raise GrpcError(GrpcCode.UNAVAILABLE, f"connection refused: {url}")
        except httpx.TimeoutException:
            raise GrpcError(GrpcCode.DEADLINE_EXCEEDED, f"timeout after {deadline_s}s: {url}")

        if resp.status_code >= 400:
            raise GrpcError(
                GrpcCode.from_http_status(resp.status_code),
                resp.text[:500],
            )
        return resp.json()

    return await interceptor.execute(_call)


# ─── Health Check ────────────────────────────────────────────────────────────

async def grpc_health_check(service_name: str, url: str) -> dict:
    """Check gRPC service health via HTTP bridge."""
    try:
        result = await grpc_http_call(
            service_name, "Check", f"{url}/health",
            {"service": service_name},
            retry_config=RetryConfig(max_attempts=1),
            deadline_s=2.0,
        )
        return {"service": service_name, "serving": True, "details": result}
    except Exception as e:
        cb = get_circuit_breaker(f"grpc:{service_name}")
        return {
            "service": service_name,
            "serving": False,
            "circuit_state": cb.state,
            "error": str(e),
        }
