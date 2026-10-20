This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load Inter (body) and Cormorant Garamond (headings).

## Backend setup (Supabase + trend providers)

Authentication, the shared catalog, and the admin "Tendencias" panel run on Supabase
(Postgres + Auth). Copy `.env.example` to `.env.local` and fill in the values.

### Database migrations

Apply the versioned migrations in `supabase/migrations/` to your Supabase project,
in order (`20261006023124_foundation` profiles/roles, `20261006023145_trends_and_catalog`
provider connections/snapshots/leases/catalog, `20261006023202_seed_products`
seed products, `20261006172120_aliexpress_ds` DS provider/SKU columns,
`20261006190950_ds_shipping` customer shipping fields on the public view,
`20261006190956_discovery_providers` widens the provider check for
`cjdropshipping`, `20261006213419_published_products_shipping_guard` hides
international products missing a confirmed customer shipping quote,
`20261006221448_archive_seed_products` archives the eight demo seed products
— `source='seed'`, ids `1`–`8`, rows preserved, not deleted),
`20261007120000_orders` creates the orders schema — `orders`, `order_items`
(price + supplier-cost snapshots), `order_events` (customer-visible
timeline), and `payment_events` (provider webhook audit + dedupe);
`20261007120100_orders_grants` revokes all anon/authenticated table grants.
All four tables are RLS-enabled with no public policies and no client-role
privileges: every read/write goes through the service role, guest lookup
requires the order reference plus the purchase phone/email (or the
unguessable `lookup_token`), and admin access uses the `user_roles` check.
Filenames use Supabase timestamp versions and must not be
renumbered; remote projects that already applied them will skip replay. With the
Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### Owner bootstrap

The first administrator is created out of band (there is no public admin signup):

1. Register a normal customer account through `/login`, or create the user in the
   Supabase Auth dashboard.
2. In the SQL editor, promote it:

   ```sql
   insert into public.user_roles (user_id, role)
   values ('<user-uuid>', 'admin')
   on conflict (user_id) do update set role = 'admin';
   ```

Additional admins are managed from Command Center -> Equipo Admin. The last
administrator cannot be removed (enforced by a database trigger).

### Trend provider credentials

- **Mercado Libre**: create a free app at developers.mercadolibre.com.co, set the
  redirect URI to `…/api/admin/providers/meli/callback`, then connect it from the
  Tendencias tab ("Conectar Mercado Libre"). Tokens are stored encrypted using
  `PROVIDER_TOKEN_ENCRYPTION_KEY`.
- **AliExpress Affiliate**: create an app at open.aliexpress.com to obtain
  `ALIEXPRESS_APP_KEY` / `ALIEXPRESS_APP_SECRET` / `ALIEXPRESS_TRACKING_ID`.
  Verify Colombia (`ship_to_country=CO`) support and display/storage terms before
  enabling.
