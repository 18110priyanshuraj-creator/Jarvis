# JARVIS hybrid AI architecture

## Existing foundation

The repository already has an OpenAI-compatible server-side provider in services/ai-provider.js, project/scene editing in services/media-engine.js, edit-plan prompt and normalizer in services/media-edit-plan.js, visual analysis in services/media-visual-analysis.js, and knowledge/learning systems in services/knowledge.js and services/learning-engine.js. Keep these boundaries.

## Roles

- Foundation model: language and instruction-following behavior.
- Retrieval: approved, current knowledge from the existing knowledge pipeline.
- Fine-tuned adapter: repeatable JARVIS tone, tool-selection, and structured edit-plan behavior.
- Visual/audio analysis: bounded frame, transcript, timestamp, and measurement context from existing or separately verified analysis tools.
- Execution: deterministic media engine only.
- Memory: store user-approved preferences and reviewed lessons separately from training data and weights.

The model proposes. The server validates. The user reviews. Existing execution code performs the supported edit. A text-only adapter does not gain video perception by reading text examples.

## Edit-plan contract

services/media-edit-plan.js is authoritative. Its six operations are rewrite_scene, set_scene_transition, set_clip_volume, set_track_muted, move_clip, and trim_clip. Transitions are cut, fade, slide, wipe, and zoom. The current normalizer drops invalid proposals and rejects a plan with no actionable operations. Keep model output bounded and structured; never accept shell, arbitrary JavaScript, or unrestricted FFmpeg commands.

## Training decision

Use RAG for updated factual knowledge. Use SFT/LoRA only for reviewed behavioral examples. A separate quality MLP is deferred until sufficient human-labeled examples exist. No training or MLP result is claimed by this code branch.

## Limits and risks

The current notebooks and scripts prepare a conservative Colab workflow. This branch does not add an inference server, Android model runtime, real multimodal model, or tested model release. A real Colab hardware report and endpoint/device access are required for those checks.
