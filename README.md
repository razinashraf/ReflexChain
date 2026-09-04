# REFLEXCHAIN

### Consensus mechanism: PROOF OF REFLEX™
### *"The fastest valid reaction becomes the next block."*

---

We built a five-node distributed validator network, ed25519 signatures on every
message, a hash-linked immutable ledger, Byzantine-fault-tolerant quorum, leader
election, fork resolution and chain resynchronisation.

To determine **who pressed the space bar faster.**

Two players. Two turns. One block.

```
NETWORK VALUE:     ₹0.00
ECONOMIC UTILITY:  NONE
THROUGHPUT:        0.0041 TPS
PROBLEM SOLVED:    WHO PRESSED A BUTTON FIRST
```

---

## Run it

```bash
npm install
npm run demo
```

That starts **seven processes**: five validators (`:7001`–`:7005`), the
coordinator (`:4000`), and the dashboard at **http://localhost:3000**.

```bash
npm test        # 58 unit + integration tests
npm run verify  # 31 live checks against a running network
```

---

## The honest claim

This is the part we will not overstate.

**The chain does not prove who physically pressed first.** Only the player's own
device can observe the moment a key went down. That measurement is a *claim*.

What the network establishes is a **canonical, signed, quorum-approved record
that each claim was admissible under protocol rules** — verified independently
by five separate OS processes, each judging against its own observation of when
the signal fired and when the event arrived.

### The timing model, precisely

| | |
|---|---|
| **Baseline** | `performance.now()` at the frame GREEN was painted (double `requestAnimationFrame`), falling back to the state-commit time if rAF is paused |
| **Reaction** | `performance.now()` at `keydown` minus that baseline |
| **Clock** | One monotonic clock, one device. Wall clocks are **never** compared between machines |
| **Status** | Client-attested. Signed, then judged — not reproduced |

### What validators actually check

They do not measure your reflex. They **bound your claim** against facts they
observed themselves:

- `claimed >= 80ms` — the human reaction floor. Below this you anticipated the
  signal rather than reacted to it. **This is the check that constrains an
  optimistic claim**; nothing else in the protocol can catch a client that
  shaves its own number.
- `claimed <= (Aᵢ − Gᵢ) + ε` — the claim must fit inside the window this node
  actually watched elapse.
- `(Aᵢ − Gᵢ) − claimed <= 3000ms` — otherwise the event is stale or replayed
  rather than live.

Where `Gᵢ` is when **this node** learned GO fired and `Aᵢ` is when **this node**
received the press. Both are private to that node.

---

## Why the votes are genuinely independent

This is the architectural centre of the project, and the one design decision
everything else rests on.

The browser holds **five independent WebSocket connections** — one per validator
— and writes the signed press event to all five in a single synchronous pass.

```
                        ┌─────────────────────────────┐
   BROWSER ─────────────┤ 5 × independent WebSocket   │
      │                 └──┬───┬───┬───┬───┬──────────┘
      │ Socket.IO          │   │   │   │   │
      ▼                    ▼   ▼   ▼   ▼   ▼
  COORDINATOR :4000      node-01 … node-05  (:7001–:7005)
   match state machine     └───┴───┴───┴──┘
   GO signal                full-mesh gossip (10 links)
      │                     votes → quorum → block → chain
      └── signed GO_ANNOUNCE ──▲
          raced to every node
```

**If the browser posted the event to one server which then fanned it out**,
every validator would be judging one identical relayed copy. Their votes would
agree by construction — 5/5, every single time. That is a rubber stamp with
extra steps, and it is the failure mode this design exists to avoid.

Because each node receives the event over its own socket and stamps its own
arrival time, `Aᵢ − Gᵢ` genuinely differs per node — and borderline events
produce real 3/5 and 4/5 splits.

The coordinator carries **only** `MATCH_OPEN` and `GO_ANNOUNCE`. It never sees a
press event, never counts a vote, never touches the chain, and never decides a
winner. It decides when the light turns green and whose turn is next.

---

## Proof of Reflex™

