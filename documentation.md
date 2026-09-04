# REFLEXCHAIN --- MY BUILD JOURNEY

## A private progress document for TinkerHub Useless Projects 3.0

**Author:** Razin Ashraf\
**Institution:** Muthoot Institute of Technology and Science\
**Project:** REFLEXCHAIN / Proof of Reflex™\
**Built for:** Useless Projects 3.0\
**Time constraint:** Approximately 18 hours\
**Document type:** Personal progress journal --- not the polished public
README

------------------------------------------------------------------------

# 1. Why I am writing this

This is not supposed to be a technical manual.

The README explains what REFLEXCHAIN is.

This document explains **how I got here**.

I want to remember the part that usually disappears after a project is
finished:

-   what I knew before starting,
-   what I thought blockchain meant,
-   the questions I kept asking,
-   the moments where something finally clicked,
-   the decisions I made under an 18-hour deadline,
-   the things that broke,
-   the things I misunderstood,
-   and the point where a ridiculous idea stopped being a joke and
    became an actual distributed system.

The funny part is that the project began with one question:

# **WHO PRESSED SPACE FIRST?**

And somehow the answer required cryptography, networking, consensus,
signatures, validators, Merkle roots, chain validation, persistence,
forks and Byzantine-fault-tolerant ideas.

I am still not sure whether that was genius or terrible judgment.

Probably both.

------------------------------------------------------------------------

# 2. The starting point: I did not know blockchain

When I started REFLEXCHAIN, I knew the vocabulary.

I had heard:

> Blockchain.\
> Hash.\
> Node.\
> Validator.\
> Consensus.\
> Wallet.\
> Cryptography.

But knowing the words is very different from understanding the machine
underneath them.

If somebody had asked me at the beginning:

> "What exactly happens between a user action and a finalized block?"

I would not have been able to explain the complete path.

That became the reason for building this project.

Instead of learning every concept in isolation and hoping it connected
later, I decided to make a project where every concept had a job.

The project became my excuse to ask:

> **"Okay, but what actually happens?"**

That question ended up being more important than the code.

------------------------------------------------------------------------

# 3. The ridiculous idea

The original problem was intentionally useless.

Two people press a button.

One says:

> "I was faster."

The other says:

> "No, I was."

A normal programmer would compare their reaction times.

I looked at the problem and essentially decided:

> "What if five computers had to agree?"

That became **Proof of Reflex™**.

The fundamental joke was simple:

**We built serious distributed infrastructure to determine who pressed
SPACE first.**

The engineering, however, was supposed to be real.

The project philosophy became:

> **The project is intentionally useless. It is not intentionally
> fake.**

That sentence became one of the most important constraints on the build.

If the screen says 5/5 validators, I wanted five actual validator
processes.

If it says consensus, I wanted actual votes.

If it says the chain is compromised, I wanted an actual validation
failure.

If it shows a hash, I wanted that hash to correspond to actual block
data.

------------------------------------------------------------------------

# 4. The first learning phase: what even is a blockchain?

My learning started from the bottom.

I first had to understand the basic object: **the block**.

A block is not just "a box containing transactions."

It has relationships.

A simplified mental model became:

``` text
BLOCK N
├── transactions
├── timestamp
├── merkleRoot
├── previousHash
└── hash
       │
       ▼
BLOCK N+1
├── transactions
├── previousHash = hash of BLOCK N
└── hash
```

Then the obvious question appeared:

> **Why does a block need the previous block's hash?**

Because changing an earlier block changes its hash, which breaks the
next block's `previousHash`, which breaks the chain onward.

That was the first time blockchain stopped feeling like a buzzword and
started feeling like a data structure with a consequence.

------------------------------------------------------------------------

# 5. Then came the tree problem

At one point I asked how a block handles many transactions.

That led to the **Merkle tree**.

The interesting part was realizing that the blockchain does not need to
repeatedly compare every transaction against every other transaction.

Instead, transaction hashes are combined upward:

``` text
        ROOT
       /    \
     H12    H34
     / \    / \
   H1  H2  H3  H4
```

So the block can store a compact fingerprint of its transaction set.

I remember asking whether calculating a big tree would itself take huge
amounts of time and power.

That question was useful because it forced me to distinguish between:

-   the conceptual tree,
-   the number of transactions,
-   the amount of computation,
-   and the actual scale of the project.

