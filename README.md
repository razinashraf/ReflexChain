# ⚡ REFLEXCHAIN

### **PROOF OF REFLEX™**

### *The fastest valid reaction becomes the next block.*

**Built by Razin Ashraf**\
**Muthoot Institute of Technology and Science**\
**Useless Projects 3.0**

> **Two people pressed a space bar. So I built distributed consensus to
> decide who was faster.**

------------------------------------------------------------------------

# 👋 How this started

I started this project knowing **almost nothing about blockchain**.

I knew the words.

> Blockchain. Hash. Validator. Consensus. Node. Cryptography.

But if someone had asked me:

> "Okay, explain exactly what a validator does."

I would have confidently started making things up.

So instead of learning blockchain from a textbook first, I decided to
build something ridiculous enough that I would be **forced to understand
it**.

The question became:

# **WHO PRESSED SPACE FIRST?**

And somehow, that question turned into:

-   five independent validator processes
-   a real WebSocket network
-   Ed25519 cryptographic identities
-   signed reaction events
-   seven independent validation checks
-   quorum-based consensus
-   deterministic leader election
-   signed votes and vote gossip
-   Merkle roots
-   hash-linked blocks
-   proposer signatures
-   fork detection and resolution
-   chain resynchronisation
-   Byzantine-node demonstrations
-   append-only ledgers
-   browser-side chain verification

All to settle a reaction game.

I think this is either a very good learning project or a spectacular
misuse of technology.

Probably both.

------------------------------------------------------------------------

# 🎮 What is REFLEXCHAIN?

REFLEXCHAIN is a **two-player, strictly turn-based reaction game**
backed by a real five-validator distributed network.

The rules are intentionally simple:

``` text
PLAYER 1
   ↓
RED 🔴
   ↓
GREEN 🟢
   ↓
PRESS SPACE
   ↓
validator network
   ↓
turn settles

PLAYER 2
   ↓
RED 🔴
   ↓
GREEN 🟢
   ↓
PRESS SPACE
   ↓
validator network
   ↓
turn settles

        ↓

Both turns → ONE BLOCK
        ↓
Fastest valid turn → WINNER
```

If a player presses during RED, they false-start and lose that turn.

The blockchain then records the result together with the transactions,
votes, hashes, consensus metadata, and cryptographic signatures that
support it.

``` text
NETWORK VALUE:     ₹0.00
ECONOMIC UTILITY:  NONE
PROBLEM SOLVED:    WHO PRESSED FIRST
```

And yes, those first two metrics are jokes.

The engineering underneath them isn't.

------------------------------------------------------------------------

# 😂 The Problem (that doesn't exist)

There are obviously easier ways to solve this.

### Option 1

Use a timer.

### Option 2

Use a referee.

### Option 3

Use one server.

### Option 4

Just compare two numbers.

### Option 5

Build a distributed consensus protocol.

Naturally, I chose **Option 5**.

The fake problem I decided to solve was:

> **How can multiple independent computers agree on the canonical result
> of a reaction event without trusting a single central authority?**

That question is actually interesting.

The fact that it is being applied to two people pressing **SPACE** is
the joke.

------------------------------------------------------------------------

# 🚀 The Solution (that nobody asked for)

The key design decision is this:

> **The browser sends the signed press event directly to all five
> validators.**

It does **not** send the event to one server and ask that server to
forward it.

Why?

Because if one server received the event first and then relayed it to
five validators, all five validators would essentially be judging the
same server-mediated observation.

That would make the "independent validators" mostly theatre.

Instead:

``` text
                         PLAYER BROWSER
                              │
                    signed PRESS event
                              │
          ┌───────────┬───────┼───────┬───────────┐
          ▼           ▼       ▼       ▼           ▼
       NODE 01     NODE 02  NODE 03 NODE 04    NODE 05
        G₁/A₁       G₂/A₂    G₃/A₃   G₄/A₄      G₅/A₅
          │           │        │       │           │
          └───────────┴────────┼───────┴───────────┘
                               ▼
                         SIGNED VOTES
                               ▼
                           QUORUM
                           4 of 5
                               ▼
                           TRANSACTION
                               ▼
                           BLOCK
                               ▼
                            CHAIN
```

Each validator receives the event through its own socket and records its
own arrival observation.

That is the centre of the entire design.

------------------------------------------------------------------------

# 🧠 The blockchain concepts I learned by building it

This project was essentially my own crash course in blockchain and
distributed systems.

## 1. Hashing

A hash is a fingerprint of data.

REFLEXCHAIN uses **SHA-256** over canonicalized data.

If:

``` text
winner = Player 1
```

becomes:

``` text
winner = Player 2
```

the resulting hash changes.

That gives us a way to detect modifications.

------------------------------------------------------------------------

## 2. Digital signatures

Hashing tells us:

> "This data is different."

A digital signature gives us another property:

> "This particular key signed this data."

Players use **Ed25519** keys.

The private key stays on the player's device.

The public key can be shared.

The player signs the canonical representation of the reaction event.

Validators verify that signature.

------------------------------------------------------------------------

## 3. Validators

A validator is not simply "a computer storing a blockchain."

