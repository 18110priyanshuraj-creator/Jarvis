# Phase 22 — System Readiness & Final Integration

## Goal

Provide one authenticated, read-only view of whether JARVIS's core storage and optional capabilities are available. Make the distinction between configured, enabled, and actually connected components explicit.

## Authenticated diagnostics API

`GET /api/diagnostics` is protected by the existing JARVIS session and a dedicated rate limit. It returns:

- Overall status: `ready`, `attention`, or `degraded`.
- Primary persistent-state storage mode and a safe readiness summary.
- Temporary chat history storage mode and its retention limits.
- AI conversation and Android-planner configuration/enabled flags.
- Live web search, secure page reading and source-based answer availability.
- Google Drive OAuth client, encrypted token-vault and connected-record readiness.
- External integration configuration/enabled flags, without probing those providers.
- Active Android Companion count and the count reporting Accessibility enabled.
- Aggregate counts for saved tasks, memories, knowledge, research and workflows.

## Storage checks

When `DATABASE_URL` is configured, diagnostics runs a small read-only query against the JARVIS application-state record. It does not migrate tables or modify stored data.

Without `DATABASE_URL`, diagnostics checks that the local JSON state file is accessible and reports the local-file mode with a warning. This does not guarantee that a hosting platform preserves that file across redeploys or instance replacement.

Temporary conversation storage is reported separately. It uses Neon runtime tables when configured; otherwise it uses process memory and is cleared when the process restarts.

## System Status dashboard

The new **System Status** navigation view:

- Calls the private diagnostics endpoint only when the user opens the view or presses **Run system check**.
- Shows the overall state, generation time, individual checks, summaries and safe capability details.
- Renders server-provided values as text; it does not inject provider output as HTML.
- Does not change connection settings, permissions, credentials, data or devices.

## Security and privacy

The diagnostics payload does not include credential values, access/refresh tokens, encryption keys, database URLs, raw filesystem paths, device names, session identifiers or environment-variable values.

The diagnostics endpoint does not initiate an external search or test GitHub, Google Drive, Telegram or ElevenLabs. A provider marked configured only means its server-side configuration appears present. Use the existing Connections **Test connection** action to contact that provider when desired.

The unauthenticated `/api/health` route remains separate and retains its existing limited capability metadata. The new detailed inventory is never public.

## Verification

Tests cover:

- Anonymous requests receive HTTP 401.
- Authenticated diagnostics reports the expected local fallback modes in the isolated test environment.
- Provider flags, device count and inventory counts are safely represented.
- Passwords, OAuth client secrets, token-encryption keys and bot credentials do not appear in the response.
- The existing Node.js suite, production dependency audit, Android unit tests, Android APK build and APK verification remain required CI gates.

## Manual release checks

The automated report does not replace physical-device testing, a deliberately initiated provider connection test, verification of Google OAuth against the real configured client, or a review of persistent storage guarantees on the production host. It does not claim that every external provider is connected or that every Android action has been tested on a physical device.