For REFLEXCHAIN, the Merkle tree is not solving a massive
cryptocurrency-scale workload.

It is demonstrating the integrity idea clearly.

------------------------------------------------------------------------

# 6. Nodes, validators, and the question I kept coming back to

Then I needed to understand:

> **What does a validator actually do?**

This was harder than memorizing a definition.

I eventually started thinking of a validator as a skeptical participant.

It does not simply say:

> "The user said this, so okay."

It asks:

> "Can I independently verify this?"

That changed the architecture of REFLEXCHAIN.

I did not want five cards on a dashboard pretending to be nodes.

I wanted five actual processes.

So the system eventually became:

``` text
Validator 01
Validator 02
Validator 03
Validator 04
Validator 05
```

with real sockets, real messages, real votes and separate ledgers.

That was the moment the project started becoming much more than a
frontend.

------------------------------------------------------------------------

# 7. The reward question

During the blockchain learning phases, I also had to understand why
validators/miners are rewarded in real blockchains.

That raised another important distinction:

**REFLEXCHAIN is not a cryptocurrency.**

There is no token.

There is no mining reward.

There is no gas market.

There is no economic value.

That is why the dashboard can honestly joke:

``` text
NETWORK VALUE:    ₹0.00
ECONOMIC UTILITY: NONE
```

The project borrows the *engineering ideas* of blockchains without
pretending to be a financial network.

The "reward" for a validator in this project is essentially
participation in the protocol and the ability to demonstrate that the
network can reach agreement.

Which is probably the least profitable blockchain in existence.

------------------------------------------------------------------------

# 8. Consensus finally became understandable

One of the biggest learning jumps was understanding **consensus**.

At first, "consensus" sounded like:

> Everyone agrees.

But the more I learned, the more precise the idea became.

In REFLEXCHAIN:

``` text
5 registered validators
        ↓
each independently evaluates an event
        ↓
each creates a signed vote
        ↓
votes are exchanged/gossiped
        ↓
4 approvals are enough
        ↓
QUORUM
```

For five validators:

``` text
quorum = floor(2n/3) + 1
       = floor(10/3) + 1
       = 4
```

So the network can tolerate one validator being unavailable and still
commit.

That became one of the most satisfying numbers in the project:

# **4/5**

Not because four is special by itself.

Because I finally understood what the number meant.

------------------------------------------------------------------------

# 9. The "wait, how does a block actually get created?" phase

This was one of the questions that forced me deeper.

If validators vote, then:

> **Who actually creates the block?**

The answer is the **proposer/leader**.

Validators independently establish what is acceptable.

The proposer packages the agreed result into a block.

REFLEXCHAIN chooses the leader deterministically:

``` text
leaderIndex =
SHA256("leader:" + matchId) mod 5
```

The same match ID gives every node the same expected leader.

If that leader is unavailable, the system can fail over.

This taught me an important distinction:

**Voting on what happened is different from packaging the agreed result
into a block.**

And that distinction finally made the proposer signature make sense too.

The proposer signs the block hash.

So another node can ask:

> "Did this proposer actually authorize this exact block?"

------------------------------------------------------------------------

# 10. Cryptography stopped being magic

Then came one of my favourite rabbit holes:

**Ed25519 signatures.**

At first, I had a vague mental model:

> private key → signature → public key verifies it

But I had to understand what the signature actually proves.

The important realization was:

The private key does **not** get sent to validators.

Instead, the player signs the event.

The validator receives:

``` text
event
public key
signature
```

and verifies the signature.

That means the validator can determine:

> "This data was signed by whoever controls the corresponding private
> key."

It cannot reverse the signature to discover the private key.

That distinction finally clicked.

------------------------------------------------------------------------

# 11. The signature question that confused me

I remember getting stuck on the relationship between a signature and a
hash.

The important correction in my understanding was:

-   the **event ID** is derived using SHA-256,
-   the **Ed25519 signature** authenticates the canonical event data,
-   the signature is not simply "the private key turned into a hash."

The event is canonicalized, excluding the signature field, and signed.

So if someone changes something like:

``` text
claimedReactionMs: 183
```

to:

``` text
claimedReactionMs: 120
```

the signature no longer verifies.

That made cryptography feel much less like a black box.

------------------------------------------------------------------------

# 12. Event IDs finally made sense

Another question was:

> **If the event has a signature, why does it also need an event ID?**

Because they solve different problems.

The event ID gives the event an identifier that can be tracked and
deduplicated.

