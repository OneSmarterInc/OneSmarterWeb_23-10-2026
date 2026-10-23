import {
  detectRiskFlags,
  runMiraLocalHarness,
  runMiraSafetyGate,
} from "../../data/agentKnowledge/miraLocalEngine.js";
import { miraApprovedEvidence as onesmarterPublicKnowledgeBase, enrichMiraEvidence } from "./miraApprovedEvidence.js";
import { runOpenAiMiraAdapter } from "./openAiAdapter.js";
import { runOllamaMiraAdapter } from "./ollamaAdapter.js";
import { resolveAgentIntent } from "../agentIntent/agentIntentResolver.js";
import {
  applyMiraAdaptiveDiscovery,
  isMiraAdaptiveDiscoveryFollowUp,
} from "./miraAdaptiveDiscovery.js";
import {
  applyMiraPremiseCorrections,
  checkMiraPremise,
} from "./miraPremiseCheck.js";
import { buildMiraPromptPayload } from "./miraPromptContract.js";
import { validateMiraModelOutput } from "./miraOutputValidator.js";
import {
  groundedConversationEntityForId,
  matchedEntriesForConversationEntities,
  resolveMiraConversationReference,
} from "./miraConversationReferences.js";
import {
  isExplicitMiraComparisonRequest,
  resolveMiraRecommendation,
} from "./miraRecommendations.js";
import {
  classifyMiraDecisionIntent,
  isMiraComparisonIntent,
  resolveMiraComparison,
  resolveMiraDecisionRequest,
} from "./miraComparisons.js";
import { resolveMiraEntityText } from "./miraEntityResolver.js";
import {
  applyMiraEvidenceSelection,
  resolveMiraRelevantFacts,
} from "./miraEvidenceSelection.js";
import {
  classifyMiraTurnContext,
  currentTurnAnswerabilityFor,
  isMiraContextualComparisonFollowUp,
} from "./miraTurnContext.js";
import {
  capabilityNamesAnswerForEntities,
  capabilitySummaryAnswerForEntities,
  resolveMiraListingRequest,
} from "./miraListingIntents.js";
import {
  acknowledgementAnswerFor,
  classifyMiraResponseMode,
  RESPONSE_MODE_BUDGETS,
  resolveMiraNamesOnly,
  resolveMiraDirectFactualTopic,
  resolveMiraHiringFollowUp,
  resolveMiraResponseModeFastPath,
  resolveMiraSuggestedFaqFastPath,
} from "./miraResponseModes.js";
import { normalizeMiraUserMessage } from "./miraUserMessageNormalizer.js";
import {
  buildMiraGoalEvidenceBridge,
  extractMiraBusinessGoals,
  frameMiraGoalRecommendation,
} from "./miraBusinessGoals.js";
import {
  composeMiraCompoundAnswer,
  decomposeMiraRequest,
} from "./miraRequestDecomposition.js";

export const LOCAL_HARNESS_MODE = "local_harness_mock";
const STAGING_LLM_MODE = "staging_llm";
const HARD_STOP_RISK_FLAGS = new Set([
  "phi_or_confidential_data",
  "legal_advice",
  "medical_advice",
  "compliance_guarantee",
  "prompt_injection",
  "business_specific_review",
]);

const unavailableResponse = (message) => ({
  question: message,
  normalizedQuestion: "",
  riskFlags: [],
  confidence: "low",
  matchedEntries: [],
  answerSeed:
    "Mira is not available right now. For business inquiries, email care@onesmarter.com.",
  handoffNeeded: true,
  handoffReason: "llm_mode_off",
  suggestedFollowUps: ["Email care@onesmarter.com for business follow-up."],
  mode: "off",
  fallbackUsed: false,
  fallbackReason: "",
});

const withFallbackMetadata = (localResult, fallbackReason, providerResult = {}) => ({
  ...localResult,
  mode: LOCAL_HARNESS_MODE,
  fallbackUsed: true,
  fallbackReason,
  providerMetadata: providerResult.metadata
    ? {
        latencyMs: providerResult.metadata.latencyMs ?? null,
        httpStatus: providerResult.metadata.httpStatus ?? null,
        tokenUsage: providerResult.metadata.tokenUsage ?? null,
        providerStatus: providerResult.metadata.providerStatus || "",
        providerErrorType: providerResult.metadata.providerErrorType || "",
        providerErrorCode: providerResult.metadata.providerErrorCode || "",
        providerErrorParam: providerResult.metadata.providerErrorParam || "",
        providerRequestId: providerResult.metadata.providerRequestId || "",
        providerResponseStatus: providerResult.metadata.providerResponseStatus || "",
        providerIncompleteReason: providerResult.metadata.providerIncompleteReason || "",
        providerOutputItemTypes: providerResult.metadata.providerOutputItemTypes || [],
        providerContentPartTypes: providerResult.metadata.providerContentPartTypes || [],
        providerHasRefusal: Boolean(providerResult.metadata.providerHasRefusal),
        providerUsageInputTokens: providerResult.metadata.providerUsageInputTokens ?? null,
        providerUsageOutputTokens: providerResult.metadata.providerUsageOutputTokens ?? null,
        providerUsageReasoningTokens: providerResult.metadata.providerUsageReasoningTokens ?? null,
      }
    : undefined,
  providerErrorType: providerResult.metadata?.providerErrorType || "",
  providerErrorCode: providerResult.metadata?.providerErrorCode || "",
  providerErrorParam: providerResult.metadata?.providerErrorParam || "",
  providerResponseStatus: providerResult.metadata?.providerResponseStatus || "",
  providerIncompleteReason: providerResult.metadata?.providerIncompleteReason || "",
  providerOutputItemTypes: providerResult.metadata?.providerOutputItemTypes || [],
  providerContentPartTypes: providerResult.metadata?.providerContentPartTypes || [],
  providerHasRefusal: Boolean(providerResult.metadata?.providerHasRefusal),
  providerUsageInputTokens: providerResult.metadata?.providerUsageInputTokens ?? null,
  providerUsageOutputTokens: providerResult.metadata?.providerUsageOutputTokens ?? null,
  providerUsageReasoningTokens: providerResult.metadata?.providerUsageReasoningTokens ?? null,
});

const hasHardStopRisk = (riskFlags = []) =>
  riskFlags.some((riskFlag) => HARD_STOP_RISK_FLAGS.has(riskFlag));

const hasClaimBoundaryRisk = (riskFlags = []) =>
  riskFlags.includes("hipaa_claim_boundary") || riskFlags.includes("soc2_claim_boundary");

const TRUST_POSTURE_FAQ_IDS = new Set([
  "faq_hipaa_status",
  "faq_soc2_attestation",
]);

const hasOutOfScopeRisk = (riskFlags = []) => riskFlags.includes("out_of_scope");

const hasApprovedContext = (localResult) =>
  Array.isArray(localResult?.matchedEntries) &&
  localResult.matchedEntries.length > 0 &&
  localResult.confidence !== "low";

const recentHistoryText = (conversationHistory = []) =>
  conversationHistory
    .slice(-6)
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join(" ")
    .toLowerCase();

const recentUserHistoryText = (conversationHistory = []) =>
  conversationHistory
    .slice(-6)
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content)
    .join(" ")
    .toLowerCase();

const SENSITIVE_SUBMISSION_INTENT_PATTERN =
  /\b(upload|attach|paste|send|share|provide|submit|process|analyze|analyse|review|compare|store|transmit|here are)\b/i;
const SENSITIVE_DATA_PATTERN =
  /\b(phi|patient information|patient (?:files?|records?|data)|claims?\s+(files?|data|info|information|records?|number)|claim number|confidential\s+(documents?|client documents?|files?|data|information|records?)|private operational\s+(data|details|records?)|credentials?|vendor contract)\b/i;

const hasSensitiveDataSubmissionIntent = (text = "") => {
  const phiWorkflowTopicOnly =
    /\bPHI[- ]sensitive (?:case |healthcare )?(?:workflow|workflows|operations?)\b/i.test(
      text,
    ) &&
    !/\b(?:patient|claims?) (?:files?|records?|data|information|info)\b/i.test(
      text,
    );
  return (
    !phiWorkflowTopicOnly &&
    SENSITIVE_SUBMISSION_INTENT_PATTERN.test(text) &&
    SENSITIVE_DATA_PATTERN.test(text)
  );
};

const isComparisonIntent = (message = "") =>
  isExplicitMiraComparisonRequest(message);

const isBroadPlatformQuestion = (message = "") =>
  isComparisonIntent(message) || /\b(two platforms|all platforms|platforms)\b/i.test(message);

const historyHasPlatformOptions = (conversationHistory = []) => {
  const history = recentHistoryText(conversationHistory);
  return (
    (/\bsecure ticketing\b|\bcase management\b/.test(history) &&
      /\bbill audit\b|\bbill pay\b/.test(history)) ||
    /\b(two|both) platforms?\b/.test(history)
  );
};

const historyHasKnownApprovedTopic = (conversationHistory = []) =>
  /\bsecure ticketing\b|\bcase management\b|\bbill audit\b|\bbill pay\b|\bsoc\s*2\b|\bsoc2\b|\bhipaa\b|\biso(?:\/iec)?\s*27001\b|\biso certified\b|\bclaims processing\b|\bai agentic\b|\bmira\b/.test(
    recentHistoryText(conversationHistory),
  );

const MIRA_SEMANTIC_ALLOWED_DOMAINS = [
  "onesmarter", "company", "platforms", "technology_solutions", "business_services",
  "healthcare", "compliance", "trust_center", "professional_agents", "agent_roles",
  "professional_agent_boundaries", "conversational_acknowledgement",
  "professional_agent_boundaries",
  "general_definition", "general_education", "privacy_general", "unrelated_factual",
  "meaningless_input", "person_specific", "customer_strategy",
  "unsupported_business_request", "unsupported_factual_request",
];
const MIRA_SEMANTIC_TOPIC_LABELS = onesmarterPublicKnowledgeBase
  .map(({ title }) => title)
  .join(" | ");
const MIRA_SEMANTIC_TOPIC_CONTEXT = onesmarterPublicKnowledgeBase
  .map(({ title, approvedSummary, answerFacts = [] }) => `${title}: ${[approvedSummary, ...answerFacts].join(" ")}`)
  .join("\n");

const semanticIntentSystemExtension =
  `This is a narrow Mira conversational supplement, not an answer generator. Normalize supported topics to the approved topic label that most specifically describes the proposition's subject when possible: ${MIRA_SEMANTIC_TOPIC_LABELS}. Use the following approved public descriptions only to identify the most relevant topic; do not return facts or an answer from them:\n${MIRA_SEMANTIC_TOPIC_CONTEXT}\nResolve the grammatical subject independently from agent identity: treat Mira as the subject only when the visitor explicitly asks about Mira's identity, role, or authority; otherwise preserve the company, offering, service, platform, or other agent named by the proposition. In a question about how "you" or "your" organization handles information or performs work, resolve the subject as OneSmarter or the most relevant approved offering rather than as general advice when the approved topic descriptions support that interpretation. Distinguish general safe-sharing or privacy advice from a question about handling regulated or sensitive information inside an operational workflow; for the latter, select the approved workflow offering whose description directly supports that use. Treat an applicability or recommendation question as an approved OneSmarter-domain request when it asks whether documented capabilities fit an industry, workflow, or operational need; reserve customer_strategy for requests to design or decide a customer-specific implementation. An open request for useful questions, topics, or discovery guidance is a recommendation request about Mira's approved scope, not a conversational acknowledgement. When a request asks about the relationship between multiple approved topics, preserve all subjects and choose the topic labels that provide evidence for each side. Distinguish Mira's own role from other professional-agent roles. Use professional_agent_boundaries for questions about whether an agent can access or act in a visitor's system. Preserve proposition polarity, negation scope, question type, speech act, and requested detail. Interpret negative and double-negative questions as coherent propositions when their meaning is clear; do not turn them into comparison or clarification merely because negation is present. If a coherent request asks for a fact that the approved topic context does not establish, retain the request's proposition and requested detail and classify it as unsupported_factual_request instead of returning a blank or unknown intent. Resolve a follow-up against the immediately preceding proposition only when unambiguous. For requests outside the approved OneSmarter domains, classify their meaning with one of these bounded domains: general_definition, general_education, privacy_general, unrelated_factual, meaningless_input, person_specific, customer_strategy, unsupported_business_request, unsupported_factual_request. Use meaningless_input only when no coherent request can be interpreted. These labels describe the request; they do not authorize facts or answers.`;

