# AGENTS.md — cf-workers-typescript-template

Fork of GregBrimble's Cloudflare Workers TypeScript template. The maintained
app is **`wise-fiskl-webhook/`** — a deterministic Worker that receives Wise
`balances#update` webhooks and records cash movements in Fiskl. The template
root is legacy boilerplate kept for reference; don't extend it.

## No GitHub Actions — gates and deploys are agent-run

The org's Actions billing is locked, so workflow runs never start and give
false signal. The mooths convention applies: **local gates + agent-run manual
deploys are the source of truth**, and the agent watches deploy output in real
time so failures get fixed immediately instead of surfacing in a dead check.

- The legacy template workflows (`test.yml`, `deploy.yml`) were removed.
- `wise-fiskl-webhook.yml` is kept as a convenience check for if/when billing
  is restored — never block on it, never treat its failure as signal.

## Local gates (run inside `wise-fiskl-webhook/`)

```sh
npm ci
npm test                 # vitest — 23 tests
npm run typecheck        # tsc --noEmit
npx wrangler deploy --dry-run   # bundle sanity check
```

## Branching & PR workflow (Daniel's convention — always)

- **Never `git checkout`/`git switch` in the main worktree** — it moves the
  shared working directory under other agents. The checked-out branch is
  yours until the user says otherwise.
- **Every fix/feature gets its own branch + PR** — review bots (Qodo,
  CodeAnt, Cursor) only run on PRs; direct commits ship unreviewed.
- PR-bound work: **suggest** a branch and wait for approval; then create it
  as a sibling **worktree**, never a checkout:
  `git worktree add ../cf-workers-typescript-template-<slug> -b <type>/<slug> <base>`
- Worktrees don't carry gitignored files — set up once: `cd wise-fiskl-webhook && npm ci`, copy `.dev.vars`.
- Cleanup: after the PR merges/closes, `git status` first (never remove a
  dirty tree), then `git worktree remove ../cf-workers-typescript-template-<slug>`
  + `git branch -d <branch>`.

## Pre-merge review gate (mandatory)

**The commit that passes the gates is the commit that merges.** Review bots
push fix commits directly onto PR branches — those land after the last gate
run and ship unverified.

Before merging ANY PR:

1. All review threads resolved — fix or dismiss with a reason
   (`gh pr view <n>`, Qodo MCP `get-pr-review-findings`).
2. Bot-authored commits are reviewed like human code — never rubber-stamp.
3. If the head moved since the last green gate run, re-run the local gates
   (`npm test` + `npm run typecheck`) on a checkout of the head SHA.

When the gate passes AND zero unresolved findings remain, merge to `master`
**without asking** (`.cursor/rules/auto-merge.mdc`). Still ask first on
failing gates, unresolved findings, non-trivial conflicts, or
secrets/destructive diffs.

## Manual deploy (agent-run)

```sh
cd wise-fiskl-webhook
npx wrangler deploy                          # needs wrangler auth (CLOUDFLARE_API_TOKEN or login)
curl -sS https://<worker-host>/healthz       # verify {"ok":true}
```

Setup / secrets (`wrangler secret put`, never commit):

- `npx wrangler kv namespace create IDEMPOTENCY` → paste id into `wrangler.jsonc`
- `FISKL_API_KEY` (`fsk_…`, needs `transactions:write`) — required
- `WISE_API_TOKEN` — optional, only for `npm run subscribe`
- `WISE_PROFILE_TO_FISKL_ACCOUNT` var → real Fiskl cash account ids after
  creating `[PERS] Wise` / `[BIZ] Wise` in Fiskl
- `npm run subscribe` (`WISE_API_TOKEN` + `WORKER_URL` env) creates both
  profile subscriptions; see `wise-fiskl-webhook/README.md`

## Bot reviews

- `REVIEW.md` encodes reviewer-facing rules for this repo — enable it in the
  Qodo portal (Configurations → Context → REVIEW.md instructions); see
  `.pr_agent.toml`.
- Resolve findings via `gh pr view` / Qodo MCP `get-pr-review-findings`.
