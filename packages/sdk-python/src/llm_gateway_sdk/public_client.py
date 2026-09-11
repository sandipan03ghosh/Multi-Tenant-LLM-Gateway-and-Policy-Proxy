"""Typed client for the Gateway's Public API (/v1/*). Every method maps to one route."""

from __future__ import annotations

from typing import Iterator, Optional, Union
from urllib.parse import quote

from .streaming import parse_chat_completion_stream
from .transport import Transport
from .types import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionStreamEvent,
    CreateBatchRequest,
    CreateBatchResponse,
    GetBatchResponse,
    ListModelsResponse,
)


class GatewayClient:
    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        bearer_token: Optional[str] = None,
        max_retries: Optional[int] = None,
        retry_base_delay_seconds: Optional[float] = None,
        timeout_seconds: Optional[float] = None,
    ) -> None:
        kwargs = {}
        if max_retries is not None:
            kwargs["max_retries"] = max_retries
        if retry_base_delay_seconds is not None:
            kwargs["retry_base_delay_seconds"] = retry_base_delay_seconds
        if timeout_seconds is not None:
            kwargs["timeout_seconds"] = timeout_seconds
        self._transport = Transport(base_url, api_key=api_key, bearer_token=bearer_token, **kwargs)

    def list_models(self) -> ListModelsResponse:
        return self._transport.request_json("GET", "/v1/models", ListModelsResponse)

    def create_chat_completion(
        self, request: ChatCompletionRequest, *, stream: bool = False
    ) -> Union[ChatCompletionResponse, Iterator[ChatCompletionStreamEvent]]:
        """Pass `stream=True` to get back an Iterator of ChatCompletionStreamEvent instead of a
        resolved response. Streaming vs. JSON is content-negotiated via the Accept header.
        """
        if stream:
            return self._stream_chat_completion(request)
        return self._transport.request_json("POST", "/v1/chat/completions", ChatCompletionResponse, body=request)

    def _stream_chat_completion(self, request: ChatCompletionRequest) -> Iterator[ChatCompletionStreamEvent]:
        response = self._transport.request_stream("POST", "/v1/chat/completions", body=request)
        yield from parse_chat_completion_stream(response)

    def create_batch(self, request: CreateBatchRequest) -> CreateBatchResponse:
        return self._transport.request_json("POST", "/v1/batches", CreateBatchResponse, body=request)

    def get_batch(self, batch_id: str) -> GetBatchResponse:
        return self._transport.request_json("GET", f"/v1/batches/{quote(batch_id, safe='')}", GetBatchResponse)
