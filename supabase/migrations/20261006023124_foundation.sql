create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text,
    name text not null default '',
    phone text not null default '',
    cedula text not null default '',
    address text not null default '',
    city text not null default '',
    department text,
    referral_code text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    role text not null check (role in ('customer', 'admin')),
    granted_by uuid references auth.users(id),
    created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.user_roles
        where user_id = auth.uid() and role = 'admin'
    );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, name, phone, cedula, address, city, department, referral_code)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'name', ''),
        coalesce(new.raw_user_meta_data ->> 'phone', ''),
        coalesce(new.raw_user_meta_data ->> 'cedula', ''),
        coalesce(new.raw_user_meta_data ->> 'address', ''),
        coalesce(new.raw_user_meta_data ->> 'city', ''),
        new.raw_user_meta_data ->> 'department',
        new.raw_user_meta_data ->> 'referral_code'
    )
    on conflict (id) do nothing;

    insert into public.user_roles (user_id, role)
    values (new.id, 'customer')
    on conflict (user_id) do nothing;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

create or replace function public.prevent_last_admin_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform pg_advisory_xact_lock(765225);
    if old.role = 'admin' and (TG_OP = 'DELETE' or new.role <> 'admin')
       and (select count(*) from public.user_roles where role = 'admin' and user_id <> old.user_id) = 0 then
        raise exception 'cannot remove the last administrator';
    end if;
    if TG_OP = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_prevent_last_admin on public.user_roles;
create trigger trg_prevent_last_admin
    before delete or update of role on public.user_roles
    for each row execute function public.prevent_last_admin_removal();

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
    for select using (auth.uid() = id or public.is_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
    for update using (auth.uid() = id)
    with check (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
    for insert with check (auth.uid() = id);

drop policy if exists user_roles_select_own on public.user_roles;
create policy user_roles_select_own on public.user_roles
    for select using (auth.uid() = user_id or public.is_admin());
