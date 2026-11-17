create extension if not exists vector with schema extensions;

create table public.agritech_operators (
  email text primary key check(email=lower(email)),
  can_review boolean not null default false
);
alter table public.agritech_operators enable row level security;
create policy own_operator on public.agritech_operators for select to authenticated using (email=lower(auth.jwt()->>'email'));

create function public.agritech_is_operator() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.agritech_operators where email=lower(auth.jwt()->>'email'));
$$;
create function public.agritech_is_reviewer() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.agritech_operators where email=lower(auth.jwt()->>'email') and can_review);
$$;
revoke all on function public.agritech_is_operator(), public.agritech_is_reviewer() from public, anon;
grant execute on function public.agritech_is_operator(), public.agritech_is_reviewer() to authenticated;

create table public.agritech_profiles (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  payload text not null,
  updated_at timestamptz not null default now()
);
create table public.agritech_phone_links (
  profile_id uuid not null references public.agritech_profiles(id),
  owner_id uuid not null references auth.users(id),
  phone_hash text not null check(length(phone_hash)=64),
  phone_cipher text not null,
  primary key(profile_id,phone_hash)
);
create index agritech_phone_lookup on public.agritech_phone_links(owner_id,phone_hash);
create table public.agritech_plots (
  id uuid primary key default gen_random_uuid(),profile_id uuid not null references public.agritech_profiles(id),
  owner_id uuid not null references auth.users(id),payload text not null
);
create table public.agritech_crop_cycles (
  id uuid primary key default gen_random_uuid(),plot_id uuid not null references public.agritech_plots(id),
  owner_id uuid not null references auth.users(id),payload text not null
);
create table public.agritech_cases (
  id uuid primary key,owner_id uuid not null references auth.users(id),
  version integer not null default 0,status text not null check(status in ('INCOMPLETE','COLLECTING','REFERRED','CLOSED')),
  payload text not null,updated_at timestamptz not null default now()
);
create index agritech_case_owner on public.agritech_cases(owner_id,updated_at desc);
create table public.agritech_case_events (
  case_id uuid not null references public.agritech_cases(id),owner_id uuid not null references auth.users(id),
  event_key text not null,event_type text not null,version integer not null,created_at timestamptz not null default now(),
  primary key(case_id,event_key)
);
do $$ declare t text; begin
  foreach t in array array['agritech_profiles','agritech_phone_links','agritech_plots','agritech_crop_cycles','agritech_cases','agritech_case_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy owner_only on public.%I for all to authenticated using (owner_id=auth.uid() and public.agritech_is_operator()) with check (owner_id=auth.uid() and public.agritech_is_operator())',t);
  end loop;
end $$;

create function public.agritech_commit_case(p_case_id uuid,p_expected_version integer,p_event_key text,p_event_type text,p_version integer,p_status text,p_payload text,p_profile_id uuid,p_profile_payload text,p_phone_hash text,p_phone_cipher text)
returns void language plpgsql security invoker set search_path='' as $$
declare current_version integer;
begin
  select version into current_version from public.agritech_cases where id=p_case_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Case unavailable'; end if;
  if exists(select 1 from public.agritech_case_events where case_id=p_case_id and event_key=p_event_key) then return; end if;
  if current_version<>p_expected_version or p_version<>p_expected_version+1 then raise exception 'Stale case version'; end if;
  update public.agritech_cases set version=p_version,status=p_status,payload=p_payload,updated_at=now() where id=p_case_id and owner_id=auth.uid();
  insert into public.agritech_case_events values(p_case_id,auth.uid(),p_event_key,p_event_type,p_version,now());
  if p_profile_id is not null then
    insert into public.agritech_profiles values(p_profile_id,auth.uid(),p_profile_payload,now())
      on conflict(id) do update set payload=excluded.payload,updated_at=now() where agritech_profiles.owner_id=auth.uid();
    delete from public.agritech_phone_links where profile_id=p_profile_id and owner_id=auth.uid() and phone_hash<>p_phone_hash;
    insert into public.agritech_phone_links values(p_profile_id,auth.uid(),p_phone_hash,p_phone_cipher) on conflict(profile_id,phone_hash) do nothing;
  end if;
end $$;
revoke all on function public.agritech_commit_case from public,anon;
grant execute on function public.agritech_commit_case to authenticated;

