import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

import { config, middleware } from "@/middleware";

type CookieMethods = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: { name: string; value: string; options: Record<string, unknown> }[], headers: Record<string, string>) => void;
};

function setEnv(values: Record<string, string | undefined>) {
  for (const name of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]) {
    vi.stubEnv(name, values[name] ?? "");
  }
}

const supabaseEnv = { SUPABASE_URL: "https://project.supabase.test", SUPABASE_PUBLISHABLE_KEY: "test-publishable-key" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClaims.mockResolvedValue({ data: null, error: null });
  mocks.createServerClient.mockImplementation(() => ({ auth: { getClaims: mocks.getClaims } }));
});
afterEach(() => vi.unstubAllEnvs());

describe("middleware session refresh", () => {
  it("skips the refresh when Supabase env vars are missing", async () => {
    setEnv({});
    await expect(middleware(new NextRequest("https://app.test/"))).resolves.toBeUndefined();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("calls getClaims and returns the response carrying refreshed cookies", async () => {
    setEnv(supabaseEnv);
    mocks.createServerClient.mockImplementation((_url: string, _key: string, options: { cookies: CookieMethods }) => ({
      auth: {
        getClaims: async () => {
          options.cookies.setAll(
            [{ name: "sb-project-auth-token", value: "refreshed", options: { path: "/", httpOnly: true } }],
            { "Cache-Control": "private, no-store" },
          );
          return { data: { claims: { sub: "user" } }, error: null };
        },
      },
    }));

    const response = (await middleware(new NextRequest("https://app.test/professor"))) as NextResponse | undefined;

    expect(mocks.createServerClient).toHaveBeenCalledWith(supabaseEnv.SUPABASE_URL, supabaseEnv.SUPABASE_PUBLISHABLE_KEY, expect.anything());
    expect(response?.status).toBe(200);
    expect(response?.cookies.get("sb-project-auth-token")?.value).toBe("refreshed");
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
  });

  it("still lets the request through when getClaims throws", async () => {
    setEnv(supabaseEnv);
    mocks.getClaims.mockRejectedValue(new Error("auth down"));
    const response = await middleware(new NextRequest("https://app.test/"));
    expect(response?.status).toBe(200);
  });
});

describe("middleware must-change-password", () => {
  function flagged(refreshCookie = false) {
    mocks.createServerClient.mockImplementation((_url: string, _key: string, options: { cookies: CookieMethods }) => ({
      auth: {
        getClaims: async () => {
          if (refreshCookie) options.cookies.setAll([{ name: "sb-project-auth-token", value: "refreshed", options: { path: "/" } }], {});
          return { data: { claims: { sub: "user", app_metadata: { must_change_password: true } } }, error: null };
        },
      },
    }));
  }

  it("redirects pages to /set-password and keeps refreshed cookies", async () => {
    setEnv(supabaseEnv);
    flagged(true);
    const response = (await middleware(new NextRequest("https://app.test/admin"))) as NextResponse;
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.test/set-password");
    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("refreshed");
  });

  it("returns 403 for API routes", async () => {
    setEnv(supabaseEnv);
    flagged();
    const response = (await middleware(new NextRequest("https://app.test/api/cases"))) as NextResponse;
    expect(response.status).toBe(403);
  });

  it("lets /set-password and /login through", async () => {
    setEnv(supabaseEnv);
    flagged();
    for (const path of ["/set-password", "/login"]) {
      expect(((await middleware(new NextRequest(`https://app.test${path}`))) as NextResponse).status).toBe(200);
    }
  });

  it("does nothing once the flag is cleared", async () => {
    setEnv(supabaseEnv);
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user", app_metadata: { must_change_password: false } } }, error: null });
    expect(((await middleware(new NextRequest("https://app.test/admin"))) as NextResponse).status).toBe(200);
  });
});

describe("middleware matcher", () => {
  // Mirrors Next.js: the middleware only runs when the matcher matches.
  async function visit(path: string) {
    const url = `https://app.test${path}`;
    if (unstable_doesMiddlewareMatch({ config, url })) await middleware(new NextRequest(url));
  }

  it("refreshes the session on pages and API routes", async () => {
    setEnv(supabaseEnv);
    for (const path of ["/", "/admin", "/session/abc", "/api/cases", "/api/session/speech"]) {
      mocks.createServerClient.mockClear();
      await visit(path);
      expect(mocks.createServerClient, path).toHaveBeenCalledTimes(1);
    }
  });

  it("skips build assets, the image optimiser, /media and public files", async () => {
    setEnv(supabaseEnv);
    for (const path of [
      "/_next/static/chunks/main.js",
      "/_next/image?url=%2Fmedia%2Fx.png&w=640&q=75",
      "/favicon.svg",
      "/media/case-1/xray.png",
      "/media/case-1/captions.vtt",
      "/og.png",
      "/icons/logo.svg",
      "/photo.jpg",
      "/fonts/inter.woff2",
      "/apple-touch-icon.ico",
    ]) {
      await visit(path);
      expect(mocks.createServerClient, path).not.toHaveBeenCalled();
    }
  });
});