The signature proves authenticity and integrity.

So:

``` text
eventId → "Which event is this?"
signature → "Was this event signed by the claimed keyholder, and was it altered?"
```

That distinction was small, but it helped me understand why real
protocols contain multiple layers of identifiers and proofs instead of
one magical field.

------------------------------------------------------------------------

# 13. The seven checks

Eventually the validator logic became concrete.

Every submitted reaction is treated skeptically.

The validator checks:

### 1. Is it well formed?

Required fields and types must exist.

### 2. Does the public key match the claimed player?

The address is derived from the public key and compared with the claimed
identity.

### 3. Is the Ed25519 signature valid?

If the event changed, or the signer does not control the corresponding
private key, validation fails.

### 4. Have I already seen this event?

Duplicate event IDs are rejected.

### 5. Does the event belong to the correct GO signal and turn?

This catches wrong-round submissions and false starts.

### 6. Is the reaction time plausible?

The current protocol uses an 80 ms minimum and 10,000 ms maximum.

### 7. Does the claim fit my own observation?

Each validator has:

``` text
Gᵢ = when this validator observed GO
Aᵢ = when this validator received the press
```

and calculates:

``` text
observed = Aᵢ - Gᵢ
```

The validator then checks whether the player's claimed reaction fits the
observed window.

This was the point where the game and the distributed system finally
became the same project.

The reaction was no longer just a number on a screen.

It became a **signed protocol event**.

------------------------------------------------------------------------

# 14. The timing problem --- and an important lesson in honesty

This was one of the most important things I learned.

A blockchain cannot magically see someone's finger.

Only the player's device directly sees the physical keyboard event.

So the player is making a claim:

> "I reacted in 183 ms."

The network can independently check whether that claim is admissible
under the protocol.

It cannot travel backward in time and observe the finger.

That means REFLEXCHAIN does **not** prove physical reality with absolute
certainty.

It proves something more precise:

> A signed claim from a particular keyholder was accepted by a quorum of
> validators under the protocol's rules and recorded in an
> integrity-checked block.

I think this limitation actually made the project better.

Understanding what a system **cannot** prove is part of understanding
the system.

------------------------------------------------------------------------

# 15. Why five validators had to receive the press independently

This became one of the most important architecture decisions.

I could have done:

``` text
Browser
   ↓
Coordinator
   ↓
Validators
```

But then the coordinator would observe the press first and distribute
it.

That would weaken the whole argument.

So the browser maintains five independent validator connections:

``` text
                 ┌── Validator 01
                 ├── Validator 02
Browser ─────────┼── Validator 03
                 ├── Validator 04
                 └── Validator 05
```

The signed event is sent to all five independently.

Each validator records its own arrival.

That gives each validator an independent observation instead of simply
trusting one central server.

This is probably the single architectural decision I am most proud of.

------------------------------------------------------------------------

# 16. Then I accidentally built a network

The validators are not fake UI boxes.

There are five actual OS processes.

They communicate with each other using a WebSocket mesh.

There are ten peer-to-peer links among five validators.

They exchange things such as:

``` text
HELLO
VOTE
BLOCK_PROPOSAL
CHAIN_REQUEST
CHAIN_RESPONSE
```

They also maintain their own ledger.

So the architecture became:

``` text
                    Browser
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       Node 1        Node 2       Node 3
          ↕            ↕            ↕
       Node 4  ↔  Node 5  ↔  network
```

And at some point I had to stop and think:

> "I came here to build a reaction game."

------------------------------------------------------------------------

# 17. The blockchain became real

Once the consensus result exists, the proposer builds the block.

The block contains much more than the winner.

It contains things such as:

-   match ID,
-   two turn transactions,
-   winner,
-   winning reaction time,
-   previous hash,
-   Merkle root,
-   consensus information,
-   proposer identity,
-   proposer signature,
-   block hash.

So the ledger does not merely say:

``` text
Razin won.
```

It stores the result together with the protocol evidence that led to it.

That was a major conceptual milestone for me.

------------------------------------------------------------------------

# 18. The chain is supposed to survive an argument

One of the things I wanted the project to demonstrate was not just
successful operation, but failure.

What happens if someone edits history?

Suppose a block says:

``` text
winner = Player 1
```

and I change it to:

``` text
winner = Player 2
```

The hash changes.

If I leave the old hash:

``` text
HASH_MISMATCH
```

