/** Extract questions, not their acknowledgement, correction or support prose. */
export function questionTexts(content: string): string[] {
  return (content.match(/[^.!?？\n]*[?？]/g) ?? []).map(text => text.trim()).filter(Boolean);
}

export function normalizeQuestion(content: string): string {
  return content.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
}

const STOP_WORDS = new Set("a an the what which how why when where who would could should can you your we our this that these those is are be to of in on at from for about and or do does did it its have has with as".split(" "));
function words(question: string) {
  return new Set((question.toLowerCase().match(/#?\d+|[a-z]+/g) ?? [])
    .filter(word => !STOP_WORDS.has(word))
    .map(word => word.replace(/prioritiz/g, "prioritis").replace(/^(findings|records|problems|views)$/, word => word.slice(0, -1))));
}

/** A bounded wording guard, not a semantic clinical-equivalence judgement. */
export function hasAskedQuestion(content: string, asked: string[]): boolean {
  const previous = asked.flatMap(questionTexts);
  return questionTexts(content).some(question => previous.some(old => {
    if (normalizeQuestion(question) === normalizeQuestion(old)) return true;
    const currentWords = words(question);
    const oldWords = words(old);
    // Do not confuse a question about a different tooth/measurement with one
    // about the same finding merely because its sentence frame is similar.
    const numbers = (tokens: Set<string>) => [...tokens].filter(token => /^#?\d+$/.test(token)).sort().join(",");
    if (numbers(currentWords) !== numbers(oldWords)) return false;
    if (Math.min(currentWords.size, oldWords.size) < 3) return false;
    const shared = [...currentWords].filter(word => oldWords.has(word)).length;
    const union = new Set([...currentWords, ...oldWords]).size;
    return shared / Math.min(currentWords.size, oldWords.size) >= 0.9 && shared / union >= 0.75;
  }));
}
