"""FR-164 / INV-7 — one door for every request to a tenant-supplied URL.

A URL a tenant writes into a row and the backend then fetches is the backend
lending its network position to whoever wrote that row. That position is worth
more than the row: inside a cloud VPC it reaches the instance metadata service
and the credentials it hands out; inside a cluster it reaches every sidecar
that trusts the pod network; on the gateway host it reaches the control API
itself, which authenticates a caller by bearer token and knows nothing about
where the connection came from.

So the check is not "is this URL well formed" but "may *this caller*, for
*this purpose*, reach *this address*" — and the answer differs by purpose,
which is why `Reach` is an argument and not a constant:

* `Reach.public_only` — notification targets, event sinks, anchor endpoints.
  These are the customer's SaaS. Every resolved address must be globally
  routable, and the scheme must be `https`: the payload leaves our network.
* `Reach.tenant_network` — the tenant's own MCP tool servers. These live on
  the customer's private network by design, so RFC-1918 is the deployment,
  not the attack, and plain `http` inside it is the customer's call.

What `tenant_network` still refuses is the part that is never "the customer's
network": loopback, link-local and the unspecified address. `127.0.0.1` is not
a tenant's tool server — it is *this* host, and a row pointing at it turns one
database write into a request to our own control plane carrying headers the
writer chose. A tool server that genuinely shares the host has a transport of
its own: `stdio`.

**Redirects.** The MCP SDK's default client sets `follow_redirects=True`
(`mcp.shared._httpx_utils.create_mcp_http_client`), which by itself defeats
every check in this module: an allowed host answers `302` and the client
follows it anywhere. `no_redirect_http_client` is the fix, and it is not
optional decoration — a validated URL fetched by a redirect-following client
is an unvalidated fetch.

**What remains.** Names are resolved and every address checked, then the
connection is made by the client, which resolves again: a name that answers
differently between the two closes on an address we rejected (DNS rebinding).
Pinning the checked address requires a resolver hook `httpx` does not expose,
so this is a declared residual, not a solved problem — which is the same
standard this product holds its coverage claims to.
"""

from __future__ import annotations

import ipaddress
import socket
from enum import StrEnum
from urllib.parse import urlsplit

import httpx

__all__ = [
    "EgressRejected",
    "Reach",
    "check_url",
    "no_redirect_http_client",
    "resolve_and_check",
]


class EgressRejected(ValueError):
    """A tenant-supplied URL that must not be fetched. The message names why."""


class Reach(StrEnum):
    """How far a caller's purpose legitimately reaches."""

    public_only = "public_only"
    tenant_network = "tenant_network"


_SCHEMES: dict[Reach, frozenset[str]] = {
    Reach.public_only: frozenset({"https"}),
    Reach.tenant_network: frozenset({"https", "http"}),
}

_MAX_URL = 2048

_IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


def _unwrap(addr: _IPAddress) -> _IPAddress:
    """Return the IPv4 address behind a mapped/compatible IPv6 form, else the input.

    `http://[::ffff:169.254.169.254]/` is the metadata service wearing a v6 hat;
    judging the wrapper instead of what it wraps is how that bypass works.
    """
    if isinstance(addr, ipaddress.IPv6Address):
        mapped = addr.ipv4_mapped or addr.sixtofour
        if mapped is not None:
            return mapped
    return addr


def _address_error(raw: _IPAddress, reach: Reach) -> str | None:
    """Why this address is out of bounds for this reach, or None if it is allowed."""
    addr = _unwrap(raw)
    shown = f"{raw}" if addr == raw else f"{raw} (which is {addr})"
    if addr.is_unspecified:
        return f"{shown} is the unspecified address"
    if addr.is_loopback:
        return f"{shown} is loopback — that is this host, not a tenant's server"
    if addr.is_link_local:
        return f"{shown} is link-local — this range carries cloud instance metadata"
    if addr.is_multicast:
        return f"{shown} is multicast"
    if addr.is_reserved:
        return f"{shown} is in a reserved range"
    if reach is Reach.public_only and not addr.is_global:
        return f"{shown} is not globally routable, and this target must be public"
    return None


def check_url(raw: str, *, reach: Reach) -> str:
    """Validate a tenant-supplied URL without touching the network.

    Catches what can be judged from the text alone — scheme, credentials in the
    authority, an address literal in a refused class. Callers that are about to
    *connect* must use `resolve_and_check` instead; this one is for write-time
    rejection, where doing DNS would put network I/O inside request validation.
    """
    if not raw or len(raw) > _MAX_URL:
        raise EgressRejected(f"URL must be 1..{_MAX_URL} characters")
    try:
        parts = urlsplit(raw.strip())
    except ValueError as exc:
        raise EgressRejected(f"URL is not parseable: {exc}") from None

    scheme = parts.scheme.lower()
    allowed = _SCHEMES[reach]
    if scheme not in allowed:
        raise EgressRejected(
            f"scheme {scheme or '(none)'} is not allowed here (use {'/'.join(sorted(allowed))})"
        )
    if parts.username or parts.password:
        raise EgressRejected("credentials in the URL authority are not allowed")

    try:
        host = parts.hostname
    except ValueError as exc:  # malformed IPv6 literal, e.g. "http://[::1"
        raise EgressRejected(f"URL host is not parseable: {exc}") from None
    if not host:
        raise EgressRejected("URL has no host")

    try:
        literal: _IPAddress | None = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        error = _address_error(literal, reach)
        if error is not None:
            raise EgressRejected(f"refused: {error}")
    return raw.strip()


def resolve_and_check(raw: str, *, reach: Reach) -> str:
    """Validate the URL *and* every address its host resolves to.

    Every resolved address must pass, not merely one: the client picks, we do
    not, so a name that answers with one allowed address and one refused one is
    a name that reaches the refused one. A name that does not resolve is
    refused too — an address we cannot read is not an address we can vouch for
    (CLAUDE.md §9, fail closed).
    """
    url = check_url(raw, reach=reach)
    host = urlsplit(url).hostname
    assert host is not None  # check_url rejects a missing host  # noqa: S101
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise EgressRejected(f"host {host} does not resolve: {exc}") from None
    if not infos:
        raise EgressRejected(f"host {host} resolves to no address")

    for info in infos:
        addr = ipaddress.ip_address(info[4][0])
        error = _address_error(addr, reach)
        if error is not None:
            raise EgressRejected(f"host {host} refused: {error}")
    return url


def no_redirect_http_client(
    headers: dict[str, str] | None = None,
    timeout: httpx.Timeout | None = None,
    auth: httpx.Auth | None = None,
) -> httpx.AsyncClient:
    """An HTTP client that refuses to be redirected off a validated address.

    Signature-compatible with `mcp.shared._httpx_utils.McpHttpClientFactory` so
    it can be handed to `streamablehttp_client`, whose own default enables
    redirect following. A `3xx` surfaces to the caller as a response instead of
    quietly becoming a second, unchecked request.
    """
    return httpx.AsyncClient(
        follow_redirects=False,
        headers=headers or {},
        timeout=timeout or httpx.Timeout(30.0, read=300.0),
        auth=auth,
    )