If I recompute the hash, the proposer signature no longer matches.

If I relink descendants, the node can diverge from the network.

That led to one of the best demo ideas:

# **Hashes can be recomputed. Signatures cannot be forged.**

The system can intentionally be broken so the audience can watch the
integrity checks fail.

------------------------------------------------------------------------

# 19. Forks and the moment blockchain stopped being "just a chain"

Another learning step was understanding that distributed nodes can
temporarily disagree.

Two validators can potentially propose competing blocks.

So REFLEXCHAIN needs a deterministic resolution rule.

The current approach prefers:

1.  the deterministic leader,
2.  otherwise the lower block hash.

The losing proposal is requeued and the network converges.

This is not meant to be a production consensus protocol.

It is a deliberately simplified demonstration of a difficult
distributed-systems idea:

> **Independent machines can disagree temporarily and still have a
> protocol for converging again.**

------------------------------------------------------------------------

# 20. The leaderboard taught me something unexpected

The leaderboard is not a separate database table containing "the truth."

It is derived by replaying the blockchain.

That means:

``` text
BLOCKS
  ↓
transactions
  ↓
replayed results
  ↓
leaderboard
```

This matters because it makes the leaderboard another view of the
ledger.

If the underlying chain changes, the derived result changes.

That reinforced the idea that the blockchain is not just decoration.

------------------------------------------------------------------------

# 21. The project had to survive the 18-hour clock

The technical ambition could easily have killed the project.

The original plan contained many possibilities:

-   computer vision,
-   advanced node management,
-   more players,
-   elaborate deployment,
-   more sophisticated consensus,
-   more visual effects.

But the constraint was simple:

# **Approximately 18 hours.**

So I had to repeatedly choose:

> technically impressive but fragile

over

> technically credible, simpler, reliable and demoable.

The second option won.

That became a real engineering lesson.

A theoretically beautiful architecture that does not work during the
demo is worse than a simpler system that actually runs.

------------------------------------------------------------------------

# 22. The final game became deliberately simple

The final game model is:

``` text
PLAYER 1
   ↓
RED
   ↓
GREEN
   ↓
SPACE
   ↓
CONSENSUS

PLAYER 2
   ↓
RED
   ↓
GREEN
   ↓
SPACE
   ↓
CONSENSUS

       ↓

ONE BLOCK
       ↓
FASTEST VALID TURN
       ↓
WINNER
```

Exactly two players.

Strictly turn-based.

SPACE is the primary input.

If someone presses during RED:

``` text
FALSE START
```

If the player presses during the opponent's turn, the input is ignored.

The game itself is intentionally boring.

The infrastructure underneath it is the spectacle.

------------------------------------------------------------------------

# 23. The first real "holy shit" moment

There is a particular difference between understanding a diagram and
seeing the system actually do it.

The dashboard eventually showed things like:

``` text
CHAIN HEIGHT:       13
TRANSACTIONS:       26
THROUGHPUT:         0.0153 TPS
CONSENSUS:          5/5 QUORUM
CHAIN INTEGRITY:    VERIFIED
HEAD:               3855CC...35CB
NETWORK VALUE:      ₹0.00
ECONOMIC UTILITY:   NONE
PROBLEM SOLVED:     WHO PRESSED FIRST
```

That combination is absurd.

The system is doing real distributed work.

And the thing being solved is still:

> Who pressed SPACE first?

That was probably the moment the original joke finally became the actual
identity of the project.

------------------------------------------------------------------------

# 24. Then reality hit: debugging

Of course, building the system was not a straight line.

At one point `npm run demo` hit errors like:

``` text
EADDRINUSE :::3000
EADDRINUSE :::7002
EADDRINUSE :::7004
```

The problem was not some mysterious blockchain failure.

Those ports were already occupied by existing processes.

That was a useful reminder:

> A distributed system can fail because of something as boring as a
> process still running.

The fix involved finding the processes using those ports and terminating
the stale processes.

This was not glamorous.

It was, however, real engineering.

------------------------------------------------------------------------

# 25. Deployment was another reality check

Hosting the dashboard and hosting the validator network are two
different problems.

The hosted Vercel build does not magically run the five-validator local
network behind it.

Instead, the hosted dashboard can display an exported real chain
snapshot and explicitly identify that it is archived rather than live.

That distinction mattered to me because it would have been easy to make
the website *look* live.

