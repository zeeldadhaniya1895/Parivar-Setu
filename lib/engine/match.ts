// Matching (DESIGN.md 7.3): blocking, field scores, weighted score, hard rules, classification.
import type {
  MatchCandidate, MatchDecision, NormalizedRecord, ReviewDecision, ReviewStatus, ScoreBreakdown,
} from "./types";

export const AUTO_MERGE_THRESHOLD = 0.9;
export const REVIEW_THRESHOLD = 0.75;
const UID_MATCH_SCORE = 0.99;
const MIDDLE_MISMATCH_LIMIT = 0.8;
const MIDDLE_MISMATCH_PENALTY = 0.25;
const MAX_DOB_YEAR_GAP = 5;

const NAME_WEIGHTS = { first: 0.5, last: 0.3, middle: 0.2 } as const;
const FIELD_WEIGHTS = { name: 0.45, dob: 0.35, address: 0.2 } as const;

// ---- string similarity -------------------------------------------------------------------

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const matchedA: boolean[] = new Array<boolean>(la).fill(false);
  const matchedB: boolean[] = new Array<boolean>(lb).fill(false);

  let matches = 0;
  for (let i = 0; i < la; i++) {
    const start = Math.max(0, i - window);
    const end = Math.min(lb - 1, i + window);
    for (let j = start; j <= end; j++) {
      if (!matchedB[j] && a[i] === b[j]) {
        matchedA[i] = true;
        matchedB[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!matchedA[i]) continue;
    while (!matchedB[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  return (matches / la + matches / lb + (matches - transpositions / 2) / matches) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  if (j <= 0.7) return j;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] !== b[i]) break;
    prefix++;
  }
  return j + prefix * 0.1 * (1 - j);
}

// ---- field scores (each 0..1, or null when either side is missing) -----------------------

function partScore(aText: string | null, aKey: string | null, bText: string | null, bKey: string | null) {
  if (aText === null || bText === null || aKey === null || bKey === null) return null;
  return aKey === bKey ? 1 : jaroWinkler(aText, bText);
}

function middleScore(a: NormalizedRecord, b: NormalizedRecord): number | null {
  const am = a.name.middle;
  const bm = b.name.middle;
  if (am === null || bm === null) return null;
  if (a.name.middleIsInitial || b.name.middleIsInitial) {
    return am[0] === bm[0] ? 0.85 : 0;
  }
  return partScore(am, a.phonetic.middle, bm, b.phonetic.middle);
}

interface NameScore {
  total: number | null;
  first: number | null;
  middle: number | null;
  last: number | null;
}

export function nameScore(a: NormalizedRecord, b: NormalizedRecord): NameScore {
  const first = partScore(a.name.first, a.phonetic.first, b.name.first, b.phonetic.first);
  const last = partScore(a.name.last, a.phonetic.last, b.name.last, b.phonetic.last);
  const middle = middleScore(a, b);

  let weight = 0;
  let sum = 0;
  for (const [score, w] of [
    [first, NAME_WEIGHTS.first], [last, NAME_WEIGHTS.last], [middle, NAME_WEIGHTS.middle],
  ] as const) {
    if (score === null) continue;
    weight += w;
    sum += score * w;
  }
  return { total: weight === 0 ? null : sum / weight, first, middle, last };
}

export function dobScore(a: NormalizedRecord, b: NormalizedRecord): number | null {
  const x = a.dob;
  const y = b.dob;
  if (x === null || y === null) return null;
  const bothFull = x.month !== null && x.day !== null && y.month !== null && y.day !== null;
  if (x.year === y.year) {
    if (bothFull && x.month === y.month && x.day === y.day) return 1;
    if (bothFull && x.month === y.day && x.day === y.month) return 0.8;
    return 0.6;
  }
  if (Math.abs(x.year - y.year) <= 1 && (x.approximate || y.approximate)) return 0.5;
  return 0;
}

export function addressScore(a: NormalizedRecord, b: NormalizedRecord): number | null {
  if (a.villageKey === "" || b.villageKey === "") return null;
  if (a.villageKey === b.villageKey) {
    const sameHouse = a.houseNo !== null && a.houseNo === b.houseNo;
    return 0.7 + (sameHouse ? 0.3 : 0);
  }
  if (a.talukaKey !== "" && a.talukaKey === b.talukaKey && a.district === b.district) return 0.2;
  return 0;
}

// ---- pair scoring ------------------------------------------------------------------------

export const pairKeyOf = (idA: string, idB: string): string =>
  idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;

export function classify(score: number): MatchDecision {
  if (score >= AUTO_MERGE_THRESHOLD) return "auto_merge";
  return score >= REVIEW_THRESHOLD ? "review" : "distinct";
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export interface PairScore {
  score: number;
  breakdown: ScoreBreakdown;
  decision: MatchDecision;
}

/**
 * Score one pair. Weighted score first, then hard rules.
 *
 * An equal uid_hash is final: 0.99, and no other rule applies. Contradictions inside a cluster
 * are the chaining guard's job (resolve.ts). This is what lets a married woman whose middle name
 * and surname changed still match herself by ID.
 */
export function scorePair(a: NormalizedRecord, b: NormalizedRecord): PairScore {
  const name = nameScore(a, b);
  const dob = dobScore(a, b);
  const address = addressScore(a, b);

  let weight = 0;
  let sum = 0;
  for (const [score, w] of [
    [name.total, FIELD_WEIGHTS.name], [dob, FIELD_WEIGHTS.dob], [address, FIELD_WEIGHTS.address],
  ] as const) {
    if (score === null) continue;
    weight += w;
    sum += score * w;
  }
  const weighted = weight === 0 ? 0 : sum / weight;

  const uid: 0 | 1 | null =
    a.uidHash !== null && b.uidHash !== null ? (a.uidHash === b.uidHash ? 1 : 0) : null;
  const rules: string[] = [];
  const breakdown: ScoreBreakdown = {
    name: name.total === null ? null : round4(name.total),
    dob,
    address,
    uid,
    nameParts: {
      first: name.first === null ? null : round4(name.first),
      middle: name.middle === null ? null : round4(name.middle),
      last: name.last === null ? null : round4(name.last),
    },
    weighted: round4(weighted),
    rules,
  };

  if (uid === 1) {
    rules.push(`uid_equal: score set to ${UID_MATCH_SCORE}`);
    return { score: UID_MATCH_SCORE, breakdown, decision: classify(UID_MATCH_SCORE) };
  }

  let score = weighted;
  let distinct = false;
  if (uid === 0) {
    rules.push("uid_different: distinct");
    distinct = true;
  }
  if (a.gender !== null && b.gender !== null && a.gender !== b.gender) {
    rules.push("gender_differs: distinct");
    distinct = true;
  }
  if (a.dob !== null && b.dob !== null && Math.abs(a.dob.year - b.dob.year) > MAX_DOB_YEAR_GAP) {
    rules.push(`dob_gap_over_${MAX_DOB_YEAR_GAP}_years: distinct`);
    distinct = true;
  }
  if (
    a.name.middle !== null && b.name.middle !== null &&
    !a.name.middleIsInitial && !b.name.middleIsInitial &&
    name.middle !== null && name.middle < MIDDLE_MISMATCH_LIMIT
  ) {
    rules.push(`middle_name_mismatch: score -${MIDDLE_MISMATCH_PENALTY}`);
    score -= MIDDLE_MISMATCH_PENALTY;
  }
  score = Math.min(1, Math.max(0, score));
  return { score: round4(score), breakdown, decision: distinct ? "distinct" : classify(score) };
}

// ---- blocking ----------------------------------------------------------------------------

/**
 * Candidate pairs (as index pairs i < j into `records`): the union of three blocking passes.
 * Death registry records are never compared with each other.
 */
function blockPairs(records: readonly NormalizedRecord[]): Set<number> {
  const n = records.length;
  const buckets = new Map<string, number[]>();
  const add = (key: string, index: number) => {
    const list = buckets.get(key);
    if (list) list.push(index);
    else buckets.set(key, [index]);
  };

  records.forEach((r, i) => {
    if (r.phonetic.last !== null && r.district !== "") add(`n|${r.district}|${r.phonetic.last}`, i);
    if (r.uidHash !== null) add(`u|${r.uidHash}`, i);
    if (r.dob !== null && r.phonetic.first !== null && r.phonetic.first !== "") {
      add(`y|${r.dob.year}|${r.phonetic.first[0]}`, i);
    }
  });

  const pairs = new Set<number>();
  for (const members of buckets.values()) {
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const i = members[x];
        const j = members[y];
        if (records[i].source === "death_registry" && records[j].source === "death_registry") continue;
        pairs.add(i * n + j);
      }
    }
  }
  return pairs;
}