In REFLEXCHAIN, a validator receives a reaction event and independently
asks:

> **"Should I accept this event?"**

It performs seven checks.

If all pass:

``` text
ACCEPT
```

If any fail:

``` text
REJECT
```

The validator then signs its vote and gossips that vote to its peers.

------------------------------------------------------------------------

## 4. Consensus

Five validators don't have to blindly trust one node.

They vote.

The network requires:

``` text
n = 5

threshold = floor(2n/3) + 1
          = floor(10/3) + 1
          = 3 + 1
          = 4
```

So:

> **4 of 5 validators are required for quorum.**

Importantly, the threshold is calculated from the **registered validator
set**, not simply the number of currently reachable nodes.

That means:

``` text
5 online → quorum 4
4 online → quorum 4
3 online → quorum 4 → HALT
```

One node can disappear and the network can still commit.

Two can disappear and it cannot.

------------------------------------------------------------------------

# 🔐 Cryptographic identity

One of the things I initially misunderstood was the word "wallet."

REFLEXCHAIN doesn't actually need cryptocurrency.

There is:

-   no token
-   no balance
-   no gas
-   no transfer
-   no payment

The browser simply creates a real **Ed25519 keypair**.

``` text
PRIVATE KEY
     │
     ├── kept locally
     │
     ▼
PUBLIC KEY
     │
     ▼
SHA-256
     │
     ▼
first 20 bytes
     │
     ▼
0x... ADDRESS
```

The player's address is:

``` text
0x + first 20 bytes of SHA-256(publicKeyHex)
```

The address is therefore derived from the public key.

When a validator receives an event, it checks:

``` text
addressFromPublicKey(event.pubKey) === event.player
```

So a player cannot simply present somebody else's address alongside
their own key.

------------------------------------------------------------------------

# ✍️ What exactly gets signed?

A press event contains information such as:

``` json
{
  "eventId": "...",
  "matchId": "...",
  "turnIndex": 0,
  "player": "0x...",
  "pubKey": "...",
  "nonce": "...",
  "goSeq": 14,
  "claimedReactionMs": 183,
  "kind": "PRESS",
  "sig": "..."
}
```

The `sig` field is **not included in the signed message**.

The rest is canonicalized into deterministic JSON and signed using
Ed25519.

Conceptually:

``` text
event without sig
       ↓
canonical JSON
       ↓
Ed25519.sign(privateKey, message)
       ↓
signature
```

A validator then reconstructs the same canonical message and verifies:

``` text
Ed25519.verify(
    signature,
    canonicalEventWithoutSig,
    publicKey
)
```

Changing even an important signed field breaks the signature.

For example:

``` text
183 ms → 1 ms
```

would make the original signature invalid.

------------------------------------------------------------------------

# 🆔 Event ID vs Signature

These two are easy to confuse.

They are completely different.

### Event ID

Answers:

> **"Which event is this?"**

It is derived using SHA-256 and is useful for identifying and preventing
duplicate processing.

### Signature

Answers:

> **"Did the owner of this key sign this exact event?"**

It is produced using Ed25519.

``` text
                 EVENT
                   │
          ┌────────┴────────┐
          ▼                 ▼
       SHA-256           Ed25519
          ▼                 ▼
      eventId          signature
          │                 │
  "identify it"       "authenticate it"
```

------------------------------------------------------------------------

# 🔢 What is `goSeq`?

`goSeq` is much simpler.

It is **not a hash**.

It is a sequence number identifying the GO signal.

For example:

``` text
GO #12
GO #13
GO #14
GO #15
```

If the validator recorded:

``` text
GO #14 → Player 1
```

and receives:

``` text
Player 1
goSeq = 14
```

the event belongs to that GO.

If someone submits:

``` text
goSeq = 9
```

the validator knows that event doesn't correspond to the current turn.

So:

``` text
goSeq   → which GO?
eventId → which event?
sig     → who signed the event?
```

------------------------------------------------------------------------

# 🧑‍⚖️ Proof of Reflex™ --- the seven validator checks

This is the heart of the project.

Every validator runs the same validation logic against its own local
observations.

## Check 1 --- Is the event well-formed?

The validator first asks:

> **"Can I understand this event?"**

Required fields must exist and have valid types and structure.

Otherwise:

``` text
❌ MALFORMED
```

------------------------------------------------------------------------

## Check 2 --- Does the public key match the player?

The validator derives the address from the supplied public key.

``` text
SHA-256(publicKey)
        ↓
first 20 bytes
        ↓
player address
```

Then it compares that with `event.player`.

Mismatch:

``` text
❌ UNKNOWN_PLAYER
```

------------------------------------------------------------------------

## Check 3 --- Is the signature valid?

The validator verifies the Ed25519 signature against the canonical event
data.

If the event was changed after signing, or the signature wasn't created
by the corresponding private key:

``` text
❌ BAD_SIGNATURE
```

------------------------------------------------------------------------

## Check 4 --- Is this a duplicate?

Each validator maintains a set of previously seen event IDs.

``` text
eventId = ABC123

already seen?
    YES → ❌ DUPLICATE
    NO  → continue
```

This prevents the same valid event from being processed repeatedly.

------------------------------------------------------------------------

