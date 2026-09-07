import { getMaterialPack, type MaterialArticle, type MaterialArticlePage } from "@/lib/materials/pack";

export interface TeachingLiteraturePassage {
  sourceId: string;
  title: string;
  page: number;
  text: string;
}

export interface TeachingContext {
  expertNotes: string;
  sourceDocument: string;
  literature: TeachingLiteraturePassage[];
}

const STOP_WORDS = new Set([
  "a", "about", "after", "again", "all", "also", "an", "and", "any", "are", "as", "at", "be", "because",
  "been", "before", "being", "between", "but", "by", "can", "could", "did", "do", "does", "for", "from",
  "had", "has", "have", "how", "if", "in", "into", "is", "it", "its", "may", "more", "most", "of", "on",
  "or", "our", "should", "such", "than", "that", "the", "their", "then", "there", "these", "they", "this",
  "to", "under", "was", "we", "were", "what", "when", "where", "which", "who", "why", "will", "with", "would",
  "you", "your",
]);

const MAX_QUERY_LENGTH = 2_000;
const MAX_TERMS = 32;
const MAX_PASSAGES = 4;
const MAX_PASSAGES_PER_SOURCE = 2;
const MAX_LITERATURE_CHARS = 6_000;
const MAX_PASSAGE_CHARS = 1_800;
const ELLIPSIS = "…";

function tokenize(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[a-z0-9]+/g)
    ?.filter((term) => term.length >= 2 && !STOP_WORDS.has(term)) ?? [];
}

function queryTerms(value: string): string[] {
  return [...new Set(tokenize(value.slice(0, MAX_QUERY_LENGTH)))].slice(0, MAX_TERMS);
}

function termCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of tokenize(value)) counts.set(term, (counts.get(term) ?? 0) + 1);
  return counts;
}

function trimPassage(text: string, terms: string[]): string {
  const normalized = text.trim();
  if (normalized.length <= MAX_PASSAGE_CHARS) return normalized;

  const lower = normalized.toLocaleLowerCase("en-US");
  const firstMatch = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const windowStart = Math.max(0, Math.min(firstMatch - 650, normalized.length - MAX_PASSAGE_CHARS + 1));
  const windowEnd = Math.min(normalized.length, windowStart + MAX_PASSAGE_CHARS);
  const prefix = windowStart > 0 ? ELLIPSIS : "";
  const suffix = windowEnd < normalized.length ? ELLIPSIS : "";
  return `${prefix}${normalized.slice(windowStart, windowEnd - suffix.length).trim()}${suffix}`;
}

interface RankedPage {
  sourceId: string;
  title: string;
  page: number;
  text: string;
  score: number;
}

interface IndexedPage {
  article: MaterialArticle;
  page: MaterialArticlePage;
  counts: Map<string, number>;
  titleCounts: Map<string, number>;
}

interface ArticleIndex {
  pages: IndexedPage[];
  documentFrequency: Map<string, number>;
}

// A material pack is immutable for the lifetime of a local server. The
// WeakMap keeps one lexical index per loaded articles array without retaining
// old packs if tests or a development reload replace the pack instance.
const articleIndexes = new WeakMap<MaterialArticle[], ArticleIndex>();

function getArticleIndex(articles: MaterialArticle[]): ArticleIndex {
  const cached = articleIndexes.get(articles);
  if (cached) return cached;

  const pages: IndexedPage[] = [];
  const documentFrequency = new Map<string, number>();
  for (const article of articles) {
    const titleCounts = termCounts(article.title);
    for (const page of article.pages) {
      const counts = termCounts(page.text);
      pages.push({ article, page, counts, titleCounts });
      for (const term of counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const index = { pages, documentFrequency };
  articleIndexes.set(articles, index);
  return index;
}

function rankPages(articles: MaterialArticle[], terms: string[]): RankedPage[] {
  if (terms.length === 0) return [];
  const index = getArticleIndex(articles);
  if (index.pages.length === 0) return [];

  return index.pages.flatMap(({ article, page, counts, titleCounts }) => {
    let score = 0;
    let matched = false;
    for (const term of terms) {
      const count = counts.get(term) ?? 0;
      if (count === 0) continue;
      matched = true;
      const informativeWeight = 1 + Math.log((1 + index.pages.length) / (1 + (index.documentFrequency.get(term) ?? 0)));
      score += informativeWeight * (1 + Math.min(count, 4) * 0.35);
      if (titleCounts.has(term)) score += informativeWeight * 1.5;
    }
    if (!matched) return [];
    return [{ sourceId: article.id, title: article.title, page: page.page, text: page.text, score }];
  }).sort((left, right) => right.score - left.score || left.sourceId.localeCompare(right.sourceId) || left.page - right.page);
}

/**
 * Retrieve bounded, page-attributed local literature context for a material
 * case. The returned text is evidence for the tutor; it is never interpreted
 * here as an instruction or policy.
 */
export function getTeachingContext(caseId: string, query: string): TeachingContext | undefined {
  const pack = getMaterialPack();
  const entry = pack?.cases.find((item) => item.case.id === caseId);
  if (!entry) return undefined;

  const terms = queryTerms(query);
  const ranked = rankPages(pack?.articles ?? [], terms);
  const selected: TeachingLiteraturePassage[] = [];
  const sourceCounts = new Map<string, number>();
  let totalCharacters = 0;

  for (const candidate of ranked) {
    if (selected.length >= MAX_PASSAGES || (sourceCounts.get(candidate.sourceId) ?? 0) >= MAX_PASSAGES_PER_SOURCE) continue;
    const text = trimPassage(candidate.text, terms);
    if (!text) continue;
    const remaining = MAX_LITERATURE_CHARS - totalCharacters;
    if (remaining <= 0) break;
    const boundedText = text.length <= remaining ? text : `${text.slice(0, Math.max(0, remaining - ELLIPSIS.length)).trim()}${ELLIPSIS}`;
    if (!boundedText) continue;
    selected.push({ sourceId: candidate.sourceId, title: candidate.title, page: candidate.page, text: boundedText });
    sourceCounts.set(candidate.sourceId, (sourceCounts.get(candidate.sourceId) ?? 0) + 1);
    totalCharacters += boundedText.length;
  }

  return {
    expertNotes: entry.expertNotes.trim().slice(0, 6_000),
    sourceDocument: entry.sourceDocument,
    literature: selected,
  };
}
