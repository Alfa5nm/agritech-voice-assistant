alter table public.agritech_cases add column profile_id uuid;
alter table public.agritech_cases add foreign key(profile_id,owner_id) references public.agritech_profiles(id,owner_id) deferrable initially deferred;
create index agritech_case_profile on public.agritech_cases(owner_id,profile_id);
create or replace function public.agritech_commit_case(p_case_id uuid,p_expected_version integer,p_event_key text,p_event_type text,p_version integer,p_status text,p_payload text,p_profile_id uuid,p_profile_payload text,p_phone_hash text,p_phone_cipher text,p_plot_id uuid default null,p_plot_payload text default null,p_cycle_id uuid default null,p_cycle_payload text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare current_version integer;
begin
  select version into current_version from public.agritech_cases where id=p_case_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Case unavailable'; end if;
  if exists(select 1 from public.agritech_case_events where case_id=p_case_id and event_key=p_event_key) then return; end if;
  if current_version<>p_expected_version or p_version<>p_expected_version+1 then raise exception 'Stale case version'; end if;
  update public.agritech_cases set version=p_version,status=p_status,payload=p_payload,profile_id=p_profile_id,updated_at=now() where id=p_case_id and owner_id=auth.uid();
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
