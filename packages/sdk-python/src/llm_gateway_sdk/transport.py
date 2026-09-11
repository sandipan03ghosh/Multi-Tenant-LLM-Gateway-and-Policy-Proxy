"""Shared HTTP layer for GatewayClient and AdminClient. Built entirely on the standard library
(urllib.request) -- zero runtime dependencies, matching this package's pyproject.toml.
"""

from __future__ import annotations

import dataclasses
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, NoReturn, Optional

from . import _codec
from .errors import LlmGatewayApiError, LlmGatewayNetworkError
from .types import GatewayErrorPayload

_DEFAULT_MAX_RETRIES = 2
_DEFAULT_RETRY_BASE_DELAY_SECONDS = 0.25
_DEFAULT_TIMEOUT_SECONDS = 30.0


class Transport:
    """Exactly one of `api_key` / `bearer_token` is required -- X-API-Key for machine auth,
    Authorization: Bearer <jwt> for human auth.
    """

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        bearer_token: Optional[str] = None,
        max_retries: int = _DEFAULT_MAX_RETRIES,
        retry_base_delay_seconds: float = _DEFAULT_RETRY_BASE_DELAY_SECONDS,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        has_api_key = api_key is not None
        has_bearer_token = bearer_token is not None
        if has_api_key == has_bearer_token:
            # Catches both "neither" and "both" -- exactly one credential is required.
            raise ValueError("Transport requires exactly one of `api_key` or `bearer_token`, not zero or both.")
        self._auth_header: tuple[str, str] = ("X-API-Key", api_key) if has_api_key else ("Authorization", f"Bearer {bearer_token}")

        self._base_url = base_url.rstrip("/")
        self._max_retries = max_retries
        self._retry_base_delay_seconds = retry_base_delay_seconds
        self._timeout_seconds = timeout_seconds

    def request_json(
        self,
        method: str,
        path: str,
        response_type: Any,
        query: Optional[dict] = None,
        body: Any = None,
        decode: bool = True,
    ) -> Any:
        """JSON in, JSON out. `decode=False` returns the raw parsed JSON instead of constructing
        `response_type` -- used by admin_client.py's policy methods, which decode the nested
        policy value with an explicit type rather than the outer PolicyResponse[T] wrapper.
        """
        response = self._execute(method, path, query, body, accept="application/json")
        return self._parse_json_response(response, response_type, decode)

    def request_stream(self, method: str, path: str, query: Optional[dict] = None, body: Any = None):
        """Returns the raw urllib response for a streaming request, once its status confirms
        success. A request that fails before any SSE bytes are sent still returns a plain JSON
        error body, same as request_json.
        """
        return self._execute(method, path, query, body, accept="text/event-stream")

    def _execute(self, method: str, path: str, query: Optional[dict], body: Any, accept: str):
        url = self._build_url(path, query)
        headers = {self._auth_header[0]: self._auth_header[1], "Accept": accept}
        data: Optional[bytes] = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(_to_json_value(body)).encode("utf-8")
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            return self._execute_with_retry(request)
        except urllib.error.HTTPError as error:
            self._raise_api_error(error)

    # Retries ONLY when no response is received (connection/DNS failure, reset, per-attempt
    # timeout). HTTPError (any non-2xx) is a subclass of URLError, so it's caught first and
    # re-raised unretried -- it IS a response. Retrying a resolved response would risk a duplicate
    # provider call / billing for a non-idempotent request.
    def _execute_with_retry(self, request: urllib.request.Request):
        last_error: Optional[BaseException] = None
        for attempt in range(self._max_retries + 1):
            try:
                return urllib.request.urlopen(request, timeout=self._timeout_seconds)
            except urllib.error.HTTPError:
                raise
            except (urllib.error.URLError, TimeoutError) as error:
                last_error = error
                if attempt < self._max_retries:
                    time.sleep(self._retry_base_delay_seconds * (2**attempt))
        raise LlmGatewayNetworkError(
            f"Request to {request.full_url} failed after {self._max_retries + 1} attempt(s) without receiving a response",
            last_error,
        )

    def _parse_json_response(self, response, response_type: Any, decode: bool) -> Any:
        try:
            raw = response.read()
        finally:
            response.close()
        if response.status == 204 or not raw:
            return None
        parsed = json.loads(raw.decode("utf-8"))
        if not decode:
            return parsed
        return _codec.decode(response_type, parsed)

    def _raise_api_error(self, error: urllib.error.HTTPError) -> NoReturn:
        try:
            raw = error.read()
        finally:
            error.close()
        parsed: Any = None
        if raw:
            try:
                parsed = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                parsed = None
        if isinstance(parsed, dict) and isinstance(parsed.get("code"), str) and isinstance(parsed.get("message"), str):
            payload = GatewayErrorPayload(code=parsed["code"], message=parsed["message"], details=parsed.get("details"))
            raise LlmGatewayApiError.from_payload(error.code, payload) from error
        # The gateway always sends the {code, message} envelope for a non-2xx -- this fallback
        # only guards against a proxy/load balancer returning its own error body.
        raise LlmGatewayApiError("UNKNOWN_ERROR", f"Request failed with status {error.code}", error.code) from error

    def _build_url(self, path: str, query: Optional[dict]) -> str:
        url = f"{self._base_url}{path}"
        if query:
            filtered = {key: value for key, value in query.items() if value is not None}
            if filtered:
                url = f"{url}?{urllib.parse.urlencode(filtered)}"
        return url


def _to_json_value(value: Any) -> Any:
    """Serializes a request dataclass (or a plain value) to something json.dumps can encode,
    dropping any dataclass field left at its `None` default so an unset optional field is absent
    from the body rather than sent as `"field": null`.
    """
    if dataclasses.is_dataclass(value):
        result = {}
        for field in dataclasses.fields(value):
            field_value = getattr(value, field.name)
            if field_value is None:
                continue
            result[field.name] = _to_json_value(field_value)
        return result
    if isinstance(value, list):
        return [_to_json_value(item) for item in value]
    return value