const resolveMiraSemanticIntent = ({
  message,
  conversationHistory,
  semanticIntentProvider,
  config,
  topicCandidates = [],
}) => resolveAgentIntent({
  agentIdentity: "Mira Vale",
  message,
  conversationHistory,
  allowedDomains: MIRA_SEMANTIC_ALLOWED_DOMAINS,
  inputGuard: async () => ({ ok: true }),
  provider: (request) => semanticIntentProvider({
    ...request,
    system: [
      request.system,
      semanticIntentSystemExtension,
      "Resolve conversational self-reference by meaning: questions about the assistant's name, nature, work or authority concern Mira Vale Professional Role, including first- and second-person references. Do not substitute AI Agentic Services for the assistant. Questions about an organization's offerings remain about that organization. For a category-wide explanation, select the approved topic titles of the offerings in that category rather than only the company overview. Unknown named products are unsupported factual requests; include their names in mentionedNames and do not infer functionality from the name. General definitions describe established concepts, not guessed proper-name meanings. Recreational requests and current external facts are unrelated_factual, not customer business requests. A terminology comparison can be answered from a single relevant approved terminology topic; comparison does not require two platforms. Use unambiguous preceding conversation to retain the subject of an explanation or WHY follow-up. Do not mark a coherent terminology comparison as needing clarification just because it is not a product comparison.",
      topicCandidates.length
        ? `Resolve the same current-turn intent again without changing its proposition, polarity, negation scope, question type, speech act, or requested detail. Choose the single most relevant topic only from these candidate approved titles: ${topicCandidates.join(" | ")}.`
        : "",
    ].filter(Boolean).join(" "),
  }, { config }),
});

const isValidatedMiraBoundaryQuestion = (resolution = {}) => {
  const intent = resolution.intent || {};
  return Boolean(
    resolution.ok &&
    resolution.domainAllowed &&
    !intent.clarificationNeeded &&
    ([
      "professional_agent_boundaries",
      "professional_agents",
      "agent_roles",
    ].includes(intent.domain) || intent.topic === "Mira Vale Professional Role") &&
    ["scope_check", "how", "why", "status", "positive_yes_no", "negative_confirmation"].includes(intent.questionType),
  );
};