## Check 5 --- Does the event belong to the actual turn?

The validator checks its recorded GO state.

It verifies:

-   a GO record exists
-   `goSeq` matches
-   the player matches the player assigned to that GO/turn

If the event does not belong to the correct round:

``` text
❌ WRONG_ROUND
```

If a press occurs before the validator has a valid GO record:

``` text
❌ FALSE_START
```

A false start forfeits that turn.

------------------------------------------------------------------------

## Check 6 --- Is the reaction time plausible?

REFLEXCHAIN currently allows:

``` text
80 ms ≤ claimedReactionMs ≤ 10,000 ms
```

So:

``` text
3 ms      → ❌ BELOW_HUMAN_FLOOR
183 ms    → ✅
10,000 ms → ✅
15,000 ms → ❌ ABOVE_MAX
```

This doesn't prove that 183 ms is physically true.

It simply rejects obviously invalid claims.

------------------------------------------------------------------------

## Check 7 --- Does the claim fit the validator's observation?

This is where the validators use their own clocks.

For validator `i`:

``` text
Gᵢ = when this validator recorded GO

Aᵢ = when this validator received the press

observedᵢ = Aᵢ − Gᵢ
```

Suppose:

``` text
Player claims:      183 ms
Node 1 observes:   350 ms
```

The difference can exist because the event had to travel from the
browser to the validator.

The protocol therefore checks whether the claim fits within a configured
latency envelope.

If it doesn't:

``` text
❌ LATENCY_ENVELOPE_FAIL
```

This is deliberately not presented as perfect physical measurement.

The network is validating a **claim** against independent observations.

------------------------------------------------------------------------

# ⏱️ The timing model

This is an important technical distinction.

The player's reaction measurement uses the browser's monotonic clock:

``` text
GREEN painted
      ↓
performance.now()
      ↓
SPACE keydown
      ↓
performance.now()
      ↓
reaction = difference
```

The browser uses a double `requestAnimationFrame` baseline when GREEN is
painted, with a fallback when rendering is paused.

Validators use their own local observations:

``` text
Gᵢ = validator's GO observation
Aᵢ = validator's event arrival
```

We **do not compare wall-clock timestamps between machines**.

That would create a clock-synchronization problem.

Instead, each validator compares two timestamps from **its own clock**.

------------------------------------------------------------------------

# 🌐 Why the five votes are actually independent

This is probably the most important architectural detail in the whole
project.

The browser maintains five validator connections.

When the player presses:

``` text
broadcastPress(event)
```

the browser writes the event across the five already-open WebSockets in
one synchronous pass.

It deliberately does not wait for Node 1 before sending to Node 2.

Otherwise we could accidentally manufacture an ordering.

Each node therefore receives the event at a different time.

Example:

``` text
Node 1 → observed Δ = 213 ms
Node 2 → observed Δ = 220 ms
Node 3 → observed Δ = 219 ms
Node 4 → observed Δ = 211 ms
Node 5 → observed Δ = 225 ms
```

Those observations are genuinely produced by different processes.

That is why the consensus panel is meaningful.

------------------------------------------------------------------------

# ✍️ Validator votes

After validating the event, a validator creates a signed vote.

A vote contains information such as:

``` json
{
  "validatorId": "node-01",
  "verdict": "ACCEPT",
  "reasons": [
    "SIG_OK",
    "ROUND_OK",
    "NOT_DUPLICATE",
    "WITHIN_HUMAN_RANGE",
    "WITHIN_LATENCY_ENVELOPE"
  ],
  "observedArrivalDeltaMs": 213,
  "canonicalReactionMs": 203,
  "sig": "..."
}
```

The vote itself is signed.

Then the validator gossips it to the other validators.

Peers verify the vote signature before counting it.

------------------------------------------------------------------------

# 🤝 How consensus actually happens

Suppose the votes are:

``` text
Node 1 → ACCEPT
Node 2 → ACCEPT
Node 3 → ACCEPT
Node 4 → ACCEPT
Node 5 → REJECT
```

That's:

``` text
4 ACCEPT
1 REJECT
```

Quorum:

``` text
4 / 5
```

Therefore the event can be confirmed.

The system also records the dissenting vote instead of pretending
everyone agreed.

When votes arrive, the system uses a short grace window so straggling
votes can still make it into the permanent record.

For accepted reactions, the canonical reaction time is derived from the
accepting validators' values using the configured aggregation rule
rather than simply trusting one node.

------------------------------------------------------------------------

# 🧱 From a turn to a transaction

Once a turn settles, it becomes a transaction.

Conceptually:

``` text
Turn 0
Player: 0x...
Outcome: VALID
Reaction: 203 ms
Event ID: ...
Votes: 5
Approvals: 5
```

The votes are kept inside the transaction.

That is important because the final block can carry the evidence used to
reach the decision.

Transactions are deterministically ordered, and their identifying data
is hashed into a `txId`.

------------------------------------------------------------------------

# 👑 Who proposes the block?

Once **both turns** have settled, a validator proposes the block.

The proposer is selected deterministically:

``` text
SHA-256("leader:" + matchId) mod 5
```

For example:

``` text
matchId
   ↓
SHA-256
   ↓
mod 5
   ↓
Node 3
```