/** Apply an officer's decision (or the pending state) to a scored pair. */
export function applyReviewDecision(
  scored: PairScore, decision: ReviewDecision["decision"] | undefined,
): { decision: MatchDecision; reviewStatus: ReviewStatus | null } {
  if (decision === "approved") {
    return {
      decision: scored.decision === "distinct" ? "review" : scored.decision,
      reviewStatus: "approved",
    };
  }
  if (decision === "rejected") return { decision: "distinct", reviewStatus: "rejected" };
  return {
    decision: scored.decision,
    reviewStatus: scored.decision === "review" ? "pending" : null,
  };
}

/** A pair counts as the same person when auto-merged or officer-approved. */
export const isMatch = (c: Pick<MatchCandidate, "decision" | "reviewStatus">): boolean =>
  c.decision === "auto_merge" || c.reviewStatus === "approved";

export function toCandidate(
  a: NormalizedRecord, b: NormalizedRecord, decision: ReviewDecision["decision"] | undefined,
): MatchCandidate {
  const [x, y] = a.id < b.id ? [a, b] : [b, a];
  const scored = scorePair(x, y);
  const applied = applyReviewDecision(scored, decision);
  return {
    pairKey: pairKeyOf(x.id, y.id),
    recordAId: x.id,
    recordBId: y.id,
    score: scored.score,
    breakdown: scored.breakdown,
    decision: applied.decision,
    reviewStatus: applied.reviewStatus,
  };
}

/**
 * Block, score and classify every candidate pair, then apply review decisions.
 * Output is sorted by pair key so results are identical run to run.
 */
export function findMatches(
  input: readonly NormalizedRecord[], decisions: readonly ReviewDecision[] = [],
): MatchCandidate[] {
  const records = [...input].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = records.length;
  const byDecision = new Map(decisions.map((d) => [d.pairKey, d.decision]));

  const pairs = blockPairs(records);

  // An officer's decision applies even if blocking no longer proposes the pair.
  const indexById = new Map(records.map((r, i) => [r.id, i]));
  for (const { pairKey } of decisions) {
    const [idA, idB] = pairKey.split("|");
    const i = indexById.get(idA);
    const j = indexById.get(idB);
    if (i !== undefined && j !== undefined && i !== j) pairs.add(Math.min(i, j) * n + Math.max(i, j));
  }

  const candidates: MatchCandidate[] = [];
  for (const code of pairs) {
    const a = records[Math.floor(code / n)];
    const b = records[code % n];
    candidates.push(toCandidate(a, b, byDecision.get(pairKeyOf(a.id, b.id))));
  }
  return candidates.sort((x, y) => (x.pairKey < y.pairKey ? -1 : x.pairKey > y.pairKey ? 1 : 0));
}
