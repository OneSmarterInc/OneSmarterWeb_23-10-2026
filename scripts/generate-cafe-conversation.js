import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  cafeGenerationConstraints,
  cafePersonas,
} from "../src/data/agentPresentation/cafePersonas.js";
import { cafeSeedTopics } from "../src/data/cafeSeedTopics.js";
import { publishedCafeConversations } from "../src/data/cafeConversations/index.js";
import { generateCafeWithOllama } from "./lib/cafeOllama.js";
import { validDay } from "./prepare-cafe-content.js";

const MAX_MESSAGE_LENGTH = 2000;
const MIN_EXCHANGES = 6;
const MAX_EXCHANGES = 10;
const RECENT_PUBLICATION_LIMIT = 4;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const draftDirectory = path.resolve(
  scriptDirectory,
  "../src/data/cafeConversations/drafts",
);

const findPersona = (personaId) =>
  cafePersonas.find((persona) => persona.id === personaId);

const randomIndex = (length, random) =>
  Math.min(length - 1, Math.floor(random() * length));

export const weightedRandomItem = (items, getWeight, random = Math.random) => {
  const weightedItems = items.map((item) => ({
    item,
    weight: Number(getWeight(item)),
  }));
  const totalWeight = weightedItems.reduce((total, { weight }) => total + weight, 0);
  if (
    weightedItems.length === 0 ||
    weightedItems.some(({ weight }) => !Number.isFinite(weight) || weight < 0) ||
    totalWeight <= 0
  ) {
    throw new Error("Weighted selection requires valid non-negative weights with a positive total.");
  }

  let threshold = Math.min(0.999999999999, Math.max(0, random())) * totalWeight;
  for (const { item, weight } of weightedItems) {
    threshold -= weight;
    if (threshold < 0) return item;
  }
  return weightedItems.at(-1).item;
};

export const toCafeParticipantPairKey = (participantIds) =>
  [...participantIds].sort().join("|");

export const getRecentCafeSelectionExclusions = (
  conversations = publishedCafeConversations,
  limit = RECENT_PUBLICATION_LIMIT,
) => {
  const recentConversations = conversations.slice(0, limit);
  return {
    seedTopics: new Set(recentConversations.map(({ seedTopic }) => seedTopic).filter(Boolean)),
    participantPairs: new Set(
      recentConversations
        .filter(({ participants }) => Array.isArray(participants) && participants.length === 2)
        .map(({ participants }) => toCafeParticipantPairKey(participants)),
    ),
  };
};

export const selectCafeSeedTopic = (
  random = Math.random,
  excludedSeedTopics = new Set(),
  approvedSeedTopics = cafeSeedTopics,
) => {
  const eligibleSeedTopics = approvedSeedTopics.filter(
    (seedTopic) => !excludedSeedTopics.has(seedTopic),
  );
  const selectionPool = eligibleSeedTopics.length ? eligibleSeedTopics : approvedSeedTopics;
  return selectionPool[randomIndex(selectionPool.length, random)];
};

export const selectWeightedCafeParticipants = (
  random = Math.random,
  excludedParticipantPairs = new Set(),
) => {
  const eligiblePartnersById = new Map(
    cafePersonas.map((persona) => [
      persona.id,
      cafePersonas.filter(
        (candidate) =>
          candidate.id !== persona.id &&
          !excludedParticipantPairs.has(
            toCafeParticipantPairKey([persona.id, candidate.id]),
          ),
      ),
    ]),
  );
  const eligibleFirstParticipants = cafePersonas.filter(
    ({ id }) => eligiblePartnersById.get(id).length > 0,
  );
  const firstPool = eligibleFirstParticipants.length
    ? eligibleFirstParticipants
    : cafePersonas;
  const firstParticipant = weightedRandomItem(
    firstPool,
    ({ cafeSelectionWeights }) => cafeSelectionWeights.appearance,
    random,
  );
  const eligiblePartners = eligiblePartnersById.get(firstParticipant.id);
  const remainingPersonas = eligiblePartners.length
    ? eligiblePartners
    : cafePersonas.filter(({ id }) => id !== firstParticipant.id);
  const secondParticipant = weightedRandomItem(
    remainingPersonas,
    ({ cafeSelectionWeights }) => cafeSelectionWeights.appearance,
    random,
  );
  return [firstParticipant.id, secondParticipant.id];
};

