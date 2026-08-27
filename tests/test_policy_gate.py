"""Policy enforcement at the gateway: auto relays, everything else is held (M3)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from core.policy import parse_policy
from gateway.downstream import DownstreamProxy, ServerSpec
from gateway.server import PolicyBackend

_MOCK = Path(__file__).resolve().parent / "fixtures" / "mock_mcp_server.py"

_POLICY = parse_policy(
    """
tools:
  - name: mock.echo
    class: read
    approval: auto
  - name: mock.delete_contact
    class: irreversible
    approval: human_dual
defaults:
  unknown_tool: deny
"""
)


def _backend() -> PolicyBackend:
    proxy = DownstreamProxy(
        [
            ServerSpec(
                name="mock",
                transport="stdio",
                config={"command": sys.executable, "args": [str(_MOCK)]},
            )
        ]
    )
    return PolicyBackend(_POLICY, proxy)


def _text(result: object) -> str:
    return result.content[0].text  # type: ignore[attr-defined]


@pytest.mark.covers("M-06", "chaine", ingress="mcp", sens="laisse_passer")
async def test_auto_tool_is_relayed() -> None:
    result = await _backend().call_tool("echo", {"text": "hi"})
    assert result.isError is False
    assert "hi" in _text(result)


@pytest.mark.covers("M-06", "chaine", ingress="mcp", sens="bloque")
async def test_irreversible_tool_is_held_not_relayed() -> None:
    result = await _backend().call_tool("delete_contact", {"contact_id": "c1"})
    assert result.isError is True
    assert "human_dual" in _text(result)
    assert "deleted" not in _text(result)  # downstream tool was never called


@pytest.mark.covers("M-06", "chaine", ingress="mcp", sens="bloque")
async def test_unknown_tool_is_denied() -> None:
    result = await _backend().call_tool("ghost", {})
    assert result.isError is True
    assert "deny" in _text(result)
