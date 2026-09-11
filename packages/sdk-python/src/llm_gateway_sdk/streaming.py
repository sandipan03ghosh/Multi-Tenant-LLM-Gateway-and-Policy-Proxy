"""Parses the wire format SseStreamTransport writes: `event: <type>\\ndata: <json>\\n\\n` per
frame. A synchronous generator reading the blocking file-like response line by line; no asyncio.
"""

from __future__ import annotations

import json
from typing import Iterator, Optional

from . import _codec
from .types import ChatCompletionStreamEvent


def parse_chat_completion_stream(response) -> Iterator[ChatCompletionStreamEvent]:
    try:
        data_line: Optional[str] = None
        for raw_line in response:
            line = raw_line.decode("utf-8").rstrip("\r\n")
            if line.startswith("data: "):
                data_line = line[len("data: ") :]
            elif line == "":
                # Blank line terminates a frame. The `data:` payload carries its own "type" field
                # -- no merge with the `event:` line needed.
                if data_line is not None:
                    payload = json.loads(data_line)
                    yield _codec.decode(ChatCompletionStreamEvent, payload)
                data_line = None
    finally:
        response.close()
