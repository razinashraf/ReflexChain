/**
 * The leaderboard is a PROJECTION OF THE LEDGER, not a stored table.
 *
 * Nothing is written when a player wins; the standings are recomputed by
 * replaying the chain. Which means tampering with a block visibly rewrites
 * history in the leaderboard too - a nice second-order demonstration that the
 * chain is the only source of truth here.
 */
import type { Block } from './types.js';

export interface LeaderboardRow {
  rank: number;
  player: string;
  label: string;
  bestReactionMs: number | null;
  averageReactionMs: number | null;
  matchesPlayed: number;
  roundsWon: number;
  falseStarts: number;
  winRate: number;
}

export function deriveLeaderboard(
  chain: Block[],
  labels: Map<string, string> = new Map(),
): LeaderboardRow[] {
  interface Acc {
    player: string;
    reactions: number[];
    matches: Set<string>;
    wins: number;
    falseStarts: number;
  }

  const accounts = new Map<string, Acc>();

  const account = (player: string): Acc => {
    let acc = accounts.get(player);
    if (!acc) {
      acc = { player, reactions: [], matches: new Set(), wins: 0, falseStarts: 0 };
      accounts.set(player, acc);
    }
    return acc;
  };

  for (const block of chain) {
    if (block.index === 0) continue;

    for (const tx of block.transactions) {
      const acc = account(tx.player);
      acc.matches.add(tx.matchId);
      if (tx.outcome === 'VALID' && typeof tx.reactionMs === 'number') {
        acc.reactions.push(tx.reactionMs);
      } else if (tx.outcome === 'FALSE_START') {
        acc.falseStarts += 1;
      }
    }

    if (block.winner) account(block.winner).wins += 1;
  }

  const rows: Omit<LeaderboardRow, 'rank'>[] = [...accounts.values()].map((acc) => {
    const matchesPlayed = acc.matches.size;
    const best = acc.reactions.length ? Math.min(...acc.reactions) : null;
    const average = acc.reactions.length
      ? Math.round(acc.reactions.reduce((a, b) => a + b, 0) / acc.reactions.length)
      : null;
    return {
      player: acc.player,
      label: labels.get(acc.player) ?? shortLabel(acc.player),
      bestReactionMs: best,
      averageReactionMs: average,
      matchesPlayed,
      roundsWon: acc.wins,
      falseStarts: acc.falseStarts,
      winRate: matchesPlayed === 0 ? 0 : Math.round((acc.wins / matchesPlayed) * 100),
    };
  });

  // Fastest confirmed reaction ranks first; players with no valid reaction sink
  // to the bottom rather than being dropped, so a false-start-only player is
  // still visible on the board.
  rows.sort((a, b) => {
    if (a.bestReactionMs === null && b.bestReactionMs === null) return b.roundsWon - a.roundsWon;
    if (a.bestReactionMs === null) return 1;
    if (b.bestReactionMs === null) return -1;
    if (a.bestReactionMs !== b.bestReactionMs) return a.bestReactionMs - b.bestReactionMs;
    return b.roundsWon - a.roundsWon;
  });

  return rows.map((row, i) => ({ rank: i + 1, ...row }));
}

export function shortLabel(address: string): string {
  const body = address.startsWith('0x') ? address.slice(2) : address;
  return `0x${body.slice(0, 4).toUpperCase()}`;
}
