begin;
insert into auth.users(id,email) values('aaaaaaaa-0000-4000-8000-000000000001','operator-a@example.invalid'),('aaaaaaaa-0000-4000-8000-000000000002','operator-b@example.invalid');
insert into public.agritech_operators values('operator-a@example.invalid',false),('operator-b@example.invalid',true);
insert into public.agritech_cases(id,owner_id,version,status,payload) values
 ('bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',0,'INCOMPLETE','encrypted-test-a'),
 ('bbbbbbbb-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000002',0,'INCOMPLETE','encrypted-test-b');
insert into public.agritech_sources(id,publisher,url,allowed_hosts,reuse_status,reuse_basis) values('test-source','Test fixture','https://example.invalid/',array['example.invalid'],'permitted','Synthetic SQL test fixture; no published guidance');
insert into public.agritech_documents(id,source_id,url,title,retrieved_at,version,extraction_status) values('test-doc','test-source','https://example.invalid/rice','Test',now(),'fixture-v1','extracted');
insert into public.agritech_chunks(id,document_id,text,crop,review_status,approved_by,approved_at,review_note,valid_until) values
 ('test-approved','test-doc','ধান পাতায় দাগ','rice','APPROVED','aaaaaaaa-0000-4000-8000-000000000002',now(),'Synthetic reviewer fixture',now()+interval '1 day'),
 ('test-stale','test-doc','ধান পাতায় দাগ','rice','APPROVED','aaaaaaaa-0000-4000-8000-000000000002',now(),'Synthetic reviewer fixture',now()-interval '1 day'),
 ('test-pending','test-doc','ধান পাতায় দাগ','rice','PENDING',null,null,null,null);
set local role anon;
do $$ begin
 if (select count(*) from public.agritech_cases)>0 then raise exception 'Anonymous case access'; end if;
 if (select count(*) from public.agritech_chunks)>0 then raise exception 'Anonymous source access'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000001","email":"operator-a@example.invalid","role":"authenticated"}',true);
do $$ declare rejected boolean:=false; begin
 if (select count(*) from public.agritech_cases)<>1 then raise exception 'Cross-operator case access'; end if;
 begin
   perform public.agritech_review_chunk('test-pending','APPROVED','Unqualified user must not approve','rice',null,null,null);
 exception when others then rejected:=true; end;
 if not rejected then raise exception 'Unqualified review succeeded'; end if;
 if (select count(*) from public.agritech_search('ধান',null,'rice',null,null,false))<>1 then raise exception 'Unapproved or stale guidance leaked'; end if;
 if (select count(*) from public.agritech_search('ধান',null,'potato',null,null,false))<>0 then raise exception 'Wrong crop leaked'; end if;
 perform public.agritech_commit_case('bbbbbbbb-0000-4000-8000-000000000001',0,'event-1','turn',1,'INCOMPLETE','cipher-next',null,null,null,null);
 perform public.agritech_commit_case('bbbbbbbb-0000-4000-8000-000000000001',0,'event-1','turn',1,'INCOMPLETE','duplicate-cipher',null,null,null,null);
 if (select version from public.agritech_cases where id='bbbbbbbb-0000-4000-8000-000000000001')<>1 then raise exception 'Duplicate event changed version'; end if;
 rejected:=false;
 begin perform public.agritech_commit_case('bbbbbbbb-0000-4000-8000-000000000001',0,'event-stale','turn',1,'INCOMPLETE','stale-cipher',null,null,null,null);
 exception when others then rejected:=true; end;
 if not rejected then raise exception 'Stale write accepted'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000001","email":"not-authorized@example.invalid","role":"authenticated"}',true);
do $$ begin if (select count(*) from public.agritech_cases)>0 then raise exception 'Unlisted operator access'; end if; end $$;
reset role;
select 'RLS, approval, temporal filtering, idempotency and stale-write checks passed' as result;
rollback;
