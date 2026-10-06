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
`cjdropshipping`).
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
  in the public view; carts sum the per-unit estimate and checkout is blocked
  while a DS item has no quote. Checkout remains a demo order flow with no
  automated fulfillment. When connected, the DS app also feeds a "bestseller
  feed" supplier signal (provider-reported order, sales period unverified) via
  `aliexpress.ds.feed.itemids.get`.
- **CJ Dropshipping**: configure `CJ_API_KEY` (server-only). The token obtained
  from `authentication/getAccessToken` is stored encrypted under the provider
  lease and the trending product list (`product/listV2`) is refreshed at most
  once every 6 hours with a ≥1s gap between auth and list calls. `listedNum`
  is shown as the provider's listing count — it is not sales data.

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
eight published seed products. The `20261006190950_ds_shipping` and
`20261006190956_discovery_providers` migrations are also applied — public
customer-shipping fields and supplier-private grants are verified remotely.
Authenticated browser flows, concurrent Postgres
behavior, OAuth, and live provider responses still require end-to-end validation.
The pinned Supabase packages are installed; TypeScript, lint, 120 fixture tests,
and the production build pass.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
