do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quotes'
      and column_name = 'oasis_fee'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quotes'
      and column_name = 'universa_fee'
  ) then
    alter table public.quotes rename column oasis_fee to universa_fee;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quotes'
      and column_name = 'oasis_fee_bps'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quotes'
      and column_name = 'universa_fee_bps'
  ) then
    alter table public.quotes rename column oasis_fee_bps to universa_fee_bps;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transfers'
      and column_name = 'oasis_fee'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transfers'
      and column_name = 'universa_fee'
  ) then
    alter table public.transfers rename column oasis_fee to universa_fee;
  end if;
end $$;
