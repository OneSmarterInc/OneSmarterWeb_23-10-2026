import path from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";
import { cafePersonas, cafeGenerationConstraints } from "../../../src/data/agentPresentation/cafePersonas.js";
import { generateCafeWithOllama } from "../../../scripts/lib/cafeOllama.js";
import { resolveCafeGenerationInputs } from "../../../scripts/generate-cafe-conversation.js";
import {
  checkCafeSafety,
  isSensitiveOrSexualText,
} from "../../../src/data/cafeConversations/cafeSafetyGuard.js";
import { createMiraRateLimitStore } from "../../../src/server/mira/miraRateLimitStore.js";

const cafeGenerateRateLimiter = createMiraRateLimitStore();
let inFlightGenerateRequests = 0;
const MAX_IN_FLIGHT_CAFE_GENERATE = 5;

export const buildEnhancedCafePrompt = ({ participantIds, seedTopic, exchangeCount }) => {
  const participants = participantIds.map((id) => cafePersonas.find((p) => p.id === id));
  const [p1, p2] = participants;

  return [
    `Write an articulate, natural, and witty conversation over coffee between ${p1.name} and ${p2.name}.`,
    `Discussion topic: "${seedTopic.trim()}".`,
    "",
    "Characters:",
    `- ${p1.name}: ${p1.offDutyDisposition}. Interested in: ${p1.interests.join(", ")}. Indifferent to: ${p1.indifferences.join(", ")}. Disagreement style: ${p1.disagreementStyle}.${p1.generationNotes ? ` Generation notes: ${p1.generationNotes}` : ""}`,
    `- ${p2.name}: ${p2.offDutyDisposition}. Interested in: ${p2.interests.join(", ")}. Indifferent to: ${p2.indifferences.join(", ")}. Disagreement style: ${p2.disagreementStyle}.${p2.generationNotes ? ` Generation notes: ${p2.generationNotes}` : ""}`,
    "",
    "Four strict Café generation constraints:",
    ...cafeGenerationConstraints.map((c) => `- ${c}`),
    "",
    "Dialogue and character direction:",
    `1. Generate exactly ${exchangeCount} dialogue turns between ${p1.name} and ${p2.name}. Turn order should vary naturally rather than strictly alternating, but both participants must speak.`,
    "2. If Theo Mercer is present, keep his contributions short (often just a few words or one short sentence) and relatively infrequent, without forcing equal conversational airtime.",
    "3. Do NOT include AI disclaimers, do NOT say 'as an AI', and do NOT mention AI identity or prompts.",
    "4. Do NOT use audit-report language, work roles, or corporate jargon.",
    "5. Style reference: natural, dry, witty, grounded conversation like two friends observing a funny or curious everyday situation over coffee (as in cafe-2026-08-19-theo-elena-cooking-programme.js).",
    "6. Put ONLY the spoken dialogue in the text field (no speaker names, prefixes, quotes, or markdown artifacts).",
    "",
    `Return strictly valid JSON:`,
    `{`,
    `  "exchanges": [`,
    `    { "speaker": "${p1.id}", "text": "First remark discussing ${seedTopic.trim()}." },`,
    `    { "speaker": "${p2.id}", "text": "Second remark responding to the first." }`,
    `  ]`,
    `}`,
  ].join("\n");
};