It isn't truly random.

It just **looks random across different match IDs**.

Every validator can independently calculate the same proposer.

If the selected proposer fails, the remaining validators use staggered
failover.

------------------------------------------------------------------------

# 🧱 What is inside a block?

A REFLEXCHAIN block contains approximately:

``` ts
Block {
    index
    timestamp
    matchId

    transactions

    winner
    winningReactionMs

    previousHash
    merkleRoot
    nonce

    proposer

    consensus: {
        approvals
        total
        threshold
    }

    proposerSig
    hash
}
```

The important idea is that the block is not merely:

``` text
"Razin won"
```

It is a cryptographically linked record containing the match result
**and the evidence surrounding that result**.

------------------------------------------------------------------------

# 🌳 Merkle root

The block contains two turn transactions.

The transactions are combined into a Merkle structure.

Conceptually:

``` text
             MERKLE ROOT
                 │
          ┌──────┴──────┐
          ▼             ▼
       TX TURN 0      TX TURN 1
```

The Merkle root acts as a compact fingerprint of the transaction set.

If a transaction changes, the Merkle root changes.

The validator can therefore check whether the block's claimed Merkle
root matches the transactions it contains.

------------------------------------------------------------------------

# #️⃣ How the block hash works

The block's own `hash` is calculated from its contents.

The preimage contains the block data **except**:

``` text
proposerSig
hash
```

The data is serialized using canonical, sorted-key JSON.

Conceptually:

``` text
block fields
    ↓
remove proposerSig + hash
    ↓
canonical JSON
    ↓
SHA-256
    ↓
block hash
```

Then the proposer signs that hash:

``` text
block hash
    ↓
Ed25519.sign(proposer private key, hash)
    ↓
proposerSig
```

This avoids circularity.

The signature isn't part of the data used to calculate the hash that it
signs.

------------------------------------------------------------------------

# 🔗 Why `previousHash` matters

Suppose:

``` text
BLOCK 10
hash = AAA
```

Then:

``` text
BLOCK 11
previousHash = AAA
```

Then:

``` text
BLOCK 12
previousHash = hash(Block 11)
```

So:

``` text
BLOCK 10
   │
   │ previousHash
   ▼
BLOCK 11
   │
   │ previousHash
   ▼
BLOCK 12
```

If somebody modifies Block 10:

``` text
winner = Player A
```

to:

``` text
winner = Player B
```

its hash changes.

That means Block 11's `previousHash` no longer points to the correct
Block 10.

One small change can therefore break the chain from that point onward.

------------------------------------------------------------------------

# 🔐 Why the proposer signature matters

You might ask:

> "Can't the attacker just recalculate the hash?"

Yes.

And that's exactly why the proposer signature exists.

Suppose:

``` text
Original:

winner = Player A
hash = ABC123
proposerSig = SIGN(ABC123)
```

Attacker changes:

``` text
winner = Player B
```

and recalculates:

``` text
hash = XYZ789
```

But they don't have the proposer's private key.

So:

``` text
proposerSig = SIGN(ABC123)
```

does not verify against:

``` text
XYZ789
```

Result:

``` text
❌ BAD_PROPOSER_SIGNATURE
```

So:

> **Hashes detect changed data. Signatures establish who authorized the
> data.**

------------------------------------------------------------------------

# 🛡️ Every node verifies the proposed block

A validator doesn't simply say:

> "Node 3 proposed it, so sure."

It independently verifies:

-   block hash
-   Merkle root
-   `previousHash`
-   proposer signature
-   every embedded vote signature
-   quorum
-   transaction consistency
-   winner derived from the transactions

That last one is particularly important.

The block contains:

``` text
winner = Player A
```

But validators don't blindly trust that field.

They re-derive the winner from the settled transactions.

So a proposer cannot simply write:

``` text
winner = Player B
```

and expect the network to accept it if the underlying transactions say
Player A won.

------------------------------------------------------------------------

# ⛓️ Genesis

The chain begins with a deterministic genesis block.

The genesis has a fixed structure and a `previousHash` consisting of
zeroes.

Because it is deterministic, all five validators can independently
create the same starting point.

Then:

``` text
GENESIS
   ↓
BLOCK 1
   ↓
BLOCK 2
   ↓
BLOCK 3
```

Every node therefore has a common ancestor from which its chain can be
compared.

------------------------------------------------------------------------

# 🌐 The five validator nodes

These are not five UI cards pretending to be nodes.

They are five separate Node.js processes:

``` text
node-01 → :7001
node-02 → :7002
node-03 → :7003
node-04 → :7004
node-05 → :7005
```

The complete local demo also has:

``` text
Next.js dashboard → :3000
Coordinator       → :4000
```

So the local demo starts **seven processes**.

Each validator has its own ledger.

------------------------------------------------------------------------

# 🔌 The validator mesh

Five nodes form a full mesh.

For five nodes:

``` text
5 × 4 / 2 = 10
```

So there are **10 peer-to-peer links**.

Communication uses raw WebSockets.

Messages include:

``` text
HELLO
VOTE
BLOCK_PROPOSAL
CHAIN_REQUEST
CHAIN_RESPONSE
```