```
1. Coordinator fires GO. Races a signed GO_ANNOUNCE to all five validators.
   Each records its OWN local Gᵢ.

2. Player presses SPACE. The browser signs a PressEvent and broadcasts it to
   all five validators simultaneously.

3. Each validator INDEPENDENTLY runs validateEvent():
     ed25519 signature verifies                     → SIG_OK
     address derives from the presented key         → UNKNOWN_PLAYER
     goSeq matches this node's round record         → WRONG_ROUND
     eventId unseen                                 → DUPLICATE
     this node has a GO record at all               → FALSE_START
     claim within human range                       → BELOW_HUMAN_FLOOR
     claim fits this node's observation             → LATENCY_ENVELOPE_FAIL
   Emits a signed Vote, gossips it to all four peers.

4. Tally. QUORUM = ⌊2n/3⌋+1 = 4 of 5, computed over the REGISTERED set —
   never over whoever happens to be reachable, or a single partitioned node
   could "reach quorum" alone.

5. When both turns settle, the deterministic leader (sha256(matchId) mod n)
   assembles the block and signs it. If the leader is down or dishonest, the
   next node in the rotation takes over after a stagger.

6. Every validator INDEPENDENTLY verifies before appending:
     recompute hash · previousHash matches own tip · merkle root
     proposer signature · every embedded vote signature
     quorum met · WINNER RE-DERIVED FROM THE TRANSACTIONS
```

That last check matters. A dishonest proposer can hash and sign a block
perfectly well. What it **cannot** do is make a wrong winner follow from the
votes the block itself carries.

### False starts are a result, not an error

If a node has no `GO` record for a turn, an arriving press physically preceded
the signal reaching it — it concludes `FALSE_START` without trusting the
client's self-report.

A quorum of nodes *rejecting* a press is the network agreeing decisively about
what happened. So quorum is measured against **agreement with the recorded
outcome**, not against acceptance — otherwise a false start could never reach a
block at all. The forfeiting player loses the turn; the opponent wins by
default.

---

## Data on chain

```ts
Block {
  index, timestamp, matchId
  transactions: [TurnTransaction, TurnTransaction]   // the two turns
  winner, winningReactionMs
  previousHash, merkleRoot, nonce
  proposer, consensus: { approvals, total, threshold }
  proposerSig            // signs `hash`, excluded from its own preimage
  hash                   // sha256 over canonical JSON of everything above
}

TurnTransaction {
  txId, matchId, turnIndex, player
  outcome: VALID | FALSE_START | REJECTED | INCONCLUSIVE
  reactionMs, eventId
  votes: Vote[]          // the ACTUAL signed votes, re-verifiable by anyone
  approvals, total
}
```

**No proof of work.** An early draft mined a difficulty-2 nonce; it was cut. You
cannot claim Proof of Reflex is your consensus mechanism and then also mine
blocks — it is incoherent, and a knowledgeable judge would catch it. Block
authority comes from the quorum of signed votes embedded in the block, which is
what actually gets verified. `nonce` is a uniqueness field.

**The leaderboard is a projection of the ledger**, recomputed by replaying the
chain. There is no standings table anywhere. Tamper with a block and the
standings change with it.

---

## Demo script (~3 minutes)

1. **Dashboard.** 5 nodes ONLINE, full mesh, `ECONOMIC UTILITY: NONE`.
2. **Two laptops join a match code.** (Or `HOTSEAT` for one keyboard.)
3. **Play.** RED → GREEN → SPACE. Deliberately false-start one turn.
4. **Consensus panel.** Five votes arrive, each showing that node's *own*
   observed delta. Watch them differ. Quorum 4/5 → CONFIRMED.
5. **Block seals**, propagates, all five nodes verify and append.
6. **Explorer.** New block linked by hash to the previous one.
7. **`KILL NODE 03`** → 4/5, network keeps committing.
   **Kill node 04** → `CONSENSUS HALTED`. **Revive both** → they resynchronise.
8. **`CORRUPT NODE 05`** → it votes the wrong way and proposes bad blocks. The
   honest four reach quorum without it and refuse its blocks.
9. **`REWRITE WINNER` on block #N** (node-01 only) → the whole suffix is
   re-linked so the ledger is structurally perfect again, and it *still* fails:
   `BAD_PROPOSER_SIGNATURE`, and node-01 forks away from the network.
   **Hashes can be recomputed. Signatures cannot be forged.**
   Then `RESYNC FROM PEERS` → repaired.
10. *"Two people pressed a space bar. So we built distributed consensus to
    decide who was faster."*

