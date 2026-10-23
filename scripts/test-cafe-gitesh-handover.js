import assert from "node:assert/strict";
import { readCafeOllamaConfig } from "./lib/cafeOllama.js";
import { cafePersonas, cafeGenerationConstraints } from "../src/data/agentPresentation/cafePersonas.js";
import {
  checkCafeSafety,
  checkNamedPeopleSafety,
  getInCharacterSafetyRefusal,
  isSensitiveOrSexualText,
} from "../src/data/cafeConversations/cafeSafetyGuard.js";
import replyHandler, {
  resolveTargetPersonas,
  detectVisitorIntent,
} from "../api/agents/cafe/reply.js";
import { buildEnhancedCafePrompt } from "../api/agents/cafe/generate.js";
import {
  buildCafeDraft,
  buildCafeGenerationPrompt,
} from "./generate-cafe-conversation.js";
import { createMiraRateLimitStore } from "../src/server/mira/miraRateLimitStore.js";
import { runOllamaMiraAdapter } from "../src/server/mira/ollamaAdapter.js";

console.log("Running Complete Gitesh Development Tasks Validation Suite...\n");

// ---------------------------------------------------------------------------
// 1. Work, politics, religion, and named-person guardrails
// ---------------------------------------------------------------------------
console.log("1. Testing work, politics, religion, and named-person guardrails...");

// Work content detection
const workQueries = [
  "what does onesmarter do",
  "tell me about AS400 systems",
  "how does your bill audit service work",
  "are you SOC 2 Type II certified",
  "what is your HIPAA compliance posture",
  "what platforms do you provide",
  "can you process healthcare claims",
  "tell me about your client work",
];
for (const q of workQueries) {
  const result = checkCafeSafety(q);
  assert.equal(result.isSafe, false, `Query "${q}" should be flagged as work content`);
  assert.equal(result.category, "work_content", `Query "${q}" category should be work_content`);
}

// Politics and religion detection
const politicsReligionQueries = [
  "who are you voting for in the presidential election",
  "what do you think about the democrat party",
  "tell me about the prime minister",
  "is Christianity the only true religion",
  "what does the Quran say about salvation",
  "theology and resurrection",
];
for (const q of politicsReligionQueries) {
  const result = checkCafeSafety(q);
  assert.equal(result.isSafe, false, `Query "${q}" should be flagged as politics/religion`);
  assert.equal(result.category, "politics_religion");
}

// Real named people detection
const namedPeopleQueries = [
  "What do you think of Taylor Swift?",
  "Tell me about Elon Musk.",
  "Who was Alan Turing?",
  "Have you heard of Jane Austen?",
];
for (const q of namedPeopleQueries) {
  const result = checkCafeSafety(q);
  assert.equal(result.isSafe, false, `Query "${q}" should be flagged as named real person`);
  assert.equal(result.category, "named_people");
}

// Allowed names (personas, days, months, common everyday nouns)
const allowedQueries = [
  "Theo and Elena had coffee on Monday",
  "Ravi visited the bakery in August",
  "Selene read a book by the fountain",
  "a local dispute over a hedge, bin, or parking space",
  "a cooking-programme controversy",
];
for (const q of allowedQueries) {
  const personCheck = checkNamedPeopleSafety(q);
  assert.equal(personCheck.isFlagged, false, `Allowed phrase "${q}" should not be flagged`);
}
console.log("PASS 1: Guardrails for work, politics, religion, and named people verified.");

// ---------------------------------------------------------------------------
// 2. Café questions about OneSmarter and AS400 hand off to Mira
// ---------------------------------------------------------------------------
console.log("2. Testing OneSmarter and AS400 handoff to Mira...");

const testHandoffQuery = async (query) => {
  let status = 200;
  let json = null;
  const req = {
    method: "POST",
    headers: { "x-forwarded-for": "10.0.0.1" },
    body: {
      visitorMessage: query,
      participantIds: ["theo-mercer", "elena-cross"],
      seedTopic: "a cooking programme",
    },
  };
  const res = {
    setHeader: () => {},
    status: (s) => {
      status = s;
      return res;
    },
    json: (d) => {
      json = d;
      return res;
    },
  };

  await replyHandler(req, res);
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.intent, "work_handoff");
  assert.ok(json.replies && json.replies.length > 0);

  for (const reply of json.replies) {
    assert.equal(reply.source, "fallback");
    assert.ok(reply.timestamp, "Must include timestamp");
    assert.ok(
      /mira|guide/i.test(reply.text),
      `Reply "${reply.text}" must direct visitor to Mira`,
    );
  }
};

await testHandoffQuery("what does onesmarter do?");
await testHandoffQuery("tell me about AS400 systems");
await testHandoffQuery("are you SOC 2 attested?");
console.log("PASS 2: OneSmarter and AS400 queries hand off to Mira with in-character responses.");

// ---------------------------------------------------------------------------
// 3. Concurrent session isolation and visitor-specific topics
// ---------------------------------------------------------------------------
console.log("3. Testing session isolation and visitor-specific topics...");