The coordinator sends:

``` text
MATCH_OPEN
GO_ANNOUNCE
```

The browser sends:

``` text
SUBMIT_EVENT
SUBSCRIBE
```

The coordinator deliberately does **not** decide consensus or winners.

Its job is game/match coordination.

------------------------------------------------------------------------

# 💾 Independent persistence

Each validator maintains its own chain:

``` text
data/
├── node-01/chain.jsonl
├── node-02/chain.jsonl
├── node-03/chain.jsonl
├── node-04/chain.jsonl
└── node-05/chain.jsonl
```

The ledger is append-only JSONL.

So the network isn't keeping one magical blockchain object in memory.

There are five independent copies.

------------------------------------------------------------------------

# 🔄 What happens when a node comes back?

Nodes periodically advertise their:

``` text
height
head hash
```

If a peer is ahead, or if both are at the same height but have different
heads, a chain synchronization request can occur.

A revived node:

``` text
OFFLINE
   ↓
RECONNECT
   ↓
REQUEST CHAIN
   ↓
VALIDATE CANDIDATE
   ↓
ADOPT IF VALID
   ↓
UP TO DATE
```

Importantly, a node doesn't simply accept the longest chain.

The candidate must pass validation and satisfy the chain-selection
rules.

That matters because:

> **A longer broken blockchain is still a broken blockchain.**

------------------------------------------------------------------------

# 🔀 Forks

Distributed systems can have races.

Two validators can potentially propose different blocks for the same
slot.

That can temporarily create:

``` text
              BLOCK 20
                 │
        ┌────────┴────────┐
        ▼                 ▼
    BLOCK 21A          BLOCK 21B
     Node 1             Node 2
```

REFLEXCHAIN handles this with deterministic resolution rules.

The preferred proposal is determined using the leader/tie-break rules,
and losing state can be re-queued or replaced.

The system also detects equal-height divergent heads during
synchronization.

------------------------------------------------------------------------

# 💥 Breaking the blockchain on purpose

This is one of the best parts of the demo.

I can deliberately attack the chain.

## 1. Naive tampering

Change:

``` text
winner = Player A
```

to:

``` text
winner = Player B
```

but leave the old hash.

Result:

``` text
❌ HASH_MISMATCH
```

------------------------------------------------------------------------

## 2. Rehashing

The attacker changes the winner **and recalculates the block hash**.

Now the block's own hash looks correct.

But:

``` text
❌ BAD_PROPOSER_SIGNATURE
```

because the proposer signed the original hash.

The next block can also expose the broken `previousHash` relationship.

------------------------------------------------------------------------

## 3. Cascade rewrite

The demo can rewrite the target block and re-link descendants so the
altered chain is structurally self-consistent.

It still fails cryptographically because the original proposer
signatures cannot simply be recreated.

That gives the demo a nice lesson:

> **You can recompute a hash. You cannot forge a signature without the
> signing key.**

With the important caveat that the demo's validator keys are simplified
and derivable from source.

------------------------------------------------------------------------

# 🧨 Byzantine node demonstration

A validator can also be deliberately put into a dishonest mode.

For example, it can:

-   invert its vote
-   propose an invalid block

The honest validators can still reach quorum when enough honest nodes
agree.

This is a small demonstration of Byzantine-fault-tolerant thinking:

``` text
Node 1 → honest
Node 2 → honest
Node 3 → malicious
Node 4 → honest
Node 5 → honest

Honest majority
      ↓
    4 / 5
      ↓
   QUORUM
```

------------------------------------------------------------------------

# ⚠️ The honesty section

This project is technically serious, but it is **not a production
blockchain**.

I want the README to be honest about that.

## The biggest limitation

The network cannot magically prove the exact physical instant a finger
touched a keyboard.

Only the player's device directly observes the physical keypress.

The player reports a timing measurement.

The network then validates that signed claim against protocol rules and
independent validator observations.

So the real statement is:

> **REFLEXCHAIN establishes a canonical, signed, quorum-approved
> protocol record of an admissible reaction claim.**

It does **not** establish an absolute physical truth about the finger.

------------------------------------------------------------------------

# 🔒 Validator key caveat

Player keys are randomly generated in the browser.

Validator and coordinator keys in this prototype are different: their
private keys are deterministically derived from constant seed strings in
source code.

That means someone with the repository can derive those demo validator
keys.

So this prototype provides:

> **integrity and attribution within the running system**

but not:

> **security against an attacker who has read the source and extracted
> the keys.**

Production validators would receive their secrets through proper
out-of-band provisioning.

I would rather admit this than pretend five nodes are magically secure
because the dashboard says "SECURE."

------------------------------------------------------------------------

# 🧩 Why there is no signup

REFLEXCHAIN doesn't need real-world authentication.

The protocol only needs:

1.  Two players to be distinguishable.
2.  A validator to know an event came from the key controlling that
    seat.
3.  A stable identity for the player's history.

An anonymous Ed25519 identity already provides that.

So adding:

``` text
SIGN UP
EMAIL
PASSWORD
DATABASE
SESSION
RESET PASSWORD
```

would add a lot of machinery without making the validator protocol
stronger.

