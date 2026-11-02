# Phase 12 — Android Action Engine

**Status:** VERIFIED — merged into `main` via PR #51; final post-merge main CI passed. Physical Samsung Galaxy Tab A9 acceptance remains Phase 31.  
**Scope:** Safe, explicit Android accessibility actions only.  
**Branch:** `main` (merged via PR #51)

## Goal

Turn the existing accessibility commands into a consistent, bounded action engine. Every action must target the current visible Android window, satisfy one shared policy, and report whether Android accepted or rejected the request. The engine does not infer coordinates, run scripts, or chain hidden actions.

## Supported actions

- Open an installed app by its exact or unambiguous launcher label.
- Tap one unique, exact visible accessibility label after safety checks.
- Scroll an enabled, visible scrollable area.
- Request Android Back or Home.
- Enter bounded, non-sensitive text only into the currently focused, visible, enabled, editable, non-password field.

No action sends, submits, purchases, pays, deletes, transfers, confirms, grants/revokes permissions, or interacts with credential/security controls. Text entry never presses Send or Submit.

## Shared action policy

`UiActionPolicy` is the same validator for local UI actions and AI-generated device plans.

- Label comparison collapses whitespace and ignores case, but remains exact; substring matching is not used.
- Tap requests reject consequential controls and protected parent/ancestor contexts (including send, submit, delete, purchase, payment, transfer, confirmation, permission and account-security controls).
- Visible screens containing password, passcode, PIN, OTP, verification, recovery, CVV/CVC, card-number or bank-account labels block actions that could interact with those screens.
- Text payloads are bounded, reject blank/oversized content, likely numeric codes and sensitive-action/credential terms.
- Text entry also checks the actual focused field is visible, enabled, editable, and not password-protected.
- Scroll targets must be visible, enabled, and scrollable.

## Target resolution and resource lifecycle

- Accessibility traversal is bounded to 180 visible nodes and depth 18.
- Clickable-parent search and protected-context inspection are bounded to six levels.
- A tap proceeds only when one unique actionable target remains. Ambiguous, disabled, hidden, protected, or missing targets fail closed.
- Accessibility node copies and parent/child wrappers are recycled after use to avoid retaining stale UI nodes.
- A new screen state is inspected for each action; nodes are not persisted for later replay.

## Structured outcomes

`UiActionResult` preserves the existing `ok` and `message` fields and adds a stable `UiActionCode` plus a `retryable` hint. Callers can distinguish missing windows/targets, ambiguity, disabled targets, protected actions, text-policy failures, and Android action rejection.

Messages are deliberately honest: a successful result means Android accepted the accessibility action request; it does not claim that the app completed a server-side transaction or that a new page loaded.

## Approval and safety boundary

- AI device plans still pass on-device validation and the existing explicit voice approval gate before execution.
- Direct spoken UI commands are explicit one-action requests.
- Protected/consequential controls are denied rather than presented as an approval option.
- No coordinate taps, unrestricted gestures, background screen scraping, arbitrary app code, shell commands, or remote execution were added.
- The Android Accessibility service remains manually enabled and can be disabled by the owner in Android Settings.

## Verification plan

- Pure JVM tests cover exact-label normalization, target state, protected controls/screens, text payload/field validation, and scroll preconditions.
- Agent-plan tests prove the server-supplied plan is checked against the same shared local policy before preview/approval.
- GitHub CI must pass Node tests, production dependency audit, Android unit tests, debug APK build, APK integrity checks, and artifact upload.
- Samsung Galaxy Tab A9 physical validation remains a Phase 31 acceptance gate.


## Merge and final main-branch verification

- Squash-merged through [PR #51](https://github.com/18110priyanshuraj-creator/Jarvis/pull/51).
- Merge commit: \`13093c603519a1e89478384ebc52e23b53869d7a\`.
- Post-merge main CI [run 41431242469](https://github.com/18110priyanshuraj-creator/Jarvis/actions/runs/41431242469): both jobs passed.
- Node.js: 197 tests passed, 0 failed; production dependency audit found 0 vulnerabilities.
- Android unit tests, debug APK build, APK integrity verification, SHA-256 generation, and artifact upload all passed.
- Final main debug artifact: \`jarvis-companion-debug\`, artifact ID \`13133489329\`, 23,972,123 bytes; GitHub retains it through 2026-11-09.

## Known limitations

- Apps must expose useful accessibility labels and actions. Canvas-rendered or custom controls without accessibility semantics may be unavailable.
- A unique label can still have app-specific meaning JARVIS cannot independently verify. The owner should inspect the visible screen before issuing commands.
- Android accepting a tap or text action is not proof that the app completed the intended operation.
- This phase does not provide general screen understanding, arbitrary gestures, transaction automation, or guaranteed app-by-app compatibility.
