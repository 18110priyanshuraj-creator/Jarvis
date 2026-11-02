# JARVIS Phase 7 — Natural Language Understanding

**Status:** CODE_COMPLETE — shared deterministic intent classification, multilingual detection and regression tests are implemented.

## Implemented
- Added a shared server-side classifier for greeting, identity, capabilities, calculator, task lookup, saved-note lookup, date/time, gratitude, app request, current information and knowledge question intents.
- Added English, Hindi-script and Hinglish language labels with bounded confidence metadata.
- Every assistant response includes an `nlu` object containing intent, confidence, language, entities and matched rule.
- The health readiness response advertises the NLU version and supported languages.
- Classification is metadata only. It does not execute Android actions or bypass the existing planner and device-side validation.
- Ambiguous requests remain `general_question` rather than being promoted to an action.

## Limitations
- Confidence is a heuristic, not a calibrated probability.
- Hindi/Hinglish recognition uses a bounded phrase and script rule set; broad dialect coverage and speech-accent recognition are not claimed.
- This is deterministic NLU, not a trained language model.

## Verification
- Regression tests cover 18 multilingual examples, metadata bounds, ambiguous input and invalid input.
- Existing Node suite and production dependency audit remain required CI gates.
- No Android behavior changed in this phase. Physical Galaxy Tab A9 acceptance remains Phase 31.

## Acceptance
Phase 7 is code-complete when the shared classifier is attached to assistant turns, multilingual examples pass, ambiguous input cannot authorize actions, and full CI passes.
