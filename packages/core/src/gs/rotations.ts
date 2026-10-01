/**
 * The rotation lattice of stable matchings.
 *
 * The stable matchings of a given instance are never just one arrangement: they
 * form a distributive lattice with the proposer-optimal matching at one extreme
 * and the receiver-optimal matching at the other. Plainer: the textbook
 * algorithm gives one valid answer, but there are usually many, and they are
 * wildly unequal in how happy people end up.
 *
 * That lattice is navigated by *rotations* - minimal, stable, simultaneous
 * trades. This module builds the machinery to find and apply them, which is what
 * lets `fair.ts` search for a matching that is still perfectly stable but much
 * fairer than the textbook one.
 *
 * Convenient property: a rotation only ever improves receivers and worsens
 * proposers, so walking from the proposer-optimal matching covers every other
 * stable matching, and the receiver-optimal matching is the unique one with no
 * rotation exposed.
 */

import { checkStability, rankMap } from './stable-marriage.js';

export interface LatticeInput {
  proposerPrefs: ReadonlyMap<string, readonly string[]>;
  receiverPrefs: ReadonlyMap<string, readonly string[]>;
}

export interface Rotation {
  /**
   * In order. `pairs[i] = [proposer, receiver]` where `receiver` is that
   * proposer's *current* partner. Applying the rotation reassigns `proposer[i]`
   * to the receiver of `pairs[i + 1]`.
   */
  pairs: Array<[string, string]>;
}

/**
 * Restrict an instance to the people who are actually matched by `matching`.
 *
 * Safe because of the Rural Hospitals theorem: within one instance, every stable
 * matching assigns the same set of proposers and the same set of receivers.
 */
function restrictToMatched(
  matching: ReadonlyMap<string, string>,
  proposerPrefs: ReadonlyMap<string, readonly string[]>,
  receiverPrefs: ReadonlyMap<string, readonly string[]>,
): { proposerPrefs: Map<string, string[]>; receiverPrefs: Map<string, string[]> } {
  const matchedProposers = new Set(matching.keys());
  const matchedReceivers = new Set(matching.values());

  const proposers = new Map<string, string[]>();
  for (const proposer of matchedProposers) {
    proposers.set(
      proposer,
      (proposerPrefs.get(proposer) ?? []).filter((receiver) => matchedReceivers.has(receiver)),
    );
  }

  const receivers = new Map<string, string[]>();
  for (const receiver of matchedReceivers) {
    receivers.set(
      receiver,
      (receiverPrefs.get(receiver) ?? []).filter((proposer) => matchedProposers.has(proposer)),
    );
  }

  return { proposerPrefs: proposers, receiverPrefs: receivers };
}

export interface ReducedLists {
  /**
   * proposer -> receivers who would rather have this proposer than the partner
   * they currently hold, kept in the proposer's own preference order. Empty when
   * the proposer has no such upgrade. Cycles in this graph are the rotations.
   */
  proposerList: Map<string, string[]>;
  /**
   * receiver -> proposers the receiver ranks strictly above their current
   * partner. All empty exactly at the receiver-optimal extreme, which is how the
   * rotation search knows it has nowhere left to go.
   */
  receiverList: Map<string, string[]>;
}

/**
 * Reduced ("shortlist") preference lists relative to a stable matching.
 *
 * The lists are built from the receivers' point of view: a receiver keeps only
 * the proposers who would be an upgrade on their current partner, and a proposer
 * keeps only receivers who would accept them as an upgrade. Mutual consistency
 * is therefore automatic, and any rotation exposed in `matching` appears as a
 * cycle where each proposer points at their best remaining upgrade, whose
 * current partner is the next proposer.
 *
 * This is deliberately *not* "keep candidates the proposer likes as much as
 * their partner": that reading filters away every rotation and makes the
 * fairness search a silent no-op.
 */
export function buildReducedLists(
  matching: ReadonlyMap<string, string>,
  input: LatticeInput,
): ReducedLists {
  const restricted = restrictToMatched(matching, input.proposerPrefs, input.receiverPrefs);
  const partnerOfReceiver = invertMatching(matching);

  const receiverList = new Map<string, string[]>();
  for (const [receiver, list] of restricted.receiverPrefs) {
    const partner = partnerOfReceiver.get(receiver);
    if (partner === undefined) continue;
    const ranks = rankMap(list);
    const cutoff = ranks.get(partner);
    if (cutoff === undefined) continue;
    receiverList.set(
      receiver,
      list.filter((proposer) => (ranks.get(proposer) ?? Infinity) < cutoff),
    );
  }

  const proposerList = new Map<string, string[]>();
  for (const [proposer, list] of restricted.proposerPrefs) {
    proposerList.set(
      proposer,
      list.filter((receiver) => (receiverList.get(receiver) ?? []).includes(proposer)),
    );
  }

  return { proposerList, receiverList };
}

export function invertMatching(matching: ReadonlyMap<string, string>): Map<string, string> {
  const inverse = new Map<string, string>();
  for (const [proposer, receiver] of matching) inverse.set(receiver, proposer);
  return inverse;
}

/**
 * Every rotation exposed in `matching` that is valid on the full instance.
 *
 * Exposed rotations are the cycles of the functional graph that sends each
 * proposer to their best remaining upgrade and on to that receiver's current
 * partner. Cycles are disjoint, so each one is a separate independent trade, and
 * applying any rotation returned here is guaranteed to yield a stable matching.
 */
