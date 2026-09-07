import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const direct = process.argv.includes("--direct");
const args = process.argv.slice(2).filter((arg) => arg !== "--direct");
const root = path.resolve(args[0] ?? "work/teaching-materials");
const port = args[1] ?? "3100";
if (process.env.VERCEL) throw new Error("Private teaching packs are for local testing only.");
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error("Invalid local port.");
if (!existsSync(path.join(root, "manifest.json"))) {
  throw new Error("Import the case and article ZIPs first; the material manifest is missing.");
}
const provider = process.env.TUTOR_PROVIDER || (process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL ? "openai" : "deterministic");
const env = {
  ...process.env,
  TUTOR_MATERIALS_DIR: root,
  FORCE_MEMORY_REPOSITORY: "true",
  TUTOR_PROVIDER: provider,
  NEXT_TELEMETRY_DISABLED: "1",
  ...(direct ? { OPENAI_PROXY_URL: "", HTTPS_PROXY: "", HTTP_PROXY: "", ALL_PROXY: "" } : {}),
};
process.stdout.write(`Teaching materials: http://127.0.0.1:${port}\nTutor provider: ${provider}. Sessions use local memory.\n`);
if (direct) process.stdout.write("Direct provider connection requested; proxy settings are bypassed for this process only.\n");
const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", port], {
  env,
  stdio: "inherit",
  windowsHide: true,
});
next.on("exit", (code) => { process.exitCode = code ?? 1; });
next.on("error", () => { process.stderr.write("Could not start the local teaching server.\n"); process.exitCode = 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => next.kill(signal));