export const selectCafeInviter = (participantIds, random = Math.random) => {
  const participants = participantIds.map(findPersona);
  if (participants.some((participant) => !participant) || new Set(participantIds).size !== 2) {
    throw new Error("Invitation selection requires two distinct Café participants.");
  }

  const noInvitation = { id: null, cafeSelectionWeights: { invitation: 1 } };
  return weightedRandomItem(
    [...participants, noInvitation],
    ({ cafeSelectionWeights }) => cafeSelectionWeights.invitation,
    random,
  ).id;
};

export const resolveCafeGenerationInputs = ({
  participantIds,
  seedTopic,
  exchangeCount,
  publishedConversations = publishedCafeConversations,
  random = Math.random,
} = {}) => {
  const recentExclusions = getRecentCafeSelectionExclusions(publishedConversations);
  const suppliedParticipantIds = participantIds?.filter(Boolean) || [];
  let resolvedParticipantIds;
  let participantMode;

  if (suppliedParticipantIds.length === 0) {
    resolvedParticipantIds = selectWeightedCafeParticipants(
      random,
      recentExclusions.participantPairs,
    );
    participantMode = "random";
  } else {
    if (suppliedParticipantIds.length !== 2 || participantIds.length !== 2) {
      throw new Error("Supply exactly two participant IDs, or omit both for random selection.");
    }
    resolvedParticipantIds = suppliedParticipantIds;
    participantMode = "manual";
  }

  const hasManualSeed = typeof seedTopic === "string" && Boolean(seedTopic.trim());
  const resolvedSeedTopic = hasManualSeed
    ? seedTopic.trim()
    : selectCafeSeedTopic(random, recentExclusions.seedTopics);
  const hasManualExchangeCount = exchangeCount !== undefined && exchangeCount !== null && exchangeCount !== "";
  const resolvedExchangeCount = hasManualExchangeCount
    ? Number(exchangeCount)
    : MIN_EXCHANGES + randomIndex(MAX_EXCHANGES - MIN_EXCHANGES + 1, random);
  const invitedBy = selectCafeInviter(resolvedParticipantIds, random);

  buildCafeGenerationPrompt({
    participantIds: resolvedParticipantIds,
    seedTopic: resolvedSeedTopic,
    exchangeCount: resolvedExchangeCount,
  });

  return {
    participantIds: resolvedParticipantIds,
    seedTopic: resolvedSeedTopic,
    exchangeCount: resolvedExchangeCount,
    invitedBy,
    selection: {
      participants: participantMode,
      seedTopic: hasManualSeed ? "manual" : "random",
      exchangeCount: hasManualExchangeCount ? "manual" : "random",
      invitedBy: "random",
    },
  };
};

