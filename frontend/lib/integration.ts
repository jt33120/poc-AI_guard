/**
 * Les blocs d'intégration, à un seul endroit (`L9`).
 *
 * Ils vivaient dans l'assistant d'intégration, où un client les reçoit après avoir
 * créé son jeton. La page publique `/mise-en-oeuvre` montre **exactement les mêmes** :
 * une page « comment ça marche » qui divergerait de ce qu'on remet réellement au
 * client est pire que pas de page — elle apprend à faire ce qui ne marchera pas.
 *
 * D'où le partage plutôt que la copie, et un test qui compare les deux rendus pour les
 * mêmes entrées. Le commentaire du bloc MCP dit déjà pourquoi ce fichier compte : la
 * passerelle stdio ne lit que deux variables, et en émettre une autre livre un
 * extrait qui ne peut pas fonctionner.
 */

export type Stack = "openai" | "anthropic" | "openrouter" | "mistral" | "langchain" | "mcp" | "http";

export const STACKS: { id: Stack; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "mistral", label: "Mistral" },
  { id: "langchain", label: "LangChain / LangGraph" },
  { id: "mcp", label: "MCP tools" },
  { id: "http", label: "Custom (HTTP API)" },
];

// OpenAI-compatible providers: same SDK, different proxy path + key.
export const OPENAI_STYLE: Record<string, { sdkBase: string; keyEnv: string; keyHint: string }> = {
  openai: { sdkBase: "openai", keyEnv: "OPENAI_API_KEY", keyHint: "OpenAI" },
  openrouter: { sdkBase: "openrouter", keyEnv: "OPENROUTER_API_KEY", keyHint: "OpenRouter" },
  mistral: { sdkBase: "mistral", keyEnv: "MISTRAL_API_KEY", keyHint: "Mistral" },
};

// Token-in-URL base_url — works with ANY tool that lets you set a base URL
// (no custom header needed). Null for non-proxy stacks.
export function proxyBase(stack: Stack, key: string, api: string): string | null {
  const oai = OPENAI_STYLE[stack];
  if (oai) return `${api}/proxy/${oai.sdkBase}/${key}/v1`;
  if (stack === "anthropic") return `${api}/proxy/anthropic/${key}`;
  return null;
}


// The stdio gateway (`gateway/server.py`) reads exactly two variables at start-up:
// XSOM_TENANT_TOKEN (the tenant session token) and DATABASE_URL (the control
// plane it authenticates against). Emitting any other name ships a snippet that
// cannot work, so this block mirrors the runtime literally.
export function mcpConfig(key: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "xsom-ai-guard": {
          command: "uv",
          args: [
            "run",
            "--directory",
            "/path/to/xsom-ai-guard",
            "python",
            "-m",
            "gateway.server",
          ],
          env: {
            XSOM_TENANT_TOKEN: key,
            DATABASE_URL: "postgresql://<user>:<password>@<host>:5432/<db>?sslmode=require",
          },
        },
      },
    },
    null,
    2,
  );
}

export function snippet(stack: Stack, key: string, api: string): string {
  if (stack === "mcp") return mcpConfig(key);
  const oai = OPENAI_STYLE[stack];
  if (oai) {
    return `# Zero-code monitoring — point the OpenAI SDK at xSOM.
# Your ${oai.keyHint} key is still used and forwarded upstream (never stored).
# The gateway token is in the base_url, so no extra header is needed.
from openai import OpenAI

client = OpenAI(
    base_url="${proxyBase(stack, key, api)}",
    api_key="<your ${oai.keyHint} key>",  # forwarded upstream, never stored by xSOM
)
# Use the client exactly as before — xSOM audits every tool-call it makes.`;
  }
  if (stack === "anthropic") {
    return `# Zero-code monitoring — point the Anthropic SDK at xSOM.
# Your Anthropic key is still used and forwarded (never stored). The gateway
# token is in the base_url, so no extra header is needed.
from anthropic import Anthropic

client = Anthropic(
    base_url="${proxyBase(stack, key, api)}",
    api_key="<your Anthropic key>",
)
# Use the client exactly as before — xSOM audits every tool_use it makes.`;
  }
  return `import requests

XSOM_API = "${api}"
XSOM_KEY = "${key}"

def allowed(tool: str, arguments: dict) -> bool:
    r = requests.post(
        f"{XSOM_API}/v1/authorize",
        headers={"X-Gateway-Token": XSOM_KEY},
        json={"tool": tool, "arguments": arguments},
        timeout=30,
    )
    # "allow" -> run it | "hold" -> wait for human approval | "deny" -> blocked
    return r.json().get("decision") == "allow"

# Before your agent executes any tool:
if allowed("crm.delete_contact", {"id": 42}):
    crm.delete_contact(id=42)`;
}

