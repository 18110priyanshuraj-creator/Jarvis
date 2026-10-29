/**
 * JARVIS built-in offline brain.
 *
 * This deliberately uses deterministic rules and a small embedded knowledge base.
 * It makes no network calls and needs no external model, inference URL, or API key.
 * It is not a general-purpose large language model; unsupported questions are
 * answered honestly instead of being fabricated.
 */

const KNOWLEDGE = [
  { title: "Newton's laws of motion", keywords: ["newton", "law of motion", "laws of motion", "inertia", "force"], body: "Newton's laws: (1) Inertia: an object keeps its state of rest or uniform straight-line motion unless a net external force acts. (2) Acceleration: net force equals mass times acceleration, F = ma. (3) Action–reaction: forces occur in equal and opposite pairs acting on different bodies. For JEE, draw a free-body diagram and resolve forces along chosen axes." },
  { title: "Units and dimensions", keywords: ["dimension", "dimensional analysis", "units and measurement", "units and measurements", "si unit"], body: "Dimensional analysis expresses quantities using base dimensions such as mass [M], length [L], and time [T]. Velocity has [LT⁻¹], acceleration [LT⁻²], force [MLT⁻²], and energy [ML²T⁻²]. A dimensionally inconsistent equation is wrong, but dimensional consistency alone does not prove an equation is correct." },
  { title: "Mole concept", keywords: ["mole concept", "avogadro", "moles", "molar mass", "limiting reagent"], body: "Amount in moles: n = mass / molar mass. Number of entities N = n × Nₐ, where Nₐ ≈ 6.022 × 10²³ mol⁻¹. For a balanced reaction, compare available moles divided by their stoichiometric coefficients; the smallest ratio identifies the limiting reactant. Keep units explicit and balance the equation first." },
  { title: "Sets", keywords: ["set theory", "sets", "subset", "union", "intersection"], body: "A set is a well-defined collection of distinct elements. A ∪ B contains elements in A or B; A ∩ B contains elements common to both; A − B contains elements in A but not B. For finite sets, |A ∪ B| = |A| + |B| − |A ∩ B|. The empty set is a subset of every set." },
  { title: "Circular motion", keywords: ["circular motion", "centripetal", "angular velocity"], body: "For circular motion of radius r and speed v: angular speed ω = v/r; centripetal acceleration a = v²/r = ω²r; required net inward force F = mv²/r. Centripetal force is the name for the net inward force, not an extra force to add to a free-body diagram." },
  { title: "Ohm's law and circuits", keywords: ["ohm", "current", "voltage", "resistance", "circuit"], body: "For an ohmic conductor at constant physical conditions, V = IR. In series, resistances add. For ideal resistors in parallel, 1/Rₑq = Σ(1/Rᵢ). Electric power may be written P = VI = I²R = V²/R when Ohm's law applies." },
  { title: "JavaScript basics", keywords: ["javascript", "js code", "function in javascript", "array in javascript"], body: "JavaScript basics: use const for bindings that are not reassigned and let for bindings that are. Functions package reusable logic. Arrays store ordered values; objects store named properties. Prefer explicit error handling and test behavior rather than assuming code works." },
  { title: "Debugging workflow", keywords: ["debug", "bug", "error", "debugging", "fix code"], body: "Reliable debugging loop: reproduce the failure; capture the exact error; locate the smallest failing area; form one hypothesis; make one focused change; run the smallest test; then run the full checks. Preserve existing work and review the diff. A successful build does not prove that every runtime path works." },
  { title: "Study planning", keywords: ["study plan", "timetable", "jee plan", "schedule study", "revision plan"], body: "A practical study block: (1) recall formulas or definitions without notes, (2) learn one small concept, (3) solve questions from easy to challenging, (4) inspect mistakes and write why they happened, (5) revisit those mistakes after a delay. Plan a realistic number of blocks and include breaks." }
];

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

