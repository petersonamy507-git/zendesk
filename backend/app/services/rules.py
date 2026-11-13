"""Shared condition engine used by chat triggers, ticket triggers, automations, SLA policies and views.

A condition is {"field": str, "operator": str, "value": any}. Fields are resolved from a flat
context dict built by the caller. Execution rules (when to run, what actions do) stay in each
module; only matching is shared here.
"""

import re
from collections.abc import Callable, Mapping
from typing import Any


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _lower(v: Any) -> Any:
    return v.lower() if isinstance(v, str) else v


def _contains(a: Any, b: Any) -> bool:
    if a is None:
        return False
    if isinstance(a, (list, tuple, set)):
        return _lower(b) in {_lower(x) for x in a}
    return str(_lower(b)) in str(_lower(a))


def _cmp(fn: Callable[[float, float], bool]) -> Callable[[Any, Any], bool]:
    def inner(a: Any, b: Any) -> bool:
        x, y = _num(a), _num(b)
        return x is not None and y is not None and fn(x, y)

    return inner


def _regex(a: Any, b: Any) -> bool:
    try:
        return a is not None and re.search(str(b), str(a), re.IGNORECASE) is not None
    except re.error:
        return False


OPERATORS: dict[str, Callable[[Any, Any], bool]] = {
    "eq": lambda a, b: _lower(a) == _lower(b) if not isinstance(b, bool) else bool(a) is b,
    "neq": lambda a, b: _lower(a) != _lower(b) if not isinstance(b, bool) else bool(a) is not b,
    "lt": _cmp(lambda x, y: x < y),
    "lte": _cmp(lambda x, y: x <= y),
    "gt": _cmp(lambda x, y: x > y),
    "gte": _cmp(lambda x, y: x >= y),
    "contains": _contains,
    "not_contains": lambda a, b: not _contains(a, b),
    "starts_with": lambda a, b: a is not None and str(_lower(a)).startswith(str(_lower(b))),
    "ends_with": lambda a, b: a is not None and str(_lower(a)).endswith(str(_lower(b))),
    "regex": _regex,
    "in": lambda a, b: _lower(a) in [_lower(x) for x in (b or [])],
    "not_in": lambda a, b: _lower(a) not in [_lower(x) for x in (b or [])],
    "is_true": lambda a, _b: bool(a) is True,
    "is_false": lambda a, _b: not bool(a),
    "present": lambda a, _b: a not in (None, "", []),
    "not_present": lambda a, _b: a in (None, "", []),
    "includes_any": lambda a, b: bool(set(map(_lower, a or [])) & set(map(_lower, b or []))),
    "includes_none": lambda a, b: not (set(map(_lower, a or [])) & set(map(_lower, b or []))),
    "includes_all": lambda a, b: set(map(_lower, b or [])) <= set(map(_lower, a or [])),
}


class RuleError(ValueError):
    pass


def validate_conditions(conditions: list[dict], allowed_fields: set[str]) -> None:
    for c in conditions:
        if c.get("field") not in allowed_fields:
            raise RuleError(f"Unknown condition field: {c.get('field')}")
        if c.get("operator") not in OPERATORS:
            raise RuleError(f"Unknown operator: {c.get('operator')}")


def check(cond: Mapping[str, Any], ctx: Mapping[str, Any]) -> bool:
    op = OPERATORS.get(cond.get("operator", ""))
    if op is None:
        return False
    return op(ctx.get(cond.get("field", "")), cond.get("value"))


def matches(ctx: Mapping[str, Any], *, all_conditions: list[dict] | None = None, any_conditions: list[dict] | None = None) -> bool:
    """True when every `all` condition holds and (if any are given) at least one `any` condition holds."""
    if all_conditions and not all(check(c, ctx) for c in all_conditions):
        return False
    if any_conditions and not any(check(c, ctx) for c in any_conditions):
        return False
    return True
