# JARVIS hybrid brain completion checklist

Status is recorded honestly; an implemented workflow is not evidence of a completed model run.

## Automated checks

- [x] Dataset JSONL format, notebook structure, Python syntax, and CPU-safe dataset unit tests passed in GitHub Actions `AI training assets` run 1 (run ID `46140071816`, success).
- [x] Existing Node syntax checks, full test suite, and production dependency audit passed in `JARVIS CI` run 1827, job `Node.js tests and dependency audit` (run ID `46140071784`, success).
- [x] Android Companion build, APK verification, release metadata, and artifact upload passed in the same `JARVIS CI` run, job `Android Companion build and APK verification` (run ID `46140071784`, success).

## Model and data acceptance

- [x] Model candidates documented with licenses and access caveats; no final model chosen without a real hardware report and revision pin (`model-candidates.json`).
- [x] Small authored smoke examples and a separate held-out example included; documentation explicitly says they are not sufficient training data.
- [x] Reproducible QLoRA training, inference, checkpointing, and held-out evaluation scripts/notebooks provided.
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
- [ ] Live deployment smoke test completed in an authorized environment. GitHub reported the Vercel PR preview as Ready, but opening it redirected to Vercel sign-in, so the protected preview could not be inspected or smoke-tested.

## Blockers / evidence

- Colab opens at a sign-in-required home page. No account sign-in, Drive mount, GPU runtime, training, or model deployment was performed. User sign-in and suitable hardware are required for those checks.
- The local environment has Node/npm but no Python interpreter, and direct GitHub network cloning is unavailable. Python checks ran in GitHub Actions instead; they were not run locally.
- This branch contains implementation and workflow scaffolding, not a trained model, production model deployment, or verified live edit. The PR is open for review at https://github.com/18110priyanshuraj-creator/Jarvis/pull/107.
