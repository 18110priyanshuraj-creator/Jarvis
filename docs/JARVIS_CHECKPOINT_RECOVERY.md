# Checkpoint recovery

The QLoRA runner writes periodic Trainer checkpoints beneath the run directory and saves the final adapter plus training_result.json. Keep the run directory in Drive for persistence. If Colab disconnects, mount the same Drive, load the same code, model ID, immutable revision, and dataset splits, then rerun the same command with --resume.

Before resuming, verify checkpoint-* directories exist and contain trainer state, confirm dataset and model revision match the run manifest, and check available Drive/GPU space. The runner chooses the latest checkpoint by step number. After completion, verify adapter files and metrics. Do not delete earlier checkpoints until the adapter and evaluation report are backed up.

No checkpoint recovery has been tested on Colab yet.
