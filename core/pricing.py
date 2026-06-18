"""Indicative LLM token pricing → cost estimation for the usage dashboard.

Prices are public *list* prices in USD per 1M tokens (input, output). They are
intentionally a small, editable table: the goal is an order-of-magnitude cost
view ("you spent ~€42 this week, mostly on gpt-4o"), not invoicing. An unknown
model costs 0 but its tokens are still recorded, so nothing is silently dropped.

OpenRouter models are namespaced ``vendor/model`` (e.g. ``openai/gpt-4o-mini``);
we resolve them against the underlying vendor's table.
"""

from __future__ import annotations

# (input, output) USD per 1M tokens. The "" key is the provider's default rate.
_PER_M: dict[str, dict[str, tuple[float, float]]] = {
    "openai": {
        "gpt-4o-mini": (0.15, 0.60),
        "gpt-4o": (2.50, 10.00),
        "gpt-4.1-mini": (0.40, 1.60),
        "gpt-4.1-nano": (0.10, 0.40),
        "gpt-4.1": (2.00, 8.00),
        "o4-mini": (1.10, 4.40),
        "o3-mini": (1.10, 4.40),
        "gpt-3.5": (0.50, 1.50),
        "": (2.50, 10.00),
    },
    "anthropic": {
        "claude-3-haiku": (0.25, 1.25),
        "claude-3-5-haiku": (0.80, 4.00),
        "claude-haiku-4": (1.00, 5.00),
        "claude-3-5-sonnet": (3.00, 15.00),
        "claude-3-7-sonnet": (3.00, 15.00),
        "claude-sonnet-4": (3.00, 15.00),
        "claude-3-opus": (15.00, 75.00),
        "claude-opus-4": (15.00, 75.00),
        "": (3.00, 15.00),
    },
    "mistral": {
        "mistral-small": (0.20, 0.60),
        "mistral-medium": (0.40, 2.00),
        "mistral-large": (2.00, 6.00),
        "open-mistral": (0.25, 0.25),
        "codestral": (0.30, 0.90),
        "": (0.20, 0.60),
    },
}

# OpenRouter vendor prefixes that map onto a table above.
_VENDOR_ALIASES: dict[str, str] = {"mistralai": "mistral"}


def _rate(provider: str, model: str) -> tuple[float, float] | None:
    """Resolve (input, output) per-1M rate for a provider/model, or None."""
    provider = provider.lower()
    model = (model or "").lower()
    if provider == "openrouter" and "/" in model:
        vendor, sub = model.split("/", 1)
        return _rate(_VENDOR_ALIASES.get(vendor, vendor), sub)
    table = _PER_M.get(provider)
    if table is None:
        return None
    best: tuple[float, float] | None = None
    best_len = -1
    for prefix, rate in table.items():
        if model.startswith(prefix) and len(prefix) > best_len:
            best, best_len = rate, len(prefix)
    return best


def cost_usd(provider: str, model: str | None, prompt_tokens: int, completion_tokens: int) -> float:
    """Estimated USD cost for a completion; 0.0 for an unpriced provider/model."""
    rate = _rate(provider, model or "")
    if rate is None:
        return 0.0
    rate_in, rate_out = rate
    cost = prompt_tokens / 1_000_000 * rate_in + completion_tokens / 1_000_000 * rate_out
    return round(cost, 6)