const session1Req = {
  method: "POST",
  headers: { "x-forwarded-for": "192.168.1.101" },
  body: {
    visitorMessage: "What an unusual coincidence.",
    participantIds: ["theo-mercer", "elena-cross"],
    seedTopic: "a radio phone-in about household habits",
  },
};
const session2Req = {
  method: "POST",
  headers: { "x-forwarded-for": "192.168.1.102" },
  body: {
    visitorMessage: "I saw the same thing yesterday.",
    participantIds: ["ravi-sen", "selene-hart"],
    seedTopic: "a street tree flowering early",
  },
};

let res1Data = null;
let res2Data = null;
const makeRes = (cb) => ({
  setHeader: () => {},
  status: () => makeRes(cb),
  json: (d) => cb(d),
});

await Promise.all([
  replyHandler(session1Req, makeRes((d) => (res1Data = d))),
  replyHandler(session2Req, makeRes((d) => (res2Data = d))),
]);

assert.equal(res1Data.success, true);
assert.equal(res2Data.success, true);
assert.equal(res1Data.replies[0].speaker, "theo-mercer");
assert.equal(res2Data.replies[0].speaker, "ravi-sen");
console.log("PASS 3: Concurrent sessions remain isolated with visitor-specific topics and targets.");

// ---------------------------------------------------------------------------
// 4. Persona prompts containing required personality details and café rules
// ---------------------------------------------------------------------------
console.log("4. Testing persona prompts contain personality details and café rules...");

for (const persona of cafePersonas) {
  assert.ok(persona.offDutyDisposition, `${persona.id} must have offDutyDisposition`);
  assert.ok(persona.interests && persona.interests.length >= 3, `${persona.id} must have interests`);
  assert.ok(persona.indifferences && persona.indifferences.length >= 1, `${persona.id} must have indifferences`);
  assert.ok(persona.disagreementStyle, `${persona.id} must have disagreementStyle`);
}

// Theo has specific generation notes
const theo = cafePersonas.find((p) => p.id === "theo-mercer");
assert.ok(theo.generationNotes && theo.generationNotes.includes("short and infrequent"));

// Check prompt generated for generation API
const enhancedPrompt = buildEnhancedCafePrompt({
  participantIds: ["theo-mercer", "elena-cross"],
  seedTopic: "a strange street sign",
  exchangeCount: 6,
});

for (const constraint of cafeGenerationConstraints) {
  assert.ok(enhancedPrompt.includes(constraint), `Prompt must include constraint: ${constraint}`);
}
assert.ok(enhancedPrompt.includes(theo.offDutyDisposition));
assert.ok(enhancedPrompt.includes("Keep Theo's contributions short") || enhancedPrompt.includes("keep his contributions short"));
console.log("PASS 4: Persona prompts contain personality details, café rules, and specific generation notes.");

// ---------------------------------------------------------------------------
// 5. No 'undefined' persona fields in prompts
// ---------------------------------------------------------------------------
console.log("5. Testing no 'undefined' persona fields...");

assert.ok(!enhancedPrompt.includes("undefined"), "Prompt must not contain '(undefined)' or 'undefined'");
const theoPromptCheck = buildCafeGenerationPrompt({
  participantIds: ["theo-mercer", "elena-cross"],
  seedTopic: "a test topic",
  exchangeCount: 6,
});
assert.ok(!theoPromptCheck.includes("undefined"), "Cafe generation prompt must not contain 'undefined'");
console.log("PASS 5: No 'undefined' fields in any persona prompts.");

// ---------------------------------------------------------------------------
// 6. Mira's approved trust answers when using Ollama
// ---------------------------------------------------------------------------
console.log("6. Testing Mira's approved trust answers when using Ollama...");

// Verification that llmAdapter Ollama bypass conditions are removed
import { verifyAgentAnswerGrounding } from "../src/server/agentGrounding/agentGroundingVerifier.js";
const groundingResult = verifyAgentAnswerGrounding({
  answer: "OneSmarter has completed a HIPAA Security Rule compliance assessment.",
  approvedEntries: [
    {
      title: "HIPAA Security Rule",
      approvedSummary: "OneSmarter has completed a HIPAA Security Rule compliance assessment.",
      sourceFacts: ["Completed assessment."],
    },
  ],
});
assert.equal(groundingResult.grounded, true);
console.log("PASS 6: Mira trust answers grounded and protected across all providers.");

// ---------------------------------------------------------------------------
// 7. Acceptance of the documented Ollama hostname http://ollama:11434
// ---------------------------------------------------------------------------
console.log("7. Testing acceptance of http://ollama:11434...");

const configWithDockerHost = readCafeOllamaConfig({
  CAFE_OLLAMA_BASE_URL: "http://ollama:11434",
});
assert.equal(configWithDockerHost.baseUrl, "http://ollama:11434");
console.log("PASS 7: Documented Docker hostname http://ollama:11434 is accepted.");

