# Training manager guide

Open ai-training/notebooks/JARVIS_Hybrid_Master_Training.ipynb from the development branch in Colab. Use the stage selector and run from top to bottom. The existing 00_hardware_and_drive_audit.ipynb remains the standalone Drive setup path.

## Stages

1. Audit: inspect Python, PyTorch, CUDA, GPU, VRAM, RAM, and disk; mount Drive through Google's authorization; create the JARVIS_AI folder tree; write a report.
2. Validate: check authored/reviewed JSONL. Splitting requires at least three independent source groups.
3. Baseline: choose a candidate only after checking the live hardware and model license. Pin the resolved Hugging Face commit SHA.
4. Train: run QLoRA with 4-bit NF4, LoRA, gradient checkpointing, batch size 1, accumulation 8, periodic checkpoints, and evaluation loss.
5. Evaluate: run held-out examples and inspect generated plans against the backend's edit-plan contract.
6. Release: write a checksum manifest with deployment disabled. This is not approval or deployment.

Drive stores data and model outputs; Colab's temporary filesystem is not persistent. Resume from the run's latest checkpoint. Never report training success without a training result, adapter files, checkpoint evidence, and evaluation report.

## Current limitation

The notebook workflow is authored but has not been executed in an authenticated Colab runtime. No Drive folder, GPU report, checkpoint, adapter, or endpoint is claimed to exist yet.
