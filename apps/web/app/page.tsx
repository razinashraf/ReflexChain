'use client';

import { Arena } from '../components/Arena';
import { ChainExplorer } from '../components/ChainExplorer';
import { ConsensusPanel } from '../components/ConsensusPanel';
import { Leaderboard } from '../components/Leaderboard';
import { NetworkPanel } from '../components/NetworkPanel';
import { PipelinePanel } from '../components/PipelinePanel';
import { StatsBar } from '../components/StatsBar';
import { useGame } from '../lib/useGame';

export default function Dashboard() {
  const game = useGame();

  return (
    <main className="min-h-screen">
      <StatsBar />

      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_320px_360px]">
        {/* --- centre: the game and what it produced --- */}
        <div className="flex flex-col gap-3">
          <Arena
            phase={game.phase}
            wallet={game.wallet}
            secondWallet={game.secondWallet}
            localTurns={game.localTurns}
            error={game.error}
            onCreate={game.createMatch}
            onJoin={game.joinMatch}
            onStart={game.startMatch}
            onLeave={game.leaveMatch}
            onPress={game.handlePress}
          />
          <ConsensusPanel />
          <Leaderboard />
        </div>

        {/* --- left rail: the network itself --- */}
        <div className="flex flex-col gap-3">
          <NetworkPanel />
          <PipelinePanel phase={game.phase} />
        </div>

        {/* --- right rail: the ledger --- */}
        <div className="flex flex-col gap-3">
          <ChainExplorer />
        </div>
      </div>

      <footer className="border-t border-ink-500 px-4 py-3">
        <p className="max-w-4xl text-2xs leading-relaxed text-muted">
          <span className="text-muted-bright">On what this proves:</span> the chain does not
          establish who physically pressed first. Only the client can observe the moment a key went
          down, and that measurement is a signed claim. What the network establishes is a canonical,
          quorum-approved record that each claim was admissible under protocol rules — verified
          independently by five separate processes, each judging against its own observation of when
          the signal fired and when the event arrived.
        </p>
      </footer>
    </main>
  );
}
