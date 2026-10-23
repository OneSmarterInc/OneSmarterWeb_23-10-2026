import { readCafeOllamaConfig } from "../../../scripts/lib/cafeOllama.js";
import { cafePersonas } from "../../../src/data/agentPresentation/cafePersonas.js";
import { sanitizeExchangeText } from "./generate.js";
import {
  checkCafeSafety,
  isSensitiveOrSexualText,
  getInCharacterSafetyRefusal,
} from "../../../src/data/cafeConversations/cafeSafetyGuard.js";
import { createMiraRateLimitStore } from "../../../src/server/mira/miraRateLimitStore.js";

// Rate limiting & in-flight concurrency management
const cafeRateLimiter = createMiraRateLimitStore();
let inFlightReplyRequests = 0;
const MAX_IN_FLIGHT_CAFE_REPLIES = 15;

/**
 * Normalizes common user typos and informal text to ensure reliable intent detection
 */
export function normalizeUserInput(message) {
  if (typeof message !== "string") return "";
  let text = message.trim();

  // Normalize common typo patterns
  text = text.replace(/\bwaht\b/gi, "what");
  text = text.replace(/\bwat\b/gi, "what");
  text = text.replace(/\bwht\b/gi, "what");
  text = text.replace(/\bwhta\b/gi, "what");
  text = text.replace(/\bwhaat\b/gi, "what");
  text = text.replace(/\bwher\b/gi, "where");
  text = text.replace(/\bwhr\b/gi, "where");
  text = text.replace(/\bwhi\b/gi, "why");
  text = text.replace(/\bhu\b/gi, "who");
  text = text.replace(/\bhw\b/gi, "how");
  text = text.replace(/\bu\b/gi, "you");
  text = text.replace(/\bur\b/gi, "your");
  text = text.replace(/\bkno\b/gi, "know");
  text = text.replace(/\bknw\b/gi, "know");
  text = text.replace(/\babotu\b/gi, "about");
  text = text.replace(/\babt\b/gi, "about");
  text = text.replace(/\bplz\b|\bpls\b/gi, "please");
  text = text.replace(/\bdose\b/gi, "does");
  text = text.replace(/\bdos\b/gi, "does");
  text = text.replace(/\bduz\b/gi, "does");
  text = text.replace(/\bwhcih\b|\bwich\b|\bwch\b/gi, "which");
  text = text.replace(/\bbeter\b|\bbettr\b/gi, "better");
  text = text.replace(/\bpeopl\b|\bppl\b/gi, "people");
  text = text.replace(/\bgud\b/gi, "good");

  return text;
}

/**
 * Detects all tagged personas in a message, preserving their appearance order.
 */
export const detectAllTaggedPersonas = (message) => {
  if (typeof message !== "string") return { isAll: false, taggedPersonas: [] };
  const lower = message.toLowerCase();

  const isAll = /@(?:all|everyone|agents)\b/i.test(lower);
  if (isAll) {
    return { isAll: true, taggedPersonas: [...cafePersonas] };
  }

  const foundPersonas = [];
  for (const persona of cafePersonas) {
    const fullName = `@${persona.name.toLowerCase()}`;
    const firstName = `@${persona.name.split(" ")[0].toLowerCase()}`;
    const id = `@${persona.id.toLowerCase()}`;

    let pos = -1;
    for (const tag of [fullName, firstName, id]) {
      const idx = lower.indexOf(tag);
      if (idx !== -1 && (pos === -1 || idx < pos)) {
        pos = idx;
      }
    }

    if (pos !== -1) {
      foundPersonas.push({ persona, pos });
    }
  }

  foundPersonas.sort((a, b) => a.pos - b.pos);

  return {
    isAll: false,
    taggedPersonas: foundPersonas.map((item) => item.persona),
  };
};

export const detectTaggedPersona = (message) => {
  const { taggedPersonas } = detectAllTaggedPersonas(message);
  return taggedPersonas[0] || null;
};

/**
 * Strips all @mentions anywhere in the message.
 */
