"""Recursive JSON -> dataclass decoder turning a parsed response body into the typed dataclasses
in types.py, including the RoutingPolicy / ChatCompletionStreamEvent discriminated unions
(matched by the `type` field).

Does not handle a parameterized Generic dataclass (PolicyResponse[T]) -- get_type_hints() doesn't
substitute a Generic's TypeVar from subscripted arguments. admin_client.py's policy methods
decode the inner value directly with an explicit type instead.

Minimal by design: an unknown field is ignored; a declared-but-omitted field is left out of the
constructor call (only optional fields, since the server always sends required ones).
"""

from __future__ import annotations

import dataclasses
import types as _types
from typing import Any, Union, get_args, get_origin, get_type_hints


def decode(target: Any, value: Any) -> Any:
    if value is None:
        return None

    origin = get_origin(target)

    # Optional[X] (typing.Union) and X | None (types.UnionType) both need unwrapping.
    if origin is Union or origin is _types.UnionType:
        non_none_args = [arg for arg in get_args(target) if arg is not type(None)]
        if len(non_none_args) == 1:
            return decode(non_none_args[0], value)
        return _decode_discriminated_union(non_none_args, value)

    if origin is list:
        (item_type,) = get_args(target)
        return [decode(item_type, item) for item in value]

    if dataclasses.is_dataclass(target):
        return _decode_dataclass(target, value)

    # str, int, float, bool, Literal[...], dict -- already JSON-native, nothing further to do.
    return value


def _decode_dataclass(cls: type, value: dict) -> Any:
    hints = get_type_hints(cls)
    kwargs = {}
    for field in dataclasses.fields(cls):
        if field.name not in value:
            continue
        kwargs[field.name] = decode(hints[field.name], value[field.name])
    return cls(**kwargs)


def _decode_discriminated_union(candidates: list, value: dict) -> Any:
    discriminant = value.get("type")
    for candidate in candidates:
        hints = get_type_hints(candidate)
        type_hint = hints.get("type")
        if type_hint is not None and discriminant in get_args(type_hint):
            return _decode_dataclass(candidate, value)
    raise ValueError(f"Unable to determine variant for discriminated union among {candidates}: type={discriminant!r}")
