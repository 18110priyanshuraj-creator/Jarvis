import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await fs.readFile(path.join(root, "public", "login.js"), "utf8");

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); }
  };
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

function setup(sessionStatus = 200) {
  let submitHandler;
  const calls = [];
  const dispatched = [];
  const elements = {
    "login-form": { addEventListener(type, handler) { assert.equal(type, "submit"); submitHandler = handler; } },
    password: { value: "private test password" },
    "login-button": { disabled: false },
    toast: { textContent: "", className: "toast" },
    "login-screen": { classList: makeClassList() },
    "app-shell": { classList: makeClassList(["hidden"]) }
  };

  const context = {
    document: { getElementById(id) { return elements[id] || null; } },
    window: { dispatchEvent(event) { dispatched.push(event.type); } },
    Event: class TestEvent { constructor(type) { this.type = type; } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === "/api/login") return response(200, { ok: true });
      if (url === "/api/session") return response(sessionStatus, { authenticated: sessionStatus === 200 });
      throw new Error("Unexpected URL: " + url);
    }
  };

  vm.runInNewContext(source, context, { filename: "public/login.js" });
  assert.equal(typeof submitHandler, "function");
  return { submitHandler, calls, dispatched, elements };
}

test("standalone login prevents native reload and unlocks only after session confirmation", async () => {
  const { submitHandler, calls, dispatched, elements } = setup();
  let prevented = false;
  let stopped = false;

  await submitHandler({
    preventDefault() { prevented = true; },
    stopImmediatePropagation() { stopped = true; }
  });

  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.deepEqual(calls.map((call) => call.url), ["/api/login", "/api/session"]);
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(elements.password.value, "");
  assert.equal(elements["login-screen"].classList.contains("hidden"), true);
  assert.equal(elements["app-shell"].classList.contains("hidden"), false);
  assert.deepEqual(dispatched, ["jarvis:authenticated"]);
  assert.equal(elements.toast.textContent, "Workspace unlocked.");
  assert.equal(elements["login-button"].disabled, false);
});

test("standalone login keeps the password screen when the session cookie is not retained", async () => {
  const { submitHandler, dispatched, elements } = setup(401);

  await submitHandler({
    preventDefault() {},
    stopImmediatePropagation() {}
  });

  assert.equal(elements["login-screen"].classList.contains("hidden"), false);
  assert.equal(elements["app-shell"].classList.contains("hidden"), true);
  assert.equal(dispatched.length, 0);
  assert.equal(elements.password.value, "private test password");
  assert.match(elements.toast.textContent, /browser did not retain the session/i);
  assert.equal(elements["login-button"].disabled, false);
});
