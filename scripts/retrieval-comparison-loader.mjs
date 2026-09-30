import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensions = [".ts", ".tsx", ".mts", ".js", ".mjs"];

function candidateUrls(filePath) {
  const values = [filePath];
  if (!path.extname(filePath)) for (const extension of extensions) values.push(`${filePath}${extension}`);
  return values.map((value) => pathToFileURL(value).href);
}

export async function resolve(specifier, context, nextResolve) {
  const mapped = specifier.startsWith("@/")
    ? path.join(root, specifier.slice(2))
    : specifier.startsWith(".") && context.parentURL?.startsWith(pathToFileURL(root).href)
      ? path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
      : null;
  if (!mapped) return nextResolve(specifier, context);
  for (const url of candidateUrls(mapped)) {
    try {
      return await nextResolve(url, context);
    } catch {
      // Try the next extension, preserving Node's normal errors if none match.
    }
  }
  return nextResolve(specifier, context);
}