But a screenshot of five validators is not the same thing as five
validators actually running.

Again:

> **Intentionally useless. Not intentionally fake.**

------------------------------------------------------------------------

# 26. What I learned about architecture

The final structure makes much more sense to me now:

``` text
apps/web
    ↓
game + dashboard + explorer
    ↓
generates player identity
measures reaction
signs events
validates chain

apps/coordinator
    ↓
match lifecycle
seat assignment
turn management
GO signal

apps/validator
    ↓
five real validator processes
event validation
votes
gossip
consensus
blocks
sync
persistence

packages/protocol
    ↓
shared rules
canonical JSON
SHA-256
Ed25519
event validation
quorum
settlement
Merkle roots
block validation
chain validation
leader selection
```

The shared protocol package is especially important.

The browser and network use the same core protocol logic.

That means the browser can independently validate the chain rather than
blindly trusting a server response.

------------------------------------------------------------------------

# 27. What I understand now that I didn't understand at the beginning

### Before

"Blockchain is a chain of blocks."

### Now

A blockchain is a replicated history whose integrity depends on
cryptographic commitments, validation rules, agreement mechanisms and
the ability of nodes to reject invalid state.

------------------------------------------------------------------------

### Before

"A validator is a computer that checks transactions."

### Now

A validator is an independent participant that observes, validates,
votes, communicates with peers, verifies proposed blocks and maintains
its own view of the ledger.

------------------------------------------------------------------------

### Before

"A signature proves something is real."

### Now

A digital signature provides cryptographic evidence that a specific
keyholder authorized specific data, and that the signed data has not
been modified.

------------------------------------------------------------------------

### Before

"Consensus means everyone agrees."

### Now

Consensus is a protocol for getting distributed participants to accept a
common result despite differences in timing, availability and
potentially incorrect participants.

------------------------------------------------------------------------

### Before

"A block stores the winner."

### Now

A block can contain the transactions, votes, cryptographic commitments,
previous-chain reference and signatures necessary for other nodes to
independently verify the recorded result.

------------------------------------------------------------------------

# 28. The questions that drove the project

Looking back, the project can almost be described as a sequence of
increasingly dangerous questions:

``` text
What is a blockchain?
        ↓
What is a block?
        ↓
What is a hash?
        ↓
Why previousHash?
        ↓
What is a node?
        ↓
What does a validator do?
        ↓
Why do validators need to agree?
        ↓
What is quorum?
        ↓
Who proposes the block?
        ↓
Why sign the block?
        ↓
Why does the player need a private key?
        ↓
What exactly does a signature sign?
        ↓
Why do we need an event ID too?
        ↓
What happens if validators disagree?
        ↓
What happens if one node dies?
        ↓
What happens if one lies?
        ↓
What happens if somebody edits history?
        ↓
What happens if two blocks are proposed?
        ↓
How does the network recover?
        ↓
Wait...
        ↓
I built a distributed system.
```

------------------------------------------------------------------------

# 29. The biggest lesson: learn by building

The biggest thing I got from this project was not "I now know
blockchain."

I don't think anybody should walk away from one prototype thinking they
have mastered distributed systems.

The real lesson was:

> **I learn difficult technical ideas much better when I have a concrete
> problem forcing me to understand them.**

A textbook can tell me:

> "Quorum is the minimum number of votes required for agreement."

But when I have a five-node network and the game needs to decide whether
a reaction becomes a transaction, the question becomes real.

When one validator disappears:

> "Does 4/5 still work?"

When a signature fails:

> "What exactly did that signature protect?"

When a block is edited:

> "Which link breaks first?"

When two nodes disagree:

> "Who decides which block survives?"

The project turned definitions into consequences.

------------------------------------------------------------------------

# 30. The limitations I want to remember

I do not want future-me to look at this project and forget what it
actually proves.

REFLEXCHAIN has real limitations.

### It does not prove physical reaction time perfectly.

The player's device observes the keypress.

The network validates the player's signed claim.

### Optimistic client-side underclaims are not perfectly catchable.

A malicious client may sometimes report a smaller value that remains
within the allowed envelope.

### The timing tolerance is intentionally generous.

The current epsilon is around 400 ms by default to tolerate
demo-environment jitter.

### Five validators run on one physical machine.

They are separate processes and have separate sockets and ledgers, but
they still share CPU, RAM, disk and power.

So the system is genuinely distributed in execution, but not physically
independent in fault domains.

