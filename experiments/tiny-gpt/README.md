# TinyGPT educational experiment

This folder contains the original small character-level GPT experiment. It is kept for learning and comparison; it is not the production JARVIS model.

## What it does

- Starts from random weights.
- Uses a character-level vocabulary.
- Predicts the next character.
- Uses a small Transformer implemented in model.py.
- Saves a local checkpoint under checkpoints/tiny_gpt.pt.

The sample corpus is intentionally tiny. Low training loss on this sample does not mean the model understands instructions or can act as a useful assistant.

## Run locally or in Google Colab

1. Install the packages listed in requirements.txt.
2. Copy data/example-training.txt to data/training.txt.
3. Add only text you wrote or are explicitly licensed to use.
4. Run python train.py.
5. Run python generate.py --prompt "Jarvis" --tokens 100.

In Colab, clone the public JARVIS repository, change directory to experiments/tiny-gpt, and follow the same steps. Mount Google Drive and copy the checkpoints folder there before the runtime ends if you need to keep the experiment checkpoint.

## Files

- model.py — educational Transformer.
- config.py — small training configuration.
- train.py — next-character training loop.
- generate.py — checkpoint loading and text generation.
- data/example-training.txt — small safe example corpus.
- data/training.txt — your local training corpus; ignored by Git.
- checkpoints/ — local model checkpoints; ignored by Git.

## Important limitation

This model is not chat-template aware, not instruction tuned, and not a multimodal video editor. Do not connect it to JARVIS as the main assistant. The real JARVIS AI plan uses a pretrained instruction model, retrieval from approved knowledge, structured editing tools, evaluation and optional LoRA/QLoRA fine-tuning.
