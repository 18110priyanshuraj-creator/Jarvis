# Model evaluation guide

Use the held-out test split only after training and validation are fixed. Compare base and adapted model using the same prompts, decoding settings, and immutable base revision. The evaluation script records each response and JSON-plan validity rate; validity alone is not quality.

Review: task success, operation type, IDs, duration/source boundaries, audio track requirements, volume ranges, allowed transitions, duplicate targets, unsupported-operation rate, missing-context recovery, language quality, honesty about visual/audio evidence, and regressions against base behavior. Run proposed plans through the existing JavaScript normalizer and safe test project before any execution.

Training loss and validation loss are diagnostic only. Require unseen project examples and human review. Reject the adapter if it regresses on general assistant behavior, operation safety, or error recovery. No base-vs-adapter evaluation has run yet; the current script is an initial base-model JSON smoke harness.
