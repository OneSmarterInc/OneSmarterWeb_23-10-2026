#!/usr/bin/env node
/**
 * Load Testing Script for OneSmarter Café Reply Endpoint
 * Simulates independent concurrent visitors chatting with Café agents.
 * 
 * Usage:
 *   node scripts/loadtest-cafe.mjs [options]
 * 
 * Options:
 *   --url <url>        Target Café reply URL (default: http://localhost:3000/api/agents/cafe/reply)
 *   --steps <list>     Comma-separated concurrency steps (default: 1,5,10,20,40)
 *   --rounds <n>       Rounds per concurrency step (default: 3)
 *   --timeout <ms>     Per-request timeout in milliseconds (default: 25000)
 *   --help             Show help message
 */

import process from "node:process";
import { performance } from "node:perf_hooks";
import { cafeSeedTopics } from "../src/data/cafeSeedTopics.js";

const DEFAULT_STEPS = [1, 5, 10, 20, 40];
const DEFAULT_ROUNDS = 3;
const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_URL = "http://localhost:3000/api/agents/cafe/reply";

const VISITOR_SAMPLE_PROMPTS = [
  "What do you think about that?",
  "Has anyone ever noticed that before?",
  "I suppose that could happen anywhere.",
  "That sounds rather strange.",
  "Why do you think people react that way?",
  "I wouldn't have expected that result.",
  "Could it just be a misunderstanding?",
  "It makes you wonder how things were done before.",
  "Is there a simpler explanation?",
  "I find that rather amusing.",
];

function parseArgs(args) {
  const options = {
    url: process.env.CAFE_LOADTEST_URL || DEFAULT_URL,
    steps: [...DEFAULT_STEPS],
    rounds: DEFAULT_ROUNDS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--url" && i + 1 < args.length) {
      options.url = args[++i];
    } else if (arg === "--steps" && i + 1 < args.length) {
      options.steps = args[++i]
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n > 0);
    } else if (arg === "--rounds" && i + 1 < args.length) {
      const r = parseInt(args[++i], 10);
      if (Number.isInteger(r) && r > 0) options.rounds = r;
    } else if (arg === "--timeout" && i + 1 < args.length) {
      const t = parseInt(args[++i], 10);
      if (Number.isInteger(t) && t > 0) options.timeoutMs = t;
    }
  }

  return options;
}

