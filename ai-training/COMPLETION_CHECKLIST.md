# JARVIS hybrid brain completion checklist

Status is recorded honestly; an implemented workflow is not evidence of a completed model run.

## Automated checks

- [x] Dataset JSONL format, notebook structure, Python syntax, and CPU-safe dataset unit tests passed in GitHub Actions `AI training assets` run 8 (commit `dcb4375f009593727b97545d1c333557b4d4b438`, success).
- [x] Node syntax checks, full test suite, and production dependency audit passed in GitHub Actions run `46146662608`, job `Node.js tests and dependency audit` (success). This includes the safe edit-plan fixture test below.
- [x] Android Companion build, APK verification, release metadata, and artifact upload passed in the same run, job `Android Companion build and APK verification` (success). Artifact `jarvis-companion-debug` (ID `15264011771`, SHA-256 `1a73c2a5a3e4f26386b527a4829ed0c65b710ed4cc6d274dcfa0ae77880d4427`, expires 2026-12-05).
- [x] Colab repository setup reran on the connected Python 3.13.16 runtime and confirmed the expected branch `ai-training/hybrid-brain-implementation`.
- [x] A free T4 runtime was allocated and is shown by Colab as connected (observed in the runtime toolbar). The fresh hardware report is still pending: the post-switch notebook cell is waiting inside `drive.mount('/content/drive')` for Google authorization, so the old saved CPU report is stale and has not been replaced.
- [x] The prior CPU-session Drive folder tree, write/read probe, and starter dataset validator succeeded. The validator reported 2 valid unique authored records from 2 source groups; these are smoke-test examples, not training data.

## Model and data acceptance

- [x] Model candidates documented with licenses and access caveats; no final model chosen before recording hardware and pinning an immutable revision (`model-candidates.json`).
- [x] Authored smoke examples and a separate held-out example included; documentation says they are insufficient as training data.
- [x] Reproducible QLoRA training, inference, checkpointing, and held-out evaluation scripts/notebooks provided.
- [ ] Curated, consented, licensed, and human-reviewed corpus ingested and split by source group.
- [ ] Fresh T4 hardware report saved to Drive; choose a compatible model/revision and record dependency versions.
- [ ] Real baseline inference, model-generated edit-plan generation, training, checkpoint save/resume, adapter load, and held-out evaluation completed with artifacts.

## JARVIS editor acceptance

- [x] Edit-plan contract and safety limits documented against the existing media-edit schema.
- [x] Deterministic safe-project fixture plan passes JARVIS plan normalization and applies a bounded scene rewrite and transition; assertions confirm resulting state and that the source project remains unchanged (`tests/media-edit-plan.test.js`, Node job `46146662608`).
- [x] The same fixture test rejects unknown scene IDs, out-of-bounds clip moves, and unsupported operations.
- [ ] A model produces a real JARVIS edit plan from a safe test project.
- [ ] A model-generated plan is validated and safely executed against a test project, then independently inspected.
- [ ] Regression evaluation confirms the adapter does not worsen the recorded baseline.

## Release and deployment

- [x] API integration and rollback guidance documented (`../docs/JARVIS_TRAINED_MODEL_DEPLOYMENT.md`).
- [ ] Exported model artifact and checksums exist in durable storage.
- [ ] Live deployment smoke test completed in an authorized environment. GitHub reported the Vercel PR preview as Ready, but it redirected to Vercel sign-in, so it could not be inspected or smoke-tested.

## Blockers / evidence

- Colab runtime setup and repository checkout succeeded. The connected runtime displays T4, but Drive authorization is needed to resume the hardware report write. No model was loaded and no inference or training was attempted.
- The prior Drive probe and starter validator ran against authored smoke examples only. They do not establish dataset readiness or model quality.
- The local environment has Node/npm but no Python interpreter, and direct GitHub network cloning is unavailable. Python checks ran in GitHub Actions and Colab instead; they were not run locally.
- This branch contains implementation, automated fixture verification, and workflow scaffolding, not a trained model, production model deployment, or verified model-generated live edit. The PR remains open for review: https://github.com/18110priyanshuraj-creator/Jarvis/pull/107.
