"""Typed exceptions raised by this SDK. One class with fields, not a subclass per error code --
callers branch on `.code`.
"""

from __future__ import annotations

from typing import Optional

from .types import GatewayErrorPayload


class LlmGatewayApiError(Exception):
    """Raised for any non-2xx response with the standard {code, message} envelope -- the request
    reached the server and was rejected. Callers branch on `.code` (a stable string contract).
    """

    def __init__(self, code: str, message: str, status: int, details: Optional[dict] = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = details

    @classmethod
    def from_payload(cls, status: int, payload: GatewayErrorPayload) -> "LlmGatewayApiError":
        return cls(payload.code, payload.message, status, payload.details)


class LlmGatewayNetworkError(Exception):
    """Raised when every transport retry failed without ever receiving an HTTP response (DNS
    failure, connection refused/reset, timeout). Distinct from LlmGatewayApiError so a caller can
    tell "the server never saw this request" from "the server saw it and rejected it".
    """

    def __init__(self, message: str, cause: Optional[BaseException] = None) -> None:
        super().__init__(message)
        self.cause = cause
