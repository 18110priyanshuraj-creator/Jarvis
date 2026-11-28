# Trained model deployment

JARVIS already uses a configurable server-side OpenAI-compatible Chat Completions endpoint in services/ai-provider.js. Keep provider URL, model, and credentials on the backend. The Android app and browser must not receive provider secrets.

A separate model-serving endpoint may need GPU capacity. Do not assume an always-free GPU endpoint or place a 1B+ model on an ordinary CPU web service. Use staging first, HTTPS, authentication, request limits, timeouts, redacted logs, and server-side plan validation. Keep editing disabled until an authenticated integration test proves plan generation, validator acceptance/rejection, approval, execution, and output verification.

This branch prepares a release manifest only. It does not deploy or create a model endpoint. Configure secrets only in the chosen hosting provider after resource and cost terms are reviewed.