create table public.agritech_sources (
  id text primary key,publisher text not null,url text not null,allowed_hosts text[] not null,
  reuse_status text not null default 'unknown' check(reuse_status in ('unknown','permitted','restricted')),
  reuse_basis text,updated_at timestamptz not null default now()
);
create table public.agritech_documents (
  id text primary key,source_id text not null references public.agritech_sources(id),url text not null,
  title text not null,language text not null default 'bn',published_at timestamptz,retrieved_at timestamptz not null,
  content_hash text,extraction_status text not null,version text not null,metadata jsonb not null default '{}',
  unique(source_id,url,version)
);
create table public.agritech_chunks (
  id text primary key,document_id text not null references public.agritech_documents(id),
  text text not null,page integer,section text,crop text,stage text,district text,
  valid_from timestamptz,valid_until timestamptz,embedding extensions.vector(768),embedding_model text,
  review_status text not null default 'PENDING' check(review_status in ('PENDING','APPROVED','REVOKED')),
  approved_by uuid references auth.users(id),approved_at timestamptz,review_note text,
  check(review_status<>'APPROVED' or (approved_by is not null and approved_at is not null and crop is not null and review_note is not null))
);
create table public.agritech_reviews (
  id bigint generated always as identity primary key,chunk_id text not null references public.agritech_chunks(id),
  reviewer_id uuid not null references auth.users(id),status text not null,note text not null,created_at timestamptz not null default now()
);
create index agritech_document_source on public.agritech_documents(source_id);
create index agritech_chunk_document on public.agritech_chunks(document_id);
create index agritech_chunk_reviewer on public.agritech_chunks(approved_by);
create index agritech_review_chunk on public.agritech_reviews(chunk_id);
create index agritech_review_user on public.agritech_reviews(reviewer_id);
do $$ declare t text; begin
  foreach t in array array['agritech_sources','agritech_documents','agritech_chunks','agritech_reviews'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy operator_read on public.%I for select to authenticated using (public.agritech_is_operator())',t);
  end loop;
end $$;
create policy source_write on public.agritech_sources for all to authenticated using(public.agritech_is_operator()) with check(public.agritech_is_operator());
create policy document_write on public.agritech_documents for insert to authenticated with check(public.agritech_is_operator());
create policy chunk_insert on public.agritech_chunks for insert to authenticated with check(public.agritech_is_operator() and review_status='PENDING' and approved_by is null and approved_at is null);
create policy chunk_review on public.agritech_chunks for update to authenticated using(public.agritech_is_reviewer()) with check(public.agritech_is_reviewer());
create policy review_write on public.agritech_reviews for insert to authenticated with check(public.agritech_is_reviewer() and reviewer_id=auth.uid());

create function public.agritech_review_chunk(p_id text,p_status text,p_note text,p_crop text,p_stage text,p_district text,p_valid_until timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if not public.agritech_is_reviewer() or p_status not in ('APPROVED','REVOKED') or length(trim(p_note))<10 then raise exception 'Reviewed decision required'; end if;
  if p_status='APPROVED' and not exists(select 1 from public.agritech_chunks c join public.agritech_documents d on d.id=c.document_id join public.agritech_sources s on s.id=d.source_id where c.id=p_id and s.reuse_status='permitted' and length(trim(s.reuse_basis))>0) then raise exception 'Source reuse permission required'; end if;
  update public.agritech_chunks set review_status=p_status,review_note=p_note,approved_by=auth.uid(),approved_at=now(),crop=p_crop,stage=p_stage,district=p_district,valid_until=p_valid_until where id=p_id;
  if not found then raise exception 'Chunk unavailable'; end if;
  insert into public.agritech_reviews(chunk_id,reviewer_id,status,note) values(p_id,auth.uid(),p_status,p_note);
end $$;
revoke all on function public.agritech_review_chunk from public,anon;
grant execute on function public.agritech_review_chunk to authenticated;

create function public.agritech_search(p_query text,p_embedding extensions.vector(768),p_crop text,p_stage text,p_district text,p_research boolean default false)
returns table(id text,text text,document_id text,url text,title text,page integer,section text,review_status text,score double precision)
language sql stable security invoker set search_path='' as $$
 select c.id,c.text,d.id,d.url,d.title,c.page,c.section,c.review_status,
   (case when p_embedding is null or c.embedding is null then 0 else 1-(c.embedding OPERATOR(extensions.<=>) p_embedding) end
   +ts_rank_cd(to_tsvector('simple',c.text),websearch_to_tsquery('simple',left(p_query,1000))))::double precision as score
 from public.agritech_chunks c join public.agritech_documents d on d.id=c.document_id join public.agritech_sources s on s.id=d.source_id
 where public.agritech_is_operator() and s.reuse_status='permitted'
   and (p_research or (c.review_status='APPROVED' and c.crop=p_crop and (c.stage is null or c.stage=p_stage) and (c.district is null or c.district=p_district)
     and (c.valid_from is null or c.valid_from<=now()) and (c.valid_until is null or c.valid_until>now())))
   and (p_embedding is not null or to_tsvector('simple',c.text)@@websearch_to_tsquery('simple',left(p_query,1000)))
 order by score desc,c.id limit 5;
$$;
revoke all on function public.agritech_search from public,anon;
grant execute on function public.agritech_search to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('agritech-sources','agritech-sources',false,20971520,array['application/pdf','text/html','text/plain']) on conflict(id) do nothing;
create policy agritech_source_storage on storage.objects for all to authenticated using(bucket_id='agritech-sources' and public.agritech_is_operator()) with check(bucket_id='agritech-sources' and public.agritech_is_operator());