export const sanitizeExchangeText = (text, speaker) => {
  if (typeof text !== "string") return "";
  let cleaned = text.trim();

  // Strip speaker prefixes like "Elena Cross:", "Elena:", "Theo Mercer:", "Theo:", "Speaker 1:"
  cleaned = cleaned.replace(/^(?:[A-Za-z\s]+):\s*/i, "");

  // Strip accidental self-addressing (e.g. Elena starting with "Elena, ")
  const persona = cafePersonas.find((p) => p.id === speaker);
  if (persona) {
    const firstName = persona.name.split(" ")[0];
    const selfRegex = new RegExp(`^${firstName},?\\s*`, "i");
    cleaned = cleaned.replace(selfRegex, "");
  }

  // Remove stray braces/brackets/quotes/backslashes at beginning or end
  cleaned = cleaned.replace(/^[{[("'`\s\\]+/, "");
  cleaned = cleaned.replace(/[}\])"'`\s\\{]+$/, "");

  // Clean double spaces
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Ensure ends with proper sentence punctuation (. ! ?)
  if (cleaned && !/[.!?]$/.test(cleaned)) {
    cleaned += ".";
  }

  // Ensure initial letter is capitalized
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return cleaned;
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "method_not_allowed",
      message: "Use POST for Café conversation generation.",
    });
  }

  // Rate limiting check
  const clientKey =
    req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "cafe-visitor";

  try {
    const rateLimit = await cafeGenerateRateLimiter.consume(`cafe-generate:${clientKey}`);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: "rate_limit_exceeded",
        message: "You have requested several conversations recently. Please wait a moment before generating another.",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }
  } catch {
    // If rate limiter fails, allow the request to proceed
  }

  if (inFlightGenerateRequests >= MAX_IN_FLIGHT_CAFE_GENERATE) {
    return res.status(503).json({
      error: "cafe_busy",
      message: "The café conversation generator is currently at capacity. Please try again shortly.",
    });
  }

  inFlightGenerateRequests++;

  try {
    const { participantIds, seedTopic, exchangeCount } = req.body || {};

    if (typeof seedTopic === "string" && seedTopic.trim()) {
      const safetyCheck = checkCafeSafety(seedTopic);
      if (!safetyCheck.isSafe) {
        return res.status(400).json({
          error: "sensitive_topic_rejected",
          message:
            "Please choose a constructive, everyday topic. Work, adult, political, religious, or sensitive topics are not permitted.",
        });
      }
    }

    const resolvedExchangeCount = exchangeCount
      ? Math.max(6, Math.min(10, Number(exchangeCount) || 6))
      : 6;

    let inputs;
    try {
      inputs = resolveCafeGenerationInputs({
        participantIds: Array.isArray(participantIds) && participantIds.length === 2
          ? participantIds
          : undefined,
        seedTopic: typeof seedTopic === "string" && seedTopic.trim()
          ? seedTopic.trim()
          : undefined,
        exchangeCount: resolvedExchangeCount,
      });
    } catch (resolutionError) {
      return res.status(400).json({
        error: "invalid_inputs",
        message: resolutionError.message,
      });
    }

    const prompt = buildEnhancedCafePrompt({
      participantIds: inputs.participantIds,
      seedTopic: inputs.seedTopic,
      exchangeCount: inputs.exchangeCount,
    });

    const schema = {
      type: "object",
      properties: {
        exchanges: {
          type: "array",
          minItems: inputs.exchangeCount,
          maxItems: inputs.exchangeCount,
          items: {
            type: "object",
            properties: {
              speaker: { type: "string", enum: inputs.participantIds },
              text: { type: "string" },
            },
            required: ["speaker", "text"],
          },
        },
      },
      required: ["exchanges"],
    };

    let response;
    let parsed;
    let lastError;

    // Execute with up to 2 attempts to ensure complete, proper output
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await generateCafeWithOllama({
          prompt,
          schema,
          env: process.env,
        });

        parsed = JSON.parse(response.content);
        if (
          parsed &&
          Array.isArray(parsed.exchanges) &&
          parsed.exchanges.length === inputs.exchangeCount &&
          parsed.exchanges.every(
            (e) =>
              typeof e.text === "string" &&
              e.text.trim().length >= 10 &&
              inputs.participantIds.includes(e.speaker) &&
              checkCafeSafety(e.text).isSafe &&
              !/\b(?:as an ai|language model|ai agent|system prompt)\b/i.test(e.text),
          )
        ) {
          break;
        }
      } catch (err) {
        lastError = err;
        if (
          err.message &&
          (err.message.includes("unavailable") ||
            err.message.includes("ECONNREFUSED"))
        ) {
          throw err;
        }
      }
    }

    if (!parsed || !Array.isArray(parsed.exchanges)) {
      throw lastError || new Error("Failed to generate complete conversation.");
    }

    // Clean each exchange: strip prefixes, fix stray brackets, ensure complete punctuation
    const cleanedExchanges = parsed.exchanges.slice(0, inputs.exchangeCount).map((ex) => {
      const speaker = inputs.participantIds.includes(ex.speaker) ? ex.speaker : inputs.participantIds[0];
      const text = sanitizeExchangeText(ex.text, speaker);

      return {
        speaker,
        text,
      };
    });

    // Ensure both participants spoke
    if (!inputs.participantIds.every((id) => cleanedExchanges.some((ex) => ex.speaker === id))) {
      // If one participant didn't speak, assign the second turn to the missing participant
      const missingId = inputs.participantIds.find((id) => !cleanedExchanges.some((ex) => ex.speaker === id));
      if (missingId && cleanedExchanges.length > 1) {
        cleanedExchanges[1].speaker = missingId;
      }
    }

    const draftId = `cafe-draft-${randomUUID()}`;
    const generatedAt = new Date().toISOString();
    const today = generatedAt.slice(0, 10);
    const content = {
      participants: inputs.participantIds,
      seedTopic: inputs.seedTopic,
      invitedBy: inputs.invitedBy,
      exchanges: cleanedExchanges,
      selection: inputs.selection,
    };
    const contentHash = createHash("sha256")
      .update(JSON.stringify(content))
      .digest("hex");

    const draft = {
      id: draftId,
      draftId,
      model: response?.model || "qwen2.5:0.5b",
      generatedAt,
      createdAt: generatedAt,
      conversationDay: today,
      publishedAt: today,
      contentHash,
      ...content,
      status: "unpublished",
    };

    return res.status(200).json({
      success: true,
      conversation: draft,
    });
  } catch (err) {
    console.error("Café generation error:", err);
    return res.status(500).json({
      error: "generation_failed",
      message:
        err.message ||
        "An unexpected error occurred during conversation generation.",
    });
  } finally {
    inFlightGenerateRequests--;
  }
}
