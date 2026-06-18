"""LLM cost estimation: per-provider rates, prefix matching, OpenRouter remap."""

from __future__ import annotations

from core import pricing


def test_known_models_are_priced_input_and_output() -> None:
    # gpt-4o: 2.50 in / 10.00 out per 1M tokens.
    assert pricing.cost_usd("openai", "gpt-4o", 1_000_000, 0) == 2.50
    assert pricing.cost_usd("openai", "gpt-4o", 0, 1_000_000) == 10.00
    # claude sonnet: 3 / 15 — longest-prefix match beats the "" default.
    assert pricing.cost_usd("anthropic", "claude-3-5-sonnet-20241022", 1_000_000, 0) == 3.00
    # mistral small.
    assert pricing.cost_usd("mistral", "mistral-small-latest", 1_000_000, 0) == 0.20


def test_default_rate_used_for_unmapped_model_of_known_provider() -> None:
    # Unknown OpenAI model falls back to the provider "" default (gpt-4o rate).
    assert pricing.cost_usd("openai", "some-future-model", 1_000_000, 0) == 2.50


def test_unknown_provider_is_free_but_does_not_crash() -> None:
    assert pricing.cost_usd("cohere", "command-r", 1_000_000, 1_000_000) == 0.0
    assert pricing.cost_usd("openai", None, 10, 10) == round(10 / 1e6 * 2.5 + 10 / 1e6 * 10, 6)


def test_openrouter_resolves_to_underlying_vendor() -> None:
    # openai/gpt-4o-mini -> openai table, mini rate (0.15 in / 0.60 out).
    assert pricing.cost_usd("openrouter", "openai/gpt-4o-mini", 1_000_000, 0) == 0.15
    # mistralai/* alias maps to the mistral table.
    assert pricing.cost_usd("openrouter", "mistralai/mistral-large", 1_000_000, 0) == 2.00
    # A vendor with no table is free.
    assert pricing.cost_usd("openrouter", "google/gemini-pro", 1_000_000, 0) == 0.0
