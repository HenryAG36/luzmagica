update public.catalog_products
set status='archived',updated_at=now()
where source='seed'
  and id in ('1','2','3','4','5','6','7','8');
