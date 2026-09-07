import { promises as fs } from "node:fs";
import path from "node:path";

import { getMaterialPack } from "@/lib/materials/pack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isLoopbackHost(value: string | null): boolean {
  if (!value) return false;
  const host = value.trim().toLowerCase();
  const portIsValid = (port: string | undefined) => port === undefined || (Number(port) >= 0 && Number(port) <= 65_535);
  const ipv4 = host.match(/^127\.0\.0\.1(?::(\d{1,5}))?$/);
  const localhost = host.match(/^localhost(?::(\d{1,5}))?$/);
  const ipv6 = host.match(/^\[::1\](?::(\d{1,5}))?$/);
  return Boolean((ipv4 && portIsValid(ipv4[1])) || (localhost && portIsValid(localhost[1])) || (ipv6 && portIsValid(ipv6[1])))
    || host === "::1";
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

function isContained(rootDir: string, candidate: string): boolean {
  const relative = path.relative(rootDir, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLoopbackHost(request.headers.get("host"))) return notFound();
  const { id } = await params;
  if (!UUID.test(id)) return notFound();

  const pack = getMaterialPack();
  const media = pack?.media.find((item) => item.id.toLowerCase() === id.toLowerCase());
  if (!pack || !media) return notFound();

  const candidate = path.resolve(pack.rootDir, media.file);
  let rootRealPath: string;
  let mediaRealPath: string;
  try {
    rootRealPath = await fs.realpath(pack.rootDir);
    mediaRealPath = await fs.realpath(candidate);
  } catch {
    return notFound();
  }
  if (!isContained(rootRealPath, mediaRealPath)) return notFound();

  let content: Buffer;
  try {
    const stats = await fs.stat(mediaRealPath);
    if (!stats.isFile()) return notFound();
    content = await fs.readFile(mediaRealPath);
  } catch {
    return notFound();
  }

  const body = new ArrayBuffer(content.byteLength);
  new Uint8Array(body).set(content);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(content.byteLength),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