And forcing a judge to create an account before pressing SPACE would be
hilarious for the wrong reason.

------------------------------------------------------------------------

# 🏗️ Architecture

``` text
┌──────────────────────────────────────────────────────────────┐
│ FRONTEND                                                     │
│ apps/web/                                                    │
│                                                              │
│ Game · Dashboard · Explorer · Telemetry · Zustand            │
│ Browser identity + signing                                   │
└───────────────┬───────────────────────┬──────────────────────┘
                │ Socket.IO             │ 5 × WebSockets
                ▼                       ▼
┌─────────────────────────┐    ┌───────────────────────────────┐
│ COORDINATOR             │    │ 5 VALIDATOR PROCESSES          │
│ apps/coordinator/       │    │ apps/validator/                │
│                         │    │                                │
│ Lobby · seats · turns   │    │ Node 01 · 02 · 03 · 04 · 05   │
│ GO signal               │    │ Full peer mesh                 │
│ Match lifecycle         │    │ Votes · blocks · sync          │
└────────────┬────────────┘    └───────────────┬───────────────┘
             │                                 │
             └───────────┬─────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ SHARED PROTOCOL                                              │
│ packages/protocol/                                           │
│                                                              │
│ canonical JSON · SHA-256 · Ed25519                           │
│ event validation · consensus · settlement                    │
│ leader selection · block creation · chain validation         │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ PERSISTENCE                                                  │
│                                                              │
│ node-01/chain.jsonl ... node-05/chain.jsonl                 │
└──────────────────────────────────────────────────────────────┘
```

One particularly useful architectural choice is that the shared
`protocol` package is imported by the browser, validators, and
coordinator.

The browser can therefore run the same chain-validation logic rather
than blindly trusting a server's "CHAIN VALID" message.

------------------------------------------------------------------------

# 📂 Project structure

``` text
REFLEXCHAIN/
│
├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── page.tsx
│   │   │   └── explorer/
│   │   ├── components/
│   │   └── lib/
│   │       ├── wallet.ts
│   │       ├── network.ts
│   │       └── store.ts
│   │
│   ├── coordinator/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── match.ts
│   │       └── validatorLink.ts
│   │
│   └── validator/
│       └── src/
│           ├── index.ts
│           ├── node.ts
│           └── store.ts
│
├── packages/
│   └── protocol/
│       └── src/
│           ├── crypto.ts
│           ├── canonical.ts
│           ├── rules.ts
│           ├── consensus.ts
│           ├── settlement.ts
│           ├── validators.ts
│           ├── block.ts
│           ├── chain.ts
│           └── leaderboard.ts
│
├── scripts/
└── data/
```

------------------------------------------------------------------------

# 📊 What the dashboard actually represents

One of the goals was to avoid making a dashboard that **looks**
decentralized while only one process is doing the work.

### `5/5 QUORUM`

Actual validator votes.

### `CHAIN VALID`

The browser independently ran chain validation.

### `HEAD`

The actual newest block hash.

### `THROUGHPUT`

Transactions divided by the measured chain lifetime.

### `BROADCAST TO 5/5`

The number of validator sockets the browser successfully wrote the event
to.

### `observed Δ`

That particular validator's own:

``` text
Aᵢ − Gᵢ
```

### `PROBLEM SOLVED`

A joke.

### `ECONOMIC UTILITY: NONE`

Also a joke.

And unfortunately, completely accurate.

------------------------------------------------------------------------

# 📈 The event pipeline

The UI exposes the lifecycle of an event:

``` text
PRESS
  ↓
BROADCAST
  ↓
VALIDATE
  ↓
CONSENSUS
  ↓
BLOCK
  ↓
COMMIT
```

These stages are driven by actual telemetry.

They aren't simply:

``` text
setTimeout(() => nextStage(), 1000)
```

because that would defeat the entire point.

------------------------------------------------------------------------

# 🏆 The leaderboard

There isn't a separate database table containing the leaderboard.

Instead, the leaderboard is derived by replaying the blockchain.

Conceptually:

``` text
BLOCKS
  ↓
transactions
  ↓
player results
  ↓
deriveLeaderboard()
  ↓
standings
```

That means the leaderboard is a **projection of the ledger**.

If you tamper with the chain, the derived standings can change too.

Which is a surprisingly nice second-order demonstration of why the
ledger matters.

------------------------------------------------------------------------

# 🔍 The blockchain explorer

The explorer shows:

-   block number
-   winner
-   reaction time
-   both turns
-   transaction outcomes
-   approvals
-   proposer
-   previous hash
-   block hash
-   consensus metadata
-   validation errors
-   orphaned blocks

Hashes are truncated visually but the underlying values remain
available.

The explorer is intended to make the blockchain inspectable rather than
treating it as a mysterious backend box.

------------------------------------------------------------------------

# 🧪 Testing

The project isn't considered finished just because the UI works.

The important logic is tested around:

-   genesis creation
-   block hashing
-   chain validation
-   tampered blocks
-   previous-hash mismatches
-   valid events
-   false starts
-   duplicate events
-   consensus
-   validator disagreement
-   majority decisions
-   block creation
-   node synchronization

The live verification script also checks the running network rather than
only testing isolated functions.

