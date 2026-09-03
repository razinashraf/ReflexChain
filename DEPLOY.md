# Deploying REFLEXCHAIN

Two pieces go to two places:

| Piece | Where | Why |
|---|---|---|
| Dashboard (`apps/web`) | **Vercel** | Static Next.js app |
| Coordinator + 5 validators | **Railway** | Needs long-lived WebSockets; Vercel functions are stateless |

The backend runs as **one container** with a routing gateway in front, so the
validators keep talking to each other over `localhost:7001–7005` exactly as they
do on a laptop. Only the browser needs public URLs.

```
Browser (Vercel, HTTPS)
   │  wss://<railway>/socket.io          → coordinator
   │  wss://<railway>/node-01 … /node-05 → validators
   ▼
┌──────────── one Railway container ────────────┐
│ gateway (binds $PORT, proxies HTTP + WS)      │
│   ├── coordinator :4000                       │
│   └── node-01…05  :7001–7005  (mesh unchanged)│
└───────────────────────────────────────────────┘
```

---

## Step 1 — GitHub

The repo is already initialized and committed on `main`. Create an **empty**
repo on GitHub (no README, no .gitignore), then:

```bash
git remote add origin https://github.com/<you>/reflexchain.git
git push -u origin main
```

---

## Step 2 — Railway (the backend)

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
   → pick the repo.
2. Railway reads `railway.json` and builds with the `Dockerfile`. No build
   command to configure.
3. **Variables** → add:
   ```
   RFX_VALIDATOR_COUNT = 5
   ```
   `PORT` is injected automatically — do not set it.
4. **Settings → Networking → Generate Domain.** Copy it, e.g.
   `reflexchain-production.up.railway.app`.

### Verify the backend before touching Vercel

```bash
RW=https://<your-railway-domain>

curl -s $RW/health                     # all 6 children should be running:true
curl -s $RW/node-01/status             # peersConnected should be 4
curl -s $RW/node-03/chain/validate     # valid:true
```

Cold boot takes ~15s while six processes start and the mesh forms. If
`peersConnected` is below 4, wait and retry before assuming a problem.

Then play real matches against it:

```bash
npx tsx scripts/seed-chain.ts --matches 3 \
  --endpoints "$RW/node-01,$RW/node-02,$RW/node-03,$RW/node-04,$RW/node-05"
```

All five heads should match afterwards.

---

## Step 3 — Vercel (the dashboard)

1. [vercel.com](https://vercel.com) → **Add New → Project** → import the repo.
2. **Leave Root Directory as the repository root.** The app cannot build from
   `apps/web` alone because it depends on the `@reflexchain/protocol` workspace
   package. `vercel.json` already points the build at the right workspace.
3. **Environment Variables** — add both, for all environments:

   ```
   NEXT_PUBLIC_COORDINATOR_URL = https://<railway-domain>
   NEXT_PUBLIC_VALIDATOR_URLS  = https://<railway-domain>/node-01,https://<railway-domain>/node-02,https://<railway-domain>/node-03,https://<railway-domain>/node-04,https://<railway-domain>/node-05
   ```

   Comma-separated, **no spaces**, no trailing slashes.

4. Deploy.

> **These are inlined at build time.** Changing either variable requires a
> redeploy — editing it in the dashboard alone does nothing to the live site.

---

## Step 4 — End-to-end check

Open the Vercel URL and confirm:

- Header reads **LIVE NETWORK** and **5/5 QUORUM** (not `CONNECTING`)
- Five validator cards show `PEERS 4/4`
- **CREATE MATCH** is present — if you see the "validator network unreachable"
  panel instead, the frontend cannot reach Railway; recheck the env vars and
  that you redeployed after setting them
- Play a match on two devices; a block should appear in the explorer

---

## Refreshing the archived snapshot

`apps/web/public/snapshot.json` is what the dashboard falls back to when no
validator answers. To update it, run a local network and export:

```bash
npm run demo          # in one terminal
npm run seed -- --matches 10
npm run snapshot
git commit -am "refresh snapshot" && git push
```

The export refuses to write an invalid chain, so a corrupted ledger cannot
become the published fallback.

---

## Things that will bite you

| Symptom | Cause |
|---|---|
| Frontend shows the offline panel | Env vars missing, or set but **not redeployed** |
| `CONNECTING` forever | Railway domain wrong, or the container is still cold-starting |
| CORS errors in console | Something added a second `Access-Control-Allow-Origin`. The gateway deliberately does not set CORS on proxied routes — upstream already does |
| Chain resets after a redeploy | Railway's filesystem is ephemeral. Mount a volume at `/app/data` to persist it |
| Anyone can kill or corrupt a node | The `/admin/*` endpoints are public. Fine for a demo; gate them behind a token if this outlives the event |

---

## Costs

Railway gives trial credit, then runs about **$5/month** for a container this
size. Vercel's hobby tier is free.

If you would rather not pay: skip Railway entirely. The Vercel site still works
on its own, showing the archived chain with the explainer panel, and the live
demo runs from your laptop with `npm run demo`. Nothing else needs to change.
