# Agritech 180 second video script

The stronger revised master is `AIBC_IMPACT_VIDEO_SCRIPT.md`. Use that version for the current film; this file preserves the earlier narration and alternate-cut reference.

English narration with Bangla demonstration. Keep the five time windows exactly aligned with AIBC Participants Guide Section 9.2. Bracketed directions are not spoken. Use the complete-production instructions in `AIBC_VIDEO_GUIDE.md`.

## 00:00 to 00:30 Problem

[Picture: a rice leaf, a farmer's hand, an ordinary button phone. Label an acted scene “Illustrative scenario.”]

**Narrator**

“A rice farmer sees yellow leaves. Is it water, nutrition, or something else? The next decision matters. But useful information is often behind a screen, a search box, or unfamiliar language.

“For a farmer who cannot comfortably navigate those tools, having a phone is not enough. We are building agricultural support around something they can already do: make a call.”

## 00:30 to 01:00 Solution

[Picture: call → consent → profile → confirmation → rice case. Distinguish the farmer's voice channel from the operator console.]

**Narrator**

“Agritech is a Bangla telephone assistant designed for rice farmers. No app installation is required on the farmer's phone.

“The workflow begins with permission, then a profile: preferred name, approximate location, associated number, and optional age. Important details are read back for confirmation.

“This creates the foundation for personalised support: a confirmed person and case, with room to clarify, correct, and ask the next useful question.”

## 01:00 to 02:00 Demo or flow

[Choose Cut A or Cut B. Never mix their claims. Keep fictional data labelled.]

### Cut A For a verified complete registration recording

**Narrator — opening approximately 4 seconds**

“Here is the prototype, using fictional test details.”

[Use approximately 30–35 seconds of actual Bangla phone excerpts. Subtitle the real output. Shorten pauses only with a visible label.]

**AI opening target, not a fabricated recording**

“আসসালামু আলাইকুম। আমি কৃষি সহায়তার একটি এআই সহকারী। আপনার নাম, এলাকা আর ফোন নম্বর এই সেবার জন্য সংরক্ষণ করতে পারি?”

**Farmer**

“জি, রাখতে পারেন।”

[Show actual name, location, consent and phone confirmation excerpts. For the correction test, use an initial fictional answer and then let the caller correct it.]

**AI read-back excerpt**

“আপনার এলাকা মহেশপুর, ঠিক তো?”

**Farmer correction**

“না, মহাদেবপুর হবে।”

**AI corrected read-back**

“মহাদেবপুর, ঠিক বললাম?”

**Farmer**

“জি।”

[Show the saved synthetic profile only after the backend actually registers it. The full recording must also contain the other required confirmation steps.]

**Narrator — approximately 8 seconds**

“The backend distinguishes a proposal from a confirmed fact and keeps the correction. A number links a profile; it does not prove who is speaking.”

[Approximately 8 seconds: rice complaint and a genuine clarification.]

**Farmer**

“ধানের পাতা হলুদ হয়ে গেছে।”

**AI clarification target**

“পুরো পাতা হলুদ, নাকি শুধু ডগা বা কিনারা?”

**Narrator — remaining seconds over actual evidence status**

“Missing evidence means further clarification or specialist consultation—not an invented prescription.”

### Cut B For the currently verified evidence without a complete phone registration recording

[Use a genuine phone-voice clip, actual backend test results and a labelled workflow diagram. Display “Prototype and backend tests” and “Registration flow under phone validation.”]

**Narrator**

“Our telephone prototype already connects Bangla speech to a live AI voice. This clip uses fictional information.”

[Play approximately 8–10 seconds of a genuine greeting and exchange. Do not imply that it created a saved profile.]

**Narrator**

“Separately, the backend registration tests show the required steps: permission, details, read-back, confirmation, and an encrypted saved profile. A correction stays traceable. Guidance retrieval is blocked until registration is complete.

“The full phone-to-registration journey is our next validation milestone. Our rice intake currently supports a small set of symptom pathways. Here, yellow leaves trigger a clarification about where the yellowing appears. Without approved evidence, the system must not invent treatment.”

[Show the actual persistence/access test receipt. The synthetic database fixtures were rolled back after testing. Do not manufacture an active farmer record or an approved agricultural source.]

## 02:00 to 02:30 AI approach

[Picture: five-block architecture. Show current implementation first; put future context in a separate amber panel.]

**Narrator**

“Gemini Live handles speech. Backend tools manage confirmation, registration, and retrieval. Supabase stores encrypted profiles and supports keyword and vector search.

“Retrieval requires approved, matching passages, but the reviewed rice knowledge base is still being prepared. Spoken output also needs further validation.

“Next come specialist-reviewed guidance, weather context, and verified local input names. Those are milestones, not claims of today's demo.”

## 02:30 to 03:00 Impact and next step

[Picture: farmer → institutional sponsor; planned pilot measures; end card.]

**Narrator**

“Cooperatives, NGOs, extension programmes, and telephone partners could sponsor access.

“We will measure registration completion, understanding, reply delay, and cost per completed case. Yield and input savings need field evidence.

“Our next step is a supervised farmer pilot, starting with Bangla rice support and expanding through local validation.

“Agritech. Agricultural support, one understandable phone call at a time.”

## Recording notes

- Read at a natural pace. Leave the demo's phone audio uncovered by narration. Rehearse against the edit; timing is not guaranteed by a word count alone.
- Do not read both demo cuts. Choose Cut A only after its full recording gate passes; otherwise use Cut B.
- The current software evidence is 47 passing app tests plus database access/persistence checks. Keep that in a small technical-evidence caption or the supporting guide, not as a claim of agricultural benefit.
- The model may phrase a question differently. Subtitle the actual recording rather than replacing it with this target dialogue.
- End on the product and the next validation step. Add real team names and assigned roles on the end card; do not invent collaborators or partnerships.

Not produced here: the video export or a verified end-to-end phone registration recording. Cloud response timing and consented recording still need checking before filming.
