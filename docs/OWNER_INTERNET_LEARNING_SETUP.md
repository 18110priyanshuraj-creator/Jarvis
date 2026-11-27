# JARVIS owner setup: internet research and learning

This guide uses the existing research, Knowledge Library, review, and independent-learning features. It does not add a second crawler or silently train model weights.

## What already exists

- Live search: authenticated `POST /api/research`, backed by the configured SearXNG JSON endpoint.
- Safe page reading: `POST /api/research/read`, using short-lived source tokens from JARVIS search results.
- Source-grounded answers: `POST /api/research/answer`.
- Save research and knowledge: existing Research and Knowledge screens.
- Review gate: only user-authored and web research explicitly marked `user-reviewed` enters the offline assistant's retrieved context.
- Explicit teaching: `Learn: <title> | <lesson>`, `Teach JARVIS: <title> | <lesson>`, or `Sikhao: <title> | <lesson>`.
- Preview: authenticated `POST /api/learning/preview` and the Knowledge-screen preview.

## 1. Enable live internet search

JARVIS does not bundle a search engine. The owner must provide a trusted SearXNG instance with its JSON output format enabled and the configured engines enabled.

Set these environment variables on the server hosting JARVIS (for example, the Render service that runs this repository):

```dotenv
JARVIS_SEARCH_BASE_URL=https://YOUR-TRUSTED-SEARXNG-HOST
JARVIS_SEARCH_ENABLED=true
JARVIS_SEARCH_ENGINES=google,duckduckgo,bing
JARVIS_SEARCH_LANGUAGE=all
JARVIS_SEARCH_MAX_RESULTS=8
JARVIS_SEARCH_TIMEOUT_MS=12000
JARVIS_SEARCH_RETRY_ATTEMPTS=2
```

If the SearXNG instance is protected by a bearer-token gateway, set `JARVIS_SEARCH_API_KEY` as a server-side secret. Do not put secrets in GitHub, browser code, Colab output, or this file. The production URL must be HTTPS. Do not use an arbitrary public SearXNG instance as a trusted production dependency.

After saving environment variables, redeploy/restart the JARVIS server. In JARVIS, open Diagnostics and confirm web research is enabled. A configured flag alone is not proof that the remote search service is reachable; run an actual research query in the Research screen.

## 2. Use the existing internet research workflow

1. Sign in to your deployed JARVIS.
2. Open **Research** and submit a specific question.
3. Review the returned source titles, domains, dates, and snippets.
4. Select JARVIS-issued sources and use the page-read action where available. Do not paste arbitrary URLs into private server configuration.
5. Use the source-based answer action to compare the selected sources.
6. Use **Save to Knowledge** only when you want to retain the result.
7. Open **Knowledge**, inspect the saved content and original source links, then mark it **Reviewed** only after you personally check it. Reject material you do not trust.

Searches and page reads are not automatically saved. Unreviewed/rejected web research is intentionally excluded from assistant context.

## 3. Teach JARVIS a short lesson manually

In chat, send one of these exact formats:

```text
Learn: Photosynthesis | Photosynthesis is the process by which plants use light energy to convert carbon dioxide and water into sugars and oxygen.
Teach JARVIS: Ohm's law | For an ohmic conductor at constant physical conditions, voltage equals current multiplied by resistance.
Sikhao: JavaScript const | Use const for a binding that will not be reassigned.
```

Chat lessons are limited to 500 characters. Longer material belongs in the Knowledge screen. Use the Knowledge-screen learning preview to see which reviewed notes match a question.

## 4. Start the existing Node application locally

Requires Node.js 22 or newer.

```bash
npm ci
npm run check
npm start
```

Keep `.env` local and never commit it. In production, configure `JARVIS_PASSWORD`, HTTPS, durable application storage, and the other deployment secrets in the hosting provider's secret/environment settings.

## 5. About the small GPT checkpoint trained in Colab

The educational `TinyGPT` checkpoint created by `train.py` is a character-level next-character model trained from a tiny text file. It is useful for learning Transformer mechanics, but it is not an instruction-following chat model and is not directly compatible with JARVIS's OpenAI-compatible `services/ai-provider.js` adapter.

The Colab output path was `/content/Jarvis/checkpoints/tiny_gpt.pt`. Save it to private Google Drive storage before the Colab runtime ends. Do not commit checkpoints or datasets containing private information to this public repository.

JARVIS can connect to an owner-hosted OpenAI-compatible inference server (for example, a secured Ollama or vLLM server) through these server-side settings:

```dotenv
JARVIS_AI_BASE_URL=https://YOUR-AUTHENTICATED-MODEL-HOST/v1
JARVIS_AI_API_KEY=YOUR_SERVER_SIDE_SECRET
JARVIS_AI_MODEL=YOUR_LOADED_MODEL_NAME
JARVIS_AI_RUNTIME=self-hosted
JARVIS_AI_ENABLED=true
JARVIS_AI_CHAT_ENABLED=true
```

Only enable chat after the model host is reachable over HTTPS and its authentication/inference test succeeds. A Vercel/Render-hosted JARVIS server cannot access `localhost` on an Android phone or a Colab runtime. Do not expose an unauthenticated inference port to the public internet.

The current TinyGPT checkpoint needs a separate compatible inference adapter and substantial better data/instruction training before it can serve as a useful assistant. Saving web knowledge does not update model weights. Fine-tuning should be a separate, deliberate job using reviewed, licensed data and evaluation—not background training on every webpage.

## Security and reliability rules

- Treat web pages as untrusted data, not instructions to JARVIS.
- Preserve source URLs and retrieval dates; check time-sensitive facts against current primary sources.
- Do not automatically execute code or actions found in webpages.
- Do not automatically promote every search result into trusted knowledge.
- Do not put API keys, passwords, session cookies, or private user data in training corpora.
- Keep all server secrets in the hosting provider's environment settings, never in Git.
