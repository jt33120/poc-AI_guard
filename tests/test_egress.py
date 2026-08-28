"""FR-164 / INV-7 — a tenant-supplied URL is judged before the backend fetches it.

The surface that exists today is `downstream_servers.config.url`: a row a tenant
writes and `gateway.downstream.open_session` then connects to, carrying whatever
headers the same row names. Unchecked, that row spends the gateway's network
position — which reaches the cloud metadata service, the cluster's unauthenticated
sidecars, and the control API on this very host.

Each test states which half it holds: the refusal, or the legitimate connection
that must still go through. A guard proven only on the first half is
indistinguishable from a gateway that refuses every downstream server.
"""

from __future__ import annotations

import pytest

from core.egress import (
    EgressRejected,
    Reach,
    check_url,
    no_redirect_http_client,
    resolve_and_check,
)
from gateway.downstream import ServerSpec, validated_http_url

# Address literals, so the suite stays hermetic: `getaddrinfo` on a literal is
# arithmetic, not a DNS query.
_PRIVATE = "http://10.0.0.5:9000/mcp"
_PUBLIC = "https://93.184.216.34/mcp"


@pytest.mark.parametrize(
    ("url", "reach", "needle"),
    [
        # The reason the module exists: cloud instance metadata, in every dress.
        ("http://169.254.169.254/latest/meta-data/", Reach.tenant_network, "link-local"),
        ("http://[::ffff:169.254.169.254]/", Reach.tenant_network, "link-local"),
        ("http://[2002:a9fe:a9fe::1]/", Reach.tenant_network, "link-local"),
        # This host — a row that points here turns one DB write into a call to
        # our own control plane with headers the writer chose.
        ("http://127.0.0.1:8000/v1/authorize", Reach.tenant_network, "loopback"),
        ("http://[::1]:9000/", Reach.tenant_network, "loopback"),
        ("http://0.0.0.0:9000/", Reach.tenant_network, "unspecified"),
        # Not a fetch at all.
        ("file:///etc/passwd", Reach.tenant_network, "scheme file"),
        ("gopher://10.0.0.5:11211/", Reach.tenant_network, "scheme gopher"),
        ("not a url", Reach.tenant_network, "scheme (none)"),
        ("http://[::1", Reach.tenant_network, "not parseable"),
        # Credentials in the authority: smuggling, and a parser-confusion vector.
        ("https://user:pass@example.com/", Reach.tenant_network, "credentials"),
        # A public target is a payload leaving our network: TLS, and public only.
        ("http://example.com/hook", Reach.public_only, "scheme http"),
        # https, so it clears the scheme rule and is judged on its address alone.
        ("https://10.0.0.5/hook", Reach.public_only, "not globally routable"),
    ],
)
def test_refused_urls(url: str, reach: Reach, needle: str) -> None:
    with pytest.raises(EgressRejected) as caught:
        check_url(url, reach=reach)
    assert needle in str(caught.value)


def test_the_tenants_own_network_is_still_reachable() -> None:
    """The other half: RFC-1918 is the deployment, not the attack.

    A customer's MCP tool servers live on the customer's private network. A guard
    that refused them would be a guard nobody could switch on.
    """
    assert check_url(_PRIVATE, reach=Reach.tenant_network) == _PRIVATE
    assert check_url(_PUBLIC, reach=Reach.tenant_network) == _PUBLIC
    assert check_url(_PUBLIC, reach=Reach.public_only) == _PUBLIC


def test_resolution_judges_the_address_not_the_name() -> None:
    """`localhost` is a name; what it means is 127.0.0.1, and that is what counts."""
    assert resolve_and_check(_PRIVATE, reach=Reach.tenant_network) == _PRIVATE
    with pytest.raises(EgressRejected, match="loopback"):
        resolve_and_check("http://localhost:9000/mcp", reach=Reach.tenant_network)


def test_a_name_that_does_not_resolve_is_refused() -> None:
    """Fail closed: an address we cannot read is not an address we can vouch for."""
    with pytest.raises(EgressRejected, match="does not resolve"):
        resolve_and_check("https://nowhere.invalid/mcp", reach=Reach.public_only)


def test_the_client_does_not_follow_redirects() -> None:
    """Without this, every check above is defeated by one `302`.

    The MCP SDK's own factory sets `follow_redirects=True`; an allowed host that
    answers with a redirect would otherwise become a second, unchecked request.
    """
    client = no_redirect_http_client()
    assert client.follow_redirects is False


async def test_the_gateway_checks_the_row_it_is_about_to_connect_to() -> None:
    """The check that counts is on the path that connects, not only at write time.

    A row can predate the write-time validation, or arrive by a route that never
    passed through the API schema at all.
    """
    good = ServerSpec(name="crm", transport="http", config={"url": _PRIVATE})
    assert await validated_http_url(good) == _PRIVATE

    metadata = ServerSpec(
        name="crm", transport="http", config={"url": "http://169.254.169.254/latest/"}
    )
    with pytest.raises(EgressRejected, match="link-local"):
        await validated_http_url(metadata)

    mistyped = ServerSpec(name="crm", transport="http", config={"url": 42})
    with pytest.raises(EgressRejected, match="must be a string"):
        await validated_http_url(mistyped)