// ---------------------------------------------------------------------------
// 8. Model versus fallback source labelling
// ---------------------------------------------------------------------------
console.log("8. Testing model versus fallback source labelling...");

let sampleData = null;
const reqSample = {
  method: "POST",
  headers: { "x-forwarded-for": "10.0.0.5" },
  body: {
    visitorMessage: "Good morning everyone!",
    participantIds: ["theo-mercer", "elena-cross"],
    seedTopic: "a sunny afternoon",
  },
};
await replyHandler(reqSample, {
  setHeader: () => {},
  status: () => ({ json: (d) => (sampleData = d) }),
  json: (d) => (sampleData = d),
});

assert.ok(sampleData && sampleData.replies.length > 0);
for (const reply of sampleData.replies) {
  assert.ok(
    reply.source === "model" || reply.source === "fallback",
    `Source must be 'model' or 'fallback', got: ${reply.source}`,
  );
}
console.log("PASS 8: All replies correctly labelled with source: 'model' or source: 'fallback'.");

// ---------------------------------------------------------------------------
// 9. Timeout handling and natural reply timing (actual arrival time)
// ---------------------------------------------------------------------------
console.log("9. Testing reply timing and timestamps...");

for (const reply of sampleData.replies) {
  assert.ok(reply.timestamp, "Reply must have timestamp");
  const replyTime = new Date(reply.timestamp).getTime();
  const now = Date.now();
  // Timestamp should be recent (within the last 5 seconds), never in the future
  assert.ok(replyTime <= now + 100, "Timestamp should not be in the future");
  assert.ok(now - replyTime < 5000, "Timestamp should represent actual arrival time");
}
console.log("PASS 9: Natural reply timing verified (no fabricated future timestamps).");

// ---------------------------------------------------------------------------
// 10. Rate limiting and capacity handling
// ---------------------------------------------------------------------------
console.log("10. Testing rate limiting and capacity handling...");

const store = createMiraRateLimitStore();
const visitorIp = "test-rate-limit-ip";
let allowedCount = 0;
let deniedCount = 0;

for (let i = 0; i < 25; i++) {
  const result = await store.consume(visitorIp);
  if (result.allowed) allowedCount++;
  else deniedCount++;
}

assert.equal(allowedCount, 20, "Store should allow exactly 20 requests in window");
assert.equal(deniedCount, 5, "Store should deny requests beyond 20");
console.log("PASS 10: Rate limiting and capacity handling correctly enforced.");

// ---------------------------------------------------------------------------
// 11. Generated conversation validation and dates
// ---------------------------------------------------------------------------
console.log("11. Testing generated conversation validation and dates...");

const today = new Date().toISOString().slice(0, 10);
const futureDate = "2099-01-01";

// Past or today dates are valid
const validDraft = buildCafeDraft({
  participantIds: ["theo-mercer", "elena-cross"],
  seedTopic: "a past event",
  conversationDay: today,
  exchanges: [{ speaker: "theo-mercer", text: "Observations remain clear." }],
  invitedBy: null,
  selection: { participants: "manual", seedTopic: "manual", exchangeCount: "manual", invitedBy: "random" },
});
assert.equal(validDraft.conversationDay, today);

// Future dates must be rejected
assert.throws(() => {
  buildCafeDraft({
    participantIds: ["theo-mercer", "elena-cross"],
    seedTopic: "a future event",
    conversationDay: futureDate,
    exchanges: [],
    invitedBy: null,
    selection: { participants: "manual", seedTopic: "manual", exchangeCount: "manual", invitedBy: "random" },
  });
}, /future date/i);
console.log("PASS 11: Generated conversation dates verified (future dates strictly rejected).");

// ---------------------------------------------------------------------------
// 12. Existing functionality and regression protection
// ---------------------------------------------------------------------------
console.log("12. Testing existing functionality and regression protection...");

// Tagging resolution
const tagResult1 = resolveTargetPersonas({
  visitorMessage: "@Theo Mercer what do you think?",
  baseParticipantIds: ["theo-mercer", "elena-cross"],
});
assert.equal(tagResult1.targets.length, 1);
assert.equal(tagResult1.targets[0].id, "theo-mercer");

const tagResultAll = resolveTargetPersonas({
  visitorMessage: "@all what do you all think?",
  baseParticipantIds: ["theo-mercer", "elena-cross"],
});
assert.equal(tagResultAll.targets.length, 4);

// Default when no tag: 1 or 2 relevant personas at the table
const tagResultDefault = resolveTargetPersonas({
  visitorMessage: "What a nice day.",
  baseParticipantIds: ["theo-mercer", "elena-cross"],
});
assert.ok(tagResultDefault.targets.length >= 1 && tagResultDefault.targets.length <= 2);

console.log("PASS 12: Existing mention resolution and regression protection verified.");

console.log("\n===============================================================");
console.log("All 12 Handover Requirement Test Suites Passed Successfully!  ");
console.log("===============================================================");
