/* global process, URL, fetch, console, Buffer, setTimeout, AbortSignal */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Explicitly opt-in: this creates a private bucket if needed, uploads one
// generated synthetic fixture, and removes exactly that fixture in finally.
// Never imports teaching records, changes policies, or migrates public files.
if (process.env.RUN_PRIVATE_STORAGE_SMOKE !== "true") throw new Error("Set RUN_PRIVATE_STORAGE_SMOKE=true to authorize the synthetic Storage smoke.");
const expectedRef = process.env.EXPECTED_SUPABASE_PROJECT_REF;
const configuredUrl = process.env.SUPABASE_URL;
if (!expectedRef || !/^[a-z0-9]{20}$/.test(expectedRef) || configuredUrl !== `https://${expectedRef}.supabase.co`) throw new Error("Explicit expected project ref must match the HTTPS Supabase URL.");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("A service-role credential is required.");
const bucket = "teaching-case-media-private";
const objectPath = `verification/synthetic-${randomUUID()}.webp`;
const client = createClient(configuredUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) } });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const result = { bucketCreated: false, anonymousReadDenied: false, publicRouteDenied: false, signedRead: false, expiredOriginDenied: false, refreshedRead: false, fixtureRemoved: false };
let uploaded = false;

try {
  const { data: buckets, error: listError } = await client.storage.listBuckets();
  assert(!listError, "Could not inspect Storage buckets.");
  const current = buckets.find((item) => item.id === bucket);
  if (!current) {
    const created = await client.storage.createBucket(bucket, { public: false, allowedMimeTypes: ["image/webp"], fileSizeLimit: 10 * 1024 * 1024 });
    assert(!created.error, "Could not create the private teaching-media bucket.");
    result.bucketCreated = true;
  } else assert(current.public === false, "Existing teaching-media bucket is not private; refusing to modify it.");

  const bytes = Buffer.alloc(32, 0);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(24, 4); bytes.write("WEBP", 8);
  const upload = await client.storage.from(bucket).upload(objectPath, bytes, { contentType: "image/webp", cacheControl: "0", upsert: false });
  assert(!upload.error, "Synthetic fixture upload failed.");
  uploaded = true;
  const read = async (url) => {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    await response.arrayBuffer();
    return response.ok;
  };
  result.anonymousReadDenied = !await read(`${configuredUrl}/storage/v1/object/${bucket}/${objectPath}`);
  result.publicRouteDenied = !await read(`${configuredUrl}/storage/v1/object/public/${bucket}/${objectPath}`);
  assert(result.anonymousReadDenied && result.publicRouteDenied, "An unsigned fixture read unexpectedly succeeded.");
  const first = await client.storage.from(bucket).createSignedUrl(objectPath, 3);
  assert(!first.error && first.data?.signedUrl, "Short-lived signing failed.");
  result.signedRead = await read(first.data.signedUrl);
  assert(result.signedRead, "Signed fixture read failed.");
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  const expiredUrl = new URL(first.data.signedUrl);
  expiredUrl.searchParams.set("cacheNonce", randomUUID());
  result.expiredOriginDenied = !await read(expiredUrl);
  assert(result.expiredOriginDenied, "Expired token was still accepted by the origin.");
  const fresh = await client.storage.from(bucket).createSignedUrl(objectPath, 60);
  assert(!fresh.error && fresh.data?.signedUrl, "Signing refresh failed.");
  result.refreshedRead = await read(fresh.data.signedUrl);
  assert(result.refreshedRead, "Refreshed signed fixture read failed.");
} finally {
  if (uploaded) {
    const removed = await client.storage.from(bucket).remove([objectPath]);
    result.fixtureRemoved = !removed.error;
    assert(result.fixtureRemoved, "Synthetic fixture cleanup failed; inspect the verification prefix.");
  }
  console.log(JSON.stringify(result));
}
