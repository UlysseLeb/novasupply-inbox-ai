# AI Customer Operations Workflow

Production-ready AI workflow for email support, document extraction, context verification and human approval.

## The problem

A B2B company selling industrial equipment receives a steady stream of customer emails: password resets, delivery questions, incomplete orders, billing disputes, legal threats. Every single one currently gets the same treatment — a human reads it, decides what it means, checks the order system, and writes a reply. Simple requests take just as long as complex ones to triage, because nothing pre-sorts them.

This project automates that triage and drafting step — without removing the human from decisions that matter.

## The workflow

```
Email received
    ↓
Classify (category, priority, complexity, sentiment, confidence)
    ↓
[if a document is attached] Extract structured data from it
    ↓
[if the case references real data] Verify it against actual orders/clients
    ↓
Generate a reply draft + suggested internal actions
    ↓
Human reviews: Approve / Modify / Reject / Transfer
```

The system never invents facts about a customer's order — it looks them up. And it never auto-sends a reply to a complex or upset customer — it routes those to a human instead.

## Three levels of handling

| Level | Example | Action |
|---|---|---|
| 1 — Simple | "How do I reset my password?" | Automatic reply, no human needed |
| 2 — Needs verification | "My order is missing 2 units" | Draft generated, human approves before sending |
| 3 — Needs a human | "I'm contacting my lawyer" | Routed directly to a human, no draft attempted |

The model isn't trusted to make this call alone — `automatic_reply` is only allowed when complexity is level 1 *and* the customer isn't angry. Everything else gets either a draft or a handoff.

## Architecture

- **Frontend + backend**: Next.js 16 (App Router, TypeScript) — a single app serving both the API routes and the validation UI.
- **AI model**: Claude Haiku 4.5 via the Anthropic API, with structured outputs (JSON schema) so every response is guaranteed parseable — no regex-scraping a chat response.
- **Data**: a fictional company, *NovaSupply* (B2B industrial equipment), represented as JSON files (`apps/web/demo-data/`) — clients, orders, invoices, catalog. No real database; this keeps the project runnable with zero setup beyond an API key.
- **Endpoints**:
  - `POST /api/classify-ticket` — categorize an email and decide its handling level
  - `POST /api/extract-document` — read a PDF attachment (e.g. a purchase order) into structured JSON
  - `POST /api/retrieve-context` — look up the real client/order data and compute actual discrepancies (ordered vs. shipped)
  - `POST /api/generate-reply` — draft a reply grounded in the classification + verified context
- **Validation UI** (`/`): an inbox of demo emails; selecting one runs the pipeline live and shows every step — the classification, the verified context (if any), the draft, and the four decision buttons.
- **ROI dashboard** (`/dashboard`): real metrics only — built from actual clicks in the UI, not simulated numbers. Tracks volume by handling level, real API cost (computed from actual token usage), and the rate of drafts approved without edits.

## Automation rules

The model doesn't get unrestricted authority to decide everything — routing follows explicit rules layered on top of its classification:

```ts
if (complexity_level === 1 && sentiment !== "angry") {
  return "automatic_reply";
}
if (complexity_level === 3) {
  return "human_review";
}
return "draft_for_approval";
```

This is the same principle the project is built around: let the model classify and draft, but keep deterministic rules in charge of what happens next.

## Evaluation results

`apps/web/evaluations/tickets.json` holds 22 hand-written test cases (8 level-1, 8 level-2, 6 level-3) spanning password resets, incomplete orders, billing errors, legal threats, and ambiguous complaints. Running `npm run eval` against the live classification endpoint typically scores **95-100%** on both classification level and routing action, across repeated runs.

The recurring miss, when it happens, is the deliberately ambiguous case: *"I don't know exactly what the problem is, but something's wrong with my last order."* It's designed to be hard — there's no extractable detail — and the model occasionally classifies it as level 2 (draft for approval) instead of level 3 (human review). LLM classification isn't perfectly deterministic, so re-running `npm run eval` may show small variation between runs. This is the actual behavior, not a cherry-picked best run.

## Limitations

Being upfront about what this is *not*:

- **No real inbox integration.** The "inbox" is a static JSON list, not a live Gmail/IMAP connection.
- **No real CRM.** "Suggested actions" (create ticket, assign to logistics...) are generated text, not actually executed against a CRM system.
- **No PDF upload in the main flow.** `/api/extract-document` works and is tested standalone, but the validation UI currently extracts order numbers from email text via a simple pattern match rather than requiring an attached PDF — a deliberate shortcut for the demo.
- **Small, hand-built dataset.** 22 test cases and 5 demo clients are enough to prove the approach, not a production-scale benchmark.
- **Classification isn't perfectly deterministic.** The same ambiguous email can occasionally be routed to a different level on re-evaluation (see Evaluation results above) — a known characteristic of LLM-based classification, not a bug to silently ignore.
- **No authentication or multi-tenant support.** This is a single-operator demo, not a deployable SaaS.

## n8n orchestration (real Gmail integration)

Beyond the validation UI (which uses a static demo inbox), `n8n/email-workflow.json` is a real n8n workflow that connects to an actual Gmail account and runs the full pipeline automatically on incoming mail:

```
Gmail Trigger (new unread email)
    → Get full message content
    → POST /api/classify-ticket
    → Switch (route by complexity_level)
        ├─ Level 1 → POST /api/generate-reply → Gmail reply sent automatically to the customer
        ├─ Level 2 → POST /api/retrieve-context → POST /api/generate-reply → Gmail notification to a human with the draft for approval (never auto-sent to the customer)
        └─ Level 3 → POST /api/generate-reply (no context lookup) → Gmail notification to a human for direct handoff
```

n8n calls the same four endpoints the validation UI uses — it doesn't reimplement any classification or business logic, it's purely an orchestrator. Verified end-to-end with a real Gmail inbox across all three levels: a password-reset email triggered an automatic reply sent directly to the customer (level 1); a genuine "order CMD-4006 is missing items" email was classified as level 2, matched against the real order discrepancy in `demo-data/`, and produced a reply draft delivered as a human-approval notification rather than sent to the customer; and a message threatening legal action was classified as level 3 and forwarded to a human with no draft sent to the customer.

To run it:

```bash
docker compose up -d        # starts n8n on http://localhost:5678
```

Import `n8n/email-workflow.json`, connect your own Gmail OAuth credentials (Google Cloud Console → OAuth client, redirect URI `http://localhost:5678/rest/oauth2-credential/callback`), and point the HTTP Request nodes at `http://host.docker.internal:3000` (n8n runs in Docker; this resolves to your host machine where the Next.js app runs).

## Cost per operation

Every classification and draft generation call returns the real cost, computed from actual token usage (not estimated): Claude Haiku 4.5 pricing is $1 / million input tokens and $5 / million output tokens. A typical classification call costs well under $0.001. The ROI dashboard aggregates this in real time as tickets are processed — there's no need to take a marketing number on faith; run it yourself and watch the dashboard update.

## Running it locally

```bash
cd apps/web
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npm run dev
```

Open `http://localhost:3000`, click an email, watch the pipeline run.

To run the evaluation suite (server must be running):

```bash
npm run eval
```

## Demo video

_Coming soon._

## Tech stack

Next.js 16 · TypeScript · Anthropic API (Claude Haiku 4.5, structured outputs) · React
