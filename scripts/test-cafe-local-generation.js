import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { generateConversation } from "./generate-cafe-conversation.js";
import { readCafeOllamaConfig } from "./lib/cafeOllama.js";

const inputs = {
  participantIds: ["theo-mercer", "elena-cross"],
  seedTopic: "a cooking programme",
  exchangeCount: 6,
  invitedBy: null,
  selection: { participants: "manual", seedTopic: "manual", exchangeCount: "manual", invitedBy: "random" },
};
const validOutput = () => ({
  exchanges: Array.from({ length: 6 }, (_, index) => ({
    speaker: inputs.participantIds[index % 2],
    text: `I enjoyed the cooking programme, especially dish ${index + 1}.`,
  })),
});
let content = JSON.stringify(validOutput());
let mode = "valid";
const requests = [];
const server = http.createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push({ route: request.url, body: JSON.parse(body), headers: request.headers });
  if (mode === "timeout") return;
  if (mode === "http-error") {
    response.writeHead(404).end();
    return;
  }
  if (mode === "redirect") {
    response.writeHead(302, { Location: "/unexpected" }).end();
    return;
  }
  response.setHeader("Content-Type", "application/json");
  if (mode === "bad-envelope") {
    response.end("not JSON");
    return;
  }
  if (request.url === "/api/show") {
    response.end(JSON.stringify(mode === "remote"
      ? { remote_model: "remote", remote_host: "https://example.com" }
      : { model_info: { "general.architecture": "qwen2" } }));
    return;
  }
  response.end(JSON.stringify({
    done: mode !== "incomplete",
    done_reason: mode === "truncated" ? "length" : "stop",
    message: { content },
  }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const env = { CAFE_OLLAMA_BASE_URL: `http://127.0.0.1:${server.address().port}` };
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cafe-local-generation-"));
const outputDirectory = path.join(temporaryRoot, "drafts");
const cleanupTestDirectory = async () => {
  // Only remove the uniquely created test directory directly under the OS temp root.
  if (path.dirname(temporaryRoot) !== path.resolve(os.tmpdir()) ||
    !path.basename(temporaryRoot).startsWith("cafe-local-generation-")) {
    throw new Error("Unexpected test cleanup path.");
  }
  await fs.rm(temporaryRoot, { recursive: true, force: true });
};
let passed = 0;
const check = async (name, run) => {
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
};
const rejectWithoutSaving = async (pattern, customEnv = env) => {
  const before = await fs.readdir(outputDirectory).catch(() => []);
  await assert.rejects(generateConversation(inputs, { env: customEnv, outputDirectory }), pattern);
  assert.deepEqual(await fs.readdir(outputDirectory).catch(() => []), before);
};

try {
  await check("local defaults and configuration boundaries", async () => {
    assert.deepEqual(readCafeOllamaConfig({}), {
      baseUrl: "http://127.0.0.1:11434", model: "qwen2.5:0.5b", timeoutMs: 120000,
    });
    for (const url of ["https://example.com", "http://192.168.1.2:11434", "http://user:pass@localhost:11434", "http://localhost:11434/api"]) {
      assert.throws(() => readCafeOllamaConfig({ CAFE_OLLAMA_BASE_URL: url }), /loopback/);
    }
    assert.throws(() => readCafeOllamaConfig({ CAFE_OLLAMA_MODEL: "qwen2.5:cloud" }), /cloud/);
    assert.throws(() => readCafeOllamaConfig({ CAFE_GENERATION_TIMEOUT_MS: "NaN" }), /integer/);
  });
  await check("valid JSON saves an unpublished draft with verifiable metadata", async () => {
    const draftPath = await generateConversation(inputs, { env, outputDirectory });
    const draft = JSON.parse(await fs.readFile(draftPath, "utf8"));
    assert.equal(draft.id, draft.draftId);
    assert.equal(draft.model, "qwen2.5:0.5b");
    assert.equal(draft.status, "unpublished");
    assert.equal(draft.reviewedBy, undefined);
    assert.equal(draft.createdAt, draft.generatedAt);
    assert.ok(Number.isFinite(Date.parse(draft.generatedAt)));
    assert.deepEqual(draft.exchanges, validOutput().exchanges);
    const hashContent = {
      participants: draft.participants, seedTopic: draft.seedTopic, invitedBy: draft.invitedBy,
      exchanges: draft.exchanges, selection: draft.selection,
    };
    assert.equal(draft.contentHash, createHash("sha256").update(JSON.stringify(hashContent)).digest("hex"));
    const chat = requests.find(({ route }) => route === "/api/chat");
    assert.equal(chat.body.stream, false);
    assert.equal(chat.body.think, false);
    assert.equal(chat.body.model, "qwen2.5:0.5b");
    assert.equal(chat.headers.authorization, undefined);
    assert.deepEqual(chat.body.format.properties.exchanges.items.properties.speaker.enum, inputs.participantIds);
    assert.ok(chat.body.messages[0].content.includes(inputs.seedTopic));
    const secondPath = await generateConversation(inputs, { env, outputDirectory });
    assert.notEqual(draftPath, secondPath);
    assert.equal((await fs.readdir(outputDirectory)).length, 2);
  });
  for (const [name, value, pattern] of [
    ["invalid JSON", "{", /valid JSON/],
    ["missing fields", "{}", /exchanges array/],
    ["empty output", "", /no text/],
    ["extra fields", JSON.stringify({ ...validOutput(), status: "published" }), /exchanges array/],
  ]) {
    await check(`${name} rejected without saving`, async () => {
      content = value;
      await rejectWithoutSaving(pattern);
    });
  }
  for (const [name, mutate, pattern] of [
    ["invalid speaker", (value) => { value.exchanges[0].speaker = "mira-vale"; }, /speaker/],
    ["nonparticipant", (value) => { value.exchanges[0].speaker = "ravi-sen"; }, /speaker/],
    ["free-form name", (value) => { value.exchanges[0].speaker = "Theo Mercer"; }, /speaker/],
    ["empty message", (value) => { value.exchanges[0].text = "   "; }, /non-empty/],
    ["non-string message", (value) => { value.exchanges[0].text = 123; }, /non-empty/],
    ["oversized message", (value) => { value.exchanges[0].text = "x".repeat(2001); }, /non-empty/],
    ["wrong exchange count", (value) => { value.exchanges.pop(); }, /exchange count/],
    ["silent participant", (value) => { value.exchanges.forEach((item) => { item.speaker = inputs.participantIds[0]; }); }, /Both/],
    ["missing text", (value) => { delete value.exchanges[0].text; }, /fields/],
  ]) {
    await check(`${name} rejected without saving`, async () => {
      const value = validOutput();
      mutate(value);
      content = JSON.stringify(value);
      await rejectWithoutSaving(pattern);
    });
  }
  content = JSON.stringify(validOutput());
  for (const [failureMode, pattern] of [
    ["remote", /local model/], ["http-error", /HTTP 404/],
    ["bad-envelope", /invalid JSON response/], ["incomplete", /incomplete/],
    ["truncated", /truncated/], ["redirect", /unavailable/],
    ["timeout", /timed out/],
  ]) {
    await check(`${failureMode} rejected without saving or fallback`, async () => {
      mode = failureMode;
      const start = requests.length;
      await rejectWithoutSaving(pattern, { ...env, CAFE_GENERATION_TIMEOUT_MS: "100" });
      if (["remote", "redirect"].includes(mode)) assert.equal(requests.length, start + 1);
    });
  }
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
  await check("Ollama unavailable gives a safe error and saves nothing", async () => {
    await rejectWithoutSaving(/unavailable.*Start local Ollama/);
  });
  console.log(`Café local generation: ${passed} checks passed (local HTTP fixtures; no model required).`);
} finally {
  server.closeAllConnections();
  server.close();
  await cleanupTestDirectory();
}
