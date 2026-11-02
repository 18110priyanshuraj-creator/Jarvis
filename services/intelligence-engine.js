import { tryRunLocalBrain } from "../brain.js";
import { getNluCapabilities } from "./nlu.js";

/**
 * Deterministic local capability layer.
 *
 * A null result means "not covered by deterministic rules", not an error.
 * Callers may then use live research or the explicitly configured model adapter.
 */
export function resolveOfflineAssistantTurn(input = {}) {
  const answer = tryRunLocalBrain(input);
  if (typeof answer !== "string" || !answer.trim()) return null;
  return {
    answer,
    engine: "built-in-offline",
    externalAI: false,
    liveWebChecked: false,
    intelligencePath: "offline-first"
  };
}

/** Safe public readiness metadata; never returns provider URLs, keys or raw model names. */
export function getIntelligenceStatus(aiProvider = {}) {
  return {
    naturalLanguageUnderstanding: getNluCapabilities(),
    localEngine: {
      id: "deterministic-rule-brain-v1",
      available: true,
      generalPurposeLanguageModel: false,
      capabilities: [
        "bounded arithmetic and scientific calculator",
        "bundled study, science and debugging notes",
        "read user-saved tasks and enabled memory notes",
        "search the user-reviewed Knowledge Library",
        "bounded local intent and Android app-search planning",
        "goal decomposition into reviewed workflow drafts"
      ]
    },
    taskPlanning: {
      available: true,
      mode: "deterministic-local-first-with-optional-model",
      maximumSteps: 10,
      requiresWorkflowApproval: true,
      executesWhenPlanIsCreated: false
    },
    routing: {
      conversation: "offline-first for covered requests; optional configured model for unsupported requests",
      devicePlanning: "local rule planner first; optional configured model for unsupported requests",
      currentInformation: "live research takes precedence when the request requires current sources"
    },
    optionalModelAdapter: {
      provider: typeof aiProvider.provider === "string" ? aiProvider.provider : "not-configured",
      configured: Boolean(aiProvider.configured),
      enabled: Boolean(aiProvider.enabled),
      conversationEnabled: Boolean(aiProvider.conversationEnabled),
      plannerEnabled: Boolean(aiProvider.plannerEnabled)
    }
  };
}
