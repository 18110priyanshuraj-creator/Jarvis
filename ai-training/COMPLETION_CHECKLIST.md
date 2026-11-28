# JARVIS hybrid brain completion checklist

Status is recorded honestly; an implemented workflow is not evidence of a completed model run.

## Automated checks

- [x] Dataset JSONL format and governance validator implemented (`scripts/dataset_factory.py`).
- [x] CPU-safe unit tests added for schema, duplicate, secret-pattern, and source-group split checks (`tests/test_dataset_factory.py`).
- [x] GitHub Actions workflow added for notebook JSON structure, starter/held-out data validation, Python compilation, and unit tests (`../.github/workflows/ai-training-checks.yml`).
- [ ] Repository pull-request CI and the existing full Node.js check suite pass. Record the PR check result here after Actions completes.

## Model and data acceptance

- [x] Model candidates documented with licenses and access caveats; no final model chosen without a real hardware report and revision pin (`model-candidates.json`).
- [x] Small authored smoke examples and a separate held-out example included; documentation explicitly says they are not sufficient training data.
- [x] Reproducible QLoRA training, inference, and held-out evaluation scripts/notebooks provided.
- [ ] Curated, consented, licensed, and human-reviewed corpus ingested and split by source group.
- [ ] Colab GPU/memory audit run; chosen model/revision and dependency versions recorded.
- [ ] Real baseline inference, training, checkpoint save/resume, adapter load, and held-out evaluation completed with artifacts.

## JARVIS editor acceptance

- [x] Edit-plan contract and limits documented against existing media edit schema.
- [ ] Model produces a real JARVIS edit plan from a safe test project.
- [ ] Actual JARVIS validation accepts valid plans and rejects invalid IDs, bounds, and operations.
- [ ] Safe execution completed and resulting project state independently inspected.
- [ ] Regression evaluation confirms the adapter does not worsen the recorded baseline.

## Release and deployment

- [x] API integration and rollback guidance documented (`../docs/JARVIS_TRAINED_MODEL_DEPLOYMENT.md`).
- [ ] Exported model artifact and checksums exist in durable storage.
- [ ] Deployment health and API smoke tests pass in an authorized environment.

## Blockers / evidence

- Colab currently opens at its sign-in-required home page. No account sign-in, Drive mount, GPU runtime, training, or deployment was performed. User sign-in and hardware availability are required for these checks.
- The local environment has Node/npm but no Python interpreter, and direct GitHub network cloning is unavailable. Python checks are therefore delegated to the added GitHub Actions workflow; do not report them as locally executed.
- This branch contains implementation and workflow scaffolding, not a trained model, production deployment, or verified live edit.
