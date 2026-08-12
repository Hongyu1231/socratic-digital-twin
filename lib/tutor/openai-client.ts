import OpenAI from "openai";
import { fetch as undiciFetch, ProxyAgent } from "undici";

function getProxyUrl() {
  const value = process.env.OPENAI_PROXY_URL
    ?? process.env.HTTPS_PROXY
    ?? process.env.ALL_PROXY;
  if (!value) return undefined;

  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OpenAI proxy URL must use http or https.");
  }
  return url.toString();
}

export function createOpenAIClient(apiKey: string) {
  const proxyUrl = getProxyUrl();
  return new OpenAI({
    apiKey,
    maxRetries: 2,
    timeout: 30_000,
    ...(proxyUrl
      ? {
          fetch: undiciFetch as unknown as typeof globalThis.fetch,
          fetchOptions: { dispatcher: new ProxyAgent(proxyUrl) },
        }
      : {}),
  });
}
