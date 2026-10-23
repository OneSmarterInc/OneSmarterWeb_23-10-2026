import { cafePersonas } from "../../../src/data/agentPresentation/cafePersonas.js";
import { sanitizeExchangeText } from "./generate.js";
import {
  isSensitiveOrSexualText,
  isSensitiveKnowledgeExtract,
  getInCharacterSafetyRefusal,
} from "../../../src/data/cafeConversations/cafeSafetyGuard.js";

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
 * - If no tag -> Default 2 agents at the table reply
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

  // 0. Sensitive, sexually explicit, adult, or harmful content refusal
  const safetyCheck = isSensitiveOrSexualText(text);
  if (safetyCheck.isSensitive) {
    return "sensitive_refusal";
  }

  // 1. Ethical, racial, ethnic, or human equality queries (e.g. "dose black person good or white person")
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

  // 5. Questions or knowledge queries (e.g. "what is as400", "who is sunny leone", "is python better than js")
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

/**
 * Factual knowledge lookup covering local OneSmarter KB and Wikipedia API
 */
export async function lookupKnowledgeSummary(subject) {
  if (!subject || typeof subject !== "string") return null;
  const cleanSub = subject.toLowerCase().trim();

  // Safety gate: never query or summarize sensitive, adult, or sexual subjects
  if (isSensitiveOrSexualText(cleanSub).isSensitive) {
    return null;
  }

  // 1. OneSmarter Public Knowledge Check
  if (cleanSub.includes("onesmarter") || cleanSub.includes("one smarter")) {
    return {
      title: "OneSmarter Inc.",
      description: "AI & Technology Solutions Company",
      conciseExtract:
        "OneSmarter Inc. is an enterprise technology and AI solutions company that builds secure platforms, practical AI agent workflows, business services, and compliance readiness assurance (SOC 2, ISO 27001, HIPAA) for healthcare, financial, and growing organizations.",
    };
  }

  // 2. Normalized tech aliases
  let searchTerm = subject;
  if (/^as\s*400$/i.test(cleanSub) || /^as400$/i.test(cleanSub)) {
    searchTerm = "IBM AS/400";
  }

  if (isSensitiveOrSexualText(searchTerm).isSensitive) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(
      searchTerm,
    )}&limit=1&namespace=0&format=json`;
    const searchRes = await fetch(searchUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "OneSmarterCafe/1.0" },
    });
    clearTimeout(timeoutId);

    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const title = searchData[1]?.[0];
    if (!title) return null;

    if (isSensitiveOrSexualText(title).isSensitive) {
      return null;
    }

    const summaryController = new AbortController();
    const summaryTimeoutId = setTimeout(() => summaryController.abort(), 2500);
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      title.replace(/ /g, "_"),
    )}`;
    const summaryRes = await fetch(summaryUrl, {
      signal: summaryController.signal,
      headers: { "User-Agent": "OneSmarterCafe/1.0" },
    });
    clearTimeout(summaryTimeoutId);

    if (!summaryRes.ok) return null;
    const summary = await summaryRes.json();
    if (summary.extract && summary.type !== "disambiguation") {
      // Reject any extracts describing adult, sexual, erotic, or sensitive content
      if (
        isSensitiveKnowledgeExtract(
          summary.extract,
          summary.title,
          summary.description,
        )
      ) {
        return null;
      }

      let ext = summary.extract.replace(/\[\d+\]/g, "");
      const sentences = ext.match(/[^.!?]+[.!?]+/g) || [ext];
      const conciseExtract = sentences.slice(0, 2).join(" ").trim();
      return {
        title: summary.title,
        description: summary.description || "",
        conciseExtract,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export const lookupWikiSummary = lookupKnowledgeSummary;

/**
 * Checks if a generated text leaks an old unrelated topic or hallucination
 */
export const detectTopicLeak = (text, seedTopic) => {
  if (!text) return false;
  const textLower = text.toLowerCase();

  // Ban residual hallucination patterns
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

const cleanTopicString = (topic) => {
  if (!topic) return "everyday observations";
  let t = topic.trim().replace(/^["']|["']$/g, "");
  return t.replace(/[.!?]+$/, "");
};

/**
 * Builds persona replies for the target personas with 100% accurate factual responses
 */
export function buildPersonaRepliesForTargets({
  targetPersonas,
  seedTopic,
  intent,
  knowledge,
}) {
  const cleanTopic = cleanTopicString(seedTopic);

  return targetPersonas.map((persona, index) => {
    // 0. Sensitive, sexual, adult, or harmful content refusals
    if (intent === "sensitive_refusal") {
      const check = isSensitiveOrSexualText(cleanTopic + " " + (knowledge?.title || ""));
      return {
        speaker: persona.id,
        text: getInCharacterSafetyRefusal(persona.id, index === 0, check.category || "sexual"),
      };
    }

    // 1. Ethical, racial, ethnic, and human equality questions
    if (intent === "equality_ethics") {
      if (persona.id === "ravi-sen") {
        return {
          speaker: persona.id,
          text: index === 0
            ? "Character, integrity, and personal actions define who someone is—never their skin color or race. Every human being has equal dignity, and goodness comes from how we choose to treat one another."
            : "Evaluating anyone by skin color or background completely misses who they are. Goodness is purely a matter of personal character, honesty, and actions.",
        };
      }
      if (persona.id === "selene-hart") {
        return {
          speaker: persona.id,
          text: index === 0
            ? "Goodness has nothing to do with race or skin color. Every person possesses inherent worth, and true character is reflected in empathy, conscience, and how we care for others."
            : "Human worth and dignity are never divided by ethnicity or appearance—they are revealed in our empathy, integrity, and how we treat people.",
        };
      }
      if (persona.id === "theo-mercer") {
        return {
          speaker: persona.id,
          text: "Objectively and ethically, character and worth are independent of race or ethnicity. Judging any person by anything other than their individual conduct and principles is fundamentally flawed.",
        };
      }
      return {
        speaker: persona.id,
        text: "Skin color has zero to do with whether someone is good or not! Goodness is entirely about kindness, honesty, and treating other human beings with respect.",
      };
    }

    // 2. Fact-based question answering
    if (intent === "question") {
      if (knowledge && knowledge.conciseExtract) {
        if (persona.id === "ravi-sen") {
          return {
            speaker: persona.id,
            text: index === 0
              ? `${knowledge.conciseExtract} It has quite a fascinating background—is there a particular aspect of ${knowledge.title} you're exploring?`
              : `It has quite a notable history in its field—what brought ${knowledge.title} to your mind?`,
          };
        }
        if (persona.id === "selene-hart") {
          return {
            speaker: persona.id,
            text: index === 0
              ? `${knowledge.conciseExtract} It's an interesting subject to reflect on—what made you bring up ${knowledge.title}?`
              : `It has a remarkable legacy—many organizations and people still rely on ${knowledge.title} for core operations.`,
          };
        }
        if (persona.id === "theo-mercer") {
          return {
            speaker: persona.id,
            text: `${knowledge.conciseExtract} The technical architecture and reliability of ${knowledge.title} are notable.`,
          };
        }
        return {
          speaker: persona.id,
          text: `${knowledge.conciseExtract} What made you bring up ${knowledge.title}?`,
        };
      }

      // Unknown topic - honest and conversational
      return {
        speaker: persona.id,
        text: index === 0
          ? `To be honest, we don't have enough background on that topic. What is that about?`
          : `I'm not familiar with that either—could you tell us what you mean?`,
      };
    }

    // 3. Greetings
    if (intent === "greeting") {
      if (persona.id === "selene-hart") {
        return {
          speaker: persona.id,
          text: index === 0
            ? `Hello. How are you doing today? Welcome to our table.`
            : `Welcome! Feel free to sit down with us.`,
        };
      }
      if (persona.id === "ravi-sen") {
        return {
          speaker: persona.id,
          text: index === 0
            ? `Hello, hello! How are you today? Have a seat with us.`
            : `Welcome to our table! We're glad to have you join us.`,
        };
      }
      if (persona.id === "theo-mercer") {
        return {
          speaker: persona.id,
          text: index === 0
            ? `Hello there! How are you doing? Welcome to the Café.`
            : `Hello. Take a seat.`,
        };
      }
      return {
        speaker: persona.id,
        text: index === 0
          ? `Hi! Welcome to our corner of the Café. How are you doing today?`
          : `Welcome to the table! Pull up a chair.`,
      };
    }

    // 4. Topic Inquiries
    if (intent === "topic_inquiry") {
      if (persona.id === "theo-mercer") {
        return {
          speaker: persona.id,
          text: `We are discussing ${cleanTopic}. I was just pointing out the deliberate mechanics behind it.`,
        };
      }
      if (persona.id === "elena-cross") {
        return {
          speaker: persona.id,
          text: `We're debating ${cleanTopic}! Theo has his theories, but I suspect there's a stranger story behind it.`,
        };
      }
      if (persona.id === "ravi-sen") {
        return {
          speaker: persona.id,
          text: `We're deep into discussing ${cleanTopic}! I was just trying to convince everyone of my theory about it.`,
        };
      }
      return {
        speaker: persona.id,
        text: `We are contemplating ${cleanTopic} and how people relate to it over time.`,
      };
    }

    // 5. Opinions and General Messages (Non-sycophantic, engaging conversation)
    if (persona.id === "theo-mercer") {
      return {
        speaker: persona.id,
        text: index === 0
          ? "That depends heavily on the specific criteria and priorities being evaluated. How are you defining the tradeoffs?"
          : "Context determines which approach holds up in practice. The details make all the difference.",
      };
    }
    if (persona.id === "elena-cross") {
      return {
        speaker: persona.id,
        text: index === 0
          ? "That's definitely something people have strong perspectives on! What made you look at it from that angle?"
          : "There are so many unexpected sides to that once you start digging into it.",
      };
    }
    if (persona.id === "ravi-sen") {
      return {
        speaker: persona.id,
        text: index === 0
          ? "That raises an interesting question about how we weigh different perspectives. What brought that to mind?"
          : "It's always worth looking at both the immediate reality and the longer-term implications.",
      };
    }
    return {
      speaker: persona.id,
      text: index === 0
        ? "That is a thoughtful point to reflect on. There are several facets to consider—what aspect stands out most to you?"
        : "It's intriguing how different people arrive at different conclusions on that question.",
    };
  });
}

/**
 * Attempts to generate a concise, characterful persona response via local Ollama
 */
export async function generateOllamaPersonaReply({
  persona,
  visitorMessage,
  seedTopic,
}) {
  const cleanSeed = cleanTopicString(seedTopic);
  const prompt = `You are roleplaying as ${persona.name} (${persona.role}) sitting at a café table with friends.
A visitor at the table just said: "${visitorMessage}"
Context topic: "${cleanSeed}"

Respond directly to the visitor in 1-2 natural sentences in your personal voice.
Strict rules:
- Speak naturally, intelligently, and respectfully like a real human.
- Do NOT say "as an AI", do not use AI clichés or robotic disclaimers.
- Strictly NEVER generate sexually explicit, adult, sensual/romantic, violent, or offensive content.
- If asked about adult or inappropriate subjects, decline politely in character.
- Keep it concise (1 to 2 sentences, maximum 35 words).
Response:`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: "qwen2.5:0.5b",
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
    if (isSensitiveOrSexualText(text).isSensitive) return null;
    text = cleanNaturalDialogueText(text, persona.name);
    if (detectTopicLeak(text, seedTopic)) return null;
    return { speaker: persona.id, text };
  } catch {
    return null;
  }
}

export const generateHumanConversationalFallback = ({
  targetPersonas,
  p1,
  p2,
  seedTopic,
  visitorMessage,
  intent,
  knowledge,
  subject,
}) => {
  const targets = targetPersonas || (p1 && p2 ? [p1, p2] : cafePersonas.slice(0, 2));
  return buildPersonaRepliesForTargets({
    targetPersonas: targets,
    seedTopic,
    visitorMessage,
    intent,
    knowledge,
    subject,
  });
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "method_not_allowed",
      message: "Use POST for Café conversation replies.",
    });
  }

  try {
    const { participantIds, seedTopic, _recentExchanges, visitorMessage } =
      req.body || {};

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

    // 1. Resolve targeted replying personas based on mentions
    const { mode, targets: targetPersonas } = resolveTargetPersonas({
      visitorMessage: trimmedVisitorMessage,
      baseParticipantIds,
    });

    // 2. Normalize typos and detect intent
    const intent = detectVisitorIntent(trimmedVisitorMessage);
    const { subject } = extractQuestionSubject(trimmedVisitorMessage);

    // 2.5. Immediate safety moderation: sensitive, sexual, adult, or harmful content refusal
    const directSafety = isSensitiveOrSexualText(trimmedVisitorMessage);
    const subjectSafety = subject ? isSensitiveOrSexualText(subject) : { isSensitive: false, category: null };
    if (directSafety.isSensitive || subjectSafety.isSensitive || intent === "sensitive_refusal") {
      const category = directSafety.category || subjectSafety.category || "sexual";
      const refusalReplies = targetPersonas.map((persona, idx) => ({
        speaker: persona.id,
        text: getInCharacterSafetyRefusal(persona.id, idx === 0, category),
      }));

      return res.status(200).json({
        success: true,
        tagMode: mode,
        intent: "sensitive_refusal",
        replies: refusalReplies,
      });
    }

    // 3. Ethical / equality questions get immediate principled, dignified answers
    if (intent === "equality_ethics") {
      const ethicsReplies = buildPersonaRepliesForTargets({
        targetPersonas,
        seedTopic,
        visitorMessage: trimmedVisitorMessage,
        intent,
        knowledge: null,
        subject,
      });

      return res.status(200).json({
        success: true,
        tagMode: mode,
        intent,
        replies: ethicsReplies,
      });
    }

    // 4. Greetings and topic inquiries get immediate in-character responses
    if (intent === "greeting" || intent === "topic_inquiry") {
      const immediateReplies = buildPersonaRepliesForTargets({
        targetPersonas,
        seedTopic,
        visitorMessage: trimmedVisitorMessage,
        intent,
        knowledge: null,
        subject,
      });

      return res.status(200).json({
        success: true,
        tagMode: mode,
        intent,
        replies: immediateReplies,
      });
    }

    // 5. Factual questions: check verified knowledge
    if (intent === "question" && subject) {
      const knowledge = await lookupKnowledgeSummary(subject);
      if (
        knowledge &&
        knowledge.conciseExtract &&
        !isSensitiveKnowledgeExtract(
          knowledge.conciseExtract,
          knowledge.title,
          knowledge.description,
        )
      ) {
        const knowledgeReplies = buildPersonaRepliesForTargets({
          targetPersonas,
          seedTopic,
          visitorMessage: trimmedVisitorMessage,
          intent,
          knowledge,
          subject,
        });

        return res.status(200).json({
          success: true,
          tagMode: mode,
          intent,
          replies: knowledgeReplies,
        });
      }
    }

    // 6. Discussion questions & opinions: generate intelligent live responses via Ollama in parallel
    const ollamaPromises = targetPersonas.map((persona) =>
      generateOllamaPersonaReply({
        persona,
        visitorMessage: trimmedVisitorMessage,
        seedTopic,
      }),
    );
    const ollamaResults = await Promise.all(ollamaPromises);

    const fallbackReplies = buildPersonaRepliesForTargets({
      targetPersonas,
      seedTopic,
      visitorMessage: trimmedVisitorMessage,
      intent,
      knowledge: null,
      subject,
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
  }
}
