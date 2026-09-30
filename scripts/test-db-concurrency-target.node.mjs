// Run with node --test; keep out of Vitest's *.test.* discovery.
import assert from "node:assert/strict";
import test from "node:test";
import { assertLoopbackTestTarget } from "./test-db-concurrency-target.mjs";

test("accepts only a loopback HTTP test target", () => {
  const target = assertLoopbackTestTarget("http://127.0.0.1:54321", "test");
  assert.equal(target.origin, "http://127.0.0.1:54321");
  assert.equal(assertLoopbackTestTarget("http://localhost:54321", "test").hostname, "localhost");
  assert.equal(assertLoopbackTestTarget("http://[::1]:54321", "test").hostname, "[::1]");
});

test("rejects production, non-loopback, and malformed targets", () => {
  assert.throws(
    () => assertLoopbackTestTarget("https://example.supabase.co", "test"),
    /non-loopback database target/,
  );
  assert.throws(
    () => assertLoopbackTestTarget("http://192.0.2.10:54321", "test"),
    /non-loopback database target/,
  );
  assert.throws(
    () => assertLoopbackTestTarget("http://127.0.0.1:54321", "production"),
    /SUPABASE_DATA_ENVIRONMENT=test/,
  );
  assert.throws(
    () => assertLoopbackTestTarget("not-a-url", "test"),
    /invalid database target URL/,
  );
});
