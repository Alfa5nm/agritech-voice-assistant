# Registration, retrieval and Bangla model research

## Current release

This is a local, operator-supervised research demonstration. Gemini Live receives audio and controls spoken replies; backend tools do not guarantee approval of every spoken sentence. The application must not be used for autonomous diagnosis or chemical treatment. Source review and model evaluation are separate from software tests.

The existing Alaap tester remains available at `/`. The authenticated operator console is `/operator.html`. A dedicated Supabase project stores encrypted private records; operators do not use a service-role key. The migrations under `supabase/migrations` must be applied in filename order before using registration.

## Configure and sign in

Add the variables from `alaap-test/.env.example` to the private `.env.local`. Generate two different 32-byte hexadecimal values for `PROFILE_ENCRYPTION_KEY` and `PHONE_LOOKUP_KEY`; back them up privately. Losing the encryption key makes existing encrypted profiles unreadable. Never rotate it without a data migration.

Apply the migrations in the dedicated project. Add authorized operator emails to `agritech_operators` through the Supabase dashboard. Set `can_review=true` only for a qualified content reviewer; ordinary operators cannot approve guidance. The configured initial operator is not an agronomy reviewer.

Start the local server and open `/operator.html`. Request a sign-in email. Paste the verification code or the original Supabase magic-link URL into the local verification field without opening the link first. Email authentication tokens must not be pasted into chat. Operator sessions are held server-side and expire with the Supabase access token; server restarts require sign-in again.

## Register and confirm facts

1. Obtain the caller's agreement to storing the research profile and case; check the consent box and create a case.
2. Open the telephone tester using the selected case's link. Connect the provider account, enable auto-answer, answer a real call, and start AI voice.
3. Gemini proposes profile facts through backend tools using exact source wording and server turn identifiers. Name, location, phone and explicit service consent must be confirmed; age is optional. Recording, training reuse and follow-up consent are separate fields.
4. The assistant reads pending values back. The browser acknowledges playback completion. Only a subsequent explicit caller confirmation can confirm that batch; corrections produce a new proposal.
5. Refresh the operator case view to inspect source turns, pending values, confirmation provenance and corrections. Registration is complete only after the backend accepts `complete_registration`.
6. Cases, plots and crop cycles remain separate from the person. Disconnects retain an incomplete case; operator-reviewed resolution closes it.

Shared numbers may link to multiple profiles. Lookup returns candidate IDs rather than exposing names or histories. Independently verify the person, enter that profile's ID, and record verification before loading history or binding it to a new case. Verification is scoped to the selected profile, and new cases start with new plot/cycle identifiers. Caller-ID metadata is not implemented as a trusted identity mechanism; the number is currently caller-confirmed.

The voice-only URL continues working without registration. Persistence failures are shown as workflow errors and must not be represented as a successful registration. Confirmation checks are conservative: rephrase and read back again when transcription or digit formatting prevents an exact match. This needs live phone testing with different speakers.

## Knowledge ingestion and retrieval

`research/sources.json` registers seven Bangladesh publishers: BAMIS, BRRI, BARI, DAE, AIS, BMD and SRDI. The first bounded catalog run produced 11 metadata records. This is discovery coverage, not an exhaustive collection. BMD redirected to an unregistered host and was left blocked rather than bypassing the host restriction.

The operator can run bounded catalog/collection jobs and inspect status. Catalog mode records provenance without retaining source bodies. Before collection, record the actual source permission or license basis. Public accessibility alone is not reuse permission. Collection stores original documents privately, extracts text/PDF pages, hashes document versions, deduplicates content, and creates pending passages. Scanned or very large PDFs are queued for manual extraction; OCR is not silently treated as completed.

Robots policies, HTTPS publisher allowlists, redirect targets, public IP resolution, request timeouts, file-size limits and crawl delays are checked. Jobs have a ten-minute bound. Resume by running the same source again; manifests and content-addressed writes preserve prior records. In-memory job status does not survive server restarts; private manifests do.

Use **Embed next 50 passages** after collection. Embeddings use `gemini-embedding-001`, 768 dimensions. Retrieval filters approved sources by crop, stage, district, review state and validity before keyword/vector ranking; embedding failures fall back to keyword search. The research-search option is explicitly separate from caller-guidance retrieval.

