alter function public.agritech_is_operator() security invoker;
alter function public.agritech_is_reviewer() security invoker;

create function public.agritech_coverage() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
   'publishers',(select count(*) from public.agritech_sources),
   'documents',(select count(*) from public.agritech_documents),
   'passages',(select count(*) from public.agritech_chunks),
   'approvedPassages',(select count(*) from public.agritech_chunks where review_status='APPROVED'),
   'byPublisher',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select s.id,s.publisher,s.reuse_status,count(d.id) as documents from public.agritech_sources s left join public.agritech_documents d on d.source_id=s.id group by s.id order by s.id) x),
   'byExtractionStatus',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select extraction_status,count(*) as documents from public.agritech_documents group by extraction_status) x),
   'byCropAndDistrict',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select crop,district,review_status,count(*) as passages from public.agritech_chunks group by crop,district,review_status) x),
   'complete',false
 ) where public.agritech_is_operator();
$$;
revoke all on function public.agritech_coverage from public,anon;
grant execute on function public.agritech_coverage to authenticated;

create function public.agritech_time_sensitive_review() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.review_status='APPROVED' and exists(select 1 from public.agritech_documents where id=new.document_id and coalesce((metadata->>'time_sensitive')::boolean,false)) and (new.valid_until is null or new.valid_until<=now()) then raise exception 'Current validity deadline required for advisories'; end if;
  return new;
end $$;
create trigger time_sensitive_review before insert or update on public.agritech_chunks for each row execute function public.agritech_time_sensitive_review();
