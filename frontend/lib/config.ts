export const config = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  // Server-side only: base URL of the FastAPI control API.
  controlApiUrl: process.env.CONTROL_API_URL ?? "http://localhost:8000",
  // Public URL of the LLM/extension API, reachable from enrolled workstations.
  extensionApiPublicUrl: process.env.EXTENSION_API_PUBLIC_URL ?? "",
  // Hermetic E2E mode: a cookie-based session bypass for Playwright smoke tests.
  e2e: process.env.E2E_TEST_MODE === "1",
  localPreview: process.env.NODE_ENV === "development" && process.env.CONSOLE_LOCAL_PREVIEW === "1",
};
