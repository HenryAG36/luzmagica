-- Order tables hold customer PII and supplier-private data: deny direct
-- table access to client-facing roles entirely. RLS is already enabled with
-- no policies; this removes the default table grants as well. All access
-- flows through the service role (which bypasses RLS).
revoke all on public.orders from anon, authenticated;
revoke all on public.order_items from anon, authenticated;
revoke all on public.order_events from anon, authenticated;
revoke all on public.payment_events from anon, authenticated;
