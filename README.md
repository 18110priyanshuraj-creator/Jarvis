# JARVIS

JARVIS is a personal assistant project with a Node.js backend, Android Companion, AI-provider integration, research and knowledge workflows, and a browser-based Media Studio.

## Repository layout

- android/ — Android Companion app and on-device policies.
- public/ — browser dashboard, Media Studio, creator tools and client-side modules.
- services/ — server-side AI, media, research, knowledge, memory and workflow services.
- routes/ — HTTP route modules.
- tests/ — Node.js and Android regression tests.
- docs/ — architecture, implementation phases, operations and acceptance notes.
- ai-training/ — governed dataset and model-training workspace for future JARVIS adapters.
- experiments/tiny-gpt/ — isolated educational character-level Transformer experiment. It is not the production JARVIS brain.

## Requirements

- Node.js 22 or newer.
- npm.
- Android Studio / Android SDK only when building the Android app.

## Run the server locally

1. Install dependencies with npm ci.
2. Create a local .env from .env.example and set only the secrets required for your environment.
3. Run npm run check.
4. Run npm start.

Never commit .env files, API keys, passwords, OAuth tokens, model checkpoints, private media or private training datasets.

## Existing AI and learning architecture

JARVIS already has separate layers for:

- AI-provider calls through services/ai-provider.js.
- Source-grounded internet research through services/web-research.js, services/web-page-reader.js and services/source-answer.js.
- Persistent, reviewable knowledge through services/knowledge.js and services/knowledge-documents.js.
- Explicit user-taught retrieval lessons through services/learning-engine.js.
- Media editing and planning through the public Media Studio and services/media-* modules.

Saving reviewed knowledge does not modify model weights. Fine-tuning is a separate, deliberate process described in ai-training/ and docs/JARVIS_AI_LEARNING_AND_VIDEO_TRAINING_PLAN.md.

## Media Studio

Start with docs/JARVIS_VIDEO_EDITING_FILE_MAP.md for the existing media files and their responsibilities. Existing files remain in public/, services/, android/ and tests/ because their runtime boundaries and imports depend on those locations.

## Training experiment

The old root-level TinyGPT files have been moved to experiments/tiny-gpt/ so they do not look like the production assistant. That experiment is useful for learning Transformer mechanics only; it is not instruction tuned, not trained on internet-scale data and not compatible with the production chat API without a separate adapter.
