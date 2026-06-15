"""A tiny downstream MCP server used by tests (stdio transport).

Exposes a harmless `echo` and an irreversible-looking `delete_contact` — the
latter is the action the HITL/policy milestones (M3/M4) will hold.
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("mock")


@mcp.tool()
def echo(text: str) -> str:
    """Return the text unchanged."""
    return text


@mcp.tool()
def delete_contact(contact_id: str) -> str:
    """Pretend to irreversibly delete a contact."""
    return f"deleted {contact_id}"


@mcp.tool()
def mail_send(to: str, subject: str) -> str:
    """Pretend to send an email (external send)."""
    return f"sent to {to}: {subject}"


if __name__ == "__main__":
    mcp.run()