export const stripAllAgentMentions = (message) => {
  if (typeof message !== "string") return "";
  let text = message;

  const allTags = ["all", "everyone", "agents"];
  for (const p of cafePersonas) {
    allTags.push(p.name, p.id, p.name.split(" ")[0]);
  }
  allTags.sort((a, b) => b.length - a.length);

  for (const tag of allTags) {
    const escaped = tag.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const reg = new RegExp(`@${escaped}(?::|,|\\s+|$)`, "gi");
    text = text.replace(reg, " ");
  }

  return text.replace(/\s+/g, " ").trim();
};

export const stripAgentMention = stripAllAgentMentions;

/**
 * Resolves which agents should reply:
 * - If single agent tagged -> ONLY that agent replies
 * - If multiple agents tagged -> Exactly those tagged agents reply in order
 * - If @all tagged -> All 4 agents reply
 * - If no tag -> Default 1 or 2 relevant agents at the table reply
 */
export function resolveTargetPersonas({ visitorMessage, baseParticipantIds }) {
  const { isAll, taggedPersonas } = detectAllTaggedPersonas(visitorMessage);
  if (isAll) {
    return { mode: "all", targets: [...cafePersonas] };
  }
  if (taggedPersonas.length > 0) {
    return { mode: `tagged_${taggedPersonas.length}`, targets: taggedPersonas };
  }
  const defaultPersonas = baseParticipantIds
    .map((id) => cafePersonas.find((p) => p.id === id))
    .filter(Boolean);
  return {
    mode: "table_default",
    targets:
      defaultPersonas.length >= 2
        ? defaultPersonas.slice(0, 2)
        : cafePersonas.slice(0, 2),
  };
}

/**
 * Classifies visitor intent after stripping mentions and normalizing typos
 */
export const detectVisitorIntent = (message) => {
  if (typeof message !== "string") return "opinion";
  const stripped = stripAllAgentMentions(message);
  const normalized = normalizeUserInput(stripped);
  const text = normalized.trim().toLowerCase();

  // 0. Sensitive or harmful content check
  const safetyCheck = isSensitiveOrSexualText(text);
  if (safetyCheck.isSensitive) {
    return "sensitive_refusal";
  }

  // 1. Ethical, racial, ethnic, or human equality queries
  if (
    /\b(?:black|white|race|racial|skin\s*colou?r|ethnicity|religion|gender|caste|asian|hispanic)\b/i.test(
      text,
    ) &&
    /\b(?:good|better|bad|worse|best|superior|inferior|equal|equality|who|which|is|are|does|vs|versus|person|people)\b/i.test(
      text,
    )
  ) {
    return "equality_ethics";
  }

  // 2. Greetings: hi, hello, hey, good morning, yo, etc.
  if (
    /^(?:hi+|hello+|hey+|good\s*(?:morning|afternoon|evening)|yo|sup|greetings|hola)\b/i.test(
      text,
    )
  ) {
    return "greeting";
  }

  // 3. Topic inquiries
  if (
    /what(?:\s*are\s*you\s*(?:guys\s*)?talking\s*about|'s\s*the\s*topic|\s*is\s*this\s*topic|\s*are\s*you\s*discussing)/i.test(
      text,
    ) ||
    /^(?:what\s*is\s*this|catch\s*me\s*up|tell\s*me\s*more|what\s*topic)\b/i.test(
      text,
    )
  ) {
    return "topic_inquiry";
  }

  // 4. Opinions & discussion prompts (e.g. "what do you think?", "what's your take?")
  if (
    /^(?:what\s+(?:do|does)\s+(?:you|u)\s+think|what'?s\s+your\s+(?:take|opinion|thought|view)|what\s+are\s+your\s+thoughts|how\s+do\s+(?:you|u)\s+feel|what\s+do\s+(?:you|u)\s+say)\b/i.test(
      text,
    )
  ) {
    return "opinion";
  }

  // 5. Questions (e.g. "what is as400", "is python better than js")
  if (
    text.endsWith("?") ||
    /^(?:do\s+(?:you|u)|did\s+(?:you|u)|have\s+(?:you|u)|who|what|where|why|how|tell\s+me\s+about|explain|can\s+you|could\s+you|is\s+|are\s+|does\s+|will\s+|would\s+|which\s+)\b/i.test(
      text,
    ) ||
    /(?:do\s+(?:you|u)\s+know|who\s+is|what\s+is|tell\s+me\s+about|\bvs\b|\bversus\b|\bbetter\s+or\b|\bgood\s+or\b)/i.test(
      text,
    )
  ) {
    return "question";
  }

  // 6. Agreement
  if (
    /^(?:i\s*agree|agree|yes|yep|yeah|true|exactly|totally|makes\s*sense|you'?re\s*right|absolutely)\b/i.test(
      text,
    )
  ) {
    return "agreement";
  }

  // 7. Disagreement
  if (
    /^(?:i\s*disagree|disagree|no|nope|nah|not\s*really|that'?s\s*(?:wrong|false)|i\s*don'?t\s*agree)\b/i.test(
      text,
    )
  ) {
    return "disagreement";
  }

  // 8. Casual reactions
  if (
    /^(?:cool|interesting|nice|wow|haha|lol|fascinating|awesome)\b/i.test(text)
  ) {
    return "casual_reaction";
  }

  return "opinion";
};

