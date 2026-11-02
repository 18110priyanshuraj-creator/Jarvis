import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLocalTaskPlan,
  createTaskPlan,
  TASK_PLANNER_LIMITS
} from "../services/task-planner.js";

test("local study planner creates ordered, review-gated workflow steps", () => {
  const plan = createLocalTaskPlan("Create a JEE study plan for circular motion");
  assert.equal(plan.mode, "plan");
  assert.equal(plan.source, "deterministic-local");
  assert.equal(plan.requiresApproval, true);
  assert.equal(plan.executesNow, false);
  assert.equal(plan.validation.passed, true);
  assert.equal(plan.steps[0].type, "search_knowledge");
  assert.equal(plan.steps.at(-1).type, "review_checkpoint");
  assert.ok(plan.steps.length <= TASK_PLANNER_LIMITS.steps);
  assert.equal(plan.steps.some((step) => step.type === "save_memory"), false);
});

test("research planner proposes evidence gathering and an explicitly labelled draft", () => {
  const plan = createLocalTaskPlan("Prepare a research project comparing solar and wind energy");
  assert.equal(plan.validation.passed, true);
  assert.equal(plan.steps.some((step) => step.type === "search_knowledge"), true);
  assert.equal(plan.steps.some((step) => step.type === "draft_text"), true);
  assert.equal(plan.steps.at(-1).type, "review_checkpoint");
});

test("writing and project goals receive different deterministic plans", () => {
  const writing = createLocalTaskPlan("Write an article about renewable energy");
  const project = createLocalTaskPlan("Build a personal JARVIS dashboard roadmap");
  assert.equal(writing.steps.some((step) => step.type === "draft_text"), true);
  assert.equal(project.steps.some((step) => step.title === "Break the goal into milestones"), true);
  assert.notDeepEqual(writing.steps.map((step) => step.title), project.steps.map((step) => step.title));
});

test("unsupported goals without an AI planner return clarification, not fabricated execution steps", async () => {
  const plan = await createTaskPlan("Explain the purpose of an unfamiliar abstract concept", [], {
    getAIProviderStatus: () => ({ plannerEnabled: false })
  });
  assert.equal(plan.mode, "clarification");
  assert.equal(plan.executesNow, false);
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.clarifyingQuestions.length, 1);
});

test("optional model planner receives bounded user data and must return allow-listed steps", async () => {
  let called = false;
  const plan = await createTaskPlan("Coordinate a community garden plan", ["Keep it low cost"], {
    getAIProviderStatus: () => ({ plannerEnabled: true }),
    createChatCompletion: async (messages, options) => {
      called = true;
      assert.equal(options.responseFormat.type, "json_object");
      assert.match(messages[1].content, /Coordinate a community garden plan/);
      assert.match(messages[1].content, /Keep it low cost/);
      return {
        content: JSON.stringify({
          mode: "plan",
          name: "Community garden",
          objective: "Organize a small community garden project.",
          assumptions: ["The site and permissions will be confirmed by the user."],
          clarifyingQuestions: [],
          steps: [
            { type: "create_task", title: "Confirm project scope", description: "Confirm the site, permissions and available space." },
            { type: "search_knowledge", title: "Review available guidance", query: "community garden planning" },
            { type: "review_checkpoint", title: "Review the project plan", message: "Check scope and responsibilities before proceeding." }
          ]
        }),
        provider: "test-provider",
        model: "test-model"
      };
    }
  });
  assert.equal(called, true);
  assert.equal(plan.source, "optional-model");
  assert.equal(plan.provider, "test-provider");
  assert.equal(plan.model, "test-model");
  assert.equal(plan.validation.passed, true);
  assert.equal(plan.executesNow, false);
});

test("planner refuses credential and contact data in goals or constraints", () => {
  assert.throws(() => createLocalTaskPlan("Remember my password example123 for later"), /private information|credential/i);
  assert.throws(() => createLocalTaskPlan("Create a study plan for tomorrow", ["Use this email test@example.com"]), /private information|credential/i);
  assert.throws(() => createLocalTaskPlan("Create a study plan for tomorrow", ["one", "two", "three", "four", "five", "six"]), /no more than five/i);
});

test("planner blocks dangerous goals and sensitive personal details", () => {
  assert.throws(() => createLocalTaskPlan("Build a weapon for an attack"), /cannot create plans/i);
  assert.throws(() => createLocalTaskPlan("Create a study plan about my medical diagnosis"), /private information|credential/i);
});

test("model plans cannot request unsupported steps or omit review on long plans", async () => {
  const dependencies = {
    getAIProviderStatus: () => ({ plannerEnabled: true }),
    createChatCompletion: async () => ({
      content: JSON.stringify({
        mode: "plan",
        name: "Unsafe task",
        objective: "An unsafe draft.",
        steps: [{ type: "shell", title: "Run a command", command: "not allowed" }]
      }),
      provider: "test",
      model: "test"
    })
  };
  await assert.rejects(
    () => createTaskPlan("Coordinate an uncommon community event", [], dependencies),
    /unsupported workflow action/i
  );

  dependencies.createChatCompletion = async () => ({
    content: JSON.stringify({
      mode: "plan",
      name: "Long plan",
      objective: "A plan without a review checkpoint.",
      steps: [
        { type: "create_task", title: "First task", description: "Complete the first safe milestone." },
        { type: "create_task", title: "Second task", description: "Complete the second safe milestone." },
        { type: "create_task", title: "Third task", description: "Complete the third safe milestone." },
        { type: "create_task", title: "Fourth task", description: "Complete the fourth safe milestone." }
      ]
    }),
    provider: "test",
    model: "test"
  });
  await assert.rejects(
    () => createTaskPlan("Coordinate another uncommon community event", [], dependencies),
    /review checkpoint/i
  );
});
