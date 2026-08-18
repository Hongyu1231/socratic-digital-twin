import { describe, expect, it } from "vitest";
import { describeRequestFailure, isTimeout, readJsonBody, requestSignal } from "@/lib/client-request";

function htmlResponse(status: number) {
  return new Response("<!DOCTYPE html><html><body>Gateway timeout</body></html>", {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe("readJsonBody", () => {
  it("returns the parsed body for a JSON response", async () => {
    const response = new Response(JSON.stringify({ session: { id: "abc" } }), {
      headers: { "content-type": "application/json" },
    });
    await expect(readJsonBody<{ session: { id: string } }>(response, "fallback")).resolves.toEqual({ session: { id: "abc" } });
  });

  it("reports a gateway timeout instead of a JSON parser message", async () => {
    await expect(readJsonBody(htmlResponse(504), "The session could not be ended."))
      .rejects.toThrow(/took too long to respond/i);
  });

  it("falls back to the caller's message for other non-JSON responses", async () => {
    await expect(readJsonBody(htmlResponse(500), "The session could not be ended."))
      .rejects.toThrow("The session could not be ended.");
  });

  it("never surfaces a syntax error for a malformed JSON body", async () => {
    const response = new Response("<html>", { headers: { "content-type": "application/json" } });
    await expect(readJsonBody(response, "Cases could not be loaded.")).rejects.toThrow("Cases could not be loaded.");
  });
});

describe("describeRequestFailure", () => {
  it("uses the timeout message when the deadline fired", async () => {
    const signal = requestSignal(1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(isTimeout(signal.reason)).toBe(true);
    expect(describeRequestFailure(signal.reason, "fallback", "taking longer than expected")).toBe("taking longer than expected");
  });

  it("reports a dropped connection for a network failure", () => {
    expect(describeRequestFailure(new TypeError("Failed to fetch"), "fallback", "timeout")).toMatch(/connection/i);
  });

  it("passes a server error message through unchanged", () => {
    expect(describeRequestFailure(new Error("This session belongs to another learner."), "fallback", "timeout"))
      .toBe("This session belongs to another learner.");
  });
});
