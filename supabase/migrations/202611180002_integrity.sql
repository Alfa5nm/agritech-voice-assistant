alter table public.agritech_profiles add unique(id,owner_id);
alter table public.agritech_plots add unique(id,owner_id);
alter table public.agritech_phone_links add foreign key(profile_id,owner_id) references public.agritech_profiles(id,owner_id);
alter table public.agritech_plots add foreign key(profile_id,owner_id) references public.agritech_profiles(id,owner_id);
alter table public.agritech_crop_cycles add foreign key(plot_id,owner_id) references public.agritech_plots(id,owner_id);

create policy document_update on public.agritech_documents for update to authenticated using(public.agritech_is_operator()) with check(public.agritech_is_operator());
create function public.agritech_document_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  if (new.id,new.source_id,new.url,new.content_hash,new.version) is distinct from (old.id,old.source_id,old.url,old.content_hash,old.version) then raise exception 'Source versions are immutable'; end if;
  return new;
end $$;
create trigger document_immutable before update on public.agritech_documents for each row execute function public.agritech_document_immutable();

drop policy chunk_review on public.agritech_chunks;
create policy chunk_update on public.agritech_chunks for update to authenticated using(public.agritech_is_operator()) with check(public.agritech_is_operator());
create function public.agritech_chunk_integrity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (new.id,new.document_id,new.text,new.page,new.section) is distinct from (old.id,old.document_id,old.text,old.page,old.section) then raise exception 'Create a new immutable passage version'; end if;
  if (new.review_status,new.approved_by,new.approved_at,new.review_note,new.crop,new.stage,new.district,new.valid_from,new.valid_until) is distinct from (old.review_status,old.approved_by,old.approved_at,old.review_note,old.crop,old.stage,old.district,old.valid_from,old.valid_until) then
    if not public.agritech_is_reviewer() then raise exception 'Agronomy reviewer required'; end if;
    if new.approved_by is distinct from auth.uid() or new.approved_at is null or length(trim(new.review_note))<10 then raise exception 'Reviewer identity and rationale required'; end if;
    if new.review_status='APPROVED' and not exists(select 1 from public.agritech_documents d join public.agritech_sources s on s.id=d.source_id where d.id=new.document_id and s.reuse_status='permitted' and length(trim(s.reuse_basis))>0) then raise exception 'Source reuse permission required'; end if;
    insert into public.agritech_reviews(chunk_id,reviewer_id,status,note) values(new.id,auth.uid(),new.review_status,new.review_note);
  end if;
  return new;
end $$;
create trigger chunk_integrity before update on public.agritech_chunks for each row execute function public.agritech_chunk_integrity();
create or replace function public.agritech_review_chunk(p_id text,p_status text,p_note text,p_crop text,p_stage text,p_district text,p_valid_until timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if not public.agritech_is_reviewer() or p_status not in ('APPROVED','REVOKED') or length(trim(p_note))<10 then raise exception 'Reviewed decision required'; end if;
  update public.agritech_chunks set review_status=p_status,review_note=p_note,approved_by=auth.uid(),approved_at=now(),crop=p_crop,stage=p_stage,district=p_district,valid_until=p_valid_until where id=p_id;
  if not found then raise exception 'Chunk unavailable'; end if;
end $$;

create function public.agritech_set_embedding(p_id text,p_embedding extensions.vector(768),p_model text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_model<>'gemini-embedding-001' then raise exception 'Embedding model mismatch'; end if;
  update public.agritech_chunks set embedding=p_embedding,embedding_model=p_model where id=p_id;
  if not found then raise exception 'Passage unavailable'; end if;
end $$;
revoke all on function public.agritech_set_embedding from public,anon;
grant execute on function public.agritech_set_embedding to authenticated;

drop function public.agritech_commit_case(uuid,integer,text,text,integer,text,text,uuid,text,text,text);
create function public.agritech_commit_case(p_case_id uuid,p_expected_version integer,p_event_key text,p_event_type text,p_version integer,p_status text,p_payload text,p_profile_id uuid,p_profile_payload text,p_phone_hash text,p_phone_cipher text,p_plot_id uuid default null,p_plot_payload text default null,p_cycle_id uuid default null,p_cycle_payload text default null)
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
    insert into public.agritech_profiles values(p_profile_id,auth.uid(),p_profile_payload,now()) on conflict(id) do update set payload=excluded.payload,updated_at=now() where agritech_profiles.owner_id=auth.uid();
    delete from public.agritech_phone_links where profile_id=p_profile_id and owner_id=auth.uid() and phone_hash<>p_phone_hash;
    insert into public.agritech_phone_links values(p_profile_id,auth.uid(),p_phone_hash,p_phone_cipher) on conflict(profile_id,phone_hash) do nothing;
    if p_plot_id is not null then
      insert into public.agritech_plots values(p_plot_id,p_profile_id,auth.uid(),p_plot_payload) on conflict(id) do update set payload=excluded.payload where agritech_plots.owner_id=auth.uid();
      if p_cycle_id is not null then
        insert into public.agritech_crop_cycles values(p_cycle_id,p_plot_id,auth.uid(),p_cycle_payload) on conflict(id) do update set payload=excluded.payload where agritech_crop_cycles.owner_id=auth.uid();
      end if;
    end if;
  end if;
end $$;
revoke all on function public.agritech_commit_case from public,anon;
grant execute on function public.agritech_commit_case to authenticated;
