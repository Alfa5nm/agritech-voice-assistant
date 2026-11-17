# Agritech: Bengali agricultural voice assistant

A work-in-progress phone assistant for Bangladeshi farmers using feature phones. The current prototype connects an Alaap incoming telephone call to Gemini Live on Google Cloud Vertex AI, with a live caller/assistant transcript and an optional local Whisper comparison.

## Run the prototype

See [the setup guide](alaap-test/README.md). You need Node.js 22+, Chrome or Edge, provider-issued Alaap credentials and a test telephone number, TURN credentials, and a Google Cloud project with Vertex AI billing and model access.

```powershell
cd alaap-test
npm ci
Copy-Item .env.example .env.local
# Edit .env.local with your own settings before starting.
npm start
```

Open http://127.0.0.1:8765, enter your provider account details, enable automatic answering, and connect. Call your provider test number, then select **Start AI voice** with the caller's agreement. Audio is sent to Google Cloud and usage is billed to your configured project.

## Current architecture

```text
Feature phone -> Alaap/Janus -> browser WebRTC
                                  |
                          local audio bridge
                                  |
                         Vertex AI Gemini Live
                                  |
                    generated speech + live captions
```

The server binds to loopback only. Google credentials remain on the server. Phone credentials stay in browser memory; the diagnostic download excludes caller transcripts and credentials. Optional Whisper QA recordings require explicit selection and remain local.

## Status and intended product

The registration, fact-confirmation, reviewed-retrieval and Bangla-model research implementation is described in [the implementation and operator guide](docs/IMPLEMENTATION.md). Open http://127.0.0.1:8765/operator.html for authenticated case and source operations. Applying database migrations and supplying reviewed content/training data are required before the full workflow can be validated.

Working prototype capabilities include incoming call handling, a Vertex Live audio bridge and transcripts, local Bangla speech-model comparison, and a small scripted clarification flow. Phone audio quality, dialect comprehension and latency need further evaluation across speakers and devices.

The backend now implements operator-scoped encrypted profiles, case fact proposals and confirmations, source catalog/collection, filtered keyword/vector retrieval, reviewer operations and referral requests. Specialist-reviewed content and student-model training remain pending. Bengali SMS, expert assignment, consented callback jobs and guaranteed approval of every spoken sentence are not implemented. The current voice model's prompt restrictions are not a validated agricultural safety system; do not rely on the prototype for diagnosis or chemical dosing.

## Tests

```powershell
cd alaap-test
npm test
```

Tests exercise signalling, cleanup, dialogue handling, audio conversion and streaming, origin restrictions, and cancellation. They do not replace live call or farmer validation.

## Private files

Environment files, service-account keys, provider documents, recordings, internal QA reports, generated audio, and installed dependencies are excluded from this repository. Supply your own credentials and respect the terms and licenses of the external services and speech models.