### Validator keys are simplified.

The prototype's validator keys are derivable from source code.

That would not be acceptable secret management for a production system.

### This is not a production consensus protocol.

It is a learning project designed to make distributed-systems concepts
visible and understandable.

Knowing these limitations does not make the project weaker.

It makes the explanation more honest.

------------------------------------------------------------------------

# 31. What I am proud of

I am proud that I did not stop at making a UI that *looked*
decentralized.

I am proud that there are actual processes.

I am proud that the player gets an actual cryptographic identity.

I am proud that the event is actually signed.

I am proud that validators actually vote.

I am proud that quorum is actually calculated.

I am proud that blocks are actually hashed and linked.

I am proud that signatures can actually fail.

I am proud that the browser can actually validate the chain.

I am proud that the system can be intentionally broken for the demo.

And, perhaps most importantly, I am proud that I can now explain many of
the concepts that originally sounded like meaningless blockchain
vocabulary.

------------------------------------------------------------------------

# 32. What makes the whole thing funny

The more technically correct the system became, the more ridiculous the
project became.

That is the part I like most.

Five validators.

Cryptographic identities.

Signed events.

Quorum.

Leader election.

Vote gossip.

Merkle roots.

Hash-linked blocks.

Persistence.

Fork resolution.

Chain resynchronization.

And the final question:

# **"Who pressed SPACE first?"**

There are probably several hundred easier ways to answer that.

I deliberately chose none of them.

------------------------------------------------------------------------

# 33. If I had to explain my journey in one paragraph

I started REFLEXCHAIN with very little practical understanding of
blockchain. I knew the vocabulary, but not the machinery. I chose a
completely ridiculous problem --- deciding who pressed a keyboard first
--- because I wanted a reason to learn the machinery by building it. The
project forced me to understand blocks, hashes, previous-hash chaining,
Merkle roots, validators, cryptographic identities, Ed25519 signatures,
event IDs, quorum, leader selection, vote gossip, block proposals,
persistence, forks, synchronization and failure handling. Somewhere
along the way, the joke became real enough that five independent OS
processes were communicating, voting and maintaining their own ledgers.
I did not set out to become a distributed-systems engineer in one night.
I set out to build a useless game. The game simply kept asking harder
questions.

------------------------------------------------------------------------

# 34. The line I want to remember

If I forget everything else about this project, I want to remember this:

> **I did not build REFLEXCHAIN because blockchain was the right
> solution.**
>
> **I built it because blockchain was the wrong solution --- and that
> gave me a reason to understand how it actually works.**

And after all that:

# **WHO PRESSED FIRST?**

## The blockchain has spoken.

------------------------------------------------------------------------

# 35. Final snapshot

``` text
PROJECT
REFLEXCHAIN

CONSENSUS
PROOF OF REFLEX™

PLAYERS
2

TURNS
2

VALIDATORS
5

QUORUM
4/5

IDENTITY
Ed25519

HASHING
SHA-256

NETWORK
WebSockets

LEDGER
Hash-linked JSONL

BLOCK INTEGRITY
Hash + Merkle root + signatures

GAME INPUT
SPACE

ECONOMIC VALUE
₹0.00

ECONOMIC UTILITY
NONE

PROBLEM SOLVED
WHO PRESSED FIRST

TIME AVAILABLE
~18 HOURS

INITIAL BLOCKCHAIN KNOWLEDGE
Almost none

FINAL RESULT
"I accidentally built a distributed system."
```

------------------------------------------------------------------------

# 36. One last thought

There is something satisfying about the fact that this project is
useless.

If I had started with a serious financial application, I might have been
tempted to hide complexity behind abstractions.

Here, the absurdity gave me permission to look underneath everything.

Why does the validator vote?

Why does the vote need a signature?

Why does the event need an ID?

Why does the block need a Merkle root?

Why does it need the previous hash?

Why does a proposer exist?

Why does the proposer sign?

What happens if one node disappears?

What happens if one node lies?

What happens if history is edited?

What happens if two nodes disagree?

And eventually:

> **Can five computers actually agree on who pressed a space bar
> first?**

Apparently, they can.

And I learned a ridiculous amount along the way.

------------------------------------------------------------------------

**Personal progress document --- September 2026**

**Razin Ashraf**\
**Muthoot Institute of Technology and Science**
**Team Bruh**

*The project is useless.*

*The learning wasn't.*
