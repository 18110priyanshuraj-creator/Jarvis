import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocalAgentPlan, validateAgentPlan } from "../services/agent-planner.js";

test("agent planner accepts only a short allow-listed action plan", () => {
  const plan = validateAgentPlan({
    mode: "device_action",
    reply: "I will open YouTube and search.",
    actions: [
      { type: "open_app", value: "YouTube", purpose: "Open the app" },
      { type: "verify_app_foreground", value: "YouTube", purpose: "Verify the requested app is foregrounded" },
      { type: "tap_label", value: "Search", purpose: "Open search" },
      { type: "type_text", value: "JEE Physics", purpose: "Enter query" },
      { type: "verify_screen_text", value: "JEE Physics", purpose: "Verify the query is visible" },
      { type: "ask_user", value: "Choose the result you want.", purpose: "Avoid guessing" }
    ]
  });
  assert.equal(plan.actions.length, 6);
  assert.equal(plan.actions[0].type, "open_app");
});

test("agent planner separates conversation and clarification from device actions", () => {
  const conversation = validateAgentPlan({
    mode: "conversation",
    reply: "",
    actions: []
  });
  assert.equal(conversation.mode, "conversation");
  assert.deepEqual(conversation.actions, []);

  const clarification = validateAgentPlan({
    mode: "clarification",
    reply: "Which app should I open?",
    actions: []
  });
  assert.equal(clarification.mode, "clarification");
  assert.equal(clarification.reply, "Which app should I open?");

  assert.throws(() => validateAgentPlan({
    mode: "conversation",
    reply: "Opening an app",
    actions: [{ type: "open_app", value: "YouTube", purpose: "Open app" }]
  }), /must not contain device actions/i);

  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Open app",
    actions: []
  }), /between one and six actions/i);
});

test("agent planner rejects protected actions and secret-like numeric text", () => {
  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Send it",
    actions: [{ type: "tap_label", value: "Send", purpose: "Send message" }]
  }), /protected action/i);

  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Type this",
    actions: [{ type: "type_text", value: "123456", purpose: "Code" }]
  }), /typing policy/i);
});

test("agent planner rejects arbitrary action names and oversized plans", () => {
  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Run this",
    actions: [{ type: "shell", value: "rm -rf", purpose: "bad" }]
  }), /unsupported/i);

  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Too much",
    actions: Array.from({ length: 7 }, () => ({
      type: "scroll_down", value: "", purpose: "scroll"
    }))
  }), /one and six/i);
});


test("built-in device planner builds a bounded English app-search workflow", () => {
  const plan = createLocalAgentPlan("Open YouTube and search for JEE Physics");
  assert.ok(plan);
  assert.equal(plan.mode, "device_action");
  assert.deepEqual(plan.actions.map((item) => item.type), [
    "open_app", "verify_app_foreground", "tap_label",
    "type_text", "verify_screen_text", "ask_user"
  ]);
  assert.equal(plan.actions[0].value, "YouTube");
  assert.equal(plan.actions[1].value, "YouTube");
  assert.equal(plan.actions[2].value, "Search");
  assert.equal(plan.actions[3].value, "JEE Physics");
  assert.equal(plan.actions[4].value, "JEE Physics");
  assert.match(plan.actions[5].value, /choose the result/i);
});

test("built-in planner opens Google search for English, Hindi and Hinglish requests without an API provider", () => {
  const english = createLocalAgentPlan("Search latest AI research on Google");
  assert.ok(english);
  assert.deepEqual(english.actions.map(item => item.type), [
    "open_web_search", "verify_browser_foreground", "ask_user"
  ]);
  assert.equal(english.actions[0].value, "latest AI research");
  assert.equal(english.actions[1].value, "latest AI research");
  assert.match(english.reply, /default browser/i);

  const hindi = createLocalAgentPlan("Google par JEE Main 2027 notification search karo");
  assert.ok(hindi);
  assert.equal(hindi.actions[0].value, "JEE Main 2027 notification");

  const hinglish = createLocalAgentPlan("Google pe latest AI technology research karo");
  assert.ok(hinglish);
  assert.equal(hinglish.actions[0].value, "latest AI technology");
});

