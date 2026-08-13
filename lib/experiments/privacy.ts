import { createHash, createHmac } from "node:crypto";

/**
 * A deterministic, one-way pseudonym.  Callers should provide a deployment
 * secret as `salt`; the default is intentionally only a test/development
 * namespace and must not be used to protect a real identity dictionary.
 */
export function pseudonymHash(value: string, salt = "socratic-experiment-dev-v1"): string {
  const normalized = value.trim().toLocaleLowerCase();
  return createHmac("sha256", salt).update(normalized, "utf8").digest("hex").slice(0, 16);
}

export type DeidentifyOptions = {
  /** Secret used by the HMAC pseudonymizer. */
  salt?: string;
  /** Known names or other exact identifiers present in the source record. */
  knownNames?: readonly string[];
  /** Known address/identifier fragments to remove as exact values. */
  knownIdentifiers?: readonly string[];
};

export type DeidentifyReplacement = {
  kind: "email" | "uuid" | "phone" | "ip" | "date" | "url" | "name" | "identifier";
  pseudonym: string;
};

export type DeidentifiedText = {
  text: string;
  replacements: readonly DeidentifyReplacement[];
};

function token(kind: DeidentifyReplacement["kind"], value: string, salt: string): string {
  return `<${kind.toUpperCase()}_${pseudonymHash(value, salt)}>`;
}

function replacementMap(): readonly [RegExp, DeidentifyReplacement["kind"]][] {
  // Order matters: URL/email are replaced before their substrings can match a
  // generic identifier pattern.  Patterns intentionally avoid matching normal
  // short numbers in clinical prose.
  return [
    [/https?:\/\/[^\s<]+/gi, "url"],
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "email"],
    [/(?<![\da-f])[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\da-f])/gi, "uuid"],
    [/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, "ip"],
    [/(?<!\d)(?:(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)?\d{2})(?!\d)/g, "date"],
    [/(?<!\d)(?:\+?\d[\d .()-]{7,}\d)(?!\d)/g, "phone"],
  ];
}

/**
 * Replace common PII and caller-supplied identifiers with stable one-way
 * pseudonyms.  Names are only replaced when supplied in `knownNames`; this
 * avoids corrupting ordinary capitalised clinical terms.
 */
export function deidentifyText(value: string, options: DeidentifyOptions = {}): DeidentifiedText {
  const input = typeof value === "string" ? value : String(value ?? "");
  const salt = options.salt ?? "socratic-experiment-dev-v1";
  let text = input;
  const replacements: DeidentifyReplacement[] = [];

  const replace = (pattern: RegExp, kind: DeidentifyReplacement["kind"]) => {
    text = text.replace(pattern, (match) => {
      const pseudonym = token(kind, match, salt);
      replacements.push({ kind, pseudonym });
      return pseudonym;
    });
  };

  for (const [pattern, kind] of replacementMap()) replace(pattern, kind);

  const exactIdentifiers = (options.knownNames ?? [])
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .sort((left, right) => right.length - left.length);
  const replaceExact = (identifier: string, kind: "name" | "identifier") => {
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
    text = text.replace(pattern, (match) => {
      const pseudonym = token(kind, match, salt);
      replacements.push({ kind, pseudonym });
      return pseudonym;
    });
  };
  for (const identifier of exactIdentifiers) replaceExact(identifier, "name");
  const knownIdentifiers = (options.knownIdentifiers ?? [])
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .sort((left, right) => right.length - left.length);
  for (const identifier of knownIdentifiers) replaceExact(identifier, "identifier");

  // Avoid leaking the original exact identifier in replacement metadata.
  return { text, replacements: Object.freeze(replacements.map((item) => Object.freeze(item))) };
}

/** Recursively de-identify arbitrary JSON-compatible values. */
export function deidentifyValue(value: unknown, options: DeidentifyOptions = {}): unknown {
  if (typeof value === "string") return deidentifyText(value, options).text;
  if (Array.isArray(value)) return value.map((item) => deidentifyValue(item, options));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, deidentifyValue(child, options)]),
    );
  }
  return value;
}

/** Return a short, stable content hash for an arbitrary UTF-8 string. */
export function contentHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
