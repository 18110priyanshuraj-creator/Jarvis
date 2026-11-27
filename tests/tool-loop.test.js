import { test } from "node:test";
import assert from "node:assert/strict";
import { runToolLoop } from "../services/tool-loop.js";

const tools = [{
  type: "function",
  function: {
    name: "lookup",
    description: "Read a bounded record.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false }
  }
}];

test("tool loop executes an allow-listed call then returns the model's final answer", async () => {
  const transcripts = [];
  let executions = 0;
  const result = await runToolLoop({
    messages: [{ role: "user", content: "Find the saved note." }],
    tools,
    executeTool: async (name, args) => {
      executions++;
      assert.equal(name, "lookup");
      assert.deepEqual(args, { query: "note" });
      return { ok: true, value: "Found it." };
    },
    completion: async (messages, options) => {
      transcripts.push({ messages: structuredClone(messages), options });
      if (transcripts.length === 1) return {
        content: "",
        toolCalls: [{ id: "call_1", name: "lookup", arguments: { query: "note" } }]
      };
      assert.equal(messages.at(-1).role, "tool");
      assert.equal(messages.at(-1).tool_call_id, "call_1");
      assert.equal(JSON.parse(messages.at(-1).content).value, "Found it.");
      return { content: "I found the saved note." };
    }
  });

  assert.equal(result.content, "I found the saved note.");
  assert.equal(result.toolCalls, 1);
  assert.equal(executions, 1);
  assert.equal(transcripts[0].options.tools, tools);
});

test("unlisted model tool calls are never executed", async () => {
  let executions = 0;
  const result = await runToolLoop({
    messages: [{ role: "user", content: "Try a tool." }],
    tools,
    executeTool: async () => { executions++; },
    completion: async (messages) => messages.some((item) => item.role === "tool")
      ? { content: "I only used the available tool." }
      : { content: "", toolCalls: [{ id: "call_bad", name: "run_shell", arguments: { command: "whoami" } }] }
  });

  assert.equal(executions, 0);
  assert.equal(result.content, "I only used the available tool.");
});

test("tool loop will not execute another call after reaching its round limit", async () => {
  let executions = 0;
  const result = await runToolLoop({
    messages: [{ role: "user", content: "Read this." }],
    tools,
    maxRounds: 1,
    executeTool: async () => { executions++; },
    completion: async () => ({ content: "Need another step.", toolCalls: [{ id: "call_2", name: "lookup", arguments: { query: "again" } }] })
  });

  assert.equal(executions, 0);
  assert.equal(result.content, "Need another step.");
  assert.equal(result.toolCalls, 0);
});