export function findExposedRotations(
  matching: ReadonlyMap<string, string>,
  input: LatticeInput,
): Rotation[] {
  const { proposerList } = buildReducedLists(matching, input);
  const partnerOfReceiver = invertMatching(matching);

  const rotations: Rotation[] = [];
  const claimed = new Set<string>();

  // Deterministic ordering so a given instance always yields the same rotations.
  const candidates = [...proposerList.keys()]
    .filter((proposer) => (proposerList.get(proposer) ?? []).length >= 1)
    .sort();

  for (const start of candidates) {
    if (claimed.has(start)) continue;

    const path: string[] = [];
    const seenAt = new Map<string, number>();
    let current: string | undefined = start;
    let cycleStart = -1;

    while (current !== undefined && !claimed.has(current)) {
      const at = seenAt.get(current);
      if (at !== undefined) {
        cycleStart = at;
        break;
      }
      const list: string[] | undefined = proposerList.get(current);
      if (list === undefined || list.length < 1) {
        current = undefined; // dead end: no rotation on this path
        break;
      }
      seenAt.set(current, path.length);
      path.push(current);
      const bestUpgrade = list[0] as string;
      current = partnerOfReceiver.get(bestUpgrade);
    }

    if (cycleStart < 0 || current === undefined) continue;

    const cycle = path.slice(cycleStart);
    for (const proposer of cycle) claimed.add(proposer);

    const rotation: Rotation = {
      pairs: cycle.map(
        (proposer) => [proposer, matching.get(proposer) as string] as [string, string],
      ),
    };

    // A cycle can be a valid rotation of the matched sub-instance yet unstable on
    // the full one: applying it can make a proposer worse than an *unmatched*
    // receiver who was excluded from the reduced lists. Only expose rotations
    // that survive the full-instance stability check, so callers can trust them.
    if (!checkStability(applyRotation(matching, rotation), input.proposerPrefs, input.receiverPrefs).stable) {
      continue;
    }

    rotations.push(rotation);
  }

  return rotations;
}

export function applyRotation(
  matching: ReadonlyMap<string, string>,
  rotation: Rotation,
): Map<string, string> {
  const next = new Map(matching);
  const size = rotation.pairs.length;
  for (let i = 0; i < size; i++) {
    const proposer = rotation.pairs[i]![0];
    const nextReceiver = rotation.pairs[(i + 1) % size]![1];
    next.set(proposer, nextReceiver);
  }
  return next;
}

/**
 * Brute-force enumeration of every stable matching.
 *
 * Exponential by nature, so it is capped and only used to establish ground truth
 * on small instances - which is exactly what the fairness search needs as a
 * correctness oracle in tests.
 */
export function enumerateStableMatchings(
  input: LatticeInput & { proposers: readonly string[]; receivers: readonly string[] },
  options: { maxNodes?: number } = {},
): { matchings: Array<Map<string, string>>; complete: boolean } {
  const { proposers, receivers, proposerPrefs, receiverPrefs } = input;
  const maxNodes = options.maxNodes ?? 200_000;

  const receiverAcceptedBy = new Map<string, Set<string>>();
  for (const receiver of receivers) {
    receiverAcceptedBy.set(receiver, new Set(receiverPrefs.get(receiver) ?? []));
  }

  const matchings: Array<Map<string, string>> = [];
  let nodes = 0;
  let complete = true;

  const current = new Map<string, string>();

  const search = (index: number): void => {
    if (!complete) return;
    if (nodes++ > maxNodes) {
      complete = false;
      return;
    }
    if (index === proposers.length) {
      if (checkStored(current, proposerPrefs, receiverPrefs)) {
        matchings.push(new Map(current));
      }
      return;
    }

    const proposer = proposers[index] as string;

    // Option 1: leave this proposer unmatched.
    search(index + 1);

    // Option 2: match them to any still-free receiver who would accept them.
    for (const receiver of proposerPrefs.get(proposer) ?? []) {
      if ([...current.values()].includes(receiver)) continue;
      if (!(receiverAcceptedBy.get(receiver) ?? new Set<string>()).has(proposer)) continue;
      current.set(proposer, receiver);
      search(index + 1);
      current.delete(proposer);
    }
  };

  search(0);
  return { matchings, complete };
}

function checkStored(
  matching: ReadonlyMap<string, string>,
  proposerPrefs: ReadonlyMap<string, readonly string[]>,
  receiverPrefs: ReadonlyMap<string, readonly string[]>,
): boolean {
  const partnerOfReceiver = invertMatching(matching);
  const proposerRanks = new Map<string, Map<string, number>>();
  for (const [id, list] of proposerPrefs) proposerRanks.set(id, rankMap(list));
  const receiverRanks = new Map<string, Map<string, number>>();
  for (const [id, list] of receiverPrefs) receiverRanks.set(id, rankMap(list));

  for (const [proposer, list] of proposerPrefs) {
    const ranks = proposerRanks.get(proposer) as Map<string, number>;
    const partner = matching.get(proposer);
    const partnerRank = partner === undefined ? Infinity : (ranks.get(partner) ?? Infinity);
    for (const receiver of list) {
      const rank = ranks.get(receiver);
      if (rank === undefined || rank >= partnerRank) continue;
      const theirRanks = receiverRanks.get(receiver);
      if (theirRanks === undefined || !theirRanks.has(proposer)) continue;
      const theirPartner = partnerOfReceiver.get(receiver);
      const theirPartnerRank =
        theirPartner === undefined ? Infinity : (theirRanks.get(theirPartner) ?? Infinity);
      if ((theirRanks.get(proposer) as number) < theirPartnerRank) return false;
    }
  }
  return true;
}
