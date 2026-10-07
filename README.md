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

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

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
timeline), and `payment_events` (provider webhook audit + dedupe). All four
tables are RLS-enabled with no public policies: every read/write goes
through the service role, guest lookup requires the order reference plus the
purchase phone/email (or the unguessable `lookup_token`), and admin access
uses the `user_roles` check.
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

### Currency conversion (manual FX review)

Imported products keep their original `listing_currency`. The draft `fx_rate` /
`fx_rate_date` fields record the conversion the reviewer used; there is no live
FX feed. Reviewers must enter a current rate and date manually before publishing.

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
connections, and snapshots are unaffected.

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
  (`/legal/privacidad`, Ley 1581) and records `consent_at`. LuzPoints
  redemption is disabled at checkout — balances live in browser state and
  cannot be verified server-side. Contraentrega is not offered.
- The browser-local order store was removed; account order history comes from
  `GET /api/orders/mine` (session email match) and reorder flows re-fetch
  current published prices rather than trusting order snapshots.

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
