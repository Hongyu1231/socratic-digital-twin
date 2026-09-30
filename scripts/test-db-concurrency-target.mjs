/* global URL */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function assertLoopbackTestTarget(supabaseUrl, dataEnvironment) {
  if (dataEnvironment !== "test") {
    throw new Error("Refusing database concurrency writes unless SUPABASE_DATA_ENVIRONMENT=test.");
  }
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL/API_URL is required.");
  }

  let baseUrl;
  try {
    baseUrl = new URL(supabaseUrl);
  } catch {
    throw new Error("Refusing invalid database target URL.");
  }
  const hostname = baseUrl.hostname.replace(/^\[|\]$/g, "");
  if (baseUrl.protocol !== "http:" || !LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(`Refusing non-loopback database target: ${baseUrl.origin}`);
  }
  return baseUrl;
}