- **AliExpress Dropshipping (DS)**: a separate app registration (not the
  affiliate keys). Configure `ALIEXPRESS_DS_APP_KEY`, `ALIEXPRESS_DS_APP_SECRET`,
  and `ALIEXPRESS_DS_REDIRECT_URI` matching the `callback_url` registered in the
  DS app console, then connect from the Tendencias tab ("Conectar AliExpress
  DS"). If the rotated DS secret is currently stored in your host as
  `ALIEXPRESS_APP_SECRET`, rename that variable to `ALIEXPRESS_DS_APP_SECRET`
  and reserve `ALIEXPRESS_APP_SECRET` for the affiliate app. OAuth tokens are
  encrypted with `PROVIDER_TOKEN_ENCRYPTION_KEY` and refreshed under the shared
  provider lease. Product lookup is ID-only (`ship_to_country=CO`, USD, `es`),
  and variants are imported one SKU per draft — SKU data is stored in the
  private `supplier_variant` column, never in the public catalog view.
  Freight is quoted per selected SKU via `aliexpress.ds.freight.query`
  (quantity 1, Bogotá, USD) — an indicative per-unit estimate, not a bulk or
  city-verified quote. The operator must enter a manual USD→COP rate and date
  before costs and the suggested retail price are computed; suggestions are
  provisional when taxes/payment fees are unknown and never guarantee profit.
  Published DS products expose only `customer_shipping_cop`,
  `shipping_estimate_city`, `shipping_checked_at`, and `shipping_quote_required`
  in the public view; carts sum the per-unit estimate and order creation is
  rejected while a DS item has no quote. Supplier fulfillment is manual for
  now — paid orders are placed with the provider by the operator. When connected, the DS app also feeds a product-feed
  supplier signal via `aliexpress.ds.feed.itemids.get`. The operator must pick
  a feed explicitly (`aliexpress.ds.feedname.get` lists provider feeds; the
  choice is stored in `provider_connections.meta.ds_feed_name`) — no feed is
  assumed, and provider feed names are not verified market truth.
- **CJ Dropshipping**: configure `CJ_API_KEY` (server-only). The token obtained
  from `authentication/getAccessToken` is stored encrypted under the provider
  lease and the trending product list (`product/listV2`) is refreshed at most
  once every 6 hours with a ≥1s gap between auth and list calls. `listedNum`
  is shown as the provider's listing count — it is not sales data.

Publishing (or saving edits to a published row) for `aliexpress_ds` /
`cjdropshipping` products requires a confirmed customer shipping quote:
`customer_shipping_cop` (explicit non-negative integer — 0 only when free
shipping is knowingly confirmed), `shipping_estimate_city`, and
`shipping_checked_at`. The `published_products` view hides international rows
missing these fields until an admin corrects them in the operator **Productos**
tab, which lists every status and supports editing, archiving (rows are kept),
and republishing.

Missing provider configuration disables only that source — the panel shows each
source's status and the age of the last successful snapshot. Snapshots refresh
automatically when an admin opens the panel if older than 6 hours; refreshes are
serialized across instances with database leases.

### Supplier import workflow (AliExpress DS / CJ Dropshipping)

The operator panel (`/operator`, tab *Tendencias*) splits into
**Descubrir** (loaded trend signals — AliExpress Affiliate/DS, CJ, MercadoLibre),
**Importar** (server-verified product preview + draft import),
**Borradores** (draft review, edit, publish gate) and **Conexiones**
(provider OAuth/feed/diagnostics status).

- `POST /api/admin/suppliers/preview` — `{source, productId, variantId?}` returns
  a `SupplierPreview` assembled server-side from the provider's official API:
  detail, variant stock (CJ CN warehouses only), a freight quote (CJ quotes
  specifically CN→CO; AliExpress DS quotes to the destination configured in the
  DS integration), and a USD→COP rate. `productId` also accepts pasted
  `aliexpress.com/item/<id>.html` or `cjdropshipping.com/…-p-<id>.html` URLs
  (parsed, never fetched; shorteners and lookalike hosts rejected).
- `POST /api/admin/catalog/import-supplier` — refetches the preview and builds
  the draft with `buildSupplierImport`; price, stock and images always come from
  the provider API response, never from the client. Body keys are allowlisted:
  `source`, `productId`, `variantId`, `freightId`, `marginPercent` (15–50), and
  an optional explicit `priceCop` that overrides the suggested selling price.
  Duplicates return `{created:false}` without overwriting.
- `POST /api/admin/catalog/[id]/supplier-sync` — manual "Actualizar costo y
  stock" re-query for imported rows. Requires `expectedUpdatedAt` (optimistic
  concurrency), refuses archived/manual rows and unverifiable stock/cost, and
  only updates `stock`, `listing_*`, `supplier_cost_cop`, `fx_*` and the
  `supplier_variant` snapshot — never the copy, images, sale price or publish
  state. No automatic repricing or cron.
- Legacy `POST /api/admin/catalog` remains only for MercadoLibre reference
  drafts; it rejects `aliexpress`, `aliexpress_ds`, `cjdropshipping` and any
  other source (they must go through `import-supplier`).

### Currency conversion (import-time FX + manual review)

Supplier previews fetch the USD→COP rate once per request from
[ExchangeRate-API](https://www.exchangerate-api.com) (`open.er-api.com`, 8s
timeout, 6h cache, rates older than 72h rejected — UI shows rate, date and the
required attribution link). If the rate is unavailable, cost/shipping stay `null`
and the price suggestion is skipped — no hardcoded fallback. The draft keeps the
original `listing_currency`; `fx_rate`/`fx_rate_date` record the applied
snapshot, and reviewers can still override the COP price before publishing.

### Supabase free-tier notes

- Free-tier projects may pause after inactivity. Check current Supabase limits
  and restore paused projects through the dashboard before serving traffic.
- Database leases and the last-admin trigger rely on Postgres functions and are
  not exercised by the fixture test suite — verify them in a linked project
  before production use.

### Validation status

Fixture tests (`npm test`) cover signing, normalization, snapshot retention on
failure, lease serialization, idempotent import, optimistic publish conflicts,
and input validation with an in-memory client. The three migrations have been
applied to the configured Supabase project; live inspection confirms RLS,
public/private catalog grants, lease RPC privileges, installed triggers, and
the seeded catalog rows. The `20261006190950_ds_shipping` and
`20261006190956_discovery_providers` migrations are also applied — public
customer-shipping fields and supplier-private grants are verified remotely. The
`20261006213419_published_products_shipping_guard` migration is also applied and
verified remotely — zero incomplete international rows are publicly readable.
The `20261006221448_archive_seed_products` migration is applied and verified
remotely — the eight original seed products are archived (not deleted) and none
remain published; imported CJ/AliExpress DS products, roles, provider
connections, and snapshots are unaffected. The `20261007120000_orders` and
`20261007120100_orders_grants` migrations are applied and verified remotely —
tables, indexes, and unique constraints exist, RLS is enabled with zero
policies, and only `postgres`/`service_role` hold table privileges.

