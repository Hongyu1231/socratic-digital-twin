import { getMaterialPack, type MaterialArticle, type MaterialArticlePage, type MaterialPack } from "@/lib/materials/pack";

export interface TeachingLiteraturePassage {
  sourceId: string;
  title: string;
  page: number;
  text: string;
  sourceType?: MaterialArticle["sourceType"];
  locator?: string;
  expert?: string;
  section?: string;
}

export interface TeachingContext {
  expertNotes: string;
  sourceDocument: string;
  literature: TeachingLiteraturePassage[];
}

/**
 * Bounded provenance for one literature passage selected for a tutor turn.
 *
 * This intentionally contains only identifiers and ranking metadata. Passage
 * text, expert notes, titles, and source documents remain in TeachingContext
 * and are never copied into the trace.
 */
export interface TeachingRetrievalTracePassage {
  sourceId: string;
  page: number;
  locator?: string;
  score: number;
}

/** Metadata-only retrieval trace for observability and evaluation. */
export interface TeachingRetrievalTrace {
  /** The bounded query used for this retrieval attempt. */
  query: string;
  passages: TeachingRetrievalTracePassage[];
}

export interface TeachingContextWithTrace {
  context: TeachingContext | undefined;
  trace: TeachingRetrievalTrace;
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
// Keep a small lane for evidence explicitly scoped to this case. It prevents
// high-frequency generic literature from consuming every slot, while still
// requiring the interview passage to match the query before it is selected.
const MAX_CASE_SCOPED_INTERVIEW_RESERVE = 2;
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
  sourceType?: MaterialArticle["sourceType"];
  locator?: string;
  expert?: string;
  section?: string;
  caseScoped: boolean;
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

function rankPages(articles: MaterialArticle[], terms: string[], caseId: string): RankedPage[] {
  if (terms.length === 0) return [];
  const index = getArticleIndex(articles);
  if (index.pages.length === 0) return [];

  return index.pages.flatMap(({ article, page, counts, titleCounts }) => {
    if (page.caseIds && !page.caseIds.includes(caseId)) return [];
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
    return [{ sourceId: article.id, title: article.title, page: page.page, text: page.text, score,
      sourceType: article.sourceType, locator: page.locator, expert: page.expert, section: page.section,
      caseScoped: Boolean(page.caseIds?.includes(caseId)) }];
  }).sort((left, right) => right.score - left.score || left.sourceId.localeCompare(right.sourceId) || left.page - right.page);
}

function emptyTrace(query: string): TeachingRetrievalTrace {
  return { query: query.slice(0, MAX_QUERY_LENGTH), passages: [] };
}

function getTeachingContextWithTraceFromPack(
  pack: MaterialPack,
  caseId: string,
  query: string,
): TeachingContextWithTrace {
  const boundedQuery = query.slice(0, MAX_QUERY_LENGTH);
  const entry = pack.cases.find((item) => item.case.id === caseId);
  if (!entry) return { context: undefined, trace: emptyTrace(boundedQuery) };

  const terms = queryTerms(query);
  const ranked = rankPages(pack.articles, terms, caseId);
  const selected: TeachingLiteraturePassage[] = [];
  const tracePassages: TeachingRetrievalTracePassage[] = [];
  const sourceCounts = new Map<string, number>();
  const selectedExperts = new Set<string>();
  const selectedCandidates = new Set<string>();
  let totalCharacters = 0;

  const selectCandidate = (candidate: RankedPage): boolean => {
    const interview = candidate.sourceType === "expert_interview";
    const expertKey = `${candidate.sourceId}:${candidate.expert}`;
    const candidateKey = `${candidate.sourceId}:${candidate.page}:${candidate.locator ?? ""}`;
    if (selected.length >= MAX_PASSAGES
      || selectedCandidates.has(candidateKey)
      || (sourceCounts.get(candidate.sourceId) ?? 0) >= (interview ? 3 : MAX_PASSAGES_PER_SOURCE)
      || (interview && selectedExperts.has(expertKey))) return false;
    const text = trimPassage(candidate.text, terms);
    if (!text) return false;
    const remaining = MAX_LITERATURE_CHARS - totalCharacters;
    if (remaining <= 0) return false;
    const boundedText = text.length <= remaining ? text : `${text.slice(0, Math.max(0, remaining - ELLIPSIS.length)).trim()}${ELLIPSIS}`;
    if (!boundedText) return false;
    selected.push({ sourceId: candidate.sourceId, title: candidate.title, page: candidate.page, text: boundedText,
      ...(candidate.sourceType ? { sourceType: candidate.sourceType } : {}),
      ...(candidate.locator ? { locator: candidate.locator } : {}),
      ...(candidate.expert ? { expert: candidate.expert } : {}),
      ...(candidate.section ? { section: candidate.section } : {}) });
    tracePassages.push({ sourceId: candidate.sourceId, page: candidate.page,
      ...(candidate.locator ? { locator: candidate.locator } : {}), score: candidate.score });
    selectedCandidates.add(candidateKey);
    if (interview) selectedExperts.add(expertKey);
    sourceCounts.set(candidate.sourceId, (sourceCounts.get(candidate.sourceId) ?? 0) + 1);
    totalCharacters += boundedText.length;
    return true;
  };

  let reservedInterviewPassages = 0;
  for (const candidate of ranked) {
    if (!candidate.caseScoped || candidate.sourceType !== "expert_interview"
      || reservedInterviewPassages >= MAX_CASE_SCOPED_INTERVIEW_RESERVE) continue;
    if (selectCandidate(candidate)) reservedInterviewPassages += 1;
  }
  for (const candidate of ranked) {
    if (selected.length >= MAX_PASSAGES) break;
    selectCandidate(candidate);
  }

  return {
    context: {
      expertNotes: entry.expertNotes.trim().slice(0, 6_000),
      sourceDocument: entry.sourceDocument,
      literature: selected,
    },
    trace: { query: boundedQuery, passages: tracePassages },
  };
}

/**
 * Retrieve bounded, page-attributed local literature context for a material
 * case. The returned text is evidence for the tutor; it is never interpreted
 * here as an instruction or policy.
 */
export function getTeachingContextFromPack(pack: MaterialPack, caseId: string, query: string): TeachingContext | undefined {
  return getTeachingContextWithTraceFromPack(pack, caseId, query).context;
}

/** Load reference context synchronously from the explicitly opted-in local pack. */
export function getTeachingContext(caseId: string, query: string): TeachingContext | undefined {
  const pack = getMaterialPack();
  return pack ? getTeachingContextFromPack(pack, caseId, query) : undefined;
}

/**
 * Retrieve teaching context alongside metadata-only ranking provenance.
 *
 * This is a parallel API to getTeachingContext: the existing context shape
 * and selection policy are unchanged, while the trace contains only the
 * bounded query and selected source/page/locator/score metadata.
 */
export function getTeachingContextWithTrace(caseId: string, query: string): TeachingContextWithTrace {
  const pack = getMaterialPack();
  return pack
    ? getTeachingContextWithTraceFromPack(pack, caseId, query)
    : { context: undefined, trace: emptyTrace(query) };
}

const HOSTED_CONTEXT_ERROR = "Teaching materials are temporarily unavailable. Please retry.";

/**
 * Resolve context for a tutor turn. Existing cases without a hosted package
 * pointer retain the synchronous local-pack behaviour and do not make a
 * Supabase Storage request.
 */
export async function getTeachingContextAsync(
  caseId: string,
  query: string,
  teachingMaterialPackageId?: string,
): Promise<TeachingContext | undefined> {
  if (!teachingMaterialPackageId) return getTeachingContext(caseId, query);

  const { getHostedMaterialPack } = await import("@/lib/materials/hosted");
  try {
    const pack = await getHostedMaterialPack(teachingMaterialPackageId);
    const context = getTeachingContextFromPack(pack, caseId, query);
    if (!context) throw new Error(HOSTED_CONTEXT_ERROR);
    return context;
  } catch (error) {
    if (error instanceof Error && error.message === HOSTED_CONTEXT_ERROR) throw error;
    throw new Error(HOSTED_CONTEXT_ERROR);
  }
}

/** Async counterpart to getTeachingContextWithTrace for hosted material packs. */
export async function getTeachingContextWithTraceAsync(
  caseId: string,
  query: string,
  teachingMaterialPackageId?: string,
): Promise<TeachingContextWithTrace> {
  if (!teachingMaterialPackageId) return getTeachingContextWithTrace(caseId, query);

  const { getHostedMaterialPack } = await import("@/lib/materials/hosted");
  try {
    const pack = await getHostedMaterialPack(teachingMaterialPackageId);
    const result = getTeachingContextWithTraceFromPack(pack, caseId, query);
    if (!result.context) throw new Error(HOSTED_CONTEXT_ERROR);
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === HOSTED_CONTEXT_ERROR) throw error;
    throw new Error(HOSTED_CONTEXT_ERROR);
  }
}
