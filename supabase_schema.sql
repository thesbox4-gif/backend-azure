-- ============================================================
-- NanaBanana — Supabase Database Schema
-- Run in: Supabase SQL Editor
-- Idempotent: safe to run repeatedly on a new OR existing database.
-- No data is dropped. To wipe everything first, see the note at the bottom.
-- ============================================================

create extension if not exists "uuid-ossp";

-- ── Enum types ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('admin', 'employee', 'customer');
  end if;
  if not exists (select 1 from pg_type where typname = 'employee_status') then
    create type employee_status as enum ('pending', 'approved', 'rejected');
  end if;
  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum ('placed', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');
  end if;
  if not exists (select 1 from pg_type where typname = 'product_type') then
    create type product_type as enum ('saree', 'jewellery');
  end if;
end $$;

-- Migrate legacy product_type values on pre-existing databases.
-- 'dress' has been retired; any existing dress rows are remapped to 'saree'
-- so the value can no longer be selected from the apps.
do $$
begin
  if exists (select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
             where t.typname = 'product_type' and e.enumlabel = 'banana') then
    alter type product_type rename value 'banana' to 'saree';
  end if;
  if exists (select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
             where t.typname = 'product_type' and e.enumlabel = 'gold') then
    alter type product_type rename value 'gold' to 'jewellery';
  end if;
  if exists (select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
             where t.typname = 'product_type' and e.enumlabel = 'dress') then
    update products set type = 'saree' where type::text = 'dress';
  end if;
end $$;

-- ── Profiles extends auth.users ──────────────────────────────────────────────
create table if not exists profiles (
  id              uuid references auth.users(id) on delete cascade primary key,
  name            text not null,
  phone           text,
  role            user_role default 'customer',
  employee_status employee_status,
  fcm_token       text,
  whatsapp        text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_profiles_role on profiles(role);
create index if not exists idx_profiles_employee_status on profiles(employee_status) where employee_status is not null;

-- Auto-create profile on Supabase signup.
-- search_path is pinned, the insert is idempotent, and any failure is swallowed
-- so a profile-row problem can never abort auth sign-up itself.
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, name, phone, role, employee_status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'User'),
    new.raw_user_meta_data->>'phone',
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'customer'),
    case when new.raw_user_meta_data->>'role' = 'employee'
         then 'pending'::employee_status else null end
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── Categories ───────────────────────────────────────────────────────────────
create table if not exists categories (
  id          uuid default uuid_generate_v4() primary key,
  name        text not null,
  slug        text unique not null,
  description text,
  image_url   text,
  parent_id   uuid references categories(id) on delete cascade,
  created_at  timestamptz default now()
);

-- Add parent_id on databases created before category hierarchy existed.
alter table categories add column if not exists parent_id uuid
  references categories(id) on delete cascade;

create index if not exists idx_categories_slug on categories(slug);
create index if not exists idx_categories_parent on categories(parent_id);

-- The 3 product types are modelled as top-level categories (parent_id is null).
-- Real categories are nested under these via parent_id. Slugs MUST match the
-- product_type enum values so the apps can map a type to its root category.
insert into categories (name, slug)
values ('Sarees', 'saree'), ('Jewellery', 'jewellery')
on conflict (slug) do nothing;

-- Retire the legacy 'Dresses' top-level category if it exists.
delete from categories where slug = 'dress' and parent_id is null;