------------------------------------------------------------------------

# 💻 Running it

``` bash
npm install
npm run demo
```

The local demo starts:

``` text
5 validators
+ coordinator
+ Next.js dashboard
```

Dashboard:

``` text
http://localhost:3000
```

Useful commands:

``` bash
npm test
npm run verify
npm run demo
```

------------------------------------------------------------------------

# 🎬 The demo I would show a judge

## 1. Start with the ridiculousness

Show:

``` text
NETWORK VALUE: ₹0.00
ECONOMIC UTILITY: NONE
```

Then say:

> "We built a blockchain to determine who pressed a button first."

------------------------------------------------------------------------

## 2. Play a match

Two players.

Two turns.

RED → GREEN → SPACE.

------------------------------------------------------------------------

## 3. Show the validators

Point at the five nodes.

Explain:

> "The browser sends the signed event to all five independently."

------------------------------------------------------------------------

## 4. Show the votes

Point at:

``` text
Node 1 → ACCEPT
Node 2 → ACCEPT
Node 3 → ACCEPT
Node 4 → ACCEPT
Node 5 → ACCEPT
```

Then point out that their observed timing values are produced
independently.

------------------------------------------------------------------------

## 5. Show quorum

``` text
4 / 5
```

Explain:

> "Four registered validators are enough to commit."

------------------------------------------------------------------------

## 6. Show the block

Open the explorer.

Show:

``` text
winner
transactions
votes
previousHash
merkleRoot
proposer
proposerSig
hash
```

------------------------------------------------------------------------

## 7. Kill a node

``` text
5/5
↓
kill Node 03
↓
4/5
```

The network continues.

Kill another:

``` text
3/5
↓
CONSENSUS HALTED
```

------------------------------------------------------------------------

## 8. Tamper with history

Rewrite an old winner.

The system reports something like:

``` text
BAD_PROPOSER_SIGNATURE
```

and the node's head can diverge from the other validators.

Then resynchronise.

------------------------------------------------------------------------

# 🧠 The mental model I now have

The biggest thing this project taught me is that these words are not
interchangeable.

``` text
HASH
  ↓
fingerprint of data

SIGNATURE
  ↓
proof a key signed data

VALIDATOR
  ↓
independent judge

VOTE
  ↓
validator's signed decision

QUORUM
  ↓
enough validators agreeing

TRANSACTION
  ↓
settled piece of activity

BLOCK
  ↓
bundle of transactions + evidence + chain metadata

BLOCKCHAIN
  ↓
blocks linked through hashes

CONSENSUS
  ↓
the process that makes independent nodes agree on what becomes canonical
```

And somehow:

``` text
CONSENSUS
     ↓
"Who pressed first?"
```

------------------------------------------------------------------------

# 🧪 What is real vs what is simplified?

## ✅ Real

-   Ed25519 key generation, signing and verification
-   SHA-256 hashing
-   canonical JSON
-   player address derivation
-   five independent OS validator processes
-   ten-link WebSocket mesh
-   five independent browser-to-validator connections
-   per-validator observations
-   seven event-validation checks
-   signed votes
-   vote gossip
-   quorum
-   deterministic leader selection
-   failover
-   transaction creation
-   Merkle root
-   block hashing
-   proposer signature
-   block verification
-   previous-hash chaining
-   full chain validation
-   tamper detection
-   fork detection
-   reorganisation/resynchronisation
-   Byzantine demonstration
-   append-only JSONL persistence
-   leaderboard derived from chain data
-   browser-side chain validation

## 🎨 Cosmetic

A few dashboard jokes are intentionally hardcoded:

``` text
NETWORK VALUE: ₹0.00
ECONOMIC UTILITY: NONE
PROBLEM SOLVED: WHO PRESSED FIRST
```

The visual scanlines, borders, colours, and other presentation elements
are obviously cosmetic too.

The project is **intentionally useless**.

It is not **intentionally fake**.

------------------------------------------------------------------------

# ⚠️ Known limitations

I don't want to hide these.

### 1. Physical reaction time isn't directly provable

The player device is the only place that sees the actual keypress.

The network validates the claim rather than reproducing the physical
measurement.

### 2. Client-side optimistic underclaims are not perfectly catchable

A malicious client could potentially report a smaller value that remains
inside the allowed envelope.

The 80 ms floor is the main constraint in that direction.

### 3. The latency tolerance is generous

The current ε is around 400 ms by default.

This is intentionally tolerant of jitter in the demo environment.

### 4. Five validators share one machine

They are genuinely separate processes, sockets, and ledgers.

But they still share:

``` text
CPU
RAM
disk
power
physical machine
```

So this is distributed execution inside a single fault domain.

### 5. Validator keys are simplified

As explained above, the prototype's validator keys are derivable from
source.

Production provisioning would be different.

### 6. This is not a production consensus protocol

There are simplified failure, leader, and finality assumptions.

The goal is to demonstrate the ideas clearly and honestly, not to
replace a production blockchain protocol.

------------------------------------------------------------------------

# 📚 My learning journey

If I had to describe the entire project in one timeline:

