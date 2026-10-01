/**
 * Gale-Shapley deferred acceptance, specialised for dating pools.
 *
 * Differences from the textbook version, both of which matter in practice:
 *
 *  - Preference lists are *incomplete*. Nobody ranks the entire pool; candidates
 *    below the score threshold are simply absent. A proposer reaching the end of
 *    their list is permanently unmatched for this round rather than being paired
 *    off arbitrarily.
 *  - A receiver only considers a proposal from someone they also list. A
 *    one-sided proposal is rejected immediately, which is what stops the
 *    algorithm from manufacturing matches the other person would never accept.
 *
 * The result is the proposer-optimal stable matching: stable, but systematically
 * the best outcome proposers can get and the worst receivers can get. `fair.ts`
 * walks the rotation lattice to pick a better point on that trade-off.
 */

/** Build id -> index lookup. Index is the rank; smaller is better. */
export function rankMap(list: readonly string[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (let i = 0; i < list.length; i++) {
    const id = list[i]!;
    if (!ranks.has(id)) ranks.set(id, i);
  }
  return ranks;
}

export interface StableMarriageInput {
  proposers: readonly string[];
  receivers: readonly string[];
  /** Ordered preferences of each proposer over receivers. */
  proposerPrefs: ReadonlyMap<string, readonly string[]>;
  /** Ordered preferences of each receiver over proposers. */
  receiverPrefs: ReadonlyMap<string, readonly string[]>;
}

export interface StableMarriageResult {
  /** proposer id -> receiver id. */
  pairs: Map<string, string>;
  unmatchedProposers: string[];
  unmatchedReceivers: string[];
  /** Total proposals made. Useful as a rough cost measure. */
  proposals: number;
}

export function galeShapley(input: StableMarriageInput): StableMarriageResult {
  const { proposers, receivers, proposerPrefs, receiverPrefs } = input;

  const receiverRanks = new Map<string, Map<string, number>>();
  for (const receiver of receivers) {
    receiverRanks.set(receiver, rankMap(receiverPrefs.get(receiver) ?? []));
  }

  const partnerOfProposer = new Map<string, string>();
  const partnerOfReceiver = new Map<string, string>();
  const nextIndex = new Map<string, number>();

  // LIFO stack, seeded in reverse so the first proposer is served first.
  const free: string[] = [];
  for (let i = proposers.length - 1; i >= 0; i--) free.push(proposers[i]!);

  let proposals = 0;

  while (free.length > 0) {
    const proposer = free.pop()!;
    if (partnerOfProposer.has(proposer)) continue;

    const list = proposerPrefs.get(proposer) ?? [];
    const ranks = receiverRanks;
    let index = nextIndex.get(proposer) ?? 0;

    while (index < list.length) {
      const receiver = list[index++]!;

      // Only pursue proposals the receiver would even consider.
      const receiverRank = ranks.get(receiver);
      if (receiverRank === undefined || !receiverRank.has(proposer)) continue;

      proposals++;
      const current = partnerOfReceiver.get(receiver);

      if (current === undefined) {
        partnerOfReceiver.set(receiver, proposer);
        partnerOfProposer.set(proposer, receiver);
        break;
      }

      const currentRank = receiverRank.get(current);
      const challengerRank = receiverRank.get(proposer);
      if (currentRank === undefined || (challengerRank !== undefined && challengerRank < currentRank)) {
        partnerOfProposer.delete(current);
        partnerOfReceiver.set(receiver, proposer);
        partnerOfProposer.set(proposer, receiver);
        free.push(current); // the dumped proposer goes back to the pool
        break;
      }
      // Otherwise the receiver keeps their current partner and the proposer moves on.
    }

    nextIndex.set(proposer, index);
    // If the loop ended without a break, the proposer exhausted their list and
    // stays unmatched for this round.
  }

  const unmatchedProposers = proposers.filter((id) => !partnerOfProposer.has(id));
  const unmatchedReceivers = receivers.filter((id) => !partnerOfReceiver.has(id));

  return { pairs: partnerOfProposer, unmatchedProposers, unmatchedReceivers, proposals };
}

export interface StabilityCheck {
  stable: boolean;
  /** Pairs that would both rather be together than with their assigned partner. */
  blockingPairs: Array<[string, string]>;
}

/**
 * Directly verify stability. Used both as the correctness oracle in tests and as
 * a production guard: a match round that cannot prove stability should be
 * rejected rather than shipped to users.
 */
export function checkStability(
  pairs: ReadonlyMap<string, string>,
  proposerPrefs: ReadonlyMap<string, readonly string[]>,
  receiverPrefs: ReadonlyMap<string, readonly string[]>,
): StabilityCheck {
  const partnerOfReceiver = new Map<string, string>();
  for (const [proposer, receiver] of pairs) {
    partnerOfReceiver.set(receiver, proposer);
  }

  const proposerRanks = new Map<string, Map<string, number>>();
  for (const [id, list] of proposerPrefs) proposerRanks.set(id, rankMap(list));

  const receiverRanks = new Map<string, Map<string, number>>();
  for (const [id, list] of receiverPrefs) receiverRanks.set(id, rankMap(list));

  const blockingPairs: Array<[string, string]> = [];

  for (const [proposer, list] of proposerPrefs) {
    const proposerRank = proposerRanks.get(proposer) as Map<string, number>;
    const currentReceiver = pairs.get(proposer);
    const currentRank = currentReceiver === undefined ? Infinity : (proposerRank.get(currentReceiver) ?? Infinity);

    for (const receiver of list) {
      const rank = proposerRank.get(receiver);
      if (rank === undefined || rank >= currentRank) continue; // proposer does not prefer them

      const receiverRank = receiverRanks.get(receiver);
      if (receiverRank === undefined || !receiverRank.has(proposer)) continue; // not acceptable to receiver

      const currentProposer = partnerOfReceiver.get(receiver);
      const receiverCurrentRank =
        currentProposer === undefined ? Infinity : (receiverRank.get(currentProposer) ?? Infinity);
      const challengerRank = receiverRank.get(proposer) as number;

      if (challengerRank < receiverCurrentRank) {
        blockingPairs.push([proposer, receiver]);
      }
    }
  }

  return { stable: blockingPairs.length === 0, blockingPairs };
}