-- ── Products ─────────────────────────────────────────────────────────────────
create table if not exists products (
  id            uuid default uuid_generate_v4() primary key,
  title         text not null,
  description   text,
  type          product_type not null,
  category_id   uuid references categories(id) on delete set null,
  base_price    numeric(10,2) not null check (base_price > 0),
  discount_pct  numeric(5,2) default 0 check (discount_pct >= 0 and discount_pct <= 100),
  coupon_code   text,
  coupon_disc   numeric(5,2),
  published     boolean default false,
  created_by    uuid references profiles(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists idx_products_published on products(published);
create index if not exists idx_products_type on products(type);
create index if not exists idx_products_category on products(category_id);
create index if not exists idx_products_created_at on products(created_at desc);
create index if not exists idx_products_title_search on products using gin(to_tsvector('english', title));

-- ── Product images ────────────────────────────────────────────────────────────
create table if not exists product_images (
  id            uuid default uuid_generate_v4() primary key,
  product_id    uuid references products(id) on delete cascade,
  url           text not null,
  alt_text      text,
  is_primary    boolean default false,
  color         text,
  display_order int default 0
);

create index if not exists idx_product_images_product on product_images(product_id);

-- ── Variants ─────────────────────────────────────────────────────────────────
create table if not exists variants (
  id          uuid default uuid_generate_v4() primary key,
  product_id  uuid references products(id) on delete cascade,
  color       text,
  size        text,
  quantity    int default 0 check (quantity >= 0),
  sold_count  int default 0 check (sold_count >= 0),
  sku         text unique,
  image_url   text,
  created_at  timestamptz default now()
);

create index if not exists idx_variants_product on variants(product_id);
create index if not exists idx_variants_sku on variants(sku);
create index if not exists idx_variants_low_stock on variants(quantity) where quantity < 5;

-- ── Addresses ────────────────────────────────────────────────────────────────
create table if not exists addresses (
  id         uuid default uuid_generate_v4() primary key,
  user_id    uuid references profiles(id) on delete cascade,
  line1      text not null,
  line2      text,
  city       text not null,
  state      text not null,
  pincode    text not null,
  country    text default 'India',
  is_default boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_addresses_user on addresses(user_id);

-- ── Orders ────────────────────────────────────────────────────────────────────
create table if not exists orders (
  id                  uuid default uuid_generate_v4() primary key,
  user_id             uuid references profiles(id),
  address_id          uuid references addresses(id),
  status              order_status default 'placed',
  total_amount        numeric(10,2) not null,
  discount_amount     numeric(10,2) default 0,
  coupon_applied      text,
  razorpay_order_id   text,
  razorpay_payment_id text,
  refund_status       text,
  refund_reason       text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Customer refund requests: refund_status is null / 'requested' / 'completed'.
alter table orders add column if not exists refund_status text;
alter table orders add column if not exists refund_reason text;

-- Shiprocket shipment fields
alter table orders add column if not exists shiprocket_order_id     text;
alter table orders add column if not exists shiprocket_shipment_id  text;
alter table orders add column if not exists shiprocket_awb          text;
alter table orders add column if not exists shiprocket_courier_id   int;
alter table orders add column if not exists shiprocket_courier_name text;
alter table orders add column if not exists tracking_url            text;
alter table orders add column if not exists shipment_status         text;
alter table orders add column if not exists expected_delivery_date  date;
alter table orders add column if not exists label_url               text;
alter table orders add column if not exists invoice_url             text;
alter table orders add column if not exists manifest_url            text;

create index if not exists idx_orders_user on orders(user_id);
create index if not exists idx_orders_awb on orders(shiprocket_awb);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_created_at on orders(created_at desc);

-- ── Order items ───────────────────────────────────────────────────────────────
create table if not exists order_items (
  id         uuid default uuid_generate_v4() primary key,
  order_id   uuid references orders(id) on delete cascade,
  product_id uuid references products(id),
  variant_id uuid references variants(id),
  quantity   int not null check (quantity > 0),
  unit_price numeric(10,2) not null
);

create index if not exists idx_order_items_order on order_items(order_id);

-- ── Cart items ────────────────────────────────────────────────────────────────
create table if not exists cart_items (
  id         uuid default uuid_generate_v4() primary key,
  user_id    uuid references profiles(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  variant_id uuid references variants(id) on delete cascade,
  quantity   int default 1 check (quantity > 0),
  created_at timestamptz default now(),
  unique(user_id, variant_id)
);

create index if not exists idx_cart_user on cart_items(user_id);

-- ── Wishlist items ────────────────────────────────────────────────────────────
create table if not exists wishlist_items (
  id         uuid default uuid_generate_v4() primary key,
  user_id    uuid references profiles(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, product_id)
);

create index if not exists idx_wishlist_user on wishlist_items(user_id);

-- ── Coupons ───────────────────────────────────────────────────────────────────
create table if not exists coupons (
  id           uuid default uuid_generate_v4() primary key,
  code         text unique not null,
  discount_pct numeric(5,2) not null,
  max_uses     int,
  used_count   int default 0,
  starts_at    timestamptz,
  expires_at   timestamptz,
  category_id  uuid references categories(id) on delete set null,
  product_id   uuid references products(id) on delete set null,
  active       boolean default true,
  created_at   timestamptz default now()
);

-- Coupon validity window + scope (category/sub-category or a single product).
alter table coupons add column if not exists starts_at   timestamptz;
alter table coupons add column if not exists category_id uuid references categories(id) on delete set null;
alter table coupons add column if not exists product_id  uuid references products(id) on delete set null;

create index if not exists idx_coupons_code on coupons(code);
create index if not exists idx_coupons_active on coupons(active) where active = true;

-- ── Offline sales (employee "mark as sold") ──────────────────────────────────
create table if not exists offline_sales (
  id             uuid default uuid_generate_v4() primary key,
  variant_id     uuid references variants(id) on delete set null,
  product_id     uuid references products(id) on delete set null,
  sold_by        uuid references profiles(id),
  quantity       int not null check (quantity > 0),
  unit_price     numeric(10,2) not null,
  customer_name  text,
  customer_phone text,
  created_at     timestamptz default now()
);

-- Walk-in customer details, captured at the point of sale.
alter table offline_sales add column if not exists customer_name  text;
alter table offline_sales add column if not exists customer_phone text;

create index if not exists idx_offline_sales_sold_by on offline_sales(sold_by);
create index if not exists idx_offline_sales_created_at on offline_sales(created_at desc);

-- ── In-app notifications ──────────────────────────────────────────────────────
create table if not exists notifications (
  id         uuid default uuid_generate_v4() primary key,
  user_id    uuid references profiles(id) on delete cascade,
  title      text not null,
  body       text not null,
  read       boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_notifications_user_unread on notifications(user_id, read) where read = false;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Service role (used by backend) bypasses RLS automatically.
alter table profiles       enable row level security;
alter table cart_items     enable row level security;
alter table wishlist_items enable row level security;
alter table orders         enable row level security;
alter table addresses      enable row level security;
alter table notifications  enable row level security;

-- ── Storage buckets ───────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('category-images', 'category-images', true) on conflict do nothing;

drop policy if exists "Public read product images" on storage.objects;
create policy "Public read product images"
  on storage.objects for select using (bucket_id = 'product-images');

drop policy if exists "Public read category images" on storage.objects;
create policy "Public read category images"
  on storage.objects for select using (bucket_id = 'category-images');

-- ── RPC functions ─────────────────────────────────────────────────────────────

-- Atomic stock decrement (prevents race conditions at scale)
create or replace function decrement_variant_stock(variant_id uuid, qty int)
returns void as $$
begin
  update variants
  set quantity   = greatest(quantity - qty, 0),
      sold_count = sold_count + qty
  where id = variant_id;
end;
$$ language plpgsql security definer;

-- Daily revenue for last 30 days (analytics chart)
create or replace function daily_sales_last_30_days()
returns table(date text, revenue numeric) as $$
  select
    to_char(date_trunc('day', created_at), 'DD/MM') as date,
    sum(total_amount) as revenue
  from orders
  where created_at >= now() - interval '30 days'
    and status != 'cancelled'
  group by date_trunc('day', created_at)
  order by date_trunc('day', created_at);
$$ language sql security definer;

-- Increment coupon usage count
create or replace function increment_coupon_usage(code text)
returns void as $$
  update coupons set used_count = used_count + 1 where coupons.code = increment_coupon_usage.code;
$$ language sql security definer;

-- Super admin + AI quota: see supabase_migrations/superadmin_ai_quota.sql

-- ============================================================
-- Optional clean slate — DESTRUCTIVE, deletes ALL data.
-- Only run this block (then re-run the schema above) if you want a
-- completely fresh database:
--
--   drop schema public cascade;
--   create schema public;
--   grant usage on schema public to anon, authenticated, service_role;
--   grant all on schema public to anon, authenticated, service_role;
-- ============================================================