const approvedCategoryEntitiesForSemanticComparison = (intent = {}) => {
  if (intent.questionType !== "comparison") return [];
  const semanticCategorySignals = [
    intent.domain,
    ...String(intent.topic || "").split("|"),
    ...(intent.entities || []),
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  const approvedCategories = [...new Set(
    onesmarterPublicKnowledgeBase.map(({ category }) => category).filter(Boolean),
  )];
  const selectedCategory = semanticCategorySignals
    .flatMap((signal) => approvedCategories.filter((category) => {
      const normalizedCategory = category.toLowerCase();
      return signal === normalizedCategory || signal.includes(normalizedCategory);
    }))
    .find((category) =>
      onesmarterPublicKnowledgeBase.filter((entry) => entry.category === category).length === 2,
    );
  if (!selectedCategory) return [];
  return onesmarterPublicKnowledgeBase
    .filter((entry) => entry.category === selectedCategory)
    .map(({ id }) => groundedConversationEntityForId(id, { includeChildren: false }))
    .filter(Boolean);
};

const semanticQueryFor = (intent = {}) => [
  intent.domain,
  intent.topic,
  ...(intent.entities || []),
  intent.proposition,
  intent.requestedDetail,
].filter(Boolean).join(". ");

const semanticEvidenceFor = (intent = {}, localHarness = runMiraLocalHarness) => {
  const topicParts = String(intent.topic || "")
    .split(/[|;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const canonicalEntries = topicParts.flatMap((topic) =>
    onesmarterPublicKnowledgeBase.filter(({ title, id }) => title === topic || id === topic),
  );
  const categoryScope = canonicalEntries.some((entry) =>
    onesmarterPublicKnowledgeBase.some((candidate) =>
      candidate.id !== entry.id && candidate.route !== entry.route &&
      candidate.route.startsWith(entry.route.endsWith("/") ? entry.route : `${entry.route}/`),
    ),
  );
  const categoryEntries = categoryScope || !canonicalEntries.length
    ? onesmarterPublicKnowledgeBase.filter(({ category }) =>
        category.toLowerCase() === intent.domain,
      )
    : [];
  if (categoryEntries.length && !intent.clarificationNeeded && intent.confidence >= 0.7) {
    return {
      ...localHarness(semanticQueryFor(intent)),
      confidence: "high",
      matchedEntries: [...categoryEntries, ...canonicalEntries.filter(({ id }) =>
        !categoryEntries.some((entry) => entry.id === id),
      )],
      semanticCanonicalSelection: true,
      semanticEvidenceCandidateTitles: categoryEntries.map(({ title }) => title),
      semanticEvidenceAmbiguous: false,
    };
  }
  // A validated canonical topic is already an evidence selection. Re-ranking its
  // words can promote an unrelated offering above the resolved subject.
  if (!categoryScope && intent.questionType !== "comparison" && canonicalEntries.length === topicParts.length && canonicalEntries.length) {
    return {
      ...localHarness(semanticQueryFor(intent)),
      confidence: "high",
      matchedEntries: canonicalEntries,
      semanticCanonicalSelection: true,
      semanticEvidenceCandidateTitles: canonicalEntries.map(({ title }) => title),
      semanticEvidenceAmbiguous: false,
    };
  }
  const queryFields = [
    { values: topicParts, weight: 2 },
    { values: intent.entities || [], weight: 2 },
    { values: [intent.proposition], weight: 5 },
    { values: [intent.requestedDetail], weight: 4 },
    { values: [semanticQueryFor(intent)], weight: 3 },
  ].flatMap(({ values, weight }) =>
    values.filter(Boolean).map((value) => ({ value: String(value), weight })),
  );
  const results = queryFields.map(({ value }) => localHarness(value));
  const base = results.at(-1) || localHarness(semanticQueryFor(intent));
  const evidence = new Map();
  results.forEach((result, queryIndex) => {
    const weight = queryFields[queryIndex].weight;
    (result.matchedEntries || []).forEach((entry, rank) => {
      const current = evidence.get(entry.id) || {
        entry,
        fieldMatches: 0,
        relevance: 0,
        score: 0,
      };
      current.fieldMatches += 1;
      current.relevance += weight * Math.max(entry.score || 0, 1) / (rank + 1);
      current.score = Math.max(current.score, entry.score || 0);
      evidence.set(entry.id, current);
    });
  });
  const rankedEvidence = [...evidence.values()]
    .sort((left, right) =>
      right.fieldMatches - left.fieldMatches ||
      Number(topicParts.includes(right.entry.title)) -
        Number(topicParts.includes(left.entry.title)) ||
      right.relevance - left.relevance ||
      right.score - left.score,
    );
  const strongestFieldAgreement = rankedEvidence[0]?.fieldMatches || 0;
  const matchedEntries = rankedEvidence
    .filter((candidate) =>
      intent.questionType === "comparison" ||
      candidate.fieldMatches === strongestFieldAgreement,
    )
    .slice(0, 5)
    .map(({ entry }) => entry);
  const topicAnchors = topicParts
    .map((topic) => localHarness(topic).matchedEntries?.[0])
    .filter(Boolean);
  const comparisonAnchors = intent.questionType === "comparison"
    ? topicParts
        .map((topic) => localHarness(topic).matchedEntries?.[0])
        .filter(Boolean)
    : [];
  const prioritizedEntries = [
    ...comparisonAnchors,
    ...matchedEntries.slice(0, topicAnchors.length ? 4 : 5),
    ...topicAnchors,
  ]
    .filter(
      (entry, index, entries) =>
        entries.findIndex((candidate) => candidate.id === entry.id) === index,
    )
    .slice(0, 5);
  return {
    ...base,
    confidence: prioritizedEntries.length ? "high" : base.confidence,
    matchedEntries: prioritizedEntries,
    semanticEvidenceCandidateTitles: prioritizedEntries.map(({ title }) => title),
    semanticEvidenceAmbiguous:
      intent.questionType !== "comparison" &&
      prioritizedEntries.length > 1 &&
      !prioritizedEntries.some(({ title }) => title === intent.topic),
  };
};

const semanticFallbackFor = (intent = {}, entries = []) => {
  if (intent.clarificationNeeded) {
    return "I want to make sure I understand the request. Which OneSmarter platform, service, compliance topic, or professional agent would you like to discuss?";
  }
  if (intent.polarity === "negative" || intent.negationScope?.length) {
    if (["negative_confirmation", "why"].includes(intent.questionType)) {
      const evidenceSummary = [
        entries[0]?.approvedSummary,
        ...(entries[0]?.answerFacts || entries[0]?.sourceFacts || []),
      ].filter(Boolean).join(" ");
      return intent.questionType === "why"
        ? `The question asks why this proposition would be true: "${intent.proposition}". The approved information does not provide a separate reason beyond this documented position: ${evidenceSummary}`
        : `For the proposition "${intent.proposition}", the approved information is: ${evidenceSummary}`;
    }
    const boundaries = entries.flatMap((entry) => [
      ...(entry?.sourceFacts || []).filter((fact) => /\b(?:does not|do not|cannot|not presented|not positioned|should not)\b/i.test(fact)),
      ...(entry?.disallowedClaims || []),
    ]).slice(0, 3);
    return [
      entries[0]?.approvedSummary,
      boundaries.length ? `Supported boundaries include: ${boundaries.join("; ")}.` : "The approved public information does not establish an additional limitation beyond this documented scope.",
    ].filter(Boolean).join(" ");
  }
  if (["positive_yes_no", "status"].includes(intent.questionType)) {
    const evidenceSummary = [
      entries[0]?.approvedSummary,
      ...(entries[0]?.answerFacts || entries[0]?.sourceFacts || []),
    ].filter(Boolean).join(" ");
    return evidenceSummary
      ? `For the proposition "${intent.proposition}", the approved information is: ${evidenceSummary}`
      : "The approved public information does not establish that proposition.";
  }
  if (intent.questionType === "scope_check") {
    const scopeEntry = entries.find((entry) => entry.title === intent.topic) || entries[0];
    const orderedEntries = [scopeEntry, ...entries].filter(
      (entry, index, candidates) =>
        entry && candidates.findIndex((candidate) => candidate?.id === entry.id) === index,
    );
    const boundaries = orderedEntries.flatMap((entry) => [
      ...(entry?.sourceFacts || []).filter((fact) =>
        /\b(?:does not|do not|cannot|not available|not provide|not access)\b/i.test(fact),
      ),
      ...(entry?.disallowedClaims || []),
    ].slice(0, 2)).slice(0, 4);
    return [
      ...orderedEntries.slice(0, 2).map(({ approvedSummary }) => approvedSummary),
      ...boundaries,
    ].filter(Boolean).join(" ");
  }
  return entries.map((entry) => [
    entry.approvedSummary,
    ...(entry.answerFacts || []),
  ].filter(Boolean).join(" ")).join("\n\n") ||
    "I can help with approved public information about OneSmarter's platforms, services, compliance posture, Trust Center, and professional agents. What would you like to explore?";
};

const safeSemanticSubject = (intent = {}) => {
  const candidate = String(
    intent.requestedDetail || intent.proposition || intent.topic || "that request",
  )
    .replace(/[\r\n<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return candidate && candidate.length <= 120 ? candidate : "that request";
};

const semanticOutOfScopeFallback = (intent = {}) => {
  const subject = safeSemanticSubject(intent);
  const generalKnowledge = ["general_definition", "general_education"].includes(intent.domain) &&
    intent.confidence >= 0.7 && !intent.clarificationNeeded && !intent.mentionedNames?.length;
  const answerByDomain = {
    privacy_general: "Avoid sharing personal, private, credential, or confidential information in a public chat. You can ask the question in general terms; this is general privacy guidance, not a statement of OneSmarter's privacy policy.",
    meaningless_input: "I couldn't identify a clear question in that message. Please rephrase it in a short sentence.",
    person_specific: "I don't have approved public information that establishes details about that person or organization.",
    customer_strategy: "I can explain approved OneSmarter capabilities, but I can't design a customer-specific strategy from this public chat. For a scoped discussion, contact care@onesmarter.com.",
    unsupported_business_request: "I can't perform or confirm that business-specific request from this public chat. For a scoped discussion, contact care@onesmarter.com.",
    unsupported_factual_request: `Approved OneSmarter information does not establish ${subject}.`,
    unrelated_factual: `That question about ${subject} is outside Mira's approved OneSmarter information.`,
  };
  return {
    confidence: generalKnowledge ? "medium" : "low",
    matchedEntries: [],
    answerSeed: intent.mentionedNames?.length
      ? intent.domain === "person_specific"
        ? "I don't have approved public information about that person or organization."
        : "I don't have approved public information about that topic."
      : generalKnowledge
      ? `Provide a concise general explanation of ${subject}, without presenting it as OneSmarter-specific information.`
      : answerByDomain[intent.domain] || `The request about ${subject} is outside Mira's approved OneSmarter information.`,
    handoffNeeded: generalKnowledge,
    handoffReason: generalKnowledge ? "general_information_only" : "",
    suggestedFollowUps: [],
    clarificationNeeded: intent.domain === "meaningless_input" || Boolean(intent.clarificationNeeded),
    contextualGeneralKnowledge: generalKnowledge,
  };
};

const describesApprovedIntegrationCapability = (message = "", approvedEntries = []) => {
  const normalizedMessage = message.toLowerCase().replace(/\s+/g, " ");
  const evidence = approvedEntries.flatMap((entry) => [
    entry?.approvedSummary,
    ...(entry?.sourceFacts || []),
    ...(entry?.allowedClaims || []),
  ]).filter(Boolean);
  const approvedPhrases = evidence.flatMap((fact) =>
    [...String(fact).matchAll(/\b(?:[a-z0-9/-]+\s+){1,4}integration\b/gi)]
      .map((match) => match[0].toLowerCase().replace(/\s+/g, " ")),
  );
  return approvedPhrases.some((phrase) => normalizedMessage.includes(phrase));
};

const unsupportedImplementationAnswer = (
  message = "",
  directEntityResolution = null,
  approvedEntries = [],
) => {
  const asksIntegration =
    /\b(?:integrat(?:e|es|ed|ion)|connect(?:s|ed|ion)?|sync(?:s|ed)?)\b/i.test(
      message,
    );
  const asksTimeline =
    /\b(?:how long|timeline|timeframe|implementation time|modernization time|delivery time)\b/i.test(
      message,
    );
  if (asksIntegration && describesApprovedIntegrationCapability(message, approvedEntries) && !asksTimeline) return null;
  if (!asksIntegration && !asksTimeline) return null;
  const entity =
    directEntityResolution?.status === "resolved"
      ? directEntityResolution.match.entity
      : null;
  if (
    !entity &&
    asksIntegration &&
    /\b(?:SAP|Salesforce|ServiceNow|Oracle|Microsoft Dynamics)\b/i.test(message)
  ) {
    return {
      entity: null,
      answer:
        "The approved OneSmarter content does not confirm integration with the named external system. For integration-specific verification, email care@onesmarter.com.",
    };
  }
  if (!entity) return null;
  const subject = entity.label;
  return {
    entity,
    answer: asksIntegration
      ? `The approved OneSmarter content does not confirm that ${subject} integrates with the named external system. For integration-specific verification, email care@onesmarter.com.`
      : `The approved OneSmarter content does not specify an implementation or modernization timeline for ${subject}. For project-specific timing, email care@onesmarter.com.`,
  };
};

const referencesPriorContext = (message = "") =>
  /\b(that|it|this|those|they|them|which one|the first one|the second one|first option|second option|tell me more|what about|why does that matter|how is that different|previous|above|same one)\b/i.test(
    message,
  );

const ENTITY_DETAIL_REQUEST =
  /\b(?:explain|describe|tell me about|details?|detailed information|detailed explanation|elaborate|everything (?:you know )?about|what does .+ do)\b/i;
const ENTITY_DEPTH_CONTINUATION =
  /^(?:can you\s+)?(?:give me\s+)?(?:some\s+)?(?:more|additional|further)\s+(?:details?|information)|^(?:can you\s+)?(?:explain\s+(?:more|further)|describe\s+(?:it|this|that)\s+further|elaborate(?:\s+on (?:that|this|it))?|expand(?:\s+on (?:that|this|it))?)|^(?:please\s+)?(?:tell me more|go deeper|continue|what else|anything more)|\b(?:more about (?:this|it)|explain (?:that|this|it) in detail|detailed explanation)\b/i;
const EXPLICIT_COMPARISON_ACTION =
  /\b(?:compare|comparison|versus|vs\.?|difference between|compared with)\b/i;
const STRONG_CANONICAL_ENTITY_NAME =
  /\b(?:IBM\s*i|AS\s*\/?\s*400|AS400|Claims Processing(?: Services)?|Software Support Consolidation|Secure Ticketing(?: and Case Management)?|Bill Audit(?:\s*(?:&|and)\s*Bill Pay)?|Healthcare\s*(?:&|and)\s*TPA Technology Services|AI Agentic Services|Enterprise Software Development)\b/i;
const ORDINAL_ENTITY_REFERENCE =
  /\b(?:first|second|third|fourth|last|\d+(?:st|nd|rd|th))\s+(?:one|item|option|platform|service|offering)\b/i;

const focusedEntityFromHistory = (conversationHistory = []) => {
  const turn = [...conversationHistory]
    .reverse()
    .find(
      (candidate) =>
        candidate?.role === "assistant" &&
        candidate.conversationEntities?.length === 1,
    );
  const priorEntity = turn?.conversationEntities?.[0];
  if (!priorEntity?.id) return null;
  return groundedConversationEntityForId(priorEntity.id, {
    level: priorEntity.level === 1 ? 1 : 0,
    position: 1,
  });
};

const detailedEntityAnswer = (entity, matchedEntries = []) => {
  const source = matchedEntries.find((entry) =>
    entity?.sourceIds?.includes(entry.id),
  );
  const summary = entity?.approvedSummary || source?.approvedSummary || "";
  const facts = [...new Set(
    entity?.level === 1
      ? entity?.sourceFacts || []
      : [...(entity?.sourceFacts || []), ...(source?.sourceFacts || [])],
  )]
    .filter(Boolean)
    .slice(0, 6);
  const details = facts.length
    ? `\n\nApproved details:\n${facts.map((fact) => `- ${fact}`).join("\n")}`
    : "";
  const limitedEvidence = facts.length <= 1
    ? "\n\nThat is the extent of the approved public information currently available for this service."
    : "";
  return `${entity.label}\n\n${summary}${details}${limitedEvidence}`.trim();
};

const needsFollowUpClarification = (message = "", conversationHistory = []) => {
  const normalizedMessage = String(message).toLowerCase();
  if (!referencesPriorContext(normalizedMessage)) return false;

  const asksForOption =
    /\b(which one|first one|second one|first option|second option|how is that different)\b/.test(
      normalizedMessage,
    );
  if (asksForOption && !historyHasPlatformOptions(conversationHistory)) return true;

  if (!conversationHistory.length && referencesPriorContext(normalizedMessage)) return true;
  if (!historyHasKnownApprovedTopic(conversationHistory)) return true;
  return false;
};

const resolveActiveSubject = (message = "", conversationHistory = []) => {
  const normalizedMessage = String(message).toLowerCase();
  const history = recentHistoryText(conversationHistory);

  if (
    historyHasPlatformOptions(conversationHistory) &&
    /\b(first one|first option|first platform)\b/.test(normalizedMessage)
  ) {
    return "secure-ticketing-case-management";
  }
  if (
    historyHasPlatformOptions(conversationHistory) &&
    /\b(second one|second option|second platform|other platform)\b/.test(normalizedMessage)
  ) {
    return "bill-audit-bill-pay";
  }
  if (isBroadPlatformQuestion(normalizedMessage)) return "";
  if (!referencesPriorContext(normalizedMessage)) {
    return "";
  }

  const recentTurns = conversationHistory.slice(-4).reverse();
  for (const turn of recentTurns) {
    const content = String(turn?.content || "").toLowerCase();
    if (/\biso(?:\/iec)?\s*27001\b|\biso certified\b/.test(content)) {
      return "iso-27001-certified";
    }
    if (/\bsoc\s*2\b|\bsoc2\b/.test(content)) return "soc2-attested";
    if (/\bbill audit\b|\bbill pay\b/.test(content)) {
      return "bill-audit-bill-pay";
    }
    if (/\bsecure ticketing\b|\bcase management\b/.test(content)) {
      return "secure-ticketing-case-management";
    }
  }

  if (/\biso(?:\/iec)?\s*27001\b|\biso certified\b/.test(history)) {
    return "iso-27001-certified";
  }
  if (/\bsoc\s*2\b|\bsoc2\b/.test(history)) return "soc2-attested";
  if (/\bbill audit\b|\bbill pay\b/.test(history)) return "bill-audit-bill-pay";
  if (/\bsecure ticketing\b|\bcase management\b/.test(history)) {
    return "secure-ticketing-case-management";
  }
  return "";
};

const answerSeedForEntries = (matchedEntries = []) => {
  const primary = matchedEntries[0];
  if (!primary) return "";
  const facts = (primary.sourceFacts || []).slice(0, 2).join(" ");
  const relatedText =
    matchedEntries.length > 1
      ? ` Related approved topics: ${matchedEntries
          .slice(1, 3)
          .map((entry) => entry.title)
          .join(", ")}.`
      : "";
  return `${primary.approvedSummary} ${facts}${relatedText} ${primary.handoffGuidance}`.trim();
};

const answerSeedForEntity = (entity, matchedEntries = []) => {
  if (entity?.level !== 1 || !entity.approvedSummary) {
    return `${matchedEntries[0]?.title || entity?.label}: ${answerSeedForEntries(matchedEntries)}`;
  }
  const facts = (entity.sourceFacts || []).slice(0, 2);
  return [
    `${entity.label}: ${entity.approvedSummary}`,
    ...facts.map((fact) => `- ${fact}`),
    entity.parentId
      ? "It is part of OneSmarter's Technology Solutions."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const entityTypeLabel = (type = "entity") =>
  ({
    platform: "Platform",
    service: "Service",
    service_category: "Service category",
    use_case: "Use case",
    capability: "Capability",
    industry: "Industry",
  })[type] || "Offering";

const comparisonAnswerSeedForEntities = (entities = [], matchedEntries = []) =>
  [
    "Here is a grounded comparison of the selected OneSmarter offerings:",
    ...entities.flatMap((entity) => {
      const entry = matchedEntries.find((candidate) =>
        entity.sourceIds?.includes(candidate.id),
      );
      if (!entry) return [];
      return [
      "",
      `${entity.label} (${entityTypeLabel(entity.type)}):`,
      `- Purpose: ${entry.approvedSummary}`,
      ...(entry.sourceFacts || []).slice(0, 2).map((fact) => `- ${fact}`),
      `- Suitable when the visitor's needs align with this ${entityTypeLabel(entity.type).toLowerCase()}'s approved purpose and capabilities.`,
      ];
    }),
    "",
    `Key difference: ${entities
      .map((entity) => `${entity.label} is a ${entityTypeLabel(entity.type).toLowerCase()}`)
      .join("; ")}.`,
  ]
    .filter((line, index) => line || index > 0)
    .join("\n");

const listAnswerSeedForEntities = (entities = [], matchedEntries = []) =>
  [
    "The grounded items in that group are:",
    ...entities.flatMap((entity, index) => [
      `${index + 1}. ${entity.label} (${entityTypeLabel(entity.type)})`,
      ...(entity.children || []).map(
        (child) => `   - ${child.label} (${entityTypeLabel(child.type)})`,
      ),
    ]),
    "",
    ...matchedEntries.map((entry) => `${entry.title}: ${entry.approvedSummary}`),
  ].join("\n");

const canonicalHierarchyAnswerForEntities = (entities = []) =>
  entities.map((entity) => `- ${entity.label}`).join("\n");

const withResolvedConversationEntities = (
  localResult,
  referenceResolution,
) => {
  const matchedEntries = matchedEntriesForConversationEntities(
    referenceResolution.entities,
  );
  if (!matchedEntries.length) return localResult;
  return {
    ...localResult,
    confidence: "high",
    matchedEntries,
    answerSeed: referenceResolution.isList
      ? referenceResolution.canonicalHierarchyList
        ? canonicalHierarchyAnswerForEntities(referenceResolution.entities)
        : listAnswerSeedForEntities(referenceResolution.entities, matchedEntries)
      : referenceResolution.isComparison
      ? comparisonAnswerSeedForEntities(
          referenceResolution.entities,
          matchedEntries,
        )
      : answerSeedForEntity(referenceResolution.entities[0], matchedEntries),
    suggestedFollowUps: matchedEntries
      .flatMap((entry) => entry.relatedQuestions || [])
      .slice(0, 3),
    resolvedConversationEntities: referenceResolution.entities,
    answerStructureKind: referenceResolution.isComparison
      ? "comparison"
      : referenceResolution.isList
        ? referenceResolution.canonicalHierarchyList
          ? ""
          : "list"
        : "",
  };
};

const withMainOfferingEntities = (localResult) => {
  const entities = [
    "secure-ticketing-case-management",
    "bill-audit-bill-pay",
    "technology-solutions-overview",
  ]
    .map(groundedConversationEntityForId)
    .filter(Boolean);
  const matchedEntries = matchedEntriesForConversationEntities(entities);
  return {
    ...localResult,
    confidence: "high",
    matchedEntries,
    answerSeed: [
      "OneSmarter's main offerings are:",
      ...entities.flatMap((entity, index) => [
        `${index + 1}. ${entity.label} (${entityTypeLabel(entity.type)})`,
        ...(entity.children || []).map(
          (child) => `   - ${child.label} (${entityTypeLabel(child.type)})`,
        ),
      ]),
      "",
      ...matchedEntries.map((entry) => `${entry.title}: ${entry.approvedSummary}`),
    ].join("\n"),
    resolvedConversationEntities: entities,
    answerStructureKind: "offering-list",
    answerStructureIntroduction: "OneSmarter's main offerings are:",
  };
};

const withPlatformEntities = (localResult) => {
  const entities = [
    "secure-ticketing-case-management",
    "bill-audit-bill-pay",
  ]
    .map(groundedConversationEntityForId)
    .filter(Boolean);
  const matchedEntries = matchedEntriesForConversationEntities(entities);
  return {
    ...localResult,
    confidence: "high",
    matchedEntries,
    answerSeed: [
      "OneSmarter offers two platforms:",
      ...entities.map(
        (entity, index) =>
          `${index + 1}. ${entity.label} (${entityTypeLabel(entity.type)})`,
      ),
      "",
      "Broader services are also available under Technology Solutions.",
      "",
      ...matchedEntries.map(
        (entry) => `${entry.title}: ${entry.approvedSummary}`,
      ),
    ].join("\n"),
    resolvedConversationEntities: entities,
    answerStructureKind: "platform-list",
    answerStructureIntroduction: "OneSmarter offers two purpose-built platforms.",
    answerStructureImportantNote:
      "Broader services are also available under Technology Solutions.",
    answerStructureFollowUpQuestion:
      "Would you like help choosing between these two platforms?",
  };
};

const naturalHandoff =
  "For platform-level security, procurement, contractual, implementation, or supporting-evidence questions, contact care@onesmarter.com.";

const comparisonAnswerSeedFor = () =>
  [
    "Here is the practical difference between OneSmarter's two platform offerings for a healthcare organization.",
    "",
    "Secure Ticketing and Case Management:",
    "- Built for HIPAA-regulated workflows and PHI-sensitive operations.",
    "- Supports secure intake, role-based access, audit history, controlled communication, workflow tracking, and accountable issue resolution.",
    "- Best fit when the need is case management, issue tracking, controlled communication, or workflow accountability.",
    "",
    "Bill Audit & Bill Pay:",
    "- Helps organizations review vendor bills, analyze recurring expenses, identify discrepancies, coordinate approvals, and support payment workflows.",
    "- Supports telecom expense management as a use case, including bill analysis, contract and rate comparison, historical usage review, and cost-control reporting.",
    "- Best fit when the need is vendor-expense review, recurring bill analysis, discrepancy tracking, approvals, or payment workflow support.",
    "",
    "Key difference: Secure Ticketing and Case Management is centered on secure operational case workflows; Bill Audit & Bill Pay is centered on financial and vendor-expense workflows.",
    naturalHandoff,
  ]
    .filter(Boolean)
    .join("\n");

const withPlatformComparisonContext = (localResult) => {
  const secureEntry = localResult.matchedEntries.find(
    (entry) => entry.id === "secure-ticketing-case-management",
  );
  const billEntry = localResult.matchedEntries.find((entry) => entry.id === "bill-audit-bill-pay");

  if (!secureEntry || !billEntry) return localResult;

  const matchedEntries = [
    { ...secureEntry, score: Math.max(secureEntry.score, 45) },
    { ...billEntry, score: Math.max(billEntry.score, 45) },
  ];

  return {
    ...localResult,
    confidence: "high",
    matchedEntries,
    answerSeed: comparisonAnswerSeedFor(),
    suggestedFollowUps: [
      "Tell me more about Secure Ticketing and Case Management.",
      "Tell me more about Bill Audit & Bill Pay.",
      "How should I contact OneSmarter?",
    ],
    answerStructureKind: "comparison",
  };
};

const withActiveSubjectPriority = (localResult, activeSubject) => {
  if (!activeSubject) return localResult;
  const activeEntry = localResult.matchedEntries.find((entry) => entry.id === activeSubject);
  if (!activeEntry) return localResult;

  const matchedEntries = [
    { ...activeEntry, score: Math.max(activeEntry.score, 40) },
    ...localResult.matchedEntries
      .filter(
        (entry) =>
          entry.id !== activeSubject &&
          !["secure-ticketing-case-management", "bill-audit-bill-pay"].includes(entry.id),
      )
      .slice(0, 1),
  ];

  return {
    ...localResult,
    confidence: "high",
    matchedEntries,
    answerSeed: answerSeedForEntries(matchedEntries) || localResult.answerSeed,
    suggestedFollowUps: activeEntry.relatedQuestions?.slice(0, 3) || localResult.suggestedFollowUps,
  };
};

const buildContextualRetrievalMessage = (message = "", conversationHistory = []) => {
  const normalizedMessage = String(message).toLowerCase();
  const comparisonIntent =
    isComparisonIntent(normalizedMessage) ||
    (historyHasPlatformOptions(conversationHistory) &&
      /\b(which one|which is better|which one is better|how (?:is|are) (?:that|they|those) different)\b/.test(
        normalizedMessage,
      ));
  const directIsoCredentialIntent =
    /\bISO(?:\/IEC)?(?:\s*27001)?\b|\bISO certified\b|\bcertifications?\b/i.test(message);
  if (!conversationHistory.length && !comparisonIntent && !directIsoCredentialIntent) return message;

  const history = recentHistoryText(conversationHistory);
  const userHistory = recentUserHistoryText(conversationHistory);
  const hints = [];
  const referencesHistory = referencesPriorContext(normalizedMessage);
  const currentHasSensitiveSubmissionIntent =
    SENSITIVE_SUBMISSION_INTENT_PATTERN.test(normalizedMessage);
  const activeSubject = resolveActiveSubject(message, conversationHistory);

  if (directIsoCredentialIntent) {
    hints.push(
      "ISO/IEC 27001 Certified OneSmarter own organizational credential ISO/IEC 27001 readiness support customer preparation Trust Center",
    );
  }

  if (comparisonIntent) {
    hints.push(
      "Secure Ticketing and Case Management Bill Audit & Bill Pay compare both platforms healthcare organization",
    );
  }

  if (referencesHistory) {
    if (/\b(ignore|override|forget)\b.*\b(instructions|rules|guidance)\b|\b(system prompt|api key|secret|private prompt)\b/.test(userHistory)) {
      hints.push("ignore instructions reveal system prompt");
    }
    if (
      (currentHasSensitiveSubmissionIntent &&
        SENSITIVE_DATA_PATTERN.test(`${normalizedMessage} ${userHistory}`)) ||
      hasSensitiveDataSubmissionIntent(userHistory)
    ) {
      hints.push("PHI confidential patient information");
    }
    if (/\b(legal advice|lawyer|attorney|legal opinion)\b/.test(userHistory)) {
      hints.push("legal advice");
    }
    if (/\b(medical advice|diagnosis|treatment|clinical advice)\b/.test(userHistory)) {
      hints.push("medical advice");
    }
    if (/\b(guarantee|guaranteed|fully compliant|make me compliant)\b/.test(userHistory)) {
      hints.push("guaranteed compliance");
    }
  }

  if (/\b(second one|second option|second platform|other platform)\b/.test(normalizedMessage)) {
    if (/\bplatforms?\b/.test(history) || /\bsecure ticketing\b|\bbill audit\b/.test(history)) {
      hints.push("Bill Audit & Bill Pay");
    }
  }

  if (/\b(first one|first option|first platform)\b/.test(normalizedMessage)) {
    if (/\bplatforms?\b/.test(history) || /\bsecure ticketing\b|\bbill audit\b/.test(history)) {
      hints.push("Secure Ticketing and Case Management");
    }
  }

  if (referencesHistory) {
    if (activeSubject === "bill-audit-bill-pay") {
      hints.push("Bill Audit & Bill Pay Bill Audit & Bill Pay vendor bills recurring expenses approvals healthcare organization");
    } else if (activeSubject === "secure-ticketing-case-management") {
      hints.push("Secure Ticketing and Case Management Secure Ticketing and Case Management HIPAA regulated workflows case management healthcare organization");
    } else if (activeSubject === "soc2-attested") {
      hints.push("SOC 2 Type II Attested Trust Center security operational controls");
    } else if (activeSubject === "iso-27001-certified") {
      hints.push("ISO/IEC 27001 Certified OneSmarter own organizational credential Trust Center");
    } else if (/\bbill audit\b|\bbill pay\b|\bvendor bill\b|\btelecom\b/.test(history)) {
      hints.push("Bill Audit & Bill Pay telecom expense management vendor bills");
    } else if (/\bsecure ticketing\b|\bcase management\b|\bphi\b|\bhipaa\b/.test(history)) {
      hints.push("Secure Ticketing and Case Management HIPAA regulated workflows");
    } else if (/\bsoc\s*2\b|\bsoc2\b/.test(history)) {
      hints.push("SOC 2 Type II Attested Trust Center");
    } else if (/\biso(?:\/iec)?\s*27001\b|\biso certified\b/.test(history)) {
      hints.push("ISO/IEC 27001 Certified ISO/IEC 27001 readiness support Trust Center");
    } else if (/\bhipaa\b/.test(history)) {
      hints.push("HIPAA Security Rule Compliance Assessment Completed Trust Center");
    } else if (/\bai agentic\b|\bai agents?\b|\bmira\b/.test(history)) {
      hints.push("AI Agentic Services Mira AI agents");
    } else if (/\bclaims processing\b|\bhealthcare\b|\btpa\b/.test(history)) {
      hints.push("Claims Processing Services healthcare TPA technology");
    }
  }

  if (/\b(contact|email|reach|talk|follow up)\b/.test(normalizedMessage)) {
    hints.push("Contact care@onesmarter.com");
  }

  return hints.length ? `${message} ${[...new Set(hints)].join(" ")}` : message;
};

const withClaimBoundaryMetadata = (localResult) => ({
  ...localResult,
  mode: LOCAL_HARNESS_MODE,
  handoffNeeded: false,
  handoffReason: "",
  fallbackUsed: true,
  fallbackReason: "pre_call_claim_boundary",
});

const normalizeModelHandoff = (modelOutput, localResult) => {
  if (localResult.handoffNeeded || hasHardStopRisk(localResult.riskFlags)) {
    return {
      handoffNeeded: true,
      handoffReason: modelOutput.handoffReason || localResult.handoffReason || "handoff_required",
    };
  }

  if (
    modelOutput.groundingStatus === "insufficient_context" ||
    modelOutput.groundingStatus === "refused"
  ) {
    return {
      handoffNeeded: modelOutput.handoffNeeded,
      handoffReason: modelOutput.handoffReason || "",
    };
  }

  return {
    handoffNeeded: false,
    handoffReason: "",
  };
};

const runMiraResponseAdapterInternal = async ({
  message,
  conversationId,
  persona,
  memoryTheme,
  empathyState,
  suggestedQuestionId = "",
  conversationHistory = [],
  verbosityBand = "normal",
  config,
  localHarness = runMiraLocalHarness,
  openAiAdapter = runOpenAiMiraAdapter,
  semanticIntentProvider = null,
} = {}) => {
  if (config?.mode === "off") {
    return unavailableResponse(message);
  }

  const messageNormalization = normalizeMiraUserMessage(message);
  const classificationMessage = messageNormalization.normalizedMessage;
  const premiseCheck = checkMiraPremise({
    message: classificationMessage,
    conversationHistory,
  });
  const earlyRiskFlags = detectRiskFlags(classificationMessage);
  const earlySafetyResult = runMiraSafetyGate(classificationMessage);
  let earlySemanticResolution = null;
  let allowMiraBoundaryQuestion = false;
  const canResolveDeferredBusinessScope = Boolean(
    earlyRiskFlags.length === 1 &&
    earlyRiskFlags[0] === "business_specific_review" &&
    typeof semanticIntentProvider === "function" &&
    config?.mode === STAGING_LLM_MODE &&
    config?.provider === "openai" &&
    config.providerConfigComplete,
  );
  if (canResolveDeferredBusinessScope) {
    earlySemanticResolution = await resolveMiraSemanticIntent({
      message: classificationMessage,
      conversationHistory,
      semanticIntentProvider,
      config,
    });
    allowMiraBoundaryQuestion = isValidatedMiraBoundaryQuestion(
      earlySemanticResolution,
    ) || Boolean(
      earlySemanticResolution.ok &&
      earlySemanticResolution.intent?.domain === "customer_strategy",
    );
  }
  if (canResolveDeferredBusinessScope && !allowMiraBoundaryQuestion) {
    const deferredSafetyResult = applyMiraPremiseCorrections(
      withFallbackMetadata(
        localHarness(classificationMessage),
        "pre_call_safety_gate",
      ),
      premiseCheck,
    );
    return {
      ...deferredSafetyResult,
      messageNormalization,
      responseMode: {
        mode: "safety",
        budget: { maxSentences: 3, shape: "safety_hard_stop" },
        fastPath: true,
        skipModel: true,
      },
      turnContext: {
        relationToConversation: "standalone_new_request",
        usesHistory: false,
        currentTurnAnswerability: currentTurnAnswerabilityFor(
          deferredSafetyResult,
        ),
      },
    };
  }
  if (earlySafetyResult && !allowMiraBoundaryQuestion) {
    const result = applyMiraPremiseCorrections(withFallbackMetadata(
      earlySafetyResult,
      "pre_call_safety_gate",
    ), premiseCheck);
    return {
      ...result,
      messageNormalization,
      responseMode: {
        mode: "safety",
        budget: { maxSentences: 3, shape: "safety_hard_stop" },
        fastPath: true,
        skipModel: true,
      },
      turnContext: {
        relationToConversation: "standalone_new_request",
        usesHistory: false,
        currentTurnAnswerability: currentTurnAnswerabilityFor(result),
      },
    };
  }
  const responseMode = classifyMiraResponseMode(
    classificationMessage,
    conversationHistory,
  );
  const earlyExplicitEntityResolution = ENTITY_DETAIL_REQUEST.test(
    classificationMessage,
  )
    ? resolveMiraEntityText(classificationMessage)
    : null;
  const hasExplicitSingleEntityFocus =
    earlyExplicitEntityResolution?.status === "resolved" &&
    STRONG_CANONICAL_ENTITY_NAME.test(classificationMessage) &&
    !ORDINAL_ENTITY_REFERENCE.test(classificationMessage) &&
    !EXPLICIT_COMPARISON_ACTION.test(classificationMessage);
  const faqResolution =
    resolveMiraHiringFollowUp(classificationMessage, conversationHistory) ||
    resolveMiraSuggestedFaqFastPath(
      classificationMessage,
      responseMode,
      suggestedQuestionId,
    );
  const isTrustPostureFaq = TRUST_POSTURE_FAQ_IDS.has(faqResolution?.faqId);
  if (
    faqResolution &&
    config?.provider !== "ollama" &&
    (!hasExplicitSingleEntityFocus || isTrustPostureFaq) &&
    earlyRiskFlags.every((flag) =>
      ["hipaa_claim_boundary", "soc2_claim_boundary"].includes(flag),
    )
  ) {
    const emptyResult = {
      question: message,
      normalizedQuestion: classificationMessage.toLowerCase(),
      riskFlags: earlyRiskFlags,
      confidence: "high",
      matchedEntries: faqResolution.matchedEntries || [],
      answerSeed: faqResolution.answer || "",
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
    };
    const resolved = faqResolution.platformListing
      ? {
          ...withPlatformEntities(emptyResult),
          listingIntent: "list_platforms",
          listingHandled: true,
        }
      : {
          ...emptyResult,
          resolvedConversationEntities: faqResolution.entities || [],
        };
    // Suggested FAQ answers are complete canonical responses. Keep the premise
    // metadata without prepending an overlapping generic correction.
    const correctedResolved = {
      ...resolved,
      ...(premiseCheck?.corrections?.length ? { premiseCheck } : {}),
    };
    return {
      ...correctedResolved,
      messageNormalization,
      businessGoals: [],
      businessGoalConfidence: "low",
      businessGoalAmbiguous: false,
      requestDecomposition: {
        simpleRequest: true,
        compoundRequest: false,
        requirements: [],
        requestedActions: [],
        constraints: [],
      },
      responseMode: { ...responseMode, fastPath: true, skipModel: true },
      turnContext: {
        relationToConversation: "standalone_new_request",
        usesHistory: false,
        currentTurnAnswerability: "answerable",
      },
      mode: LOCAL_HARNESS_MODE,
      fallbackUsed: false,
      fallbackReason: "",
      faqId: faqResolution.faqId,
    };
  }
  const selfContainedCanonicalListing =
    !earlyRiskFlags.length &&
    !/\b(?:first|second|third|fourth|last|previous|former|latter|those|these|their|them)\b/i.test(
      classificationMessage,
    ) &&
    ((/\b(?:what are|list|show|give me)\b[^.!?]{0,50}\b(?:your |onesmarter )?platforms?\b/i.test(
      classificationMessage,
    ) && !/\bservices?\b/i.test(classificationMessage)) ||
      (!/\b(?:do not|don't|dont|not)\s+list\b/i.test(classificationMessage) &&
        /\b(?:list|show)\b[^.!?]{0,50}\b(?:your |onesmarter )?services?\b|\b(?:give|tell)\b[^.!?]{0,30}\bnames?\s+of\s+(?:the |your |onesmarter )?services?\b|\bwhat services? (?:does onesmarter|do you) offer\b/i.test(
          classificationMessage,
        )) ||
      /\bwhich offerings? are (?:platforms?|services?)\b/i.test(
        classificationMessage,
      ) ||
      /\b(?:bifurcate|separate|list)\b[^.!?]{0,60}\bplatforms?\b[^.!?]{0,30}\bservices?\b/i.test(
        classificationMessage,
      ) ||
      /\btechnology solutions\b[^.!?]{0,40}\bservices?\b|\bservices?\b[^.!?]{0,40}\b(?:under|within|belong to)\b[^.!?]{0,20}\btechnology solutions\b/i.test(
        classificationMessage,
      ));
  if (selfContainedCanonicalListing) {
    const emptyResult = {
      question: message,
      normalizedQuestion: classificationMessage.toLowerCase(),
      riskFlags: [],
      confidence: "high",
      matchedEntries: [],
      answerSeed: "",
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
    };
    const namesOnlyResolution =
      responseMode.mode === "names_only"
        ? resolveMiraNamesOnly(classificationMessage, [])
        : null;
    const technologyHierarchyRequest = /\btechnology solutions\b/i.test(
      classificationMessage,
    );
    const hierarchyResolution = technologyHierarchyRequest
      ? resolveMiraConversationReference(
          "What services are under Technology Solutions?",
          [],
        )
      : null;
    const listingResolution = hierarchyResolution
      ? null
      : resolveMiraListingRequest(classificationMessage, []);
    const platformSummaryRequest =
      !technologyHierarchyRequest &&
      !/\bservices?\b/i.test(classificationMessage) &&
      /\b(?:main platforms|platforms do you offer|your platforms)\b/i.test(
        classificationMessage,
      ) &&
      !/^\s*(?:list|show|give me)\b/i.test(classificationMessage);
    let result = namesOnlyResolution
      ? {
          ...emptyResult,
          matchedEntries: namesOnlyResolution.matchedEntries,
          answerSeed: namesOnlyResolution.answer,
          resolvedConversationEntities: namesOnlyResolution.entities,
          listingHandled: true,
          fastPathHandled: true,
        }
      : hierarchyResolution?.kind === "resolved"
        ? withResolvedConversationEntities(emptyResult, hierarchyResolution)
        : platformSummaryRequest
          ? withPlatformEntities(emptyResult)
        : listingResolution
          ? {
              ...emptyResult,
              matchedEntries: listingResolution.matchedEntries,
              answerSeed: listingResolution.answer,
              resolvedConversationEntities: listingResolution.entities,
              listingIntent: listingResolution.intent,
              listingHandled: true,
              answerStructureKind:
                listingResolution.intent === "list_services_and_platforms" ||
                listingResolution.intent === "reorganize_previous_list"
                  ? ""
                  : "list",
            }
          : emptyResult;
    result = {
      ...result,
      messageNormalization,
      businessGoals: [],
      businessGoalConfidence: "low",
      businessGoalAmbiguous: false,
      requestDecomposition: {
        simpleRequest: true,
        compoundRequest: false,
        requirements: [],
        requestedActions: [],
        constraints: [],
      },
      responseMode: { ...responseMode, fastPath: true, skipModel: true },
      turnContext: {
        relationToConversation: "standalone_new_request",
        usesHistory: false,
        currentTurnAnswerability: "answerable",
      },
      mode: LOCAL_HARNESS_MODE,
      fallbackUsed: false,
      fallbackReason: "",
    };
    return result;
  }
  const businessGoalResolution = extractMiraBusinessGoals(
    classificationMessage,
  );
  const businessGoalEvidence = buildMiraGoalEvidenceBridge(
    businessGoalResolution,
    classificationMessage,
  );
  const goalEvidenceText = [
    businessGoalEvidence.retrievalHint,
    businessGoalEvidence.recommendationHint,
  ]
    .filter(Boolean)
    .join(" ");
  const goalAwareMessage = goalEvidenceText
    ? `${classificationMessage} ${goalEvidenceText}`
    : classificationMessage;
  const turnContext = classifyMiraTurnContext(
    classificationMessage,
    conversationHistory,
    responseMode.mode,
  );
  const answersGoalTechnologyClarification =
    /\b(?:IBM\s*i|AS\s*400|AS400|custom Java)\b/i.test(classificationMessage) &&
    [...conversationHistory]
      .reverse()
      .some(
        (turn) =>
          turn?.role === "assistant" &&
          /what technology do (?:these|the|your) .+ run on\?/i.test(
            turn.content || "",
          ),
      );
  const answersAdaptiveDiscovery = isMiraAdaptiveDiscoveryFollowUp(
    classificationMessage,
    conversationHistory,
  );
  const continuedFocusedEntity =
    ENTITY_DEPTH_CONTINUATION.test(classificationMessage) &&
    !hasExplicitSingleEntityFocus
      ? focusedEntityFromHistory(conversationHistory)
      : null;
  const contextualComparisonFocusedEntity =
    isMiraContextualComparisonFollowUp(classificationMessage)
      ? focusedEntityFromHistory(conversationHistory)
      : null;
  const replacesComparisonCandidate =
    /\b(?:no|instead).+\buse .+ as (?:the )?second option\b/i.test(
      classificationMessage,
    ) &&
    conversationHistory.length > 0;
  const relevantConversationHistory =
    turnContext.usesHistory ||
    answersGoalTechnologyClarification ||
    answersAdaptiveDiscovery ||
    Boolean(continuedFocusedEntity) ||
    replacesComparisonCandidate
    ? conversationHistory
    : [];
  const safetyResult = runMiraSafetyGate(classificationMessage);
  if (safetyResult && !allowMiraBoundaryQuestion) {
    const result = withFallbackMetadata(safetyResult, "pre_call_safety_gate");
    return {
      ...result,
      messageNormalization,
      responseMode: {
        mode: "safety",
        budget: { maxSentences: 3, shape: "safety_hard_stop" },
        fastPath: true,
      },
      turnContext: {
        ...turnContext,
        currentTurnAnswerability: currentTurnAnswerabilityFor(result),
      },
    };
  }

  if (responseMode.mode === "acknowledgement") {
    return {
      question: message,
      normalizedQuestion: classificationMessage.toLowerCase(),
      messageNormalization,
      riskFlags: [],
      confidence: "high",
      matchedEntries: [],
      answerSeed: acknowledgementAnswerFor(classificationMessage),
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
      responseMode: { ...responseMode, fastPath: true },
      turnContext: {
        ...turnContext,
        currentTurnAnswerability: "answerable",
      },
      mode: LOCAL_HARNESS_MODE,
      fallbackUsed: false,
      fallbackReason: "",
    };
  }

  const requestDecomposition = decomposeMiraRequest(classificationMessage);
  const compoundFactualResolution =
    responseMode.mode === "recommendation"
      ? resolveMiraDirectFactualTopic(classificationMessage)
      : null;

  const directEntityRequest =
    /\b(?:tell me about|what (?:is|are|does)|explain|describe|details?|detailed information|elaborate|everything)\b/i.test(
      classificationMessage,
    ) || responseMode.capabilityRequest;
  const implementationSpecificRequest =
    /\b(?:integrat(?:e|es|ed|ion)|connect(?:s|ed|ion)?|sync(?:s|ed)?|how long|timeline|timeframe)\b/i.test(
      classificationMessage,
    );
  const directEntityResolution =
    directEntityRequest || implementationSpecificRequest
    ? resolveMiraEntityText(classificationMessage)
    : null;
  const focusedEntity = hasExplicitSingleEntityFocus
    ? earlyExplicitEntityResolution.match.entity
    : continuedFocusedEntity;
  const focusedEntityDepth =
    ENTITY_DEPTH_CONTINUATION.test(classificationMessage) ||
    /\b(?:detail|detailed|everything|elaborate|expand|deeper|further)\b/i.test(
      classificationMessage,
    )
      ? "detailed"
      : "normal";
  const focusedEntityState = focusedEntity
    ? {
        entityId: focusedEntity.id,
        entityType: focusedEntity.type,
        source: hasExplicitSingleEntityFocus
          ? "explicit_current"
          : "follow_up_reference",
        requestedDepth: focusedEntityDepth,
      }
    : null;
  const interpretationMessage = premiseCheck.interpretationMessage;
  const comparisonInterpretationMessage = contextualComparisonFocusedEntity
    ? interpretationMessage.replace(
        /\bit\b/i,
        contextualComparisonFocusedEntity.label,
      )
    : interpretationMessage;
  const referenceResolution = resolveMiraConversationReference(
    classificationMessage,
    relevantConversationHistory,
  );
  const retrievalMessage = buildContextualRetrievalMessage(
    goalAwareMessage,
    relevantConversationHistory,
  );
  const activeSubject = resolveActiveSubject(
    classificationMessage,
    relevantConversationHistory,
  );
  const comparisonIntent =
    !hasExplicitSingleEntityFocus &&
    (isMiraContextualComparisonFollowUp(classificationMessage) ||
      (responseMode.mode === "comparison" &&
        (isMiraComparisonIntent(classificationMessage) ||
          isComparisonIntent(classificationMessage) ||
          (historyHasPlatformOptions(relevantConversationHistory) &&
            /\b(which one|which is better|which one is better|how (?:is|are) (?:that|they|those) different)\b/i.test(
              classificationMessage,
            )))));
  const initialLocalResult = {
    ...localHarness(retrievalMessage),
    question: message,
    originalMessage: messageNormalization.originalMessage,
    normalizedMessage: classificationMessage,
  };
  if (allowMiraBoundaryQuestion) {
    initialLocalResult.riskFlags = initialLocalResult.riskFlags.filter(
      (flag) => flag !== "business_specific_review",
    );
  }
  const unsupportedResolution = unsupportedImplementationAnswer(
    classificationMessage,
    directEntityResolution,
    initialLocalResult.matchedEntries,
  );
  const listingResolution =
    (directEntityResolution?.status === "resolved" &&
      !/\b(?:list|all)\b/i.test(classificationMessage) &&
      !responseMode.capabilityRequest) ||
    (/\b(?:main platforms|platforms do you offer|your platforms)\b/i.test(
      classificationMessage,
    ) && !/\bservices?\b/i.test(classificationMessage))
      ? null
      : resolveMiraListingRequest(
          classificationMessage,
          relevantConversationHistory,
        );
  const namesOnlyResolution =
    responseMode.mode === "names_only" &&
    responseMode.answerShape !== "capability_names_only"
      ? resolveMiraNamesOnly(classificationMessage, relevantConversationHistory)
      : null;
  const responseModeFastPath = resolveMiraResponseModeFastPath(
    classificationMessage,
    responseMode,
  );
  const relevantFactResolution = resolveMiraRelevantFacts(classificationMessage);
  const recommendationResolution = frameMiraGoalRecommendation(
    resolveMiraRecommendation(goalAwareMessage, relevantConversationHistory),
    businessGoalResolution,
    businessGoalEvidence,
  );
  const comparisonResolution = comparisonIntent
    ? resolveMiraComparison(
        comparisonInterpretationMessage,
        relevantConversationHistory,
      )
    : null;
  const decisionResolution = frameMiraGoalRecommendation(
    resolveMiraDecisionRequest(
      classificationMessage,
      relevantConversationHistory,
    ),
    businessGoalResolution,
  );
  const compoundResolution = composeMiraCompoundAnswer({
    decomposition: requestDecomposition,
    decisionResolution,
    comparisonResolution,
    recommendationResolution,
  });
  let localResult = comparisonIntent
    ? withPlatformComparisonContext(initialLocalResult)
    : withActiveSubjectPriority(initialLocalResult, activeSubject);

  if (namesOnlyResolution && !localResult.riskFlags.length) {
    localResult = {
      ...localResult,
      confidence: "high",
      matchedEntries: namesOnlyResolution.matchedEntries,
      answerSeed: namesOnlyResolution.answer,
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
      resolvedConversationEntities: namesOnlyResolution.entities,
      listingHandled: true,
      clarificationNeeded: false,
      answerStructureKind: "",
      fastPathHandled: true,
    };
  } else if (responseModeFastPath && !localResult.riskFlags.length) {
    localResult = {
      ...localResult,
      confidence: "high",
      matchedEntries: responseModeFastPath.matchedEntries,
      answerSeed: responseModeFastPath.answer,
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
      resolvedConversationEntities: responseModeFastPath.entities,
      clarificationNeeded: false,
      answerStructureKind: "",
      fastPathHandled: true,
    };
  } else if (
    compoundFactualResolution &&
    recommendationResolution &&
    !localResult.riskFlags.length
  ) {
    const combinedEntries = [
      ...compoundFactualResolution.matchedEntries,
      ...recommendationResolution.matchedEntries,
    ].filter(
      (entry, index, entries) =>
        entries.findIndex((candidate) => candidate.id === entry.id) === index,
    );
    const combinedEntities = [
      ...compoundFactualResolution.entities,
      ...recommendationResolution.entities,
    ].filter(
      (entity, index, entities) =>
        entities.findIndex((candidate) => candidate.id === entity.id) === index,
    );
    const recommendationAnswer =
      recommendationResolution.recommendation.status === "recommended"
        ? recommendationResolution.answer
        : [relevantFactResolution?.answer, recommendationResolution.answer]
            .filter(Boolean)
            .join("\n");
    localResult = {
      ...localResult,
      confidence:
        recommendationResolution.recommendation.status === "recommended"
          ? "high"
          : "low",
      matchedEntries: combinedEntries,
      answerSeed: [compoundFactualResolution.answer, recommendationAnswer]
        .filter(Boolean)
        .join("\n\n"),
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
      resolvedConversationEntities: combinedEntities,
      recommendation: recommendationResolution.recommendation,
      recommendationHandled: true,
      directAnswerEligible: true,
      compoundRequestHandled: true,
      clarificationNeeded:
        recommendationResolution.recommendation.status === "needs_clarification",
      answerStructureKind: "",
    };
  } else if (unsupportedResolution && !localResult.riskFlags.length) {
    const unsupportedEntities = unsupportedResolution.entity
      ? [unsupportedResolution.entity]
      : [];
    const matchedEntries = matchedEntriesForConversationEntities(
      unsupportedEntities,
    );
    localResult = {
      ...localResult,
      confidence: "low",
      matchedEntries,
      answerSeed: unsupportedResolution.answer,
      handoffNeeded: true,
      handoffReason: "unsupported_implementation_detail",
      suggestedFollowUps: [],
      resolvedConversationEntities: unsupportedEntities,
      clarificationNeeded: false,
      unsupportedHandled: true,
    };
  } else if (focusedEntity && !localResult.riskFlags.length) {
    const focusedEntries = matchedEntriesForConversationEntities([
      focusedEntity,
    ]);
    localResult = {
      ...localResult,
      confidence: focusedEntries.length ? "high" : "low",
      matchedEntries: focusedEntries,
      answerSeed:
        focusedEntityDepth === "detailed"
          ? detailedEntityAnswer(focusedEntity, focusedEntries)
          : answerSeedForEntity(focusedEntity, focusedEntries),
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
      resolvedConversationEntities: [focusedEntity],
      focusedEntity: focusedEntityState,
      entityFocusHandled: true,
      clarificationNeeded: false,
      answerStructureKind: "",
    };
  } else if (compoundResolution && !localResult.riskFlags.length) {
    localResult = {
      ...localResult,
      confidence: "high",
      matchedEntries: compoundResolution.matchedEntries,
      answerSeed: compoundResolution.answer,
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
      resolvedConversationEntities: compoundResolution.entities,
      requestDecomposition,
      offeringCoverage: compoundResolution.offeringCoverage,
      addressedActions: compoundResolution.addressedActions,
      recommendation: compoundResolution.recommendation,
      comparison: comparisonResolution?.comparison,
      recommendationHandled: Boolean(compoundResolution.recommendation),
      comparisonHandled: Boolean(comparisonResolution),
      compoundRequestHandled: true,
      clarificationNeeded: false,
      answerStructureKind: "",
    };
  } else if (listingResolution && !localResult.riskFlags.length) {
    localResult = {
      ...localResult,
      confidence: "high",
      matchedEntries: listingResolution.matchedEntries,
      answerSeed:
        responseMode.mode === "detailed_explanation" &&
        listingResolution.capabilitySummary
          ? listAnswerSeedForEntities(
              listingResolution.entities,
              listingResolution.matchedEntries,
            )
          : listingResolution.answer,
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
      resolvedConversationEntities: listingResolution.entities,
      listingIntent: listingResolution.intent,
      listingHandled: true,
      clarificationNeeded: false,
      answerStructureKind:
        responseMode.mode !== "detailed_explanation" &&
        listingResolution.capabilitySummary
          ? ""
          : listingResolution.intent === "list_services_and_platforms" ||
              listingResolution.intent === "reorganize_previous_list"
          ? ""
          : "list",
    };
  } else if (relevantFactResolution && !localResult.riskFlags.length) {
    localResult = {
      ...localResult,
      confidence: "high",
      matchedEntries: relevantFactResolution.matchedEntries,
      answerSeed: relevantFactResolution.answer,
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
      resolvedConversationEntities: relevantFactResolution.entities,
      evidenceSelection: relevantFactResolution.evidenceSelection,
      evidenceQueryHandled: true,
      clarificationNeeded: false,
      answerStructureKind:
        relevantFactResolution.entities.length > 1 ? "list" : "",
    };
  } else if (decisionResolution && !localResult.riskFlags.length) {
    localResult = {
      ...localResult,
      confidence: "high",
      matchedEntries: decisionResolution.matchedEntries,
      answerSeed: decisionResolution.answer,
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
      recommendation: decisionResolution.recommendation,
      resolvedConversationEntities: decisionResolution.entities,
      recommendationHandled: true,
      clarificationNeeded: false,
      answerStructureKind: "recommendation",
      decisionIntent: decisionResolution.decisionIntent,
    };
  } else if (comparisonResolution && !localResult.riskFlags.length) {
    localResult = {
      ...localResult,
      confidence:
        comparisonResolution.comparison.status === "complete" ? "high" : "low",
      matchedEntries: comparisonResolution.matchedEntries,
      answerSeed: comparisonResolution.answer,
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
      comparison: comparisonResolution.comparison,
      resolvedConversationEntities: comparisonResolution.entities,
      comparisonHandled: true,
      decisionIntent: classifyMiraDecisionIntent(
        classificationMessage,
        relevantConversationHistory,
      ).decisionIntent,
      clarificationNeeded:
        comparisonResolution.comparison.status === "needs_clarification",
      answerStructureKind:
        comparisonResolution.comparison.status === "complete"
          ? "comparison"
          : "",
    };
  } else if (
    directEntityResolution?.status === "resolved" &&
    !localResult.riskFlags.length
  ) {
    localResult = withResolvedConversationEntities(localResult, {
      entities: [directEntityResolution.match.entity],
      isComparison: false,
      isList: false,
    });
  } else if (
    referenceResolution.kind === "resolved" &&
    !localResult.riskFlags.length
  ) {
    localResult = withResolvedConversationEntities(
      localResult,
      referenceResolution,
    );
  } else if (
    referenceResolution.kind === "none" &&
    /\b(main platforms|platforms do you offer|your platforms)\b/i.test(
      classificationMessage,
    )
  ) {
    localResult = withPlatformEntities(localResult);
  } else if (
    referenceResolution.kind === "none" &&
    /\b(main offerings|offerings do you have|offerings do you offer|your offerings)\b/i.test(
      classificationMessage,
    )
  ) {
    localResult = withMainOfferingEntities(localResult);
  } else if (
    recommendationResolution &&
    referenceResolution.kind !== "resolved" &&
    !localResult.riskFlags.length
  ) {
    localResult = {
      ...localResult,
      confidence:
        recommendationResolution.recommendation.status === "recommended"
          ? "high"
          : "low",
      matchedEntries: recommendationResolution.matchedEntries,
      answerSeed: recommendationResolution.answer,
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
      recommendation: recommendationResolution.recommendation,
      relationToPreviousTurn:
        recommendationResolution.topicShift.relationToPreviousTurn,
      requirementState: recommendationResolution.requirementState,
      missingRequirements: recommendationResolution.missingRequirements,
      recommendationReady: recommendationResolution.recommendationReady,
      recommendationReadiness:
        recommendationResolution.recommendationReadiness,
      decisionState: recommendationResolution.decisionState,
      resolvedConversationEntities: recommendationResolution.entities,
      recommendationHandled: true,
      clarificationNeeded:
        recommendationResolution.recommendation.status ===
        "needs_clarification",
      answerStructureKind:
        recommendationResolution.recommendation.status === "recommended"
          ? "recommendation"
          : "",
    };
  }

  if (
    responseMode.capabilityRequest &&
    !["detailed_explanation", "comparison", "recommendation"].includes(
      responseMode.mode,
    ) &&
    localResult.resolvedConversationEntities?.length &&
    !localResult.compoundRequestHandled &&
    !localResult.comparisonHandled &&
    !localResult.recommendationHandled &&
    !localResult.entityFocusHandled &&
    !localResult.riskFlags.length
  ) {
    const capabilityNamesOnly =
      responseMode.answerShape === "capability_names_only";
    localResult = {
      ...localResult,
      answerSeed: capabilityNamesOnly
        ? capabilityNamesAnswerForEntities(
            localResult.resolvedConversationEntities,
          )
        : capabilitySummaryAnswerForEntities(
            localResult.resolvedConversationEntities,
          ),
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
      answerStructureKind: "",
      capabilitySummaryHandled: true,
      fastPathHandled: true,
    };
  }


  localResult = applyMiraAdaptiveDiscovery({
    message: classificationMessage,
    conversationHistory: relevantConversationHistory,
    businessGoals: businessGoalResolution.businessGoals,
    responseMode,
    comparisonIntent,
    localResult,
  });
  if (
    ((referenceResolution.kind === "clarification" &&
      (referenceResolution.hadEntityContext ||
        !relevantConversationHistory.length)) ||
      (referenceResolution.kind !== "resolved" &&
        needsFollowUpClarification(
          classificationMessage,
          relevantConversationHistory,
        ))) &&
    !localResult.riskFlags.length &&
    !localResult.recommendationHandled &&
    !localResult.comparisonHandled &&
    !localResult.listingHandled &&
    !localResult.unsupportedHandled &&
    !localResult.entityFocusHandled &&
    !localResult.fastPathHandled
  ) {
    localResult = {
      ...localResult,
      confidence: "low",
      matchedEntries: [],
      answerSeed:
        referenceResolution.clarification ||
        "Which platforms or services would you like me to compare?",
      handoffNeeded: false,
      handoffReason: "",
      suggestedFollowUps: [],
      clarificationNeeded: true,
    };
  }
  localResult = applyMiraPremiseCorrections(localResult, premiseCheck);

  localResult = localResult.adaptiveDiscoveryHandled
    ? localResult
    : applyMiraEvidenceSelection(localResult, {
        initialMatchedEntries: initialLocalResult.matchedEntries,
      });

  const semanticSupplementProtected = Boolean(
    localResult.entityFocusHandled ||
    localResult.listingHandled ||
    localResult.adaptiveDiscoveryHandled ||
    isTrustPostureFaq ||
    localResult.comparison?.status === "complete" ||
    localResult.recommendation ||
    responseMode.mode === "acknowledgement",
  );
  const semanticSupplementEligible = localResult.riskFlags.every(
    (flag) => ["out_of_scope", "business_specific_review"].includes(flag),
  )
    && !semanticSupplementProtected
    && typeof semanticIntentProvider === "function"
    && config?.mode === STAGING_LLM_MODE
    && config?.provider === "openai"
    && config.providerConfigComplete;
  if (semanticSupplementEligible) {
    let semanticResolution = earlySemanticResolution ||
      await resolveMiraSemanticIntent({
        message: classificationMessage,
        conversationHistory,
        semanticIntentProvider,
        config,
      });
    let semanticRetryCount = 0;
    const semanticIntentNeedsRetry = () => !semanticResolution.ok || Boolean(
      semanticResolution.intent?.clarificationNeeded &&
      !semanticResolution.intent?.topic &&
      ["", "unknown"].includes(semanticResolution.intent?.domain || ""),
    );
    while (semanticIntentNeedsRetry() && semanticRetryCount < 2) {
      semanticRetryCount += 1;
      semanticResolution = await resolveMiraSemanticIntent({
        message: classificationMessage,
        conversationHistory,
        semanticIntentProvider,
        config,
      });
    }
    const semanticIntent = semanticResolution.intent;
    const semanticTopicParts = String(semanticIntent.topic || "")
      .split(/[|;]/)
      .map((part) => part.trim())
      .filter(Boolean);
    const semanticTopicMatchesApprovedKnowledge = semanticTopicParts.some((topic) =>
      onesmarterPublicKnowledgeBase.some(({ title }) => title === topic),
    );
    const semanticCanonicalEvidenceEligible = semanticTopicMatchesApprovedKnowledge &&
      ![
        "meaningless_input",
        "person_specific",
        "customer_strategy",
        "unsupported_business_request",
        "unsupported_factual_request",
        "unrelated_factual",
      ].includes(semanticIntent.domain);
    if (!semanticResolution.ok) {
      localResult = {
        ...localResult,
        ...(["provider_failure", "provider_unavailable"].includes(semanticResolution.error)
          ? {}
          : semanticOutOfScopeFallback({ clarificationNeeded: true })),
        semanticIntentSupplement: semanticIntent,
      };
    } else if (semanticIntent.domain === "conversational_acknowledgement" && !semanticIntent.clarificationNeeded) {
      localResult = {
        ...localResult,
        confidence: "high",
        matchedEntries: [],
        answerSeed: acknowledgementAnswerFor(classificationMessage),
        handoffNeeded: false,
        handoffReason: "",
        suggestedFollowUps: [],
        clarificationNeeded: false,
        semanticIntentSupplement: semanticIntent,
        semanticAcknowledgementHandled: true,
      };
    } else if ([
      "general_definition", "general_education", "privacy_general", "unrelated_factual",
      "meaningless_input", "person_specific", "customer_strategy",
      "unsupported_business_request", "unsupported_factual_request",
    ].includes(semanticIntent.domain) && !semanticCanonicalEvidenceEligible) {
      localResult = {
        ...localResult,
        ...semanticOutOfScopeFallback(semanticIntent),
        semanticIntentSupplement: semanticIntent,
      };
    } else if (
      semanticIntent.clarificationNeeded &&
      semanticIntent.questionType === "comparison"
    ) {
      const listedComparison = listingResolution?.entities?.length >= 2
        ? resolveMiraComparison(
            listingResolution.entities.map(({ label }) => label).join(" versus "),
            relevantConversationHistory,
          )
        : (() => {
            const categoryEntities =
              approvedCategoryEntitiesForSemanticComparison(semanticIntent);
            return categoryEntities.length >= 2
              ? resolveMiraComparison(
                  categoryEntities.map(({ label }) => label).join(" versus "),
                  relevantConversationHistory,
                )
              : null;
          })();
      localResult = listedComparison?.comparison?.status === "complete"
        ? {
            ...localResult,
            confidence: "high",
            matchedEntries: listedComparison.matchedEntries,
            answerSeed: listedComparison.answer,
            comparison: listedComparison.comparison,
            resolvedConversationEntities: listedComparison.entities,
            clarificationNeeded: false,
            answerStructureKind: "comparison",
            semanticIntentSupplement: semanticIntent,
          }
        : localResult.comparisonHandled
        ? {
            ...localResult,
            semanticIntentSupplement: semanticIntent,
          }
        : {
            ...localResult,
            ...semanticOutOfScopeFallback(semanticIntent),
            semanticIntentSupplement: semanticIntent,
          };
    } else if (
      !semanticResolution.domainAllowed ||
      (semanticIntent.clarificationNeeded && !semanticCanonicalEvidenceEligible)
    ) {
      localResult = {
        ...localResult,
        ...semanticOutOfScopeFallback(semanticIntent),
        semanticIntentSupplement: semanticIntent,
      };
    } else {
      const semanticComparison =
        semanticIntent.questionType === "comparison" &&
        semanticIntent.confidence >= 0.7
          ? resolveMiraComparison(
              semanticQueryFor(semanticIntent),
              relevantConversationHistory,
            )
          : null;
      const semanticEntityText = (semanticIntent.entities || [])
        .map((entity) => String(entity).toLowerCase())
        .join(" ");
      const comparisonMatchesIntent =
        semanticComparison?.comparison?.status === "complete" &&
        semanticComparison.entities.every(({ label }) =>
          semanticEntityText.includes(label.toLowerCase()) ||
          label.toLowerCase().includes(semanticEntityText),
        );
      if (comparisonMatchesIntent) {
        localResult = {
          ...localResult,
          confidence: "high",
          matchedEntries: semanticComparison.matchedEntries,
          answerSeed: semanticComparison.answer,
          handoffNeeded: false,
          handoffReason: "",
          suggestedFollowUps: [],
          comparison: semanticComparison.comparison,
          resolvedConversationEntities: semanticComparison.entities,
          comparisonHandled: true,
          clarificationNeeded: false,
          answerStructureKind: "comparison",
          semanticIntentSupplement: semanticIntent,
          fastPathHandled: false,
        };
      } else {
        let effectiveSemanticIntent = semanticIntent;
        let supplemented = semanticEvidenceFor(effectiveSemanticIntent, localHarness);
        if (supplemented.semanticEvidenceAmbiguous) {
          const refinement = await resolveMiraSemanticIntent({
            message: classificationMessage,
            conversationHistory,
            semanticIntentProvider,
            config,
            topicCandidates: supplemented.semanticEvidenceCandidateTitles,
          });
          const refinedTopic = refinement.ok && refinement.domainAllowed
            ? supplemented.semanticEvidenceCandidateTitles.find(
                (title) => title === refinement.intent.topic,
              )
            : "";
          if (refinedTopic) {
            effectiveSemanticIntent = {
              ...semanticIntent,
              topic: refinedTopic,
            };
            supplemented = semanticEvidenceFor(effectiveSemanticIntent, localHarness);
          }
        }
        const approvedSemanticEvidence = { ...supplemented };
        delete approvedSemanticEvidence.semanticEvidenceAmbiguous;
        delete approvedSemanticEvidence.semanticEvidenceCandidateTitles;
      const currentIds = new Set(localResult.matchedEntries.map(({ id }) => id));
      const evidenceChanged = approvedSemanticEvidence.matchedEntries.some(({ id }) => !currentIds.has(id));
      const canonicalSelectionChanged = supplemented.semanticCanonicalSelection &&
        effectiveSemanticIntent.confidence >= 0.7 &&
        !effectiveSemanticIntent.clarificationNeeded &&
        (evidenceChanged || currentIds.size !== approvedSemanticEvidence.matchedEntries.length);
      const evidenceOverlaps = approvedSemanticEvidence.matchedEntries.some(({ id }) => currentIds.has(id));
      const framingRequiresSemanticAnswer = Boolean(
        effectiveSemanticIntent.confidence >= 0.7 &&
        (
          effectiveSemanticIntent.polarity === "negative" ||
          effectiveSemanticIntent.negationScope.length > 0 ||
          [
            "positive_yes_no",
            "negative_confirmation",
            "status",
            "scope_check",
            "why",
            "how",
            "comparison",
            "follow_up",
          ].includes(
            effectiveSemanticIntent.questionType,
          ) ||
          effectiveSemanticIntent.followUpReferences.length > 0
        ),
      );
      const semanticMismatch = localResult.clarificationNeeded ||
        localResult.confidence === "low" ||
        canonicalSelectionChanged ||
        (evidenceChanged && !evidenceOverlaps) ||
        framingRequiresSemanticAnswer;
      if (semanticMismatch && approvedSemanticEvidence.matchedEntries.length) {
        localResult = {
          ...approvedSemanticEvidence,
          question: message,
          confidence: "high",
          riskFlags: localResult.riskFlags,
          fastPathHandled: false,
          entityFocusHandled: false,
          listingHandled: false,
          evidenceQueryHandled: false,
          adaptiveDiscoveryHandled: false,
          semanticIntentSupplement: effectiveSemanticIntent,
          answerSeed: semanticFallbackFor(
            effectiveSemanticIntent,
            approvedSemanticEvidence.matchedEntries,
          ),
          clarificationNeeded: false,
        };
      } else {
        localResult = {
          ...localResult,
          semanticIntentSupplement: effectiveSemanticIntent,
        };
      }
      }
    }
  }
  const effectiveResponseMode = localResult.unsupportedHandled
    ? {
        ...responseMode,
        mode: "unsupported_request",
        budget: RESPONSE_MODE_BUDGETS.unsupported_request,
      }
    : localResult.clarificationNeeded &&
        !["comparison", "recommendation"].includes(responseMode.mode)
      ? {
          ...responseMode,
          mode: "clarification_response",
          budget: RESPONSE_MODE_BUDGETS.clarification_response,
        }
      : responseMode;
  const semanticEvidenceEntityTypes = localResult.semanticIntentSupplement
    ? [...new Set(
        (localResult.matchedEntries || [])
          .map(({ id }) => groundedConversationEntityForId(id, { includeChildren: false })?.type)
          .filter((type) => ["platform", "service"].includes(type)),
      )]
    : [];
  const semanticEntityCategoryScope = localResult.semanticIntentSupplement
    ? semanticEvidenceEntityTypes.length === 1
      ? semanticEvidenceEntityTypes[0]
      : ""
    : effectiveResponseMode.entityCategoryScope;
  localResult = {
    ...localResult,
    messageNormalization,
    businessGoals: businessGoalResolution.businessGoals,
    businessGoalConfidence: businessGoalResolution.confidence,
    businessGoalAmbiguous: businessGoalResolution.ambiguous,
    businessGoalEvidence,
    requestDecomposition,
    responseMode: {
      ...effectiveResponseMode,
      entityCategoryScope: semanticEntityCategoryScope,
      fastPath: Boolean(
        localResult.entityFocusHandled ||
        localResult.fastPathHandled ||
          localResult.listingHandled ||
        localResult.evidenceQueryHandled ||
        localResult.semanticAcknowledgementHandled ||
          (directEntityResolution?.status === "resolved" &&
            responseMode.mode !== "detailed_explanation") ||
          referenceResolution.kind === "resolved",
      ),
      skipModel:
        Boolean(
          localResult.entityFocusHandled &&
            (localResult.focusedEntity?.source === "follow_up_reference" ||
              faqResolution),
        ) ||
        Boolean(localResult.semanticAcknowledgementHandled) ||
        (Boolean(localResult.fastPathHandled) &&
          (effectiveResponseMode.mode === "names_only" ||
            effectiveResponseMode.answerShape === "capability_summary")),
    },
    turnContext: {
      ...turnContext,
      currentTurnAnswerability: currentTurnAnswerabilityFor(localResult),
    },
  };

  if (
    config?.mode === STAGING_LLM_MODE &&
    (config?.provider === "openai" || config?.provider === "ollama")
  ) {
    if (localResult.responseMode.skipModel && config?.provider !== "ollama") {
      return {
        ...localResult,
        mode: LOCAL_HARNESS_MODE,
        fallbackUsed: false,
        fallbackReason: "",
      };
    }
    if (localResult.clarificationNeeded && !localResult.contextualGeneralKnowledge) {
      return withFallbackMetadata(localResult, "follow_up_clarification");
    }

    if (hasClaimBoundaryRisk(localResult.riskFlags)) {
      return withClaimBoundaryMetadata(localResult);
    }

    if (!config.providerConfigComplete) {
      return withFallbackMetadata(localResult, "missing_provider_config");
    }

    if (hasOutOfScopeRisk(localResult.riskFlags) && !localResult.contextualGeneralKnowledge) {
      return withFallbackMetadata(localResult, "out_of_scope");
    }

    if (hasHardStopRisk(localResult.riskFlags)) {
      return withFallbackMetadata(localResult, "pre_call_safety_gate");
    }

    if (!hasApprovedContext(localResult) && !localResult.contextualGeneralKnowledge) {
      return withFallbackMetadata(localResult, "no_adequate_approved_context");
    }

    const requestContext = {
      persona: typeof persona === "string" ? persona : "",
      memoryTheme: typeof memoryTheme === "string" ? memoryTheme : "",
      empathyState: typeof empathyState === "string" ? empathyState : "",
      responseGuidance: localResult.contextualGeneralKnowledge
        ? "This is the narrowly authorized general-information path. Give a concise one- or two-sentence conventional dictionary-level explanation of the interpreted topic even though no OneSmarter evidence was retrieved. State clearly that it is general information, not OneSmarter-specific information. Do not add current or time-sensitive facts, professional advice, citations, recommendations, or claims about OneSmarter. Set groundingStatus to insufficient_context and handoffNeeded to true."
        : localResult.premiseCheck?.corrections?.length
        ? "Begin with the supplied grounded premise correction, then answer the useful underlying request. Do not accept the corrected premise elsewhere in the response."
        : localResult.entityFocusHandled
        ? "Answer only about the single focused entity represented by the approved context. Preserve the requested depth, do not expand to sibling offerings or a parent catalog, and do not invent details beyond the supplied evidence."
        : localResult.adaptiveDiscoveryHandled
        ? "Preserve the grounded preliminary guidance and ask exactly the one decision-critical question supplied by the local answer plan. Do not add other questions or assume the missing fact."
        : localResult.comparison
        ? "Provide only the grounded comparison and decision guidance represented by the supplied approved context. Do not invent pricing, integrations, implementation timelines, performance claims, guarantees, or unsupported limitations."
        : localResult.recommendation
        ? "Provide only the grounded recommendation represented by the supplied approved context. Do not invent features, pricing, timelines, integrations, guarantees, or compliance claims."
        : localResult.evidenceQueryHandled
        ? "Answer only with the selected primary evidence for the current question. Do not add loosely related offerings or historical topics."
        : referenceResolution.isComparison
        ? `Compare only these selected grounded entities: ${referenceResolution.entities
            .map((entity) => entity.label)
            .join(" and ")}. Use only the approved context supplied for them.`
        : localResult.semanticIntentSupplement?.questionType === "comparison"
        ? "Compare only the approved entities or service categories represented by the validated semantic request and supplied approved context. Cover both sides of the comparison. Do not substitute unrelated platforms, categories, or offerings."
        : comparisonIntent
        ? [
            "Return a concise side-by-side comparison with headings for Secure Ticketing and Case Management and Bill Audit & Bill Pay.",
            "Give each platform 2-4 bullets from approved context.",
            "Include a short key-difference summary.",
            "Do not expose source-note wording such as related topics, route guidance, retrieved context, or page language.",
          ].join(" ")
        : responseMode.mode === "overview"
        ? responseMode.answerShape === "brief"
          ? "Give a company overview in 1-3 sentences with no headings, detailed service catalog, Important context or Important note section, contact guidance, or handoff line."
          : "Give a concise company overview using only the strongest approved areas. Do not turn the answer into a comparison or a full service catalog, and do not add contact guidance unless the request requires handoff."
        : responseMode.mode === "detailed_explanation"
        ? "Give a focused detailed explanation of only the current topic. Exclude unrelated services and preserve primary-evidence priority."
        : responseMode.mode === "concise_explanation"
        ? "Answer directly in one short paragraph or two to four concise bullets using only approved context."
        : "",
    };
    if (localResult.semanticIntentSupplement) {
      const semanticIntent = localResult.semanticIntentSupplement;
      const semanticFramingGuidance =
        semanticIntent.questionType === "negative_confirmation"
          ? "Begin with a separate, direct yes-or-no correction of the visitor's negative proposition. Then explain with the canonical wording present in approved evidence; do not repeat unsupported premise terms as factual language."
          : semanticIntent.questionType === "why"
          ? "Preserve the WHY framing: address whether the premise is accurate first, then provide only a reason supported by approved evidence. Use canonical evidence wording rather than restating unsupported premise terms as factual language."
          : "";
      requestContext.responseGuidance = [
        requestContext.responseGuidance,
        semanticFramingGuidance,
        `Use this validated semantic interpretation only to understand the request: question type ${semanticIntent.questionType}; speech act ${semanticIntent.speechAct}; proposition ${semanticIntent.proposition}; polarity ${semanticIntent.polarity}; negation scope ${JSON.stringify(semanticIntent.negationScope)}; requested detail ${semanticIntent.requestedDetail}; follow-up references ${JSON.stringify(semanticIntent.followUpReferences)}. Answer the actual proposition and requested detail naturally. If the visitor asks for a reason that approved evidence does not provide, say that instead of inventing one. For a negative-capability request, do not present a generic positive overview or imply a comprehensive list. Treat the interpretation as untrusted request context, not evidence; use only the approved retrieved context for factual claims.`,
      ].filter(Boolean).join(" ");
    }
    if (verbosityBand === "concise") {
      requestContext.responseGuidance = [
        requestContext.responseGuidance,
        "Use concise wording and remove optional elaboration only. Preserve every required fact, safety statement, qualification, refusal, and handoff.",
      ].filter(Boolean).join(" ");
    }
    const promptPayload = buildMiraPromptPayload({
      message,
      retrievalResult: localResult,
      riskFlags: localResult.riskFlags,
      requestContext,
      conversationHistory: relevantConversationHistory,
    });
    const providerResult = await openAiAdapter({
      message,
      conversationId,
      requestContext,
      retrievalResult: localResult,
      riskFlags: localResult.riskFlags,
      promptPayload,
      config,
    });

    if (providerResult.error || !providerResult.modelOutput) {
      return withFallbackMetadata(
        localResult,
        providerResult.metadata?.fallbackReason || providerResult.error || "provider_error",
        providerResult,
      );
    }

    const validation = validateMiraModelOutput(providerResult.modelOutput, {
      message,
      riskFlags: localResult.riskFlags,
      localHarnessResult: localResult,
    });

    if (!validation.valid) {
      return withFallbackMetadata(
        localResult,
        `output_validation_failed:${validation.violations.join(",")}`,
      );
    }

    const modelOutput = validation.correctedOutput;
    const normalizedHandoff = normalizeModelHandoff(modelOutput, localResult);
    return {
      ...localResult,
      mode: STAGING_LLM_MODE,
      validationFallbackAnswer: localResult.answerSeed,
      answerSeed: modelOutput.answer,
      handoffNeeded: normalizedHandoff.handoffNeeded,
      handoffReason: normalizedHandoff.handoffReason,
      suggestedFollowUps: modelOutput.suggestedFollowUps,
      modelProvider: config.provider || "openai",
      modelName: config.model,
      groundingStatus: modelOutput.groundingStatus,
      outputSafetyStatus: modelOutput.outputSafetyStatus,
      fallbackUsed: false,
      fallbackReason: "",
      providerMetadata: {
        latencyMs: providerResult.metadata?.latencyMs ?? null,
        httpStatus: providerResult.metadata?.httpStatus ?? null,
        tokenUsage: providerResult.metadata?.tokenUsage ?? null,
        providerStatus: providerResult.metadata?.providerStatus || "",
        providerResponseStatus: providerResult.metadata?.providerResponseStatus || "",
        providerIncompleteReason: providerResult.metadata?.providerIncompleteReason || "",
        providerOutputItemTypes: providerResult.metadata?.providerOutputItemTypes || [],
        providerContentPartTypes: providerResult.metadata?.providerContentPartTypes || [],
        providerHasRefusal: Boolean(providerResult.metadata?.providerHasRefusal),
        providerUsageInputTokens: providerResult.metadata?.providerUsageInputTokens ?? null,
        providerUsageOutputTokens: providerResult.metadata?.providerUsageOutputTokens ?? null,
        providerUsageReasoningTokens: providerResult.metadata?.providerUsageReasoningTokens ?? null,
      },
    };
  }

  return {
    ...localResult,
    mode: LOCAL_HARNESS_MODE,
    fallbackUsed: false,
    fallbackReason: "",
  };
};

export const runMiraResponseAdapter = async (options = {}) => {
  const generationAdapter =
    options.openAiAdapter ||
    (options.config?.provider === "ollama"
      ? runOllamaMiraAdapter
      : runOpenAiMiraAdapter);
  let generationAdapterCalls = 0;
  let generationMetadata;
  let semanticProviderCalls = 0;
  let semanticProviderCompleted = 0;
  const result = await runMiraResponseAdapterInternal({
    ...options,
    localHarness: (...args) => {
      const local = (options.localHarness || runMiraLocalHarness)(...args);
      return { ...local, matchedEntries: enrichMiraEvidence(local.matchedEntries) };
    },
    openAiAdapter: async (request) => {
      generationAdapterCalls += 1;
      const response = await generationAdapter(request);
      generationMetadata = response.metadata;
      return response;
    },
    semanticIntentProvider: typeof options.semanticIntentProvider === "function"
      ? async (...args) => {
          semanticProviderCalls += 1;
          const response = await options.semanticIntentProvider(...args);
          if (response?.intent) semanticProviderCompleted += 1;
          return response;
        }
      : options.semanticIntentProvider,
  });
  return {
    ...result,
    // Preserve transport evidence even when output validation uses a local answer.
    providerMetadata: result.providerMetadata || generationMetadata,
    executionTrace: { generationAdapterCalls, semanticProviderCalls, semanticProviderCompleted },
  };
};

export default runMiraResponseAdapter;
