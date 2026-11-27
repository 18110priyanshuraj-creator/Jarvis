# JARVIS Media Studio — existing file map

This document maps the current main-branch editing implementation. The files are intentionally separated by runtime boundary; do not move them into a new modules/ directory without updating imports, static asset paths, route loading and tests in the same change.

## Browser workspace

- public/media-workspace.js — main browser Media Studio UI and timeline workspace.
- public/media-workspace.css — Media Studio styles.
- public/media-copilot.js — project analysis, edit-operation application and Copilot prompt/response helpers.
- public/media-asset-library.js — browser-side media asset management helpers.
- public/media-captions.js — caption normalization, SRT and timed caption utilities.
- public/media-editor-shortcuts.js — editor time and keyboard shortcut helpers.
- public/media-export-quality.js — browser-side export metadata quality checks.
- public/media-intent.js — media editing intent parsing.
- public/media-timeline-snapping.js — timeline snapping helpers.

## Server-side media and AI

- services/media-engine.js — canonical media project normalization, bounds and server-side media workflow logic.
- services/media-edit-plan.js — edit-plan normalization and validation support.
- services/media-visual-analysis.js — bounded visual/audio analysis request preparation and normalization.
- services/media-export-quality.js — server-side export quality checks.
- services/ai-provider.js — configured AI provider and OpenAI-compatible chat interface.
- services/web-research.js — live web research using the configured search service.
- services/web-page-reader.js — safe selected-page reading.
- services/source-answer.js — source-grounded answer construction.
- services/knowledge.js — knowledge normalization, trust and retrieval.
- services/knowledge-documents.js — document library metadata and review.

## Android

- android/app/src/main/java/com/priyanshuraj/jarviscompanion/accessibility/VideoEditorPolicy.kt — policy boundary for video-editor accessibility actions.
- Related Android accessibility observation/action code stays in the accessibility package and must retain its allowlists and user approval boundaries.

## Tests

- tests/media-engine.test.js
- tests/media-copilot.test.js
- tests/media-visual-analysis.test.js
- tests/media-export-quality.test.js
- tests/media-captions.test.js
- tests/media-intent.test.js
- tests/media-timeline-snapping.test.js
- tests/media-asset-library.test.js
- Android VideoEditorPolicy tests under android/app/src/test/.

## Why not physically move these files now?

The browser files are imported by public/media-workspace.js and served through the existing public asset layout. Server services are imported by server/routes and test modules. Android classes are compiled through the existing Gradle source layout. A cosmetic folder move would create broad import churn without adding capability.

The safe organization is to keep each file in its existing runtime area, use this map as the canonical index, and extract a submodule only when a tested compatibility layer and all imports can be migrated together.

## Known boundary

The browser Media Studio and timeline planner are not the same as a dedicated server-side render farm. Do not claim full cloud FFmpeg rendering, arbitrary third-party editor automation or end-to-end automatic export unless the corresponding worker, adapter and integration tests exist.