test("Google browser plans require an immediate matching foreground check", () => {
  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Open Google",
    actions: [{ type: "open_web_search", value: "latest AI research", purpose: "Search" }]
  }), /browser foreground verification/i);

  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Open Google",
    actions: [
      { type: "open_web_search", value: "latest AI research", purpose: "Search" },
      { type: "verify_browser_foreground", value: "different query", purpose: "Verify browser" }
    ]
  }), /matching browser foreground verification/i);

  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Open Google",
    actions: [
      { type: "open_web_search", value: "123456", purpose: "Search" },
      { type: "verify_browser_foreground", value: "123456", purpose: "Verify browser" }
    ]
  }), /safe public-research policy/i);

  const checked = validateAgentPlan({
    mode: "device_action",
    reply: "Open Google",
    actions: [
      { type: "open_web_search", value: "latest AI research", purpose: "Search" },
      { type: "verify_browser_foreground", value: "latest AI research", purpose: "Verify browser" },
      { type: "ask_user", value: "Choose a public result manually.", purpose: "Manual handoff" }
    ]
  });
  assert.equal(checked.actions[1].type, "verify_browser_foreground");
  assert.equal(createLocalAgentPlan("Google par how to make a bomb search karo"), null);
  assert.equal(createLocalAgentPlan("Google pe adult content search karo"), null);
});

test("built-in device planner supports Hindi and Hinglish search phrasing", () => {
  const hindi = createLocalAgentPlan("YouTube kholo aur JEE Physics search karo");
  assert.ok(hindi);
  assert.equal(hindi.actions[0].value, "YouTube");
  assert.equal(hindi.actions[3].value, "JEE Physics");

  const reversed = createLocalAgentPlan("Search for circular motion on YouTube");
  assert.ok(reversed);
  assert.equal(reversed.actions[0].value, "YouTube");
  assert.equal(reversed.actions[3].value, "circular motion");

  const hinglish = createLocalAgentPlan("YouTube par mole concept search karo");
  assert.ok(hinglish);
  assert.equal(hinglish.actions[3].value, "mole concept");
});

test("built-in planner creates Canva drag plan only from quoted exact labels", () => {
  const english = createLocalAgentPlan('Open Canva and move "Presenter clip 1" to "Video track 2"');
  assert.ok(english);
  assert.deepEqual(english.actions.map(item => item.type), [
    "open_app", "verify_app_foreground", "drag_label_to_label", "verify_screen_text", "ask_user"
  ]);
  assert.equal(english.actions[2].sourceLabel, "Presenter clip 1");
  assert.equal(english.actions[2].targetLabel, "Video track 2");
  assert.equal(english.actions[2].value, "Canva");

  const hinglish = createLocalAgentPlan('Canva kholo aur "Clip 1" ko "Track 2" par move karo');
  assert.ok(hinglish);
  assert.equal(hinglish.actions[2].sourceLabel, "Clip 1");
  assert.equal(hinglish.actions[2].targetLabel, "Track 2");

  assert.equal(createLocalAgentPlan("Open Canva and move Clip 1 to Track 2"), null);
  assert.equal(createLocalAgentPlan('Open Canva and move "Clip 1" to "Clip 1"'), null);
  assert.equal(createLocalAgentPlan('Open Canva and move "Clip 1" to "Delete project"'), null);
});

