# V2.3 — Planning Index

Planning docs for the **Photo/Video Running Analysis** app (single-feature spin-off of Echo V1,
PACE family). No app code exists yet — planning only.

| File | Process step | Covers |
|------|--------------|--------|
| [`01-brainstorm.md`](01-brainstorm.md) | **Step 1** + **Step 2** | Goal, milestones, all clarifying answers, Echo-codebase findings |
| [`02-product-requirements.md`](02-product-requirements.md) | **Step 3 · Part A** | Product requirements — what & why |
| [`03-engineering-requirements.md`](03-engineering-requirements.md) | **Step 3 · Part B** | Engineering requirements — how |

The **project spec doc** is the two Part-A / Part-B files (02 and 03).

## Coverage checklist

**Part A — Product Requirements**
- [x] Who it's for · what problem · what it does
- [x] Specific UX / user flows
- [x] Milestones with a "done" definition each
- [x] v1-first, iterate to v2

**Part B — Engineering Requirements**
- [x] Tech stack: language · frontend · backend · database · hosting · auth · payments · email · **storage** · AI models
- [x] Architecture: system design · component interactions · DB schema · API design
- [x] Conventions / best practices
- [ ] Infrastructure provisioned — checklist in 03, **not yet done**

## Key decisions (locked)
- **Quotas:** Free 1 total · Pro 10 / month · Elite 30 / month.
- **Detail gradient:** Free < Pro < Elite, with the Pro→Elite step intentionally *tiny*
  (a verbosity/depth bump, not a different analysis). Elite's real draw is quantity + comparison.
- **Media retention:** kept by default in a private bucket (shows in Past Analyses); the **user
  can delete** any analysis, which purges its media. Their choice.

## What's different from V2.2 (inherited vs new)
- **Inherited:** auth (Google + Apple + email), Free/Pro/Elite dummy-payment tiers,
  server-side quota enforcement, same stack, same `purchase-tier` contract.
- **New:** media capture (upload + record), **private Supabase Storage** (kept, user-deletable),
  **multi-frame video** motion analysis, and **certified-knowledge grounding** — Claude reads
  the PACE-adapted rule files before every analysis.

## Still open before coding
1. **Build step 1:** copy the 4 knowledge files in and adapt ECHO → PACE (see 03).
2. Pick the **app name**.
3. **Provision infra** (checklist in 03).
