import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";
import { cafePersonas } from "../../../src/data/agentPresentation/cafePersonas.js";
import { generateCafeWithOllama } from "../../../scripts/lib/cafeOllama.js";
import { resolveCafeGenerationInputs } from "../../../scripts/generate-cafe-conversation.js";
import { isSensitiveOrSexualText } from "../../../src/data/cafeConversations/cafeSafetyGuard.js";

const draftsDirectory = path.resolve(
  process.cwd(),
  "src/data/cafeConversations/drafts",
);

export const buildEnhancedCafePrompt = ({ participantIds, seedTopic, exchangeCount }) => {
  const participants = participantIds.map((id) => cafePersonas.find((p) => p.id === id));
  const [p1, p2] = participants;

  return [
    `Write an articulate, natural, and meaningful conversation over coffee between ${p1.name} and ${p2.name}.`,
    `Discussion topic: "${seedTopic.trim()}".`,
    "",
    "Characters:",
    `- ${p1.name}: ${p1.offDutyDisposition.slice(0, 160)}. Interested in: ${p1.interests.slice(0, 3).join(", ")}.`,
    `- ${p2.name}: ${p2.offDutyDisposition.slice(0, 160)}. Interested in: ${p2.interests.slice(0, 3).join(", ")}.`,
    "",
    "Rules for high-quality dialogue:",
    `1. Generate exactly ${exchangeCount} dialogue turns strictly alternating between ${p1.name} and ${p2.name}.`,
    `2. Every turn MUST be 1 or 2 complete, well-formed, grammatically correct sentences directly discussing "${seedTopic.trim()}".`,
    `3. Strictly NO sentence fragments, unfinished clauses, or cut-offs (such as "I noticed" or "I found").`,
    `4. Strictly NO speaker prefixes or names inside the text field (do NOT write "${p1.name}:" or "${p2.name}:" inside the text). Put ONLY the spoken words in the text.`,
    `5. Strictly NO code brackets, curly braces, or markdown artifacts.`,
    `6. Keep the discussion thoughtful, curious, and realistic.`,
    `7. Strictly avoid all sexually explicit, adult, violent, or sensitive subject matter.`,
    "",
    `Return strictly valid JSON:`,
    `{`,
    `  "exchanges": [`,
    `    { "speaker": "${p1.id}", "text": "First complete remark discussing ${seedTopic.trim()}." },`,
    `    { "speaker": "${p2.id}", "text": "Second complete remark responding to the first." }`,
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

  try {
    const { participantIds, seedTopic, exchangeCount } = req.body || {};

    if (typeof seedTopic === "string" && seedTopic.trim()) {
      const safetyCheck = isSensitiveOrSexualText(seedTopic);
      if (safetyCheck.isSensitive) {
        return res.status(400).json({
          error: "sensitive_topic_rejected",
          message:
            "Please choose a constructive, everyday topic. Adult, sexual, or sensitive topics are not permitted.",
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
              e.text.trim().length >= 15 &&
              inputs.participantIds.includes(e.speaker) &&
              !isSensitiveOrSexualText(e.text).isSensitive,
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
    const cleanedExchanges = parsed.exchanges.slice(0, inputs.exchangeCount).map((ex, index) => {
      // Ensure proper alternating speaker if model defaulted to single speaker
      const expectedSpeaker = inputs.participantIds[index % 2];
      const speaker = inputs.participantIds.includes(ex.speaker) ? ex.speaker : expectedSpeaker;
      const text = sanitizeExchangeText(ex.text, speaker);

      return {
        speaker,
        text,
      };
    });

    const draftId = `cafe-draft-${randomUUID()}`;
    const generatedAt = new Date().toISOString();
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
      publishedAt: generatedAt.slice(0, 10),
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
  }
}