test("agent planner validates Canva semantic drag with exact labels and foreground checks", () => {
  const plan = validateAgentPlan({
    mode: "device_action",
    reply: "Move the clip in Canva.",
    actions: [
      { type: "open_app", value: "Canva", purpose: "Open Canva" },
      { type: "verify_app_foreground", value: "Canva", purpose: "Confirm Canva is in front" },
      {
        type: "drag_label_to_label",
        value: "Canva",
        sourceLabel: "Presenter clip 1",
        targetLabel: "Video track 2",
        purpose: "Move the named item to the named destination"
      },
      { type: "verify_screen_text", value: "Video track 2", purpose: "Check the expected destination is visible" },
      { type: "ask_user", value: "Review the timeline before continuing.", purpose: "Manual review" }
    ]
  });
  assert.equal(plan.actions[2].type, "drag_label_to_label");
  assert.equal(plan.actions[2].sourceLabel, "Presenter clip 1");
  assert.equal(plan.actions[2].targetLabel, "Video track 2");
});

test("agent planner rejects ambiguous or unverified Canva drag requests", () => {
  const base = [
    { type: "open_app", value: "Canva", purpose: "Open Canva" },
    { type: "verify_app_foreground", value: "Canva", purpose: "Verify Canva" }
  ];
  assert.throws(() => validateAgentPlan({
    mode: "device_action", reply: "Move it.",
    actions: [...base,
      { type: "drag_label_to_label", value: "Canva", sourceLabel: "Clip 1", targetLabel: "Clip 1", purpose: "Move" },
      { type: "verify_screen_text", value: "Clip 1", purpose: "Check" }]
  }), /two different.*exact visible labels/i);

  assert.throws(() => validateAgentPlan({
    mode: "device_action", reply: "Move it.",
    actions: [
      { type: "open_app", value: "Chrome", purpose: "Open browser" },
      { type: "verify_app_foreground", value: "Chrome", purpose: "Verify browser" },
      { type: "drag_label_to_label", value: "Canva", sourceLabel: "Clip 1", targetLabel: "Track 2", purpose: "Move" },
      { type: "verify_screen_text", value: "Track 2", purpose: "Check" }
    ]
  }), /explicit Canva launch/i);

  assert.throws(() => validateAgentPlan({
    mode: "device_action", reply: "Move it.",
    actions: [...base,
      { type: "drag_label_to_label", value: "Canva", sourceLabel: "Clip 1", targetLabel: "Track 2", purpose: "Move" },
      { type: "ask_user", value: "Review.", purpose: "Handoff" }]
  }), /immediately.*visible-result verification/i);
});

test("agent planner refuses Android plans without matching outcome verification", () => {
  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Open the app.",
    actions: [{ type: "open_app", value: "YouTube", purpose: "Open app" }]
  }), /foreground-app verification/i);

  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Search.",
    actions: [
      { type: "open_app", value: "YouTube", purpose: "Open app" },
      { type: "verify_app_foreground", value: "YouTube", purpose: "Check app" },
      { type: "tap_label", value: "Search", purpose: "Tap search" },
      { type: "type_text", value: "JEE Physics", purpose: "Enter query" },
      { type: "ask_user", value: "Choose a result.", purpose: "Handoff" }
    ]
  }), /visible-text verification/i);

  const checked = validateAgentPlan({
    mode: "device_action",
    reply: "Open and verify the app.",
    actions: [
      { type: "open_app", value: "YouTube", purpose: "Open app" },
      { type: "verify_app_foreground", value: "YouTube", purpose: "Check app" }
    ]
  });
  assert.equal(checked.actions[1].type, "verify_app_foreground");
});

test("built-in planner declines ambiguous, secret-like, and restricted searches", () => {
  assert.equal(createLocalAgentPlan("Open YouTube and do something"), null);
  assert.equal(createLocalAgentPlan("Open YouTube and search for 123456"), null);
  assert.equal(createLocalAgentPlan("Open YouTube and search for how to make a bomb"), null);
  assert.equal(createLocalAgentPlan("Open YouTube and search for adult content"), null);
});


