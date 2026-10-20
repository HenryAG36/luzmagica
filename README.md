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

- **Mastershop** (the only importable supplier): configure `MASTERSHOP_API_KEY`
  (server-only); it is sent as the `ms-api-key` header to
  `https://prod.api.mastershop.com`. Contract verified against the official
  [Postman documentation](https://documenter.getpostman.com/view/33212980/2sB3WnxNAk):
  `POST /api/products/market?page={offset}&limit=20` for marketplace search
  (`page` is a **row offset** incremented by 20, body `{valueToSearch}` for a
  non-empty term or `{}` for an empty one, plain-array response),
  `GET /api/products/market/{id}` for the authoritative detail (always
  refetched — the summary `variantsCount` is not fulfillment truth), and
  `GET /api/products/{id}?includeAllVariations=true` for account membership
  (404 = product not in «Mis productos»). Your own product list may be empty
  until you add products to «Mis productos» in Mastershop — that is a setup
  state, not an outage. The collection also documents order endpoints
  (`POST /api/orders`, `GET /api/orders?externalOrderId=…`,
  `POST /api/orders/list`, `PUT /api/orders/{idOrder}`); only the COD create
  and lookup paths are wired today.
  **Capability boundary:** catalog search/detail is available, there is no
  documented external freight endpoint (shipping is confirmed manually per
  city before publish), and prepaid orders stay manual.

  **Contraentrega (feature-flagged, OFF by default):** set
  `MASTERSHOP_COD_ENABLED=true` plus `MASTERSHOP_API_KEY` to enable COD
  checkout for carts that are 100% Mastershop. Semantics:
  `POST /api/orders` registers the remote order in `Por Confirmar` — provider
  creation is **not** payment collection and **not** dispatch confirmation;
  an operator confirms the shipment inside Mastershop (no automatic guide or
  dispatch is promised). Local orders stay `cod_pending` and can never become
  `paid` from provider statuses alone — COD collection/settlement is verified
  manually (Mastershop `Entregada` only logs «recaudo sin verificar»).
  Remote `Cancelada` cancels the local order (authenticated polling is the
  proof); `Devuelta` parks the order in reconciliation, never auto-refunded.
  COD rejects coupons/loyalty points, requires a numeric CC document, a real
  department and an operator-registered `mastershop_weight` per product (the
  docs do not state the weight unit — copy the value Mastershop expects).
  Checkout creation is idempotent via `checkout_attempt_id` + the
  `create_cod_order` RPC (per-phone ≤3 COD orders/hour, atomic
  order/items/event insert). After any create attempt, retries are GET-only —
  an ambiguous POST is reconciled by lookup, never re-POSTed blindly.
  Webhooks are not registered (the docs lack origin verification and
  guaranteed payload semantics); tracking reconciles via authenticated
  polling on the daily cron + manual sync. **Wallet settlement is not
  implemented** — revenue summaries continue counting `paid` only.
- **Mercado Libre**: create a free app at developers.mercadolibre.com.co, set the
  redirect URI to `…/api/admin/providers/meli/callback`, then connect it from the
  Tendencias tab ("Conectar Mercado Libre"). Tokens are stored encrypted using
  `PROVIDER_TOKEN_ENCRYPTION_KEY`.
- **AliExpress Affiliate** *(research-only)*: create an app at open.aliexpress.com to obtain
  `ALIEXPRESS_APP_KEY` / `ALIEXPRESS_APP_SECRET` / `ALIEXPRESS_TRACKING_ID`.
  Verify Colombia (`ship_to_country=CO`) support and display/storage terms before
  enabling.
- **AliExpress Dropshipping (DS)** *(research-only)*: a separate app registration (not the
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
  DS product/freight lookup remains available for research and historical rows
  only — importing DS products is disabled by policy.
- **CJ Dropshipping** *(research-only)*: configure `CJ_API_KEY` (server-only). The token obtained
  from `authentication/getAccessToken` is stored encrypted under the provider
  lease and the trending product list (`product/listV2`) is refreshed at most
  once every 6 hours with a ≥1s gap between auth and list calls. `listedNum`
  is shown as the provider's listing count — it is not sales data.
  CJ product/stock/freight lookup remains available for research only —
  importing CJ products is disabled by policy.

`aliexpress`, `aliexpress_ds` and `cjdropshipping` are research-only sources
(`lib/suppliers/policy.ts`): their trend/statistics retrieval still works, but
import drafts, publication, checkout pricing and supplier placement reject
them in every direct path — including historical catalog rows and mixed carts.
Already-submitted tracking, refunds and claims remain functional.

Publishing (or saving edits to a published row) for `mastershop` products
requires a
confirmed customer shipping quote: `customer_shipping_cop` (explicit
non-negative integer — 0 only when free shipping is knowingly confirmed),
`shipping_estimate_city`, and `shipping_checked_at`. Mastershop has no
automatic shipping quote yet, so the operator confirms the cost manually before publish —
and the quote is only valid for the city it was confirmed for: checkout
compares the normalized destination city against `shipping_estimate_city` and
rejects the order when they differ. There is no automatic nationwide tariff.
The `published_products` view hides quoted-shipping rows missing these fields
until an admin corrects them in the operator **Productos** tab, which lists
every status and supports editing, archiving (rows are kept), and republishing.

Missing provider configuration disables only that source — the panel shows each
source's status and the age of the last successful snapshot. Snapshots refresh
automatically when an admin opens the panel if older than 6 hours; refreshes are
serialized across instances with database leases.

### Supplier import workflow (Mastershop)

The operator panel (`/operator`, tab *Tendencias*) splits into
**Descubrir** (loaded trend signals — research-only AliExpress Affiliate/DS, CJ,
MercadoLibre), **Importar** (Mastershop catalog
browse/search + server-verified
product preview + draft import), **Borradores** (draft review, edit, publish
gate) and **Conexiones** (provider status: Mastershop configured/verified,
plus research-only AliExpress/CJ and DS feed diagnostics).

- `GET /api/admin/suppliers/mastershop/products?query=&offset=` — server-side
  Mastershop marketplace search (`POST /api/products/market` upstream with
  `page` as a row offset and `limit=20`; `hasMore` follows the raw page size).
  Search terms accept Unicode letters, digits and spaces (≤120 chars).
- `GET /api/admin/suppliers/mastershop/status` — `{configured, country:"CO",
  catalog:true, automaticOrders:false, shippingQuotes:false, tracking:false,
  cashOnDelivery:false}`. `configured` only means `MASTERSHOP_API_KEY` is set;
  "Probar acceso" performs one catalog request and is the only path to an
  access-verified state.
- `POST /api/admin/suppliers/preview` — `{source:"mastershop", productId,
  variantId?}` refetches `GET /api/products/market/{id}` server-side: numeric
  id, `nameProduct` required, only literal `COP` currency accepted, variant
  prices/stock strictly from each variant (parent `providerPrice` is used only
  when `variants` is empty → `simple` variant), and duplicate/malformed
  variants invalidate the whole product. Preview ships no freight options and
  no FX; warnings make the pending shipping quote and manual fulfillment
  explicit (confirm city shipping and add the product to
  «Mis productos» before selling).
- `POST /api/admin/catalog/import-supplier` — refetches the provider product
  and builds the draft with `buildSupplierImport`; cost, stock, images and
  description always come from the provider response, never the client. Body
  keys are allowlisted: `source`, `productId`, `variantId`, `freightId`,
  `marginPercent` (15–50), and an optional explicit `priceCop` selling price.
  The draft stores `supplier_variant = {product_id, variation_id, …}` plus the
  recommended `suggested_price`. Duplicates return `{created:false}` without
  overwriting operator edits.
- `POST /api/admin/catalog/[id]/supplier-sync` — manual "Actualizar costo y
  stock" re-query for imported local-supplier rows. Requires `expectedUpdatedAt`
  (optimistic concurrency), refuses archived/manual/research rows and
  unverifiable stock/cost, verifies returned product/variant identity, and only
  updates `stock`, `listing_*`, `supplier_cost_cop` and the `supplier_variant`
  snapshot — never the copy, images, sale price, shipping or publish state. No
  automatic repricing or cron.
- Legacy `POST /api/admin/catalog` remains only for MercadoLibre reference
  drafts; it rejects `aliexpress`, `aliexpress_ds`, `cjdropshipping` (research
  only), `mastershop` (must go through `import-supplier`) and any other
  source.

**Local-supplier fulfillment boundary:** paid orders containing research-only
or prepaid Mastershop items are marked `supplier_order_status='failed'` with an
explicit manual-handling message and `auto_fulfill_attempts=3` so the retry
cron leaves them alone. `placeSupplierOrder` returns the manual-fulfillment
message without any provider call for research/prepaid items — there is no
verified automatic prepaid-dispatch API for Mastershop, so none is
implemented. The only automated supplier path is Mastershop COD
(`cash_on_delivery` + all-Mastershop items + `MASTERSHOP_COD_ENABLED`),
handled by the dedicated contraentrega flow described above; wallet
settlement/recaudo reconciliation is **not** implemented — collection is
verified manually.

### Currency conversion (import-time FX + manual review)

Mastershop prices are already COP — no FX is involved in Mastershop
previews/imports.
Legacy USD-based provider helpers still fetch the USD→COP rate from
[ExchangeRate-API](https://www.exchangerate-api.com) (`open.er-api.com`, 8s
timeout, 6h cache, rates older than 72h rejected) for research previews only.
If the rate is unavailable, converted cost/shipping stay `null` — no hardcoded
fallback.

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

**Pending migrations (apply in this order, before enabling COD):**
1. `supabase/migrations/20261019120000_local_sourcing_policy.sql` (prepared,
   **not yet applied**) recreates the `published_products` view to exclude
   research-only sources and require the Mastershop quote fields.
2. `supabase/migrations/20261020130000_mastershop_cod.sql` (prepared, **not
   yet applied**) adds `payment_method`/`checkout_attempt_id`/`mastershop_status`
   + COD consistency checks, the `cash_on_delivery_eligible` view flag and the
   atomic `create_cod_order` RPC (service-role-only execute).

The app-level policy already fails closed, but the view guard is the last line
of defense for public reads; COD checkout also requires
`MASTERSHOP_COD_ENABLED=true` after the migrations are verified.

### Orders and payments (Wompi)

- Checkout submits item ids + quantities + customer fields to `POST /api/orders`.
  The server reloads the catalog and recomputes every price, discount, and
  shipping amount — client totals are informational only. Prepaid orders are
  created as `pending_payment` and the customer is redirected to a single-use
  Wompi payment link; Mastershop-only carts may instead choose contraentrega
  (feature-flagged, see the Mastershop section) which creates a `cod_pending`
  order without any Wompi link or charge.
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
  Coupons and points apply to online payment only — contraentrega rejects
  them, and its collection is verified outside this app (the order stays
  `cod_pending` and is never counted as revenue).
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
