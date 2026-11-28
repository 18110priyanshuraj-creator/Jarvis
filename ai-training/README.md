# JARVIS AI Training Workspace

This branch contains a staged, Colab-oriented model adaptation workflow. It does not train on arbitrary web pages or videos and does not claim a model is trained before a real GPU run produces verifiable artifacts.

## Architecture

1. A pretrained instruction model supplies broad language capability.
2. The existing Knowledge pipeline retrieves reviewed, current facts.
3. LoRA/QLoRA SFT teaches repeatable JARVIS behavior and structured edit proposals.
4. Existing deterministic media tools perform edits after server validation and user review.

The existing provider, edit-plan validator, media engine, visual analysis, knowledge, learning, and Android Companion remain the production foundations. Read docs/JARVIS_HYBRID_AI_ARCHITECTURE.md for boundaries and limitations.

## Start here

Open notebooks/JARVIS_Hybrid_Master_Training.ipynb on this branch in Colab. Begin with the hardware audit stage. Mount Drive through the official Google prompt. Review model_candidates.json and current official model terms before choosing a model. Training requires a measured eligible CUDA GPU, an immutable model revision, and reviewed source-separated data. Free Colab GPU access is not guaranteed.

The existing notebooks/00_hardware_and_drive_audit.ipynb remains available for hardware and Drive setup by itself. Modular notebooks 01 through 07 cover candidate selection, source approval, dataset splits, editing examples, QLoRA, evaluation, and adapter release checks.

## Data and artifacts

Read DATASET_GOVERNANCE.md. Keep private data, checkpoints, adapters, and evaluation outputs in private Google Drive. GitHub contains only code, schemas, and small authored smoke fixtures. The starter examples are not enough to train a useful model. Unknown source rights, secrets, private conversations, and unapproved media must be excluded.

## Local checks

The CPU-safe dataset validator and unit tests require Python 3.11 or newer. Run python ai-training/scripts/dataset_factory.py validate ai-training/datasets/starter/general.jsonl and python -m unittest discover -s ai-training/tests -v. GitHub Actions validates notebook JSON, authored JSONL, Python syntax, and the dataset tests. GPU training is not run in CI.

## Honest release status

The notebooks/scripts are implemented, but they have not been run in Colab. No Drive folder, hardware report, baseline inference, checkpoint, adapter, evaluation result, trained model, endpoint, or deployment is claimed. A release manifest defaults to deployment disabled. Read the training, evaluation, recovery, deployment, and Android guides under docs/.