### Orders and payments (Wompi)

- Checkout submits item ids + quantities + customer fields to `POST /api/orders`.
  The server reloads the catalog and recomputes every price, discount, and
  shipping amount — client totals are informational only. Orders are created as
  `pending_payment` and the customer is redirected to a single-use Wompi
  payment link.
- `POST /api/webhooks/wompi` verifies the `signature.checksum` (SHA-256 over the
  `signature.properties` values + timestamp + `WOMPI_EVENTS_SECRET`) before
  touching state. Only `APPROVED` events with a matching `amount_in_cents` mark
  an order `paid`; mismatches go to `payment_review` and are never auto-fulfilled.
  Events are deduplicated on `(provider, transaction_id, status)`.
- The browser redirect is never proof of payment — the confirmation page polls
  `/api/orders/status` with the unguessable `lookup_token` embedded in the
  redirect URL. Guest tracking (`/tracking`) needs the order reference plus the
  purchase phone or email via `POST /api/orders/lookup` (uniform 404 — no
  enumeration of which value failed).
- `WOMPI_ENVIRONMENT` defaults to `sandbox`; an explicit `production` value is
  required for real charges. Without `WOMPI_PRIVATE_KEY` + `WOMPI_EVENTS_SECRET`
  checkout returns 503.
- The Command Center "Pedidos" tab lists real orders, allows fulfillment-status
  updates (forward-only transitions), tracking number/carrier entry, cancel on
  unpaid orders, and refund flagging on paid ones (the money movement itself is
  done in the Wompi dashboard). Payment status is never editable by hand.
- Confirmation email (Resend) is sent only after a verified `APPROVED` event.
  `RESEND_FROM_EMAIL` needs a domain verified in Resend — `luzmagica.vercel.app`
  cannot be verified since it isn't a domain you own. Email failure never
  changes payment state.
- Checkout requires the customer to accept the data-processing policy
  (`/legal/privacidad`, Ley 1581) and records `consent_at`. Puntos Honesty
  redemption at checkout uses the server-verified balance
  (`/api/loyalty/balance`) and is re-validated + debited at order creation.
  Contraentrega is not offered.
- The browser-local order store was removed; account order history comes from
  `GET /api/orders/mine` (session email match) and reorder flows re-fetch
  current published prices rather than trusting order snapshots.

### Honesty storefront rebrand

- Customer-facing UI, order/status emails, WhatsApp recovery copy, legal
  pages, and loyalty labels use the **Honesty** / **Club Honesty** /
  **Puntos Honesty** names. Visual identity is a royal-minimal light theme
  (white/near-black with restrained gold `#A98B5F`, Cormorant Garamond
  headings + Inter body, black pill CTAs).
- Legacy technical identifiers are kept deliberately for compatibility:
  `luzmagica-*` localStorage keys, `LM-` order references, `luzmagica.co`
  domain/env values, and real URLs are unchanged.
- Customer-facing coupons are `HONEST10` (10%), `VUELVE10` (10%), and
  `HONESTVIP15` (15%). `MAGIA10`, `RETORNO10`, and `LUZVIP15` remain valid
  as hidden compatibility aliases at identical rates — persisted carts and
  old links keep working; discount arithmetic is unchanged.
- Public catalog responses include `reviewsAvg`/`reviewsCount` aggregates
  computed from approved `product_reviews` rows only (paginated 1000-row
  windows; any query failure hides the summary). Review comments and
  reviewer PII are never exposed by the aggregate path.
- The cart drawer is a native `<dialog>` with focus trap via `showModal`,
  backdrop/Escape close, focus restoration, and scroll locking; quantity
  is clamped to `min(stock, 20)` server-side cap via
  `lib/cart/totals.ts` (`itemQuantityCap`).

### Local demo data cleanup

- Browser stores no longer ship demo orders, abandoned carts, operator tasks,
  loyalty history, or the demo customer profile. Persisted `luzmagica-*` keys are
  migrated in place (version 1): only exact seeded ids (`LM-8921`, `LM-9402`,
  `LM-9811`, `AB-3021`, `AB-2940`, `tsk-1`–`tsk-3`, `tx-1`–`tx-2`), seed product
  ids `1`–`8`, and the exact-match demo profile are removed; all other persisted
  data is preserved.

Authenticated browser flows, concurrent Postgres behavior, OAuth, and live
provider responses still require end-to-end validation. The pinned Supabase
packages are installed; TypeScript, lint, fixture tests, and the production
build pass.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
