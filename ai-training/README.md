# JARVIS AI Training Workspace

This workspace is for a controlled, reproducible JARVIS model-adaptation pipeline. It is not a web scraper and it does not train on every URL or video that can be found online.

## The correct architecture

Use four separate mechanisms for four different jobs:

1. **Pretrained foundation model** — supplies general language ability. Do not try to recreate a large foundation model from scratch in a 4 GB Android device or an ordinary Colab session.
2. **Retrieval-augmented generation (RAG)** — supplies current, source-grounded facts from the reviewed JARVIS Knowledge Library. New reviewed knowledge can be retrieved without retraining model weights.
3. **Supervised fine-tuning (SFT) with LoRA/QLoRA** — teaches repeatable JARVIS behavior: how to interpret editing briefs, generate validated timeline plans, choose tools, explain decisions and recover from errors.
4. **Deterministic editing tools** — actually trim, sequence, caption, mix, render and verify media. A language model must propose typed operations; the engine validates and executes them.

A model that has only read text examples will not automatically gain the ability to see video, hear audio or render a project. Multimodal tasks need aligned frame/audio/transcript examples and a compatible multimodal model. The first milestone should use existing media-analysis tools and a text model that produces structured edit plans.

## Data location

Keep code and small synthetic examples in GitHub. Keep private or large data and training artifacts in private Google Drive storage.

Recommended Drive root:

MyDrive/JARVIS_AI/
- source_manifests/
- approved_corpus/
- derived_notes/
- datasets/train/
- datasets/validation/
- datasets/test/
- runs/
- checkpoints/
- adapters/
- evaluation_reports/
- backups/

Never store private credentials, personal user data, unlicensed media or large model checkpoints in this public repository.

## First action

Open notebooks/00_hardware_and_drive_audit.ipynb in Google Colab and run it from top to bottom. It checks the actual runtime GPU, VRAM, RAM and disk, mounts Drive with your consent, creates the folders above, clones this repository and saves a hardware report to Drive.

Do not select a base model or start fine-tuning until the hardware report is available. Colab GPU type and availability vary, especially on the free tier.

## Planned notebook sequence

- 00_hardware_and_drive_audit.ipynb — created; hardware and Drive setup only.
- 01_model_selection_and_baseline.ipynb — select a license-compatible model that fits the measured GPU; benchmark before training.
- 02_source_manifest_and_corpus_ingestion.ipynb — ingest only approved source material.
- 03_dataset_cleaning_and_splits.ipynb — deduplicate, validate, remove secrets and create source-separated train/validation/test sets.
- 04_editing_instruction_dataset.ipynb — prepare supervised editing examples and timeline JSON targets.
- 05_lora_sft_training.ipynb — train a small adapter with resumable checkpoints.
- 06_evaluation_and_regression.ipynb — compare base and tuned model on unseen tasks and existing JARVIS tests.
- 07_export_and_api_smoke_test.ipynb — export adapter metadata and test an authenticated OpenAI-compatible endpoint.

The later notebooks should be generated only after choosing a specific base model and checking its tokenizer, chat template, license, library compatibility and hardware fit. Do not leave fake notebooks that appear to train a model but have unverified settings.

## Data governance

Read DATASET_GOVERNANCE.md before collecting or importing content. Every source needs provenance, license or permission evidence, allowed purposes, acquisition method and a checksum. Unknown or denied sources must be excluded from training.

## Model release rule

A training run is not successful merely because loss decreases. Compare the original base model and adapter on the same held-out tasks. Require valid JSON plans, safe tool selection, correct timeline operations, sensible editing decisions, and no unacceptable regressions before creating a release.
