"""
VedaDB ORM — Lifecycle hook system.

Hooks are callables invoked at well-defined points in a model's lifecycle.
They receive a ``HookContext`` and may modify the data or abort the
operation by raising an exception.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING

from .exceptions import HookError, ValidationError

if TYPE_CHECKING:
    from .session import Session


# ---------------------------------------------------------------------------
# Hook type enum
# ---------------------------------------------------------------------------

class HookType(Enum):
    BEFORE_CREATE = "before_create"
    AFTER_CREATE = "after_create"
    BEFORE_UPDATE = "before_update"
    AFTER_UPDATE = "after_update"
    BEFORE_DELETE = "before_delete"
    AFTER_DELETE = "after_delete"
    BEFORE_FIND = "before_find"
    AFTER_FIND = "after_find"
    BEFORE_VALIDATE = "before_validate"
    AFTER_VALIDATE = "after_validate"


# ---------------------------------------------------------------------------
# Hook context
# ---------------------------------------------------------------------------

@dataclass
class HookContext:
    """Bag of state passed to every hook invocation."""

    model: Any = None          # The model *class*
    instance: Any = None       # The model *instance* (may be None for class-level ops)
    data: Optional[Dict[str, Any]] = None
    query: Optional[str] = None
    session: Optional["Session"] = None


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class HookRegistry:
    """Manages hook callbacks for a single model class."""

    def __init__(self) -> None:
        self._hooks: Dict[HookType, List[Callable]] = {ht: [] for ht in HookType}

    def register(self, hook_type: HookType, fn: Callable) -> None:
        """Append *fn* to the list of callbacks for *hook_type*."""
        self._hooks[hook_type].append(fn)

    def execute(self, hook_type: HookType, context: HookContext) -> HookContext:
        """Run all hooks for *hook_type* sequentially.

        Each hook receives the context (possibly mutated by previous hooks)
        and may raise to abort the operation.

        Returns the (possibly modified) context.
        """
        for fn in self._hooks[hook_type]:
            try:
                result = fn(context)
                if result is not None:
                    context = result
            except (ValidationError, HookError):
                raise
            except Exception as exc:
                raise HookError(
                    f"Hook {fn.__name__} for {hook_type.value} failed: {exc}"
                ) from exc
        return context


# ---------------------------------------------------------------------------
# Built-in hooks
# ---------------------------------------------------------------------------

class TimestampHook:
    """Automatically set ``created_at`` / ``updated_at`` timestamps."""

    @staticmethod
    def before_create(ctx: HookContext) -> HookContext:
        if ctx.data is not None:
            now = datetime.utcnow().isoformat()
            ctx.data.setdefault("created_at", now)
            ctx.data["updated_at"] = now
        return ctx

    @staticmethod
    def before_update(ctx: HookContext) -> HookContext:
        if ctx.data is not None:
            ctx.data["updated_at"] = datetime.utcnow().isoformat()
        return ctx


class SoftDeleteHook:
    """Replace DELETE with ``UPDATE ... SET deleted_at = NOW()``."""

    @staticmethod
    def before_delete(ctx: HookContext) -> HookContext:
        if ctx.instance is not None:
            ctx.data = ctx.data or {}
            ctx.data["_soft_delete"] = True
            ctx.data["deleted_at"] = datetime.utcnow().isoformat()
        return ctx


class ValidationHook:
    """Run field-level validators defined in the schema."""

    @staticmethod
    def before_validate(ctx: HookContext) -> HookContext:
        if ctx.model is None or ctx.data is None:
            return ctx

        schema = getattr(ctx.model, "__schema__", None)
        if schema is None:
            return ctx

        errors: List[str] = []
        for field_name, field_def in schema.fields.items():
            value = ctx.data.get(field_name)
            for validator in field_def.validators:
                try:
                    validator(value)
                except ValidationError as ve:
                    ve.field = field_name
                    ve.value = value
                    errors.append(f"{field_name}: {ve.message}")

        if errors:
            raise ValidationError("; ".join(errors))

        return ctx
