# JARVIS Phase 1 — Native Central Orb Interface

**Status:** IN PROGRESS  
**Target:** Existing Android package `com.priyanshuraj.jarviscompanion`  
**Baseline:** Phase 0 closeout on `main`

## Objective

Make the native Android application open into a central animated JARVIS orb instead of opening directly into the pairing and permission checklist. The orb becomes the primary home surface while existing setup, pairing, voice and accessibility flows remain available.

## Implemented in this increment

- Add a custom native `OrbitalOrbView` rendered with Android Canvas, gradients, orbital rings, rotating arcs and orbit nodes.
- Keep the animation inside the view lifecycle; it starts when attached and stops when detached.
- Make the orb an accessible, focusable click target with a descriptive content label.
- Route a tap on the orb to the existing one-shot Android speech recognizer.
- Add a message field that first checks the existing local command processor, then uses the existing paired-device voice endpoint when needed.
- Add explicit Speak and Hands-free controls. Microphone use remains user-started and the existing foreground-service notification Stop behavior is preserved.
- Move the complete existing pairing, permissions, accessibility disclosure, activity log and device credential controls behind the Setup button.
- Preserve the existing Activity, package ID, pairing token store, device connector, server routes, voice service and accessibility boundaries.

## Non-goals in Phase 1

- No wake-word or hidden always-on microphone.
- No new accessibility permission, arbitrary screen tap, background screen capture or protected-control interaction.
- No persistence schema or server API migration.
- No replacement of the existing Node backend or browser orb.
- No claim of physical Samsung Galaxy Tab A9 verification based on CI.

## Acceptance checks

- Android CI must compile the existing application and produce a non-empty, structurally valid debug APK.
- The existing Android JVM test task must remain green.
- The orb, text submit, Speak, Hands-free and Setup controls must remain wired to real activity actions.
- Setup must retain all previous pairing, permission and local activity controls.
- Animation must stop when the view is detached.
- Real-device layout, touch, TalkBack, microphone permission and Hindi/English voice checks remain required on the Samsung Galaxy Tab A9 before Phase 1 can be marked VERIFIED.