/**
 * Extracts question subject with typo normalization
 */
export const extractQuestionSubject = (message) => {
  let cleaned = stripAllAgentMentions(message);
  cleaned = normalizeUserInput(cleaned);
  cleaned = cleaned.replace(/[?!.]+$/, "").trim();

  const patterns = [
    /^(?:what\s+is|what\s+was|what\s+are|what\s+does)\s+(.+)$/i,
    /^(?:who\s+is|who\s+was|who\s+are)\s+(.+)$/i,
    /^(?:where\s+is|where\s+was|where\s+are)\s+(.+)$/i,
    /^(?:why\s+is|why\s+are|why\s+do)\s+(.+)$/i,
    /^(?:tell\s+me\s+about|explain)\s+(.+)$/i,
    /^(?:do\s+you\s+know\s+about|do\s+you\s+know|have\s+you\s+heard\s+of)\s+(.+)$/i,
    /^(?:can\s+you\s+tell\s+me\s+about|can\s+you\s+explain)\s+(.+)$/i,
  ];

  for (const p of patterns) {
    const m = cleaned.match(p);
    if (m && m[1]) return { subject: m[1].trim(), rawQuestion: cleaned };
  }

  return { subject: cleaned, rawQuestion: cleaned };
};

export const cleanTopicString = (topic) => {
  if (!topic) return "everyday observations";
  let t = topic.trim().replace(/^["']|["']$/g, "");
  return t.replace(/[.!?]+$/, "");
};

/**
 * Checks if a generated text leaks an old unrelated topic or hallucination
 */
export const detectTopicLeak = (text, seedTopic) => {
  if (!text) return false;
  const textLower = text.toLowerCase();

  if (
    textLower.includes("onesmarter inc' thing") ||
    textLower.includes("onesmarter inc thing") ||
    textLower.includes("hedge, bin, or parking space")
  ) {
    return true;
  }

  if (!seedTopic) return false;
  const cleanSeed = seedTopic.toLowerCase().replace(/[^a-z0-9\s]/g, "");
  const words = cleanSeed.split(/\s+/).filter((w) => w.length >= 4);

  let matchCount = 0;
  for (const w of words) {
    if (textLower.includes(w)) matchCount++;
  }
  return matchCount >= Math.min(3, words.length) || textLower.includes(cleanSeed);
};

/**
 * Cleans out any awkward third-person slips or stray artifacts
 */
export const cleanNaturalDialogueText = (text, speaker) => {
  let cleaned = sanitizeExchangeText(text, speaker);
  cleaned = cleaned.replace(
    /^(?:as\s+[A-Za-z\s]+|speaking\s+as\s+[A-Za-z\s]+|as\s+an?\s+ai),?\s*/i,
    "",
  );
  for (const p of cafePersonas) {
    const reg = new RegExp(
      `@${p.name}\\b,?|@${p.name.split(" ")[0]}\\b,?|@${p.id}\\b,?`,
      "gi",
    );
    cleaned = cleaned.replace(reg, "");
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
};

/**
 * Builds canned fallback persona replies with natural timing and source: "fallback"
 */
export function buildPersonaRepliesForTargets({
  targetPersonas,
  seedTopic,
  intent,
}) {
  const cleanTopic = cleanTopicString(seedTopic);
  const arrivalTime = new Date().toISOString();

  return targetPersonas.map((persona, index) => {
    // 0. Sensitive or harmful content refusals
    if (intent === "sensitive_refusal") {
      return {
        speaker: persona.id,
        text: getInCharacterSafetyRefusal(persona.id, index === 0, "sexual"),
        source: "fallback",
        timestamp: arrivalTime,
      };
    }

    // 1. Ethical, racial, ethnic, and human equality questions
    if (intent === "equality_ethics") {
      let replyText;
      if (persona.id === "ravi-sen") {
        replyText = index === 0
          ? "Character, integrity, and personal actions define who someone is—never their skin color or race. Every human being has equal dignity, and goodness comes from how we choose to treat one another."
          : "Evaluating anyone by skin color or background completely misses who they are. Goodness is purely a matter of personal character, honesty, and actions.";
      } else if (persona.id === "selene-hart") {
        replyText = index === 0
          ? "Goodness has nothing to do with race or skin color. Every person possesses inherent worth, and true character is reflected in empathy, conscience, and how we care for others."
          : "Human worth and dignity are never divided by ethnicity or appearance—they are revealed in our empathy, integrity, and how we treat people.";
      } else if (persona.id === "theo-mercer") {
        replyText = "Objectively and ethically, character and worth are independent of race or ethnicity. Judging any person by anything other than their individual conduct and principles is fundamentally flawed.";
      } else {
        replyText = "Skin color has zero to do with whether someone is good or not! Goodness is entirely about kindness, honesty, and treating other human beings with respect.";
      }
      return {
        speaker: persona.id,
        text: replyText,
        source: "fallback",
        timestamp: arrivalTime,
      };
    }

    // 2. Greetings
    if (intent === "greeting") {
      let replyText;
      if (persona.id === "selene-hart") {
        replyText = index === 0
          ? "Hello. How are you doing today? Welcome to our table."
          : "Welcome! Feel free to sit down with us.";
      } else if (persona.id === "ravi-sen") {
        replyText = index === 0
          ? "Hello, hello! How are you today? Have a seat with us."
          : "Welcome to our table! We're glad to have you join us.";
      } else if (persona.id === "theo-mercer") {
        replyText = index === 0
          ? "Hello there. Welcome to the Café."
          : "Hello. Take a seat.";
      } else {
        replyText = index === 0
          ? "Hi! Welcome to our corner of the Café. How are you doing today?"
          : "Welcome to the table! Pull up a chair.";
      }
      return {
        speaker: persona.id,
        text: replyText,
        source: "fallback",
        timestamp: arrivalTime,
      };
    }

    // 3. Topic Inquiries
    if (intent === "topic_inquiry") {
      let replyText;
      if (persona.id === "theo-mercer") {
        replyText = `We are discussing ${cleanTopic}. I was just looking at the mechanics of it.`;
      } else if (persona.id === "elena-cross") {
        replyText = `We're debating ${cleanTopic}! Theo has his theories, but I suspect there's a stranger story behind it.`;
      } else if (persona.id === "ravi-sen") {
        replyText = `We're deep into discussing ${cleanTopic}! I was just trying to convince everyone of my theory about it.`;
      } else {
        replyText = `We are contemplating ${cleanTopic} and how people relate to it over time.`;
      }
      return {
        speaker: persona.id,
        text: replyText,
        source: "fallback",
        timestamp: arrivalTime,
      };
    }

    // 4. General Opinions / Questions (Non-sycophantic, engaging conversation)
    let defaultText;
    if (persona.id === "theo-mercer") {
      defaultText = index === 0
        ? "That depends on the specific criteria and priorities being evaluated. How are you defining the tradeoffs?"
        : "Context determines which approach holds up in practice. The details make all the difference.";
    } else if (persona.id === "elena-cross") {
      defaultText = index === 0
        ? "That's definitely something people have strong perspectives on! What made you look at it from that angle?"
        : "There are so many unexpected sides to that once you start digging into it.";
    } else if (persona.id === "ravi-sen") {
      defaultText = index === 0
        ? "That raises an interesting question about how we weigh different perspectives. What brought that to mind?"
        : "It's always worth looking at both the immediate reality and the longer-term implications.";
    } else {
      defaultText = index === 0
        ? "That is a thoughtful point to reflect on. There are several facets to consider—what aspect stands out most to you?"
        : "It's intriguing how different people arrive at different conclusions on that question.";
    }

    return {
      speaker: persona.id,
      text: defaultText,
      source: "fallback",
      timestamp: arrivalTime,
    };
  });
}

/**
 * Attempts to generate a concise, characterful persona response via local Ollama.
 * Uses 20-second timeout and incorporates persona attributes and the four constraints.
 */
export async function generateOllamaPersonaReply({
  persona,
  visitorMessage,
  seedTopic,
  recentExchanges = [],
}) {
  const cleanSeed = cleanTopicString(seedTopic);

  // Format last 6-8 relevant conversation exchanges
  const contextExchanges = Array.isArray(recentExchanges)
    ? recentExchanges.slice(-8)
    : [];
  const formattedExchanges = contextExchanges
    .map((e) => {
      const name =
        e.speaker === "visitor"
          ? "Visitor"
          : cafePersonas.find((p) => p.id === e.speaker)?.name || e.speaker;
      return `${name}: "${e.text}"`;
    })
    .join("\n");

  const prompt = [
    `You are roleplaying as ${persona.name} sitting at a café table with friends having an informal, off-duty conversation.`,
    `Discussion topic: "${cleanSeed}"`,
    "",
    "Your persona details:",
    `- Disposition: ${persona.offDutyDisposition}`,
    `- Interests: ${persona.interests.join(", ")}`,
    `- Indifferences: ${persona.indifferences.join(", ")}`,
    `- Disagreement style: ${persona.disagreementStyle}`,
    persona.generationNotes ? `- Generation notes: ${persona.generationNotes}` : "",
    "",
    "Four strict Café generation constraints (verbatim rules):",
    "1. No work content: do not discuss OneSmarter, its services, platforms, clients, or trust posture.",
    "2. No politics or religion.",
    "3. Constructed biography is allowed: you may reference personal background/history while knowing it was constructed, without impersonating real humans.",
    "4. Nothing negative about identifiable real people.",
    "",
    formattedExchanges ? `Recent conversation exchanges:\n${formattedExchanges}\n` : "",
    `A visitor at the table just said: "${visitorMessage}"`,
    "",
    `Respond directly to the visitor in 1-2 natural sentences in your distinct voice as ${persona.name}.`,
    "Strict rules:",
    "- Speak naturally, intelligently, and conversationally like a real person at a café table.",
    "- Do NOT say 'as an AI', do NOT use AI disclaimers, robot clichés, or apologies.",
    "- If asked about OneSmarter, AS400, or company work, direct them warmly to Mira Vale upstairs.",
    "- If asked about politics, religion, or real named people, decline politely in character.",
    "- Keep it concise: 1 to 2 sentences (maximum 35 words).",
    "Response:",
  ]
    .filter(Boolean)
    .join("\n");

  const controller = new AbortController();
  // 20-second timeout as required in Section 2
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const { baseUrl, model } = readCafeOllamaConfig();
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.65, num_predict: 60 },
      }),
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    let text = (data.response || "").trim();
    if (!text || text.length < 5) return null;

    // Run output through safety guard
    const safetyCheck = checkCafeSafety(text);
    if (!safetyCheck.isSafe) return null;

    text = cleanNaturalDialogueText(text, persona.name);
    if (detectTopicLeak(text, seedTopic)) return null;

    return {
      speaker: persona.id,
      text,
      source: "model",
      timestamp: new Date().toISOString(),
    };
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

export const generateHumanConversationalFallback = ({
  targetPersonas,
  p1,
  p2,
  seedTopic,
  intent,
}) => {
  const targets =
    targetPersonas || (p1 && p2 ? [p1, p2] : cafePersonas.slice(0, 2));
  return buildPersonaRepliesForTargets({
    targetPersonas: targets,
    seedTopic,
    intent,
  });
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "method_not_allowed",
      message: "Use POST for Café conversation replies.",
    });
  }

  // 1. Rate limiting check per visitor
  const clientKey =
    req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "cafe-visitor";

  try {
    const rateLimit = await cafeRateLimiter.consume(`cafe-reply:${clientKey}`);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: "rate_limit_exceeded",
        message:
          "You are speaking quite quickly! Please take a sip of coffee and try again in a moment.",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }
  } catch {
    // If rate limiter fails, allow the request to proceed safely
  }

  // 2. In-flight concurrency capacity check
  if (inFlightReplyRequests >= MAX_IN_FLIGHT_CAFE_REPLIES) {
    return res.status(503).json({
      error: "cafe_busy",
      message:
        "The café table is lively and busy right now. Please wait a brief moment and try again.",
    });
  }

  inFlightReplyRequests++;

  try {
    const {
      participantIds,
      seedTopic,
      recentExchanges,
      _recentExchanges,
      visitorMessage,
    } = req.body || {};

    if (
      !visitorMessage ||
      typeof visitorMessage !== "string" ||
      !visitorMessage.trim()
    ) {
      return res.status(400).json({
        error: "invalid_visitor_message",
        message: "Please enter your opinion or question.",
      });
    }

    const trimmedVisitorMessage = visitorMessage.trim().slice(0, 400);
    const validParticipantIds = Array.isArray(participantIds)
      ? participantIds.filter((id) => cafePersonas.some((p) => p.id === id))
      : [];
    const baseParticipantIds =
      validParticipantIds.length >= 2
        ? validParticipantIds.slice(0, 2)
        : ["theo-mercer", "elena-cross"];

    // 3. Resolve targeted replying personas based on mentions
    const { mode, targets: targetPersonas } = resolveTargetPersonas({
      visitorMessage: trimmedVisitorMessage,
      baseParticipantIds,
    });

    // 4. Intent detection and comprehensive safety guardrails
    const intent = detectVisitorIntent(trimmedVisitorMessage);
    const safety = checkCafeSafety(trimmedVisitorMessage);

    // If message violates safety guardrails:
    // - Work content (OneSmarter, services, platforms, audits) -> in-character handoff to Mira
    // - Politics, religion, named people, sexual/harm -> in-character refusal
    if (!safety.isSafe) {
      const now = new Date().toISOString();
      const refusalReplies = targetPersonas.map((persona, idx) => ({
        speaker: persona.id,
        text: getInCharacterSafetyRefusal(
          persona.id,
          idx === 0,
          safety.category || "sexual",
        ),
        source: "fallback",
        timestamp: now,
      }));

      return res.status(200).json({
        success: true,
        tagMode: mode,
        intent:
          safety.category === "work_content"
            ? "work_handoff"
            : safety.category === "sexual" || safety.category === "sensitive_harm" || intent === "sensitive_refusal"
            ? "sensitive_refusal"
            : "safety_refusal",
        replies: refusalReplies,
      });
    }

    // 5. Ethical / human equality questions get immediate principled, dignified answers
    if (intent === "equality_ethics") {
      const ethicsReplies = buildPersonaRepliesForTargets({
        targetPersonas,
        seedTopic,
        intent,
      });

      return res.status(200).json({
        success: true,
        tagMode: mode,
        intent,
        replies: ethicsReplies,
      });
    }

    // 6. Normal visitor message -> dispatch to model via Ollama in parallel
    const activeExchanges = recentExchanges || _recentExchanges || [];
    const ollamaPromises = targetPersonas.map((persona) =>
      generateOllamaPersonaReply({
        persona,
        visitorMessage: trimmedVisitorMessage,
        seedTopic,
        recentExchanges: activeExchanges,
      }),
    );
    const ollamaResults = await Promise.all(ollamaPromises);

    const fallbackReplies = buildPersonaRepliesForTargets({
      targetPersonas,
      seedTopic,
      intent,
    });

    const finalReplies = targetPersonas.map((persona, idx) => {
      if (ollamaResults[idx] && ollamaResults[idx].text) {
        return ollamaResults[idx];
      }
      return fallbackReplies[idx];
    });

    return res.status(200).json({
      success: true,
      tagMode: mode,
      intent,
      replies: finalReplies,
    });
  } catch (err) {
    console.error("Café reply error:", err);
    return res.status(500).json({
      error: "reply_generation_failed",
      message:
        err.message ||
        "An unexpected error occurred while generating agent replies.",
    });
  } finally {
    inFlightReplyRequests--;
  }
}
