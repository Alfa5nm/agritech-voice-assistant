# Alaap incoming-call test

Requires Node.js 22 or newer and Chrome or Edge. Run `npm install` once for the Vertex AI voice bridge.

1. In this folder run `node server.mjs`, then open http://127.0.0.1:8765.
2. Enter the provider access token and SIP password. Use the extension and realm supplied by your provider. Credentials stay in memory and the secret fields clear after connecting. Do not save them in browser password storage.
3. Select **Check microphone permission and devices**, allow microphone access, and select your headset. This briefly opens the microphone and immediately releases it.
4. Select **Enable automatic answering**, then **Connect**. Wait for **Registered**. Leave this page open and the laptop awake; keep this test window in the foreground for the initial test.
5. Call **your provider test DID** from a separate phone. Speak in both directions using headphones. If playback is blocked, click **Play incoming audio**.
6. End the first call from the phone, the second with **Hang up**, and the third from the phone. Verify each subsequent call succeeds without reconnecting. Increasing counters prove packet traffic, not intelligible speech.
7. Download the redacted log and note which calls had intelligible audio both ways. Use **Disconnect** when finished; reconnect requires entering credentials again.

Run automated checks with `node --test`. The server binds only to the laptop's loopback address. Audio travels over WebRTC. The WebSocket carries signalling only.

### Realtime AI test

For the free, local comparison, use **Whisper comparison (optional)** instead. Install the worker with `uv venv --python 3.11 .bangla-venv` and `uv pip install --python .bangla-venv/Scripts/python.exe faster-whisper edge-tts indic-transliteration`. Run `.bangla-venv/Scripts/python.exe -u bangla.py` in one terminal and `node server.mjs` in another. The first worker launch downloads both models.

The test expects `bangla-reply.mp3` in this folder. To regenerate the fixed reply from PowerShell, run `.bangla-venv/Scripts/edge-tts.exe --voice bn-BD-NabanitaNeural --text "দাগগুলো পাতার কোন অংশে দেখা যাচ্ছে?" --write-media bangla-reply.mp3`. This sends only the fixed reply text to the synthesis service during setup. Caller audio is processed locally in memory.

Once the call connects, click **Capture Bangla speech**, have the caller speak one short sentence, then click **Finish utterance**. Repeat with a Chittagonian speaker. Compare crop names, symptoms, and numbers in both transcripts. The displayed reply timing measures capture end to local playback start. Ask the caller when they actually hear it.

For hands-free turns, install `indic-transliteration` in the same environment and run `.bangla-venv/Scripts/python.exe generate-bangla-prompts.py` once. This generates the fixed questions from `bangla-prompts.json`; it sends no caller content. Click **Start hands-free Bangla** once on a connected call. The regional model runs after about 600 ms of quiet. The page shows the raw, lightly cleaned, and Latin-script text. It asks a Bangla question about the crop, symptom, or timing based on the current call, then listens again. Wait until **Listening** before the next sentence. **Stop Bangla test** or hangup releases the audio connection.

With the caller's permission, check **Save next turn for QA** before speaking. The checkbox clears when that turn is selected. The exact WAV passed to the regional model and a matching JSON report are written to `qa/captures/`, which is excluded from Git. The page reports the saved filename. Use it to compare the captured speech, transcript, and spoken follow-up.

### Vertex AI voice

Copy `.env.example` to `.env.local` and set your Google Cloud project, service-account file path (or use Application Default Credentials), and the TURN username/password supplied by Alaap. Do not commit that environment file or the service-account JSON. The default voice model is `gemini-live-2.5-flash-native-audio` in `us-central1`; the project needs Vertex AI permissions, billing, and quota. For user credentials, leave `GOOGLE_APPLICATION_CREDENTIALS` unset and run `gcloud auth application-default login` and `gcloud auth application-default set-quota-project YOUR_PROJECT_ID`.

Alaap access tokens and SIP passwords are entered in the browser at connection time. TURN credentials are loaded by the local server and returned only to same-origin requests from the tester. They are required for the relay-only telephone media connection.

Restart `node server.mjs` after changing configuration. With the caller's agreement, click **Start AI voice** during a connected phone call. Caller audio streams through the local `/vertex` WebSocket to Google Cloud, and generated speech is sent back to the phone. The main **Live transcript from Vertex AI** panel displays caller and AI captions directly from Vertex. Local Whisper results are kept separately under the collapsed **Whisper comparison (optional)** section. **Stop AI voice** restores the laptop microphone; hanging up closes the Vertex session. One AI session is allowed at a time, with a ten-minute test limit. No caller audio or captions are saved by this bridge. Google Cloud usage is billed to the selected project; vendor retention is separate from local storage.

This is an experimental voice conversation, without reviewed agricultural knowledge, real expert referrals or SMS. Do not treat its output as validated agricultural advice. Dialect accuracy, interruptions and phone-to-phone response delay need live testing.

If registration fails, verify token expiry, extension/password, the supplied realm, and possible use of the shared test extension by someone else. The realm need not resolve locally when an explicit SIP proxy routes registration. Do not substitute the proxy IP as the realm without provider confirmation or protocol evidence.

If registered but the DID never rings, ask the provider to verify DID-to-extension routing. If ICE fails or counters remain zero, inspect TURN/network access before changing voice services. Browser permission denial is recovered by allowing the microphone for this local site, then calling again. Disconnect/reconnect tests temporarily stop the client receiving calls. No automatic reconnect is implemented.

The included TURN configuration comes from the supplied guide and needs a real media test. The shared test account may conflict with other registrations. This is a single-call diagnostic client, not a production telephone service.