export const buildCafeGenerationPrompt = ({
  participantIds,
  seedTopic,
  exchangeCount,
}) => {
  const participants = participantIds.map(findPersona);

  if (participants.some((participant) => !participant)) {
    throw new Error("Both participant IDs must match Café personas.");
  }
  if (new Set(participantIds).size !== 2) {
    throw new Error("Choose exactly two different Café personas.");
  }
  if (!Number.isInteger(exchangeCount) || exchangeCount < MIN_EXCHANGES || exchangeCount > MAX_EXCHANGES) {
    throw new Error("Exchange count must be an integer from 6 through 10.");
  }
  if (!seedTopic?.trim()) {
    throw new Error("Seed topic must be a non-empty string.");
  }

  return [
    "Generate one natural off-duty Café conversation as JSON.",
    `Use exactly ${exchangeCount} exchanges about this ordinary seed topic: ${seedTopic.trim()}`,
    "Return only an object with an exchanges array of { speaker, text } objects.",
    `Every speaker must be one of: ${participantIds.join(", ")}.`,
    "Do not add headings, explanations, or markdown.",
    "",
    "Café generation constraints (apply every line verbatim):",
    ...cafeGenerationConstraints.map((constraint) => `- ${constraint}`),
    "",
    "Participant profiles (complete data):",
    JSON.stringify(participants, null, 2),
    "",
    "Identity and conversational voice:",
    "Both participants are AI agents having a professional but relaxed off-duty discussion, not humans acting out a scene. Let their agent identity be apparent naturally, without repeating 'as an AI' or turning the conversation into a disclaimer.",
    "In the first exchange, explicitly refer to your shared identity as AI agents while opening a question or possibility about the topic. Make this a brief part of the conversation, not a greeting or disclaimer. Neither participant has personally witnessed the topic or received any evidence beyond this prompt.",
    "Use their different agent perspectives to explore the ordinary topic: Theo notices evidence and precise wording; Elena notices claims, assumptions, and boundaries; Ravi considers practical steps and what might go wrong; Selene asks how parts and perspectives fit together. These are habits of thought, not permission to discuss work, customers, or internal systems.",
    "Respect each selected persona's disposition, interests, and speaking habits. Give both a meaningful contribution without forcing equal airtime or making reserved participants unusually talkative.",
    "Write natural back-and-forth: respond to the previous remark, ask a curious question, offer a different angle, or gently disagree. Prefer short, concrete sentences and varied turns over consecutive monologues or repeated agreement.",
    "Keep the tone professional, warm, and conversational. Avoid audit-report language, compliance documents, findings, recommendations, bullet lists, summaries, marketing language, and formal closing conclusions.",
    "Treat the profiles' human biographies as fictional persona context only. Do not claim lived memories, family experiences, eating, travel, physical actions, real-world observation, or independent access to data. If a constructed background is relevant, explicitly describe it as constructed rather than a real experience.",
    "Do not invent statistics, research, citations, news events, customers, experiments, tests, or results. Do not turn a seed topic into a claim that an event actually happened. Use only supplied factual details; explore other ideas as clearly framed possibilities, questions, or opinions rather than unsupported facts.",
    "The seed topic is a discussion idea, not a factual account. Open with a question or possibility about it. If you introduce an illustrative detail, imagined rule, quotation, note, person, or scenario, explicitly label it hypothetical in that same turn using wording such as 'suppose', 'imagine', or 'what if'. Never imply you found, read, noticed, tested, or observed something that was not supplied. Do not assert what people usually do or call an invented example real, classic, common, or proven.",
    "Keep observations about people and the world as questions or possibilities too: say what someone might do in the imagined scenario, not what players, readers, or people generally do. Stay with this small idea instead of making broad claims.",
    "Style demonstration only, on an unrelated topic; do not copy its subject or wording into your dialogue:",
    "Agent A: 'As agents, would we read an imaginary sign saying “almost open” the same way? I'd want to know what “almost” means.'",
    "Agent B: 'I'd be tempted to ask the sign to commit. Could it mean opening soon, or just a door left slightly ajar?'",
    "Agent A: 'The second reading hadn't occurred to me. What extra word would settle it?'",
    "Follow that pattern: a clearly imagined idea, different perspectives, curiosity, and direct replies. Keep each turn to one or two short sentences. Stay entirely within the imagined discussion; leave biographies, memories, named real examples, and claims of personal experience out of the dialogue.",
    "Before returning JSON, check that each turn sounds like a reply from a distinct AI agent, stays on the supplied topic, and contains no invented evidence or human experience. Return only the dialogue JSON, not this check.",
  ].join("\n");
};

