const MAX_ROUNDS = 4;
const MAX_TOOL_CALLS = 6;
const MAX_TOOL_RESULT_CHARS = 7000;

function safeToolResult(value) {
  let serialized;
  try { serialized = JSON.stringify(value ?? { ok: true }); }
  catch { serialized = JSON.stringify({ ok: false, error: "Tool result could not be encoded." }); }
  return serialized.slice(0, MAX_TOOL_RESULT_CHARS);
}

/**
 * Run a bounded model/tool cycle over server-owned tools. The model can select
 * only the provided function names; it never receives a shell or arbitrary URL tool.
 */
export async function runToolLoop({ messages, tools, executeTool, completion, maxRounds = MAX_ROUNDS, maxToolCalls = MAX_TOOL_CALLS }) {
  if (!Array.isArray(messages) || !messages.length) throw new TypeError("Tool-agent messages are required.");
  if (!Array.isArray(tools) || !tools.length || typeof executeTool !== "function" || typeof completion !== "function") {
    throw new TypeError("Tool-agent tools, executor and completion function are required.");
  }
  const allowedNames = new Set(tools.map((tool) => tool?.function?.name).filter((name) => typeof name === "string"));
  if (!allowedNames.size) throw new TypeError("Tool-agent definitions must include function names.");
  const roundLimit = Number.isInteger(maxRounds) ? Math.max(1, Math.min(6, maxRounds)) : MAX_ROUNDS;
  const callLimit = Number.isInteger(maxToolCalls) ? Math.max(1, Math.min(10, maxToolCalls)) : MAX_TOOL_CALLS;
  const transcript = messages.map((message) => ({ ...message }));
  let callCount = 0;

  for (let round = 0; round < roundLimit; round++) {
    const response = await completion(transcript, {
      temperature: 0.35,
      maxTokens: 1200,
      ...(round < roundLimit - 1 && callCount < callLimit ? { tools } : {})
    });
    const calls = Array.isArray(response?.toolCalls) ? response.toolCalls : [];
    if (!calls.length) return { content: String(response?.content || "").trim(), toolCalls: callCount };
    if (round >= roundLimit - 1) {
      return { content: String(response?.content || "I reached the tool-step limit before I could finish. Please split the request into smaller steps.").trim(), toolCalls: callCount };
    }

    const boundedCalls = calls.slice(0, callLimit - callCount);
    if (!boundedCalls.length) return { content: "I reached the limit for tool actions in this request. Please split it into smaller steps.", toolCalls: callCount };
    transcript.push({
      role: "assistant",
      content: String(response.content || ""),
      tool_calls: boundedCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments }
      }))
    });

    for (const call of boundedCalls) {
      callCount++;
      let result;
      if (!allowedNames.has(call.name)) {
        result = { ok: false, error: "That tool is not available." };
      } else if (!call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) {
        result = { ok: false, error: "Tool arguments must be a JSON object." };
      } else {
        try {
          result = await executeTool(call.name, call.arguments);
        } catch {
          result = { ok: false, error: "The tool could not complete this request." };
        }
      }
      transcript.push({ role: "tool", tool_call_id: call.id, content: safeToolResult(result) });
    }
  }

  return { content: "I completed the available tool steps but could not produce a final reply. Please try a shorter request.", toolCalls: callCount };
}

export const TOOL_LOOP_LIMITS = Object.freeze({ rounds: MAX_ROUNDS, toolCalls: MAX_TOOL_CALLS, resultCharacters: MAX_TOOL_RESULT_CHARS });
