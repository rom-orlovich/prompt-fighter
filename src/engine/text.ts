/** Text primitives shared by the analyzer. Pure, dependency-free. */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'on',
  'for', 'and', 'or', 'but', 'it', 'this', 'that', 'with', 'as', 'at', 'by', 'from',
  'you', 'your', 'i', 'we', 'they', 'not', 'do', 'does', 'did', 'if', 'then', 'than',
  'so', 'just', 'can', 'will', 'would', 'should', 'have', 'has', 'had', 'my', 'me',
  'am', 'its', 'their', 'there', 'here', 'what', 'when', 'how', 'why', 'who'
]);

/** Content words: lowercased, punctuation-stripped, stopword-filtered, code fences removed. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[^a-z0-9֐-׿]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Raw word count — used for move weight, where filler still costs you time. */
export function rawWordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Jaccard similarity over content words. 0 when either side has no content. */
export function similarity(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}