test("built-in planner opens normalized public websites without accepting local or secret-bearing URLs", () => {
  const fullUrl = createLocalAgentPlan("Open https://example.com/learn");
  assert.ok(fullUrl);
  assert.deepEqual(fullUrl.actions.map(item => item.type), [
    "open_public_url", "verify_public_url_foreground", "ask_user"
  ]);
  assert.equal(fullUrl.actions[0].value, "https://example.com/learn");
  assert.equal(fullUrl.actions[1].value, fullUrl.actions[0].value);

  const bareDomain = createLocalAgentPlan("Open example.org");
  assert.ok(bareDomain);
  assert.equal(bareDomain.actions[0].value, "https://example.org/");

  const hinglish = createLocalAgentPlan("example.com website kholo");
  assert.ok(hinglish);
  assert.equal(hinglish.actions[0].value, "https://example.com/");

  for (const request of [
    "Open http://localhost/admin",
    "Open http://127.0.0.1/",
    "Open http://192.168.1.1/",
    "Open http://169.254.169.254/",
    "Open http://203.0.113.10/",
    "Open http://198.51.100.4/",
    "Open http://100.64.0.1/",
    "Open http://0177.0.0.1/",
    "Open https://device.test/",
    "Open https://router.home.arpa/",
    "Open https://example.invalid/",
    "Open https://example.com/adult-content/",
    "Open https://example.com/search?q=porn",
    "Open https://example.com/store/weapon",
    "Open https://example.com/suicide-prevention/",
    "Open https://example.com/self-harm/",
    "Open https://example.com/drug/overdose",
    "Open https://example.com/?access_token=secret",
    "Open https://example.com/?code=123456",
    "Open javascript:alert(1)"
  ]) {
    assert.equal(createLocalAgentPlan(request), null, request);
  }
});

test("public URL device plans require a matching immediate browser foreground check", () => {
  const checked = validateAgentPlan({
    mode: "device_action",
    reply: "Open the public website.",
    actions: [
      { type: "open_public_url", value: "https://example.com/", purpose: "Open website." },
      { type: "verify_public_url_foreground", value: "https://example.com/", purpose: "Check browser." },
      { type: "ask_user", value: "Review the page yourself.", purpose: "Manual handoff." }
    ]
  });
  assert.equal(checked.actions[1].type, "verify_public_url_foreground");

  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Open website.",
    actions: [
      { type: "open_public_url", value: "https://example.com/", purpose: "Open website." },
      { type: "ask_user", value: "Review it.", purpose: "Handoff." }
    ]
  }), /matching browser foreground verification/i);

  assert.throws(() => validateAgentPlan({
    mode: "device_action",
    reply: "Open website.",
    actions: [
      { type: "open_public_url", value: "https://example.com/", purpose: "Open website." },
      { type: "verify_public_url_foreground", value: "https://different.org/", purpose: "Check browser." }
    ]
  }), /matching browser foreground verification/i);

  for (const url of [
    "file:///etc/passwd",
    "https://user:password@example.com/",
    "http://10.0.0.1/",
    "https://example.com/?token=secret"
  ]) {
    assert.throws(() => validateAgentPlan({
      mode: "device_action",
      reply: "Open website.",
      actions: [
        { type: "open_public_url", value: url, purpose: "Open website." },
        { type: "verify_public_url_foreground", value: url, purpose: "Check browser." }
      ]
    }), /normalized public HTTP or HTTPS URL/i);
  }
});

test("device planner selects supported deterministic app and Google plans before any model fallback", async () => {
  const { createAgentPlan } = await import("../services/agent-planner.js");
  const appPlan = await createAgentPlan("Open YouTube and search for JEE Physics");
  assert.equal(appPlan.engine, "built-in-device-rules");
  assert.equal(appPlan.provider, "built-in");
  assert.equal(appPlan.externalAI, false);
  assert.equal(appPlan.actions.length, 6);

  const googlePlan = await createAgentPlan("Search latest AI research on Google");
  assert.equal(googlePlan.engine, "built-in-device-rules");
  assert.equal(googlePlan.provider, "built-in");
  assert.equal(googlePlan.externalAI, false);
  assert.deepEqual(googlePlan.actions.map(item => item.type), [
    "open_web_search", "verify_browser_foreground", "ask_user"
  ]);
});