---

## What is real

Every number on screen is traceable to actual computation. Specifically:

| The UI says | Because |
|---|---|
| `5/5 QUORUM` | five OS processes are running and meshed |
| `4/5 approvals` | four signed votes were counted, and they are in the block |
| `observed Δ 210ms` | that node measured it on its own clock |
| `CHAIN VALID` | `validateChain()` recomputed every hash **in the browser** |
| `CHAIN COMPROMISED` | a sha256 genuinely failed to match |
| `FORKED` | that node's head hash genuinely differs from the majority |
| `BLOCK #23` | it is on disk, in five separate JSONL files |

The project is intentionally useless. It is **not** intentionally fake.

---

## Layout

```
packages/protocol/     types · canonical JSON · sha256 · ed25519 · block
                       chain validation · event rules · tally · settlement
                       (shared verbatim by validators, coordinator AND browser)
apps/validator/        one program, five instances. mesh · gossip · JSONL ledger
apps/coordinator/      match lifecycle only. zero consensus logic
apps/web/              Next.js 15 dashboard + explorer
scripts/               dev-all · seed-chain · export-snapshot · verify-demo
data/validator-0X/     each node's own append-only chain.jsonl
```

The protocol package is imported unchanged by the browser, so the client runs
the **exact same** hashing, signing and validation code the network runs.

### Scripts

| | |
|---|---|
| `npm run demo` | all seven processes |
| `npm run dev:network` | validators + coordinator, no dashboard |
| `npm test` | unit + 5-process integration tests |
| `npm run verify` | 31 live assertions against a running network |
| `npm run seed -- --matches 10` | synthetic players, real protocol, real blocks |
| `npm run snapshot` | export a chain for the hosted build |
| `npx tsx scripts/watch-votes.ts 60` | live vote stream with reason codes, for diagnosing a rejection |

`seed-chain` drives the real protocol with real keys and real signatures over
real sockets — only the finger is simulated. Its blocks verify exactly like one
played by hand.

---

## Hosted build

Vercel has no validator network behind it. The dashboard detects that, shows
`LIVE NETWORK: NOT CONNECTED`, and renders `public/snapshot.json` — a genuine
chain exported from a live session, labelled `ARCHIVED SNAPSHOT`. It verifies
under the same `validateChain()`. It is simply not live.

To point a build at a real network, see `apps/web/.env.example`.

---

## Two players, two devices

Open the dashboard on both machines, `CREATE MATCH` on one, and `JOIN` with the
six-character code on the other. Each device generates its own signing key, so
the two turns are genuinely two identities on the chain.

- Only the player whose turn it is can end it. The waiting player's space bar
  does nothing — it would otherwise cut their opponent's turn short.
- A dropped connection reconnects with a new socket id, so the client reclaims
  its seat using its signing identity. Background a tab and come back; you are
  still in the match.
- `HOTSEAT` puts both seats on one keyboard, as demo insurance if the venue
  network is unhelpful. It still mints a separate key per seat.

## Known limits

- **The latency envelope cannot catch an optimistic under-claim.** A client that
  reports 150ms when it truly took 300ms passes, because only the client
  observes the true press. The 80ms floor is what constrains this. We say so in
  the UI rather than implying the network measures reflexes.
- **ε defaults to 400ms**, which is generous. It absorbs real GO-propagation
  jitter across five processes on one machine. Tightening it causes honest
  rejections; it is per-node configurable via `/admin/epsilon`.
- **The coordinator is a single point of failure** for *starting* matches. It is
  deliberately not one for deciding results.
- **Five nodes on one machine** share a fault domain. The distribution is real
  (separate processes, separate sockets, separate ledgers); the isolation is not.
- **Simultaneous proposals do happen.** Two validators can seal different blocks
  for the same slot; they are resolved by a deterministic tie-break (leader
  first, then lowest hash) and the loser's match is re-queued rather than lost.
  Under rapid seeding we observed nine reorgs and still converged on one head.
- **A deliberately tampered node does not self-repair.** It holds the
  compromised state until `RESYNC FROM PEERS`, so the failure can actually be
  inspected. Ordinary divergence heals on its own within a sync tick.

---

*Built for Useless Projects 3.0.*

**Q:** Who pressed first?
**A:** The blockchain has spoken.