export const parseCafeModelOutput = (outputText, { participantIds, exchangeCount }) => {
  if (typeof outputText !== "string" || outputText.length > 100000) {
    throw new Error("Café output must be JSON text within the size limit.");
  }
  let generated;
  try {
    generated = JSON.parse(outputText);
  } catch {
    throw new Error("Café output is not valid JSON.");
  }
  if (!generated || typeof generated !== "object" || Array.isArray(generated) ||
    Object.keys(generated).length !== 1 || !Array.isArray(generated.exchanges)) {
    throw new Error("Café output must contain only an exchanges array.");
  }
  if (!Number.isInteger(exchangeCount) || exchangeCount < MIN_EXCHANGES ||
    exchangeCount > MAX_EXCHANGES || generated.exchanges.length !== exchangeCount) {
    throw new Error("Café output did not contain the requested exchange count (6–10).");
  }
  for (const exchange of generated.exchanges) {
    if (!exchange || typeof exchange !== "object" || Array.isArray(exchange) ||
      Object.keys(exchange).length !== 2 || !Object.hasOwn(exchange, "speaker") ||
      !Object.hasOwn(exchange, "text")) {
      throw new Error("Each Café exchange must contain only speaker and text fields.");
    }
    // The existing transcript contract uses exact persona IDs, not free-form names.
    if (!participantIds.includes(exchange.speaker) || !findPersona(exchange.speaker)) {
      throw new Error("Café output contains an invalid speaker or participant name.");
    }
    if (typeof exchange.text !== "string" || !exchange.text.trim() ||
      exchange.text.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Café messages must contain 1–${MAX_MESSAGE_LENGTH} characters of non-empty text.`);
    }
  }
  if (participantIds.some((id) => !generated.exchanges.some(({ speaker }) => speaker === id))) {
    throw new Error("Both Café participants must speak.");
  }
  return generated;
};

export const buildCafeDraft = ({
  participantIds,
  seedTopic,
  conversationDay,
  exchanges,
  invitedBy,
  selection,
  model = "qwen2.5:0.5b",
}) => {
  if (conversationDay !== undefined && !validDay(conversationDay)) throw new Error("Invalid Cafe conversation day.");
  const draftId = `cafe-draft-${randomUUID()}`;
  const generatedAt = new Date().toISOString();
  const content = { participants: participantIds, seedTopic, conversationDay, invitedBy, exchanges, selection };
  return {
    id: draftId,
    draftId,
    model,
    generatedAt,
    createdAt: generatedAt,
    contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"),
    ...content,
    status: "unpublished",
  };
};

export const generateConversation = async ({
  participantIds,
  seedTopic,
  conversationDay,
  exchangeCount,
  invitedBy,
  selection,
}, { env = process.env, outputDirectory = draftDirectory } = {}) => {
  if (conversationDay !== undefined && !validDay(conversationDay)) throw new Error("Invalid Cafe conversation day.");
  const prompt = buildCafeGenerationPrompt({ participantIds, seedTopic, exchangeCount });
  const response = await generateCafeWithOllama({
    prompt,
    env,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        exchanges: {
          type: "array",
          minItems: exchangeCount,
          maxItems: exchangeCount,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              speaker: { type: "string", enum: participantIds },
              text: { type: "string", minLength: 1, maxLength: MAX_MESSAGE_LENGTH },
            },
            required: ["speaker", "text"],
          },
        },
      },
      required: ["exchanges"],
    },
  });
  const generated = parseCafeModelOutput(response.content, { participantIds, exchangeCount });

  const draft = buildCafeDraft({
    participantIds,
    seedTopic,
    conversationDay,
    exchanges: generated.exchanges,
    invitedBy,
    selection,
    model: response.model,
  });
  await fs.mkdir(outputDirectory, { recursive: true });
  const draftPath = path.join(outputDirectory, `${draft.id}.json`);
  const temporaryPath = `${draftPath}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(draft, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporaryPath, draftPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
  return draftPath;
};

// Named options do not consume or reinterpret the four existing positional args.
export const parseCafeGenerationArgs = (args) => {
  const positional = [];
  const options = new Map();
  for (const arg of args) {
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const separator = arg.indexOf("=");
    const key = arg.slice(0, separator);
    if (separator < 0 || !["--count", "--conversation-days"].includes(key) || options.has(key)) {
      throw new Error("Use --count=N and optionally --conversation-days=YYYY-MM-DD,... once each.");
    }
    options.set(key, arg.slice(separator + 1));
  }
  const countText = options.get("--count");
  const count = countText === undefined ? 1 : Number(countText);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("Count must be a positive integer.");
  const conversationDays = options.has("--conversation-days") ? options.get("--conversation-days").split(",") : [];
  if (conversationDays.length && (conversationDays.length !== count || !conversationDays.every(validDay))) {
    throw new Error("Supply one valid conversation day per draft.");
  }
  const [firstPersonaId, secondPersonaId, seedTopic, exchangeCount] = positional;
  return { count, conversationDays, inputs: {
    participantIds: firstPersonaId || secondPersonaId ? [firstPersonaId, secondPersonaId] : undefined,
    seedTopic, exchangeCount,
  } };
};

export const generateCafeBatch = async ({ count = 1, conversationDays = [], inputs = {} } = {}, {
  random = Math.random,
  publishedConversations = publishedCafeConversations,
  generate = generateConversation,
  onSelection = () => {},
  onGenerated = () => {},
} = {}) => {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("Count must be a positive integer.");
  if (conversationDays.length && (conversationDays.length !== count || !conversationDays.every(validDay))) {
    throw new Error("Supply one valid conversation day per draft.");
  }
  const batch = [];
  const draftPaths = [];
  for (let index = 0; index < count; index += 1) {
    const selection = {
      ...resolveCafeGenerationInputs({ ...inputs, random, publishedConversations: [...batch, ...publishedConversations] }),
      conversationDay: conversationDays[index],
    };
    onSelection(selection, index);
    const start = Date.now();
    const draftPath = await generate(selection);
    batch.unshift({ participants: selection.participantIds, seedTopic: selection.seedTopic });
    draftPaths.push(draftPath);
    onGenerated({ draftPath, selection, index, durationMs: Date.now() - start });
  }
  return draftPaths;
};

const isDirectRun = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  Promise.resolve().then(() => generateCafeBatch(parseCafeGenerationArgs(process.argv.slice(2)), {
    onSelection: (selection) => console.log(`Café selection: ${JSON.stringify(selection)}`),
    onGenerated: ({ draftPath, durationMs }) => console.log(`Unpublished Café draft written to ${draftPath} (${durationMs} ms)`),
  }))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
