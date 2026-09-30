import { afterEach, describe, expect, it, vi } from "vitest";
import { needsMediaRefresh, refreshMediaReference } from "@/lib/media-refresh";

afterEach(() => vi.unstubAllGlobals());

describe("media refresh", () => {
  it("refreshes missing and expired URLs, but keeps valid or legacy references", () => {
    expect(needsMediaRefresh({ id: "a" }, 0)).toBe(true);
    expect(needsMediaRefresh({ id: "a", url: "/media/a.png" }, 0)).toBe(false);
    expect(needsMediaRefresh({ id: "a", url: "https://example.com/a", expiresAt: new Date(29_000).toISOString() }, 0)).toBe(true);
    expect(needsMediaRefresh({ id: "a", url: "https://example.com/a", expiresAt: new Date(60_000).toISOString() }, 0)).toBe(false);
    expect(needsMediaRefresh({ id: "a", url: "/media/a.png", expiresAt: "invalid" }, 0)).toBe(true);
  });

  it("uses the authorized refresh endpoint without sending an object path", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ attachmentId: "a", url: "https://example.com/signed", expiresAt: null }));
    vi.stubGlobal("fetch", fetcher);
    expect(await refreshMediaReference("s", "a", new AbortController())).toEqual({ url: "https://example.com/signed", expiresAt: undefined });
    expect(fetcher).toHaveBeenCalledWith("/api/session/s/attachments/a/url", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  });

  it.each([
    { attachmentId: "other", url: "https://example.com/a", expiresAt: null },
    { attachmentId: "a", url: "javascript:alert(1)", expiresAt: null },
    { attachmentId: "a", url: "//example.com/a", expiresAt: null },
    { attachmentId: "a", url: "/\\example.com/a", expiresAt: null },
    { attachmentId: "a", url: "https://example.com/a", expiresAt: "invalid" },
  ])("rejects mismatched or invalid refresh payloads", async (payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    await expect(refreshMediaReference("s", "a", new AbortController())).rejects.toThrow("Teaching media could not be loaded");
  });

  it("handles gateway HTML without exposing a parser error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>timeout</html>", { status: 504 })));
    await expect(refreshMediaReference("s", "a", new AbortController())).rejects.toThrow("server took too long");
  });
});
