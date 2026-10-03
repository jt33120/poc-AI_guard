import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import { WORKSPACE } from "./workspace-fixture";
import type { Workspace } from "../lib/workspace";

let server: Server;
let workspace: Workspace = structuredClone(WORKSPACE);
let unavailable = false;
let reads = 0;

test.beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/v1/extension-enrollment/start") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({code:"ABCDE-23456",expires_at:new Date(Date.now()+600_000).toISOString(),interval:5}));
      return;
    }
    if (request.headers.authorization !== "Bearer e2e-token") {
      response.writeHead(401).end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/v1/workspace") {
      response.writeHead(unavailable ? 503 : 200).end(JSON.stringify(unavailable ? {} : workspace));
    } else if (request.url === "/v1/extensions/devices") {
      reads += 1;
      response.end("[]");
    } else response.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(3181, "127.0.0.1", resolve);
  });
});

test("native enrollment is public while organization confirmation still requires a session", async ({request}) => {
  const started=await request.post("/api/enrollment/start",{data:{installation_id:"test",credential_hash:"test"}});
  expect(started.status()).toBe(200);
  expect(started.headers()["cache-control"]).toBe("no-store");
  expect(await started.json()).toMatchObject({code:"ABCDE-23456",endpoint:"https://extension.example.test"});
  expect((await request.post("/api/enrollment/status",{data:{}})).status()).toBe(401);
  expect((await request.post("/api/enrollment/start",{data:"x".repeat(5000)})).status()).toBe(413);
  expect((await request.post("/api/control/v1/extensions/enrollment",{data:{code:"ABCDE-23456",name:"test"}})).status()).toBe(401);
});
test.afterAll(async () => { await new Promise<void>((resolve) => server?.close(() => resolve())); });

test("server proxy enforces product access before requesting protected data", async ({ request }) => {
  expect((await request.get("/api/control/v1/extensions/devices")).status()).toBe(401);
  const headers = { Cookie: "xsom_e2e=1" };
  workspace.subscriptions[0].status = "not_subscribed";
  const locked = await request.get("/api/control/v1/extensions/devices", { headers });
  expect(locked.status()).toBe(402);
  expect(reads).toBe(0);
  workspace.subscriptions[0].status = "trial";
  workspace.subscriptions[0].ends_at = "2000-01-01T00:00:00Z";
  expect((await request.get("/api/control/v1/extensions/devices", { headers })).status()).toBe(402);
  expect(reads).toBe(0);
  unavailable = true;
  expect((await request.get("/api/control/v1/extensions/devices", { headers })).status()).toBe(503);
  expect(reads).toBe(0);
  unavailable = false;
  workspace = structuredClone(WORKSPACE);
  const active = await request.get("/api/control/v1/extensions/devices", { headers });
  expect(active.status()).toBe(200);
  expect(await active.json()).toEqual([]);
  expect(reads).toBe(1);
  expect(await active.text()).not.toContain("e2e-token");
  workspace.subscriptions[1].status = "not_subscribed";
  for (const path of ["agents", "clients", "credentials", "audit", "usage"]) {
    expect((await request.get(`/api/control/v1/${path}`, { headers })).status()).toBe(402);
  }
});