``` text
"What is a blockchain?"
        ↓
"What is a block?"
        ↓
"What is a hash?"
        ↓
"Why does a block need previousHash?"
        ↓
"What does a validator actually do?"
        ↓
"Why does the player need a private key?"
        ↓
"What exactly does a signature sign?"
        ↓
"What is an event ID?"
        ↓
"Why do five validators need to see the event?"
        ↓
"What is quorum?"
        ↓
"Why does one validator propose?"
        ↓
"What happens if validators disagree?"
        ↓
"What happens if one node dies?"
        ↓
"What happens if one node lies?"
        ↓
"What happens if someone edits history?"
        ↓
"Okay..."
        ↓
"I accidentally built a distributed system."
```

The funny part is that I didn't really understand these concepts by
reading definitions.

I understood them because I kept asking:

> **"Okay, but what actually happens when I press SPACE?"**

That question eventually forced me to understand the whole system from
the browser all the way down to the ledger.

------------------------------------------------------------------------

# 🧭 What I would explain if someone asked "How does one press become a block?"

``` text
1. Browser creates/restores player's Ed25519 identity.

2. Player's turn begins.

3. Coordinator sends a signed GO signal.

4. Validators record their own GO observations.

5. Player presses SPACE.

6. Browser calculates its local reaction time.

7. Browser creates the PressEvent.

8. Browser signs the canonical event with the player's private key.

9. Browser broadcasts the event to all five validators.

10. Every validator records its own arrival time.

11. Every validator runs seven checks.

12. Every validator signs its vote.

13. Votes are gossiped between validators.

14. Validators tally votes.

15. 4/5 quorum confirms the turn.

16. The second turn is settled.

17. Deterministic leader selection chooses a proposer.

18. Proposer builds the block.

19. Merkle root is calculated.

20. Block hash is calculated.

21. Proposer signs the block hash.

22. Block is broadcast.

23. Every node independently verifies it.

24. Valid nodes append it to their own JSONL ledger.

25. Browser fetches the chain and independently validates it.

26. Explorer displays the result.

27. Leaderboard replays the chain and updates.

28. Somewhere in all of this, two people have pressed SPACE.
```

That is REFLEXCHAIN.

------------------------------------------------------------------------

# 👨‍💻 About Me

## **Razin Ashraf**

**Muthoot Institute of Technology and Science**

I built REFLEXCHAIN for **Useless Projects 3.0** as a way to learn
distributed systems and blockchain by actually building one.

I started with almost no understanding of blockchain.

I ended up with five validators, a consensus mechanism, signed events, a
blockchain explorer, fork handling, tamper detection, and a very serious
answer to a very unserious question.

If this project makes you ask:

> **"Why the hell did you use blockchain for this?"**

then I consider that a successful demo.

------------------------------------------------------------------------

# 🖼️ Screenshots

## 🎮 Game

**Add screenshot here**

``` text
screenshots/game.png
```

![Game screenshot](screenshots/game.png)

------------------------------------------------------------------------

## 🌐 Validator Network

**Add screenshot here**

``` text
screenshots/network.png
```

![Validator network screenshot](screenshots/network.png)

------------------------------------------------------------------------

## 🤝 Proof of Reflex Consensus

**Add screenshot here**

``` text
screenshots/consensus.png
```

![Consensus screenshot](screenshots/consensus.png)

------------------------------------------------------------------------

## ⛓️ Blockchain Explorer

**Add screenshot here**

``` text
screenshots/explorer.png
```

![Blockchain explorer screenshot](screenshots/explorer.png)

------------------------------------------------------------------------

## 💥 Tamper Demonstration

**Add screenshot here**

``` text
screenshots/tamper.png
```

![Tamper detection screenshot](screenshots/tamper.png)

------------------------------------------------------------------------

# 🛠️ Technology Stack

  Technology         Role
  ------------------ ------------------------------------------
  **Next.js**        Dashboard, game and explorer
  **TypeScript**     Shared application/protocol language
  **Node.js**        Coordinator and validator processes
  **WebSockets**     Validator mesh and direct event delivery
  **Socket.IO**      Browser ↔ coordinator communication
  **Ed25519**        Digital signatures and identities
  **SHA-256**        Hashing, IDs and address derivation
  **Merkle roots**   Transaction-set integrity
  **JSONL**          Independent node persistence
  **Zustand**        Frontend state management
  **Vercel**         Hosted dashboard

------------------------------------------------------------------------

# ⛓️ Final thoughts

REFLEXCHAIN doesn't solve an important problem.

It doesn't need to.

The point was to take something completely insignificant and use it as a
microscope for understanding something genuinely difficult.

A reaction game gave me a reason to learn:

**cryptography → identity → signatures → validators → networking →
consensus → blocks → hashes → persistence → forks → recovery.**

And after all that engineering:

# **Who pressed first?**

The blockchain has spoken.

------------------------------------------------------------------------

```{=html}
<p align="center">
```
### ⚡ Two players. Two turns. Five validators. One completely unnecessary blockchain.

**Built by Razin Ashraf**\
**Muthoot Institute of Technology and Science**

```{=html}
</p>
```

------------------------------------------------------------------------

*Built for Useless Projects 3.0.*

*The project is intentionally useless. The engineering is not.*
