# JARVIS Hatchable edition

This branch contains the Hatchable deployment target for the JARVIS project.

Live project: https://jarvis-hatchable.hatchable.site
Hatchable console: https://hatchable.com/console/projects/jarvis-hatchable

The live Hatchable project was built as a separate native implementation because Hatchable does not run the original Node/Express server or persist local filesystem state. Its deployed source is maintained in the Hatchable project workspace.

## Included in v1
- Private, owner/admin-only JARVIS dashboard
- AI chat endpoint (requires the project owner to configure an AI provider in Hatchable Setup)
- PostgreSQL-backed tasks and explicit saved notes
- System status view and health endpoint

## Not migrated yet
The original Express backend, Android Companion, device-control bridge, external OAuth integrations, web research adapters, media/YouTube publishing, specialist workers, scheduler, and autonomous workflow engine remain in the original implementation and are not available in this Hatchable edition.

## Security and persistence
Every API route is gated with access = admin. Tasks and notes are scoped to the authenticated project owner. Chat history is kept in the current browser tab and is not saved to the database. No device, messaging, payment, or publishing tools are exposed by the chat endpoint.

## Deployment
The Hatchable project is a private personal project. Visitors must pass the Hatchable sign-in wall; public visibility can only be changed by the owner in project Settings.