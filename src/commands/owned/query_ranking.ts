/**
 * Adaptive query ranking — 구조적 시그널 기반 결과 재정렬.
 *
 * upstream의 RRF/rerank 스코어 위에 lexical 매칭 시그널을 가산하여
 * 한국어·기술 쿼리에서 정확한 결과를 상위로 끌어올린다.
 *
 * 시그널별 최대 기여도:
 *   phrase:       0.44  (쿼리 전체가 제목/본문에 포함)
 *   title:        0.14  (개별 term이 제목에 포함)
 *   heading:      0.14  (마크다운 헤딩에 term 포함)
 *   coverage:     0.12  (전체 term 중 본문에 등장하는 비율)
 *   proximity:    0.12  (한 줄에 여러 term이 동시 출현)
 *   literalAnchor: 0.28 (경로/코드 패턴, 한영혼합 등 literal 일치 보너스)
 *
 * 감점:
 *   vector 약함 + mixed-technical → -0.02
 *   vector 없음 + short-korean + 시그널 부족 → -0.04
 */
import type { AdaptiveQueryExplain, SearchOutputRow } from './io/types.js';
import type { QueryTraits } from './query_classifier.js';

/** 결과 스코어를 구성하는 구조적 시그널. explain 출력에도 포함된다. */
interface StructuralSignals {
  readonly phrase: number;
  readonly title: number;
  readonly heading: number;
  readonly coverage: number;
  readonly proximity: number;
  readonly literalAnchor: number;
  readonly vectorStrength: AdaptiveQueryExplain['vectorStrength'];
}

/** 시그널 계산에 사용할 본문 최대 크기. 성능을 위해 chunkPos 주변만 잘라서 분석한다. */
const MAX_SCORING_BODY_BYTES = 12_000;

function clampScore(score: number): number {
  return Math.max(0, Math.min(0.99, score));
}

function countMatches(text: string, terms: readonly string[]): number {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

/**
 * vector search 결과의 강도를 판별한다.
 * cosine similarity 0.4 이상이면 'strong' — 이 임계값은
 * Qwen3-Embedding-0.6B 모델에서 "주제적 관련성이 있는" 결과의 실험적 하한이다.
 */
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

function extractHeadings(lines: readonly string[]): string[] {
  return lines
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .trim()
        .toLowerCase(),
    )
    .filter((line) => line.length > 0);
}

/**
 * 한 줄 안에서 여러 검색어가 동시에 등장하는 정도를 측정한다.
 * 모든 term이 같은 줄에 있으면 0.12, 2개 이상이면 0.06.
 * 단일 term 쿼리에서는 proximity가 의미 없으므로 0을 반환한다.
 */
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
  const lines = scoringBody.split('\n');
  const headings = extractHeadings(lines);
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

  // vector가 약한 mixed-technical 결과는 코드/경로 매칭에서 벗어난 가능성이 높으므로 소폭 감점
  if (signals.vectorStrength === 'weak' && traits.queryClass === 'mixed-technical') {
    adjustedScore -= 0.02;
  }

  // vector도 없고 lexical 시그널도 미미한 한글 쿼리 결과는 노이즈일 가능성이 높으므로 감점
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
