# JARVIS AI learning and professional video-editing training plan

**Source of truth:** main  
**Scope:** internet research, persistent knowledge, editing intelligence, model fine-tuning and deployment.

## The important correction

JARVIS must not be trained by indiscriminately copying the whole internet or every YouTube video. That is not a realistic training plan, and public visibility does not grant a right to scrape, download, store or train on a source. Use a governed corpus with verifiable rights, and use retrieval for current information.

A single small language model also cannot acquire professional video perception merely by reading editing articles. Text reasoning, image/video understanding, speech recognition and deterministic rendering are separate capabilities.

## What JARVIS already has on main

- Internet research and safe page reading: services/web-research.js, services/web-page-reader.js and services/source-answer.js.
- Reviewable persistent knowledge: services/knowledge.js and services/knowledge-documents.js.
- Explicit user teaching and retrieval: services/learning-engine.js.
- AI-provider connector: services/ai-provider.js.
- Media project/timeline logic: services/media-engine.js and services/media-edit-plan.js.
- Visual/media analysis: services/media-visual-analysis.js.
- Browser Media Studio and client-side editor modules under public/.
- YouTube analytics/publishing services and tests.

Phase documentation is under docs/JARVIS_PHASE_16_INTERNET_RESEARCH.md, docs/JARVIS_PHASE_17_MEDIA_CONTENT.md, docs/JARVIS_PHASE_18_YOUTUBE_PUBLISHING.md, docs/JARVIS_PHASE_19_INDEPENDENT_LEARNING.md, docs/JARVIS_PHASE_20_KNOWLEDGE_MANAGER.md and docs/PHASE23_GOOGLE_SEARCH_SELF_HOSTED_MODEL.md.

The current Independent Learning feature intentionally stores lessons that the owner explicitly teaches and retrieves reviewed knowledge. It does not update neural-network weights. The current tiny character-level model is only an educational experiment.

## The four learning mechanisms

### 1. Foundation model

Start from a licensed instruction-following pretrained model. Select its exact model ID, revision, license, tokenizer and chat template only after checking the actual Colab GPU/VRAM report. Do not assume a free GPU or choose model size by guesswork.

### 2. RAG: current internet and curated knowledge

Use the existing JARVIS SearXNG search, safe reader and Knowledge review pipeline. Research flow:

1. Search the question.
2. Inspect source title, domain, date and relevance.
3. Read only selected JARVIS-issued sources through the safe reader.
4. Create a short source-grounded summary or lesson.
5. Save it explicitly to Knowledge.
6. Have the owner review or reject it.
7. Retrieve only trusted records for later answers.

This updates what JARVIS can retrieve, not model weights. It is the right way to keep changing documentation and recent facts available without retraining.

### 3. SFT with LoRA/QLoRA: teach specialized behavior

Build a high-quality dataset of original or permitted examples showing:
- interpreting editing briefs;
- planning story structure and shot order;
- choosing cuts, transitions, captions, audio and color operations;
- generating canonical timeline JSON;
- selecting the correct editing tool;
- handling missing assets and unsupported operations;
- verifying output and explaining errors.

Use a compatible pretrained instruction model and a small LoRA/QLoRA adapter. Keep the base model frozen. Save checkpoints and adapter artifacts in private Drive storage. Evaluate against held-out tasks before enabling the adapter in JARVIS.

### 4. Tool execution: do the actual edit

The model must never execute arbitrary commands. Its output is a typed edit plan. Validate that plan against the JARVIS project schema and allowlisted operations, then route it to the appropriate renderer. Inspect the rendered output and report success only after the file passes checks.

## Video intelligence pipeline

For the first working version, do not train a new video foundation model. Reuse specialized, maintained components for:
- speech-to-text and timestamped transcript;
- scene/shot boundary detection;
- keyframe sampling and visual descriptions;
- audio level and silence analysis;
- metadata probing;
- timeline rendering and export verification.

Combine their outputs into a bounded media context. The language model plans edits; deterministic tools perform them. A later multimodal fine-tuning phase would require aligned video frames, audio, transcripts, timestamps, creator permissions and much more compute.

## Dataset curriculum

1. Editing vocabulary and project structure.
2. Storytelling and pacing.
3. Shot and scene selection.
4. Timeline operations and clip timing.
5. Captions and subtitle timing.
6. Audio mixing and voice priority.
7. Color and visual consistency.
8. Motion, transitions and keyframes.
9. Export settings and format constraints.
10. Tool selection, validation and recovery.
11. End-to-end editing plans for documentary, long-form, shorts, educational, podcast and commercial formats.
12. Human-reviewed quality assessment.

Do not generate huge volumes of unchecked synthetic examples. Each training target must validate against the same schema used by the real editor.

## Storage and security

GitHub stores source code, schemas, documentation and tiny synthetic samples only.

Private Google Drive stores:
- source manifests and permission evidence;
- approved source files and derived annotations;
- train/validation/test datasets;
- training logs and resumable checkpoints;
- LoRA adapters and evaluation reports;
- versioned backups and release manifests.

Never commit secrets, private media, full copyrighted source copies, raw user conversations or large model checkpoints to this public repository.

## Training and release sequence

1. Run the Colab hardware/Drive audit notebook.
2. Select the smallest suitable instruction model based on VRAM and license.
3. Benchmark the unmodified base model on fixed editing tasks.
4. Build the source manifest and permission-reviewed corpus.
5. Build and validate the editing instruction dataset.
6. Train a LoRA/QLoRA adapter with periodic Drive checkpoints.
7. Compare base and adapter on the same unseen tasks.
8. Check JSON validity, editing-plan quality, unsafe/unsupported tool calls and regressions.
9. Export the adapter and record model ID, revision, dataset version and training settings.
10. Host inference behind authenticated HTTPS.
11. Connect using the existing services/ai-provider.js configuration.
12. Keep the adapter disabled until live API and end-to-end rendering tests pass.

## Hardware reality

The 4 GB Android device is the control interface and lightweight preview client. It should not train the model. Colab performs notebook training when a compatible GPU is allocated; Drive stores permanent artifacts. The production model endpoint should be a separate inference host, not the Android localhost and not an unauthenticated public server.

Colab resources and GPU availability vary by account and time. Check the notebook report first and plan for interrupted runtimes and checkpoint resume.

## Completion definition

JARVIS is not considered professionally trained because it can describe transitions. A release must demonstrate that it can convert held-out editing briefs into valid project plans, execute supported operations, render a test output, pass metadata/quality checks, and explain any unsupported operation honestly.
