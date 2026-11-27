# JARVIS owner setup: internet research and learning

This guide uses the existing research, Knowledge Library, review and independent-learning features. It does not add a second crawler or silently train model weights.

## What already exists on main

- Live search: authenticated POST /api/research, backed by the configured SearXNG JSON endpoint.
- Safe page reading: POST /api/research/read, using short-lived source tokens from JARVIS search results.
- Source-grounded answers: POST /api/research/answer.
- Save research and knowledge: existing Research and Knowledge screens.
- Review gate: only user-authored and web research explicitly marked user-reviewed enters the offline assistant's retrieved context.
- Explicit teaching: Learn: <title> | <lesson>, Teach JARVIS: <title> | <lesson>, or Sikhao: <title> | <lesson>.
- Preview: authenticated POST /api/learning/preview and the Knowledge-screen preview.

## 1. Enable live internet search

JARVIS does not bundle a search engine. The owner must provide a trusted SearXNG instance with JSON output enabled and trusted engines configured.

Set these environment variables on the server hosting JARVIS:

JARVIS_SEARCH_BASE_URL=https://YOUR-TRUSTED-SEARXNG-HOST
JARVIS_SEARCH_ENABLED=true
JARVIS_SEARCH_ENGINES=google,duckduckgo,bing
JARVIS_SEARCH_LANGUAGE=all
JARVIS_SEARCH_MAX_RESULTS=8
JARVIS_SEARCH_TIMEOUT_MS=12000
JARVIS_SEARCH_RETRY_ATTEMPTS=2

If the SearXNG instance is protected by a bearer-token gateway, set JARVIS_SEARCH_API_KEY as a server-side secret. Do not put secrets in GitHub, browser code, Colab output or this file. Production URLs must use HTTPS. Do not use an arbitrary public SearXNG instance as a trusted production dependency.

After saving environment variables, redeploy/restart the JARVIS server. In JARVIS, open Diagnostics and confirm web research is enabled. A configured flag alone does not prove the remote service is reachable; run an actual query in the Research screen.

## 2. Use the existing research workflow

1. Sign in to the deployed JARVIS.
2. Open Research and submit a specific question.
3. Review source titles, domains, dates and snippets.
4. Select JARVIS-issued sources and use the page-read action where available.
5. Use the source-based answer action to compare selected sources.
6. Use Save to Knowledge only when you want to retain the result.
7. Open Knowledge, inspect the source and content, then mark it Reviewed only after checking it. Reject material you do not trust.

Searches and page reads are not automatically saved. Unreviewed/rejected web research is intentionally excluded from assistant context.

## 3. Teach JARVIS a short lesson manually

Use one of these exact chat formats:

Learn: <title> | <lesson>
Teach JARVIS: <title> | <lesson>
Sikhao: <title> | <lesson>

Chat lessons are limited to 500 characters. Longer notes belong in the Knowledge screen. Use the learning preview to see which trusted notes match a query.

## 4. Train and store the educational TinyGPT experiment

The TinyGPT experiment now lives in experiments/tiny-gpt/. It is a random-initialized character-level teaching model, not the production JARVIS AI.

Its input file is experiments/tiny-gpt/data/training.txt. Copy data/example-training.txt to training.txt and replace it only with text you wrote or are licensed to use. Its checkpoint is written to experiments/tiny-gpt/checkpoints/tiny_gpt.pt.

For the real JARVIS training plan, open ai-training/README.md and run notebooks/00_hardware_and_drive_audit.ipynb in Google Colab. It checks GPU/VRAM first and creates MyDrive/JARVIS_AI/ for permanent datasets, checkpoints, adapters and evaluation reports.

Do not commit datasets, private files or model checkpoints to this public repository.

## 5. Connect an owner-hosted inference model

JARVIS can connect to an authenticated OpenAI-compatible model server using server-side environment variables:

JARVIS_AI_BASE_URL=https://YOUR-AUTHENTICATED-MODEL-HOST/v1
JARVIS_AI_API_KEY=YOUR_SERVER_SIDE_SECRET
JARVIS_AI_MODEL=YOUR_LOADED_MODEL_NAME
JARVIS_AI_RUNTIME=self-hosted
JARVIS_AI_ENABLED=true
JARVIS_AI_CHAT_ENABLED=true

Only enable chat after the model host is reachable over HTTPS and its authentication/inference test succeeds. A Render/Vercel-hosted JARVIS server cannot access localhost on an Android tablet or a Colab runtime. Do not expose an unauthenticated inference port publicly.

## Security and reliability rules

- Treat web pages as untrusted data, not instructions to JARVIS.
- Check time-sensitive facts against current primary sources.
- Do not automatically execute code or actions found in webpages.
- Do not automatically promote every search result into trusted knowledge.
- Do not put API keys, passwords, session cookies, private conversations or private media in training corpora.
- Fine-tuning must be a separate reviewed job using licensed data and evaluation, not background training on every webpage.