A qualified reviewer must approve source-linked passages and define allowed usage. Time-sensitive advisories need validity deadlines. The live rice workflow covers spots, yellowing and insects as intake pathways, not diagnoses. Missing approved evidence returns clarification or referral. No source has been approved merely because ingestion succeeded.

## Bangla model experiments

The pinned model registry is `research/models.json`. All three selected checkpoints have passed CPU inference smoke tests. This establishes loading and output production, not agricultural accuracy. BanglaLlama uses its published instruction adapter plus its pinned base model, loaded in half precision to fit local memory.

Create the isolated environment from the workspace root:

```powershell
uv venv --python 3.11 .research-venv
uv pip install --python .research-venv/Scripts/python.exe torch --index-url https://download.pytorch.org/whl/cpu
uv pip install --python .research-venv/Scripts/python.exe -r research/requirements.lock
.research-venv/Scripts/python.exe research/smoke_models.py
```

The local environment was frozen in `requirements.lock`. Platform-specific Torch availability may require using `requirements.txt` with the CPU wheel index instead. Models, drafts, reports and data remain ignored by Git.

Generate teacher drafts with `node alaap-test/scripts/teacher.mjs 300`. A completed batch of 300 synthetic drafts already exists privately. Resume a partial file by passing its filename as the third argument. Drafts remain unassigned and unreviewed; invalid spans are flagged instead of becoming training labels.

```powershell
.research-venv/Scripts/python.exe research/review_dataset.py review --input research/private/teacher-FILENAME.jsonl --output research/private/reviewed.jsonl --reviewer REVIEWER_ID
.research-venv/Scripts/python.exe research/review_dataset.py split --input research/private/reviewed.jsonl --output research/private/split.jsonl
.research-venv/Scripts/python.exe research/run_models.py train --model banglabert --task extract --data research/private/split.jsonl --output research/models/banglabert
.research-venv/Scripts/python.exe research/run_models.py train --model banglabert --task intent --data research/private/split.jsonl --output research/models/banglabert-intent
.research-venv/Scripts/python.exe research/run_models.py train --model banglat5 --data research/private/split.jsonl --output research/models/banglat5
.research-venv/Scripts/python.exe research/run_models.py train --model banglallama --data research/private/split.jsonl --output research/models/banglallama
.research-venv/Scripts/python.exe research/run_models.py evaluate --model banglabert --task extract --data research/private/split.jsonl --checkpoint research/models/banglabert
node alaap-test/scripts/evaluate-baselines.mjs research/private/split.jsonl
```

Run the equivalent evaluate command for each trained task. Human review must check intended meaning, dialect, exact spans, negation, numbers and pseudonymization. Split whole paraphrase/conversation groups, targeting approximately 200/50/50 examples while prioritizing no leakage. Evaluation outputs exact-field scores, validity, response times and normalization-preservation flags. The operator page displays saved reports. No automatic student deployment occurs.

BanglaBERT/BanglaT5 retain their non-commercial research restrictions. Check inherited checkpoint licenses before any commercial or farmer deployment. No real caller data is used for training without separate consent. Full training and accuracy benchmarks remain pending human-reviewed data.

## Validation and release limits

Run `npm test` in `alaap-test`, and `.research-venv/Scripts/python.exe -m unittest discover -s research -p 'test_*.py'` at the root. Run `supabase/tests/access.sql` in an administrative SQL session; the fixture rolls back all test data. It checks anonymous/unauthorized access, cross-operator isolation, approval restrictions, stale content, idempotency and stale writes.

Observed service checks: Gemini Live accepted tool declarations and invoked `case_status`; the embedding API returned 768 dimensions; the first three database migrations and SQL access tests passed, and the database security advisor returned no findings. The fourth migration adds profile-linked history and must be applied if absent.

Still required: final migration deployment verification, authenticated browser registration end-to-end, real phone read-back/confirmation, specialist content review, approved source reuse decisions, training-data review, student training/evaluation and broader dialect tests. SMS delivery, automatic expert scheduling and unattended farmer deployment are not implemented.
