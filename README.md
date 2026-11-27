# Jarvis Own AI — educational starter

This folder trains a tiny character-level GPT-style Transformer from random initialization.
It is intended to teach the training loop and model structure, not to create a ChatGPT-level model.

## Run in Google Colab

1. Upload this folder to your GitHub repository under `my-ai-model/`.
2. Open Google Colab and choose a Python notebook.
3. Clone your repository (replace the URL with your repository URL):

```python
!git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git
%cd YOUR-REPO/my-ai-model
!pip install -r requirements.txt
!python train.py
!python generate.py --prompt "Jarvis" --tokens 200
```

If you use a private repository, do not paste a personal access token into a notebook
that you share or commit. Use Colab's secure secrets feature or upload the files privately.

## Dataset

Replace `data/training.txt` with text you own or are licensed to use. Keep a backup.
For meaningful language behavior, a much larger, clean, diverse dataset is needed.

## Checkpoints

The trained checkpoint is written to `checkpoints/tiny_gpt.pt`.
Do not commit large model checkpoints to GitHub. Store them privately or use an
appropriate model-storage service.

## Important

This is a small character-level model. It is not instruction-tuned and will not
behave like ChatGPT. The next stage is evaluation, better tokenization, larger
licensed datasets, instruction tuning, and a separate inference service.
