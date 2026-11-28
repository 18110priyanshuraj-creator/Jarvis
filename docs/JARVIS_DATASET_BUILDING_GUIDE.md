# Dataset building guide

Read ai-training/DATASET_GOVERNANCE.md and validate ai-training/schemas/source-manifest.schema.json before collecting examples. Use owned, licensed, public-domain with verified status, or directly authorized sources only. Unknown rights means exclude from training.

Each JSONL record uses a non-empty messages array with system/user/assistant text, an id, source_group, and source_manifest_id. source_group is the split boundary, so examples from one project or source cannot leak across train, validation, and test. Never put private conversations, irrelevant personal information, credentials, or unapproved project files in data.

Run: python ai-training/scripts/dataset_factory.py validate PATH. Then split a reviewed file using split PATH --out DIR. The helper checks malformed JSON, empty messages, unsupported roles, missing assistant answers, source groups, duplicate records, and common secret patterns. It is a useful first gate, not a rights or quality reviewer.

Keep evaluation material separate and source-disjoint. The starter examples are authored smoke fixtures and too few to train a useful model. Do not treat them as evidence of improved quality. Record version, source IDs, license/permission evidence, checksum, acquisition date, attribution and retention in the manifest.
