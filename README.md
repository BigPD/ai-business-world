# JDM Kingdom eBay Tool

Automates JDM Kingdom's eBay store: syncs current listings/orders into Supabase,
runs a daily trend scan against a JDM-parts keyword watchlist, and (once trend
data is trusted) drafts new listing suggestions for review before publishing.

Stack: Next.js (App Router, TypeScript) on Vercel, Supabase Postgres, eBay REST
APIs (Sell Inventory/Fulfillment, Browse) + the legacy Trading API for reading
existing listings that predate this tool.

## What's built so far

- `GET /api/ebay/oauth/start` / `/api/ebay/oauth/callback` — 3-legged OAuth
  connect flow for JDM Kingdom's seller account. Tokens are stored (and
  auto-refreshed) in the `ebay_tokens` table.
- `GET /api/ebay/deletion` (GET challenge + POST) — eBay's required
  Marketplace Account Deletion notification endpoint.
- `GET /api/cron/sync-store` — pulls all active listings (Trading API
  `GetSellerList`) and the last 30 days of orders (Fulfillment API) into
  `store_listings` / `store_orders`. Runs daily via Vercel Cron.
- `GET /api/cron/trend-scan` — runs the `trend_keywords` watchlist against
  eBay's Browse API (active-listing price/competition as a demand proxy) and
  records a snapshot per keyword into `trend_snapshots`. Runs daily via
  Vercel Cron.
- `/` — dashboard: connection status, synced counts, top trend opportunities.

## Not built yet (next steps)

- Turning trend snapshots into `listing_opportunities` drafts (title/price/
  category suggestions), with a review UI before anything publishes to eBay.
- Actually publishing approved drafts via the Inventory/Offer APIs.
- Competitor price tracking (`competitor_prices` table exists, nothing
  populates it yet).
- Marketplace Insights API (real sold-item history) — this requires a
  separate, gated approval from eBay beyond standard developer access. The
  trend scan uses Browse API active-listing data as a proxy until that's
  granted; swap it in in `src/app/api/cron/trend-scan/route.ts`.

## Setup

### 1. eBay Developer Portal (developer.ebay.com)

1. Create/open your application under **My Account → Application Keys**.
   Start with the **Sandbox** keyset, move to **Production** once the OAuth
   flow and syncs are verified end to end.
2. Copy the **App ID (Client ID)** and **Cert ID (Client Secret)**.
3. Under **User Tokens → Get a Token from eBay via Your Application**, add a
   redirect (RuName). Its "Your auth accepted URL" should point at this
   app's deployed URL, e.g. `https://<domain>/` — that URL just needs to
   exist, eBay doesn't call it directly. Copy the generated **RuName** value.
4. Set **Privacy Policy URL** to `https://<domain>/jdm-kingdom-ebay-privacy.html`.
5. Under **Marketplace Account Deletion**, set the notification endpoint to
   `https://<domain>/api/ebay/deletion` and set a verification token (any
   string, 32-80 chars — put the same value in `EBAY_VERIFICATION_TOKEN`).
   eBay will immediately send a GET challenge to verify the endpoint, so the
   env vars below need to be deployed *before* you save this.

### 2. Environment variables (Vercel project settings)

Copy `.env.example` and fill in:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — from the `jdm-kingdom-ebay`
  Supabase project (Project Settings → API). Service role key, not anon —
  this app only runs server-side.
- `EBAY_ENV`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_RU_NAME` — from
  step 1.
- `EBAY_VERIFICATION_TOKEN`, `EBAY_DELETION_ENDPOINT_URL` — from step 1.
- `CRON_SECRET` — set this in Vercel project settings under Cron Jobs; Vercel
  sends it automatically as a bearer token to cron routes once set, no extra
  wiring needed.

### 3. Connect the store

Once deployed with env vars set, visit `/` and click "connect JDM Kingdom's
eBay account" — this runs eBay's OAuth consent screen. After approving, the
dashboard should show "Connected" and the next cron run will populate
listings/orders/trends.

## Local development

```bash
npm install
npm run dev
```

Needs a `.env.local` with the same variables as above.