function tokenizeExpression(input) {
  const tokens = [];
  let index = 0;
  while (index < input.length) {
    if (/\s/.test(input[index])) { index++; continue; }
    const remaining = input.slice(index);
    const number = remaining.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const name = remaining.match(/^(?:sqrt|sin|cos|tan|pi|e)\b/i);
    if (name) {
      tokens.push({ type: "name", value: name[0].toLowerCase() });
      index += name[0].length;
      continue;
    }
    if ("+-*/%^()".includes(input[index])) {
      tokens.push({ type: "symbol", value: input[index++] });
      continue;
    }
    throw new Error("unsupported character");
  }
  return tokens;
}

function calculate(input) {
  const tokens = tokenizeExpression(input);
  if (!tokens.length || tokens.length > 120) return null;
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];

  function primary() {
    const token = take();
    if (!token) throw new Error("missing value");
    if (token.type === "number") return token.value;
    if (token.value === "(") {
      const value = expression();
      if (take()?.value !== ")") throw new Error("missing closing parenthesis");
      return value;
    }
    if (token.type === "name") {
      if (token.value === "pi") return Math.PI;
      if (token.value === "e") return Math.E;
      if (take()?.value !== "(") throw new Error("function requires parentheses");
      const value = expression();
      if (take()?.value !== ")") throw new Error("missing function parenthesis");
      if (token.value === "sqrt") return Math.sqrt(value);
      if (token.value === "sin") return Math.sin(value);
      if (token.value === "cos") return Math.cos(value);
      if (token.value === "tan") return Math.tan(value);
    }
    throw new Error("expected a value");
  }

  function unary() {
    if (peek()?.value === "+") { take(); return unary(); }
    if (peek()?.value === "-") { take(); return -unary(); }
    return primary();
  }

  function power() {
    const left = unary();
    if (peek()?.value === "^" || peek()?.value === "**") {
      take();
      return left ** power();
    }
    return left;
  }

  function term() {
    let value = power();
    while (["*", "/", "%"].includes(peek()?.value)) {
      const operator = take().value;
      const right = power();
      if ((operator === "/" || operator === "%") && right === 0) throw new Error("division by zero");
      if (operator === "*") value *= right;
      else if (operator === "/") value /= right;
      else value %= right;
    }
    return value;
  }

  function expression() {
    let value = term();
    while (peek()?.value === "+" || peek()?.value === "-") {
      const operator = take().value;
      const right = term();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  const result = expression();
  if (position !== tokens.length || !Number.isFinite(result)) throw new Error("invalid result");
  return Object.is(result, -0) ? 0 : Number(result.toPrecision(12));
}

function findCalculation(message) {
  const original = String(message ?? "").trim();
  const lower = normalize(original);
  let candidate = "";
  const command = original.match(/^(?:calculate|calc|solve|compute|hisab|गणना करो)\s+(.+?)[?।.!]*$/i);
  const question = original.match(/^(?:what is|how much is|kitna hota hai|kitna hoga)\s+(.+?)[?।.!]*$/i);
  if (command) candidate = command[1];
  else if (question && /[\d()]/.test(question[1]) && /[+*/%^]|\s-\s/.test(question[1])) candidate = question[1];
  else if (/^[\d\s.+*/%^()epi-]+$/i.test(original) && /\d/.test(original) && /[+*/%^()]|\s-\s/.test(original)) candidate = original;
  if (!candidate) return null;
  try {
    const value = calculate(candidate.replace(/\*\*/g, "^"));
    return value === null ? null : { expression: candidate, value };
  } catch {
    return { expression: candidate, error: "I could not safely evaluate that expression. Check the symbols and parentheses." };
  }
}

function knowledgeSearch(query, limit = 5) {
  const q = normalize(query);
  const stopWords = new Set(["who", "what", "when", "where", "why", "how", "the", "and", "that", "this", "with", "from", "into", "for", "are", "was", "were", "has", "have", "had", "not", "can", "could", "should", "would", "will", "about", "after", "before", "game", "happened", "minute", "ago", "won", "any", "some", "like", "did", "does", "then", "than", "been", "being", "you", "your", "our", "their", "them", "his", "her", "she", "he", "they", "all", "just", "one", "out", "too", "very"]);
  const words = q.split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !stopWords.has(word));
  return KNOWLEDGE.map((item) => {
    const haystack = normalize(item.title + " " + item.keywords.join(" ") + " " + item.body);
    const haystackWords = new Set(haystack.split(/[^a-z0-9]+/).filter(Boolean));
    const score = item.keywords.reduce((sum, keyword) => sum + (q.includes(keyword) ? 4 : 0), 0)
      + words.reduce((sum, word) => sum + (haystackWords.has(word) ? 1 : 0), 0);
    return { ...item, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
    .map(({ title, body, score }) => ({ title, snippet: body, score }));
}

export function searchLocalKnowledge(query, limit = 8) {
  return knowledgeSearch(query, limit);
}

export function runLocalBrain({ message, memories = [], tasks = [], skills = [], feedback = [] } = {}) {
  const raw = String(message ?? "").trim();
  const q = normalize(raw);
  if (!q) return "Message khaali hai. Apna sawaal type karo.";

  const calculation = findCalculation(raw);
  if (calculation) {
    if (calculation.error) return calculation.error;
    return "Calculation (built-in offline calculator):\n" + calculation.expression + " = " + calculation.value
      + "\n\nNote: sin(), cos(), and tan() use radians. This result was calculated locally; no AI service or model URL was contacted.";
  }

  if (/^(hi|hello|hey|namaste|namaskar|salaam|salam|hii|hlo)(\b|\s)/i.test(q) || /^(hi|hello|hey|namaste|namaskar|salaam|salam|hii|hlo)$/.test(q)) {
    return "Namaste! Main JARVIS ka built-in offline core hoon. Main basic calculations, saved memories/tasks, aur bundled study/debugging knowledge mein help kar sakta hoon. Mere paas general-purpose language model nahi hai, isliye kuch open-ended sawaalon ka jawab dena possible nahi hoga.\n\nTry: “calculate (25*4)+10”, “explain Newton's laws”, “show my tasks”, ya “what can you do?”";
  }

  if (/(who are you|what are you|tum kaun|tera naam|your name|how do you work|kaise kaam karte)/.test(q)) {
    return "Main JARVIS hoon: is deployment mein self-contained, rule-based offline assistant core. Chat ke liye main Gemini, Ollama, ya kisi external inference URL ko call nahi karta. Calculator aur embedded knowledge rules locally run hote hain.\n\nImportant limitation: main ek trained LLM nahi hoon. Isliye main kisi bhi topic par freely nayi language generate ya deep reasoning guarantee nahi kar sakta. Open-ended intelligence ke liye trained model chahiye hota hai; bina model/API ke main available built-in rules tak limited hoon.";
  }

  if (/(what can you do|help menu|commands|kya kar sakte|help me use|features)/.test(q)) {
    return "Built-in offline features:\n1. Calculator: “calculate (25*4)+10”, parentheses, + − × ÷ %, powers, pi, e, sqrt(), sin(), cos(), tan().\n2. Bundled study notes: Newton's laws, units/dimensions, mole concept, sets, circular motion, Ohm's law.\n3. Debugging and study-planning checklists.\n4. Read your saved memories and tasks when you ask.\n5. Search the small embedded knowledge base without external websites.\n\nI do not call Gemini/Ollama, browse the live web, execute shell commands, or retrain model weights.";
  }

  if (/(show|list|what are|view|mere|meri|my).*(task|tasks|to.?do|kaam|कार्य)/.test(q) || /^(tasks|my tasks|mere tasks|show tasks)$/.test(q)) {
    if (!tasks.length) return "Abhi koi saved task nahi hai. Tasks section mein ek task add kar sakte ho.";
    return "Your saved tasks (local store):\n" + tasks.slice(-30).map((task, index) => (index + 1) + ". [" + (task.done ? "DONE" : "OPEN") + "] " + task.title + (task.description ? " — " + task.description : "")).join("\n");
  }

  if (/(show|list|what are|view|mere|meri|my).*(memory|memories|notes|yaad)/.test(q) || /^(memories|my memory|show memories|meri memory)$/.test(q)) {
    if (!memories.length) return "Abhi koi saved memory nahi hai. Memory section mein preference, goal, ya fact save kar sakte ho.";
    return "Your saved memories (local store):\n" + memories.slice(-30).map((item, index) => (index + 1) + ". [" + (item.category || "fact") + "] " + item.content).join("\n");
  }

  if (/(today|aaj|date|time|samay|kitne baje)/.test(q) && /(date|time|today|aaj|samay|kitne baje|what day)/.test(q)) {
    return "Server date/time: " + new Date().toISOString() + " (UTC). This is the hosting server's clock, not necessarily your local time.";
  }

  if (/(thank you|thanks|shukriya|dhanyavaad)/.test(q)) return "You're welcome! Main offline rules ke through kaam kar raha hoon—koi model URL ya hosted AI API call nahi hota.";

  if (/(forget|clear|delete).*(memory|memories|task)/.test(q)) {
    return "Main chat se directly delete action execute nahi karta. Dashboard ke Memory ya Tasks section mein item ke saamne Delete button use karo. Delete karne se pehle sahi item verify kar lena.";
  }

  if (/(newton|law of motion|laws of motion|inertia|force)/.test(q)) {
    const item = KNOWLEDGE.find((entry) => entry.title === "Newton's laws of motion");
    return item.body + "\n\nQuick check: agar net force zero hai, kya object ko rest par hi rehna zaroori hai? (Socho: uniform straight-line motion bhi possible hai.)";
  }

  if (/(units and measurements|dimensional analysis|dimension of|si units)/.test(q)) {
    return KNOWLEDGE.find((entry) => entry.title === "Units and dimensions").body;
  }
  if (/(mole concept|limiting reagent|avogadro|molar mass)/.test(q)) {
    return KNOWLEDGE.find((entry) => entry.title === "Mole concept").body;
  }
  if (/(sets|subset|union|intersection)/.test(q)) {
    return KNOWLEDGE.find((entry) => entry.title === "Sets").body;
  }
  if (/(circular motion|centripetal|angular velocity)/.test(q)) {
    return KNOWLEDGE.find((entry) => entry.title === "Circular motion").body;
  }
  if (/(ohm|voltage|resistance|electric current|circuit)/.test(q)) {
    return KNOWLEDGE.find((entry) => entry.title === "Ohm's law and circuits").body;
  }
  if (/(javascript|debug|bug|error|fix this code)/.test(q)) {
    return KNOWLEDGE.find((entry) => entry.title === (q.includes("javascript") ? "JavaScript basics" : "Debugging workflow")).body;
  }
  if (/(study plan|timetable|study schedule|revision plan|jee plan)/.test(q)) {
    return KNOWLEDGE.find((entry) => entry.title === "Study planning").body;
  }

  const hits = knowledgeSearch(q, 2);
  if (hits.length) {
    return "Mere embedded offline knowledge base mein related material mila:\n\n" + hits.map((hit) => "**" + hit.title + "**\n" + hit.snippet).join("\n\n")
      + "\n\nYeh chhota built-in knowledge pack hai, live internet search ya general-purpose model nahi.";
  }

  const style = skills.length ? "\n\nNote: tumhare custom skills saved hain, lekin bina language model ke unki open-ended instructions ko general answer mein execute nahi kar sakta." : "";
  const hasNegativeFeedback = feedback.some((item) => item.rating === "down");
  return "Is sawaal ka reliable jawab mere current offline rule set mein nahi hai. Main guess karke galat fact dene ke bajay limitation bata raha hoon.\n\nTum calculator, saved tasks/memories, ya bundled topics (Newton's laws, units/dimensions, mole concept, sets, circular motion, Ohm's law, basic debugging, study planning) try kar sakte ho. " +
    (hasNegativeFeedback ? "Recent feedback saved hai, par feedback se model ki capability train nahi hoti." : "Feedback save karna memory mein note rakhta hai, model ko train nahi karta.") + style;
}