function calculatePercentile(values, percentile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function sendVisitorRequest({ url, timeoutMs, visitorId, round }) {
  const seedTopic =
    cafeSeedTopics[(visitorId + round) % cafeSeedTopics.length] ||
    "everyday observations";
  const prompt =
    VISITOR_SAMPLE_PROMPTS[
      (visitorId * 3 + round) % VISITOR_SAMPLE_PROMPTS.length
    ];

  const payload = {
    visitorMessage: prompt,
    seedTopic,
    participantIds: ["theo-mercer", "elena-cross"],
    recentExchanges: [
      { speaker: "elena-cross", text: "It's an interesting subject to ponder." },
      { speaker: "theo-mercer", text: "Details determine the outcome." },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = performance.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `192.168.10.${(visitorId % 250) + 1}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const latencyMs = performance.now() - startTime;
    clearTimeout(timer);

    if (!response.ok) {
      return {
        success: false,
        latencyMs,
        error: `HTTP ${response.status}`,
        fallbackReplies: 0,
        modelReplies: 0,
        totalReplies: 0,
      };
    }

    const data = await response.json();
    if (!data || !data.success || !Array.isArray(data.replies)) {
      return {
        success: false,
        latencyMs,
        error: "Malformed response payload",
        fallbackReplies: 0,
        modelReplies: 0,
        totalReplies: 0,
      };
    }

    let fallbackReplies = 0;
    let modelReplies = 0;
    for (const reply of data.replies) {
      if (reply.source === "fallback") fallbackReplies++;
      else if (reply.source === "model") modelReplies++;
    }

    return {
      success: true,
      latencyMs,
      error: null,
      fallbackReplies,
      modelReplies,
      totalReplies: data.replies.length,
    };
  } catch (err) {
    const latencyMs = performance.now() - startTime;
    clearTimeout(timer);
    return {
      success: false,
      latencyMs,
      error: err.name === "AbortError" ? "Timeout" : (err.message || "Network Error"),
      fallbackReplies: 0,
      modelReplies: 0,
      totalReplies: 0,
    };
  }
}

async function runStep({ url, concurrency, rounds, timeoutMs }) {
  const stepLatencies = [];
  let stepErrors = 0;
  let stepFallbackReplies = 0;
  let stepTotalReplies = 0;
  const totalRequests = concurrency * rounds;

  for (let round = 0; round < rounds; round++) {
    const tasks = Array.from({ length: concurrency }, (_, visitorIdx) =>
      sendVisitorRequest({
        url,
        timeoutMs,
        visitorId: visitorIdx,
        round,
      }),
    );

    const results = await Promise.all(tasks);
    for (const result of results) {
      stepLatencies.push(result.latencyMs);
      if (!result.success) {
        stepErrors++;
      }
      stepFallbackReplies += result.fallbackReplies;
      stepTotalReplies += result.totalReplies;
    }
  }

  const medianLatency = calculatePercentile(stepLatencies, 50);
  const p95Latency = calculatePercentile(stepLatencies, 95);
  const maxLatency = stepLatencies.length ? Math.max(...stepLatencies) : 0;
  const fallbackPct =
    stepTotalReplies > 0
      ? (stepFallbackReplies / stepTotalReplies) * 100
      : 0;

  return {
    concurrency,
    totalRequests,
    errors: stepErrors,
    medianMs: Math.round(medianLatency),
    p95Ms: Math.round(p95Latency),
    maxMs: Math.round(maxLatency),
    fallbackReplies: stepFallbackReplies,
    totalReplies: stepTotalReplies,
    fallbackPercentage: fallbackPct.toFixed(1),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(`
OneSmarter Café Load Testing Utility

Usage:
  node scripts/loadtest-cafe.mjs [options]

Options:
  --url <url>        Target Café reply URL (default: ${DEFAULT_URL})
  --steps <list>     Concurrency steps (default: ${DEFAULT_STEPS.join(",")})
  --rounds <n>       Rounds per concurrency step (default: ${DEFAULT_ROUNDS})
  --timeout <ms>     Request timeout in ms (default: ${DEFAULT_TIMEOUT_MS})
  --help             Show this help message

Example:
  node scripts/loadtest-cafe.mjs --steps 1,5,10,20,40 --rounds 3
`);
    process.exit(0);
  }

  console.log("===============================================================");
  console.log("           OneSmarter Café Load Test Execution                 ");
  console.log("===============================================================");
  console.log(`Target URL:    ${options.url}`);
  console.log(`Steps:         ${options.steps.join(", ")} simultaneous visitors`);
  console.log(`Rounds/Step:   ${options.rounds}`);
  console.log(`Timeout:       ${options.timeoutMs} ms`);
  console.log("---------------------------------------------------------------\n");

  const results = [];

  for (const step of options.steps) {
    process.stdout.write(`Executing step: ${step} simultaneous visitors... `);
    const stepStartTime = performance.now();
    try {
      const result = await runStep({
        url: options.url,
        concurrency: step,
        rounds: options.rounds,
        timeoutMs: options.timeoutMs,
      });
      const stepDuration = ((performance.now() - stepStartTime) / 1000).toFixed(1);
      console.log(`done in ${stepDuration}s (${result.errors} errors)`);
      results.push(result);
    } catch (err) {
      console.log(`failed: ${err.message}`);
      results.push({
        concurrency: step,
        totalRequests: step * options.rounds,
        errors: step * options.rounds,
        medianMs: 0,
        p95Ms: 0,
        maxMs: 0,
        fallbackReplies: 0,
        totalReplies: 0,
        fallbackPercentage: "0.0",
      });
    }
  }

  console.log("\n=========================================================================================================");
  console.log("                                        Load Test Results Summary                                        ");
  console.log("=========================================================================================================");
  console.log(
    "| " +
      "Visitors".padEnd(10) +
      " | " +
      "Total Reqs".padEnd(10) +
      " | " +
      "Errors".padEnd(8) +
      " | " +
      "Median (ms)".padEnd(12) +
      " | " +
      "p95 (ms)".padEnd(10) +
      " | " +
      "Max (ms)".padEnd(10) +
      " | " +
      "Fallback".padEnd(10) +
      " | " +
      "Fallback %".padEnd(10) +
      " |",
  );
  console.log(
    "|-" +
      "-".repeat(10) +
      "-+-" +
      "-".repeat(10) +
      "-+-" +
      "-".repeat(8) +
      "-+-" +
      "-".repeat(12) +
      "-+-" +
      "-".repeat(10) +
      "-+-" +
      "-".repeat(10) +
      "-+-" +
      "-".repeat(10) +
      "-+-" +
      "-".repeat(10) +
      "-|",
  );

  for (const r of results) {
    console.log(
      "| " +
        String(r.concurrency).padEnd(10) +
        " | " +
        String(r.totalRequests).padEnd(10) +
        " | " +
        String(r.errors).padEnd(8) +
        " | " +
        String(r.medianMs).padEnd(12) +
        " | " +
        String(r.p95Ms).padEnd(10) +
        " | " +
        String(r.maxMs).padEnd(10) +
        " | " +
        String(r.fallbackReplies).padEnd(10) +
        " | " +
        `${r.fallbackPercentage}%`.padEnd(10) +
        " |",
    );
  }
  console.log("=========================================================================================================\n");

  return results;
}

// Execute CLI when invoked directly
if (process.argv[1]?.endsWith("loadtest-cafe.mjs") || process.argv[1]?.includes("loadtest-cafe")) {
  main().catch((err) => {
    console.error("Fatal loadtest error:", err);
    process.exit(1);
  });
}

export { runStep, sendVisitorRequest, calculatePercentile };
