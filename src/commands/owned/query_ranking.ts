import type { AdaptiveQueryExplain, SearchOutputRow } from './io/types.js';
import type { QueryTraits } from './query_classifier.js';

interface StructuralSignals {
  readonly phrase: number;
  readonly title: number;
  readonly heading: number;
  readonly coverage: number;
  readonly proximity: number;
  readonly literalAnchor: number;
  readonly vectorStrength: AdaptiveQueryExplain['vectorStrength'];
}

const MAX_SCORING_BODY_BYTES = 12_000;

function clampScore(score: number): number {
  return Math.max(0, Math.min(0.99, score));
}

function countMatches(text: string, terms: readonly string[]): number {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function getVectorStrength(row: SearchOutputRow): AdaptiveQueryExplain['vectorStrength'] {
  const scores = row.explain?.vectorScores ?? [];
  if (scores.length === 0) {
    return 'absent';
  }

  return Math.max(...scores) >= 0.4 ? 'strong' : 'weak';
}

function getScoringBody(row: SearchOutputRow): string {
  const sourceBody = row.sourceBody ?? row.body;
  if (sourceBody.length <= MAX_SCORING_BODY_BYTES) {
    return sourceBody;
  }

  const center = row.sourceChunkPos ?? row.chunkPos;
  if (center === undefined) {
    return row.body;
  }

  const halfWindow = Math.floor(MAX_SCORING_BODY_BYTES / 2);
  const start = Math.max(0, center - halfWindow);
  const end = Math.min(sourceBody.length, start + MAX_SCORING_BODY_BYTES);
  const adjustedStart = Math.max(0, end - MAX_SCORING_BODY_BYTES);

  return sourceBody.slice(adjustedStart, end);
}

function extractHeadings(body: string): string[] {
  return body
    .split('\n')
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .trim()
        .toLowerCase(),
    )
    .filter((line) => line.length > 0);
}

function computeProximity(lines: string[], terms: readonly string[]): number {
  if (terms.length < 2) {
    return 0;
  }

  let best = 0;
  for (const line of lines) {
    const lowered = line.toLowerCase();
    const matchCount = countMatches(lowered, terms);
    if (matchCount === terms.length) {
      best = Math.max(best, 0.12);
    } else if (matchCount > 1) {
      best = Math.max(best, 0.06);
    }
  }

  return best;
}

function computeSignals(row: SearchOutputRow, traits: QueryTraits): StructuralSignals {
  const titleText = row.title.toLowerCase();
  const scoringBody = getScoringBody(row);
  const sourceBody = scoringBody.toLowerCase();
  const headings = extractHeadings(scoringBody);
  const lines = scoringBody.split('\n');
  const termCount = traits.terms.length === 0 ? 1 : traits.terms.length;
  const coverageRatio = countMatches(sourceBody, traits.terms) / termCount;
  const wholeForm = traits.wholeForm;

  let phrase = 0;
  if (wholeForm.length > 0) {
    if (titleText.includes(wholeForm)) {
      phrase += traits.queryClass === 'short-korean-phrase' ? 0.28 : 0.18;
    }
    if (sourceBody.includes(wholeForm)) {
      phrase += traits.queryClass === 'short-korean-phrase' ? 0.16 : 0.1;
    }
  }

  const headingMatches = headings.filter((heading) => {
    if (wholeForm.length > 0 && heading.includes(wholeForm)) {
      return true;
    }

    return countMatches(heading, traits.terms) > 0;
  }).length;

  const title = Math.min(0.14, countMatches(titleText, traits.terms) * 0.06);
  const heading = Math.min(0.14, headingMatches * 0.07);
  const coverage = Math.min(0.12, coverageRatio * 0.12);
  const proximity = computeProximity(lines, traits.terms);
  let literalAnchor = 0;

  if (traits.hasExplicitPhrase && wholeForm.length > 0 && sourceBody.includes(wholeForm)) {
    literalAnchor += 0.08;
  }
  if (traits.queryClass === 'mixed-technical' && wholeForm.length > 0) {
    if (titleText.includes(wholeForm) || sourceBody.includes(wholeForm)) {
      literalAnchor += 0.08;
    }
  }
  if (
    traits.hasPathLikeToken &&
    wholeForm.length > 0 &&
    (titleText.includes(wholeForm) || sourceBody.includes(wholeForm))
  ) {
    literalAnchor += 0.12;
  }
  if (
    traits.hasLatin &&
    traits.hasHangul &&
    countMatches(sourceBody, traits.terms) === traits.terms.length
  ) {
    literalAnchor += 0.08;
  }

  return {
    phrase,
    title,
    heading,
    coverage,
    proximity,
    literalAnchor,
    vectorStrength: getVectorStrength(row),
  };
}

function applySignals(
  row: SearchOutputRow,
  traits: QueryTraits,
  signals: StructuralSignals,
): SearchOutputRow {
  let adjustedScore =
    row.score +
    signals.phrase +
    signals.title +
    signals.heading +
    signals.coverage +
    signals.proximity +
    signals.literalAnchor;

  if (signals.vectorStrength === 'weak' && traits.queryClass === 'mixed-technical') {
    adjustedScore -= 0.02;
  }

  if (
    signals.vectorStrength === 'absent' &&
    traits.queryClass === 'short-korean-phrase' &&
    signals.phrase + signals.title + signals.heading + signals.coverage < 0.1
  ) {
    adjustedScore -= 0.04;
  }

  const adaptive: AdaptiveQueryExplain = {
    queryClass: traits.queryClass,
    candidateSource: traits.queryClass === 'structured' ? 'structured-compatibility' : 'adaptive',
    vectorStrength: signals.vectorStrength,
    baseScore: row.score,
    adjustedScore: clampScore(adjustedScore),
    phrase: signals.phrase,
    title: signals.title,
    heading: signals.heading,
    coverage: signals.coverage,
    proximity: signals.proximity,
    literalAnchor: signals.literalAnchor,
  };

  return {
    ...row,
    score: adaptive.adjustedScore,
    adaptive,
  };
}

export function rankQueryRows(
  rows: readonly SearchOutputRow[],
  traits: QueryTraits,
): SearchOutputRow[] {
  if (traits.queryClass === 'structured' || rows.length === 0) {
    return rows.map((row) => ({
      ...row,
      adaptive: {
        queryClass: traits.queryClass,
        candidateSource:
          traits.queryClass === 'structured' ? 'structured-compatibility' : 'adaptive',
        vectorStrength: getVectorStrength(row),
        baseScore: row.score,
        adjustedScore: row.score,
        phrase: 0,
        title: 0,
        heading: 0,
        coverage: 0,
        proximity: 0,
        literalAnchor: 0,
      },
    }));
  }

  return rows
    .map((row) => applySignals(row, traits, computeSignals(row, traits)))
    .sort((left, right) => right.score - left.score);
}
