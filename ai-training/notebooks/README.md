# Colab notebooks

Start with JARVIS_Hybrid_Master_Training.ipynb for the staged workflow or 00_hardware_and_drive_audit.ipynb for a standalone GPU/Drive audit. Both use official Drive authorization and save persistent reports to Drive.

Modular notebooks are present for model selection, approved source review, leakage-safe data splits, editing examples, resumable QLoRA training, held-out evaluation, and release-manifest checks. See ../README.md and docs/JARVIS_TRAINING_MANAGER_GUIDE.md for the run order.

Notebook files are JSON-validated in GitHub Actions. Colab execution still requires the owner's authenticated Google account and an available runtime; no GPU run is claimed.
