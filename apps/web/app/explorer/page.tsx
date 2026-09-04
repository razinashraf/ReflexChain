'use client';

import { useCallback, useEffect } from 'react';
import Link from 'next/link';
import { ChainExplorer } from '../../components/ChainExplorer';
import { Leaderboard } from '../../components/Leaderboard';
import { NetworkPanel } from '../../components/NetworkPanel';
import { StatsBar } from '../../components/StatsBar';
import { fetchChain, fetchSnapshot, validatorNetwork } from '../../lib/network';
import { useReflex } from '../../lib/store';

export default function ExplorerPage() {
  const setChain = useReflex((s) => s.setChain);

  const refresh = useCallback(async () => {
    const result = await fetchChain();
    if (result) {
      setChain(result.blocks as never, 'LIVE', result.validatorId);
      return;
    }
    const snapshot = await fetchSnapshot();
    if (snapshot) setChain(snapshot.blocks as never, 'SNAPSHOT', null);
  }, [setChain]);

  useEffect(() => {
    validatorNetwork.start();
    void refresh();
    const timer = setInterval(() => void refresh(), 4_000);
    return () => {
      clearInterval(timer);
      validatorNetwork.stop();
    };
  }, [refresh]);

  return (
    <main className="min-h-screen">
      <StatsBar />

      <div className="border-b border-ink-500 px-4 py-2">
        <Link
          href="/"
          className="text-2xs uppercase tracking-[0.16em] text-muted transition-colors hover:text-signal-cyan"
        >
          ← back to arena
        </Link>
      </div>

      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ChainExplorer full />
        <div className="flex flex-col gap-3">
          <NetworkPanel />
          <Leaderboard />
        </div>
      </div>
    </main>
  );
}
