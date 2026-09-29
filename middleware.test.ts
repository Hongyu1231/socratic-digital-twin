import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { config, middleware } from "@/middleware";

const password = "unit-test-gate-password";
const realm = 'Basic realm="Socratic Digital Twin"';

function basic(username: string, secret: string): string {
  return `Basic ${Buffer.from(`${username}:${secret}`, "utf8").toString("base64")}`;
}

function request(path: string, authorization?: string): NextRequest {
  const headers = authorization ? { authorization } : undefined;
  return new NextRequest(new URL(path, "https://gate.test"), { headers });
}

function setEnv(values: Record<string, string | undefined>) {
  for (const name of ["SITE_GATE_PASSWORD", "VERCEL", "VERCEL_ENV", "VERCEL_URL"]) {
    vi.stubEnv(name, values[name] ?? "");
  }
}

beforeEach(() => setEnv({ SITE_GATE_PASSWORD: password, VERCEL: "1", VERCEL_ENV: "production" }));
afterEach(() => vi.unstubAllEnvs());

describe("site password gate", () => {
  it("returns 401 with a Basic challenge when no credentials are sent", async () => {
    const response = await middleware(request("/"));

    expect(response?.status).toBe(401);
    expect(response?.headers.get("www-authenticate")).toBe(realm);
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 401 for a wrong password", async () => {
    const response = await middleware(request("/api/cases", basic("student", "wrong-password")));

    expect(response?.status).toBe(401);
    expect(response?.headers.get("www-authenticate")).toBe(realm);
  });

  it("returns 401 for malformed or non-Basic credentials", async () => {
    for (const header of ["Bearer token", "Basic !!!", `Basic ${btoa("no-separator")}`]) {
      expect((await middleware(request("/", header)))?.status).toBe(401);
    }
  });

  it("lets the right password through with any username", async () => {
    for (const username of ["", "anyone", "admin", "a:b"]) {
      expect(await middleware(request("/api/demo/identity", basic(username, password)))).toBeUndefined();
    }
  });

  it("does not accept a password that only shares a prefix", async () => {
    expect((await middleware(request("/", basic("x", `${password}x`))))?.status).toBe(401);
    expect((await middleware(request("/", basic("x", password.slice(0, -1)))))?.status).toBe(401);
  });

  it("locks the site when the password is missing on Vercel production and preview", async () => {
    for (const vercelEnv of ["production", "preview"]) {
      setEnv({ VERCEL: "1", VERCEL_ENV: vercelEnv, VERCEL_URL: "gate-abc.vercel.app" });

      const withoutCredentials = await middleware(request("/"));
      const withCredentials = await middleware(request("/", basic("x", "")));

      expect(withoutCredentials?.status).toBe(503);
      expect(withCredentials?.status).toBe(503);
    }
  });

  it("locks the site when any single Vercel variable is present", async () => {
    for (const name of ["VERCEL", "VERCEL_ENV", "VERCEL_URL"]) {
      setEnv({ [name]: "1" });
      expect((await middleware(request("/")))?.status).toBe(503);
    }
  });

  it("leaves the site open locally when no password is configured", async () => {
    setEnv({});

    expect(await middleware(request("/"))).toBeUndefined();
    expect(await middleware(request("/api/cases"))).toBeUndefined();
  });

  it("still enforces the password locally when one is configured", async () => {
    setEnv({ SITE_GATE_PASSWORD: password });

    expect((await middleware(request("/")))?.status).toBe(401);
    expect(await middleware(request("/", basic("", password)))).toBeUndefined();
  });
});

describe("site password gate matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it("skips static build assets and the favicon without credentials", () => {
    expect(matches("/_next/static/chunks/main.js")).toBe(false);
    expect(matches("/_next/static/css/app.css")).toBe(false);
    expect(matches("/favicon.svg")).toBe(false);
  });

  it("gates pages, API routes, image optimisation and other public files", () => {
    for (const url of [
      "/",
      "/admin",
      "/api/demo/identity",
      "/api/cases",
      "/_next/image?url=%2Fmedia%2Fx.png&w=640&q=75",
      "/_next/data/build/index.json",
      "/media/x.png",
      "/og.png",
      "/favicon.svg.bak",
    ]) {
      expect(matches(url), url).toBe(true);
    }
  });
});
