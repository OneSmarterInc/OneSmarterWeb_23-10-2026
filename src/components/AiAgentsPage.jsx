import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMiraAnswerBlocks as formatStructuredMiraAnswerBlocks } from "../data/agentPresentation/miraAnswerFormatter.js";
import { cafePersonas } from "../data/agentPresentation/cafePersonas.js";
import { getCafeWeekBucket, isCafeConversationActive, selectCafeConversation } from "../data/cafeConversations/index.js";
import { cafeSeedTopics } from "../data/cafeSeedTopics.js";
import MiraPageReview from "./MiraPageReview.jsx";
import CafeConversationGenerator from "./CafeConversationGenerator.jsx";
import { Sparkles, CheckCheck, Coffee, Copy, Check, Send, Loader2, AtSign, Play, SkipForward } from "lucide-react";

const conversationExamples = [
  {
    id: "faq_company_overview",
    question: "What does OneSmarter do?",
    answer:
      "OneSmarter builds secure platforms, practical AI workflows, business services, and compliance readiness support for healthcare, financial, telecom, and growing organizations. The work is grounded in useful systems, trusted execution, and careful claim boundaries.",
  },
  {
    id: "faq_platforms",
    question: "What platforms do you offer?",
    answer:
      "OneSmarter currently presents two platform areas: Secure Ticketing and Case Management, and Bill Audit & Bill Pay. Telecom expense management is treated as a capability within Bill Audit & Bill Pay rather than a separate platform.",
  },
  {
    id: "faq_healthcare",
    question: "Do you work with healthcare organizations?",
    answer:
      "Yes. OneSmarter's experience includes healthcare workflows, claims-processing services, TPA support, secure case management, and compliance-aware operations. For specific healthcare or regulated-workflow questions, the right next step is to contact care@onesmarter.com.",
  },
  {
    id: "faq_soc2_attestation",
    question: "What does SOC 2 Type II Attested mean here?",
    answer:
      "OneSmarter uses the phrase SOC 2 Type II Attested to describe its trust posture. The Trust Center provides more context. For formal vendor, security, or procurement review, OneSmarter should provide the appropriate evidence through a direct business process.",
  },
  {
    id: "faq_hipaa_status",
    question: "Are you HIPAA certified?",
    answer:
      "A safer way to say this is that OneSmarter has completed a HIPAA Security Rule compliance assessment. OneSmarter does not present this as HIPAA certification. For regulated workflows, the Trust Center and a direct business review are the right next steps.",
  },
  {
    id: "faq_iso_readiness_vs_certification",
    question: "What is the difference between your readiness service and your own certification?",
    answer:
      "One Smarter Inc.'s ISO/IEC 27001:2022 certification is its own organizational credential for the certified scope stated in the Trust Center. ISO/IEC 27001 readiness support is a separate client-facing service that helps organizations prepare through ISMS documentation, control mapping, evidence preparation, and remediation coordination. Readiness support does not automatically certify a customer, and One Smarter Inc. does not issue ISO certificates.",
  },
  {
    id: "faq_contact",
    question: "How should I contact OneSmarter?",
    answer: "For business inquiries, email care@onesmarter.com.",
  },
];

const MIRA_INPUT_LIMIT = 500;
const MIRA_HISTORY_LIMIT = 6;
const MIRA_HISTORY_TOTAL_LIMIT = 2000;
const requestedCafeRestorationEvents = new Set();

const askMiraEndpoint = async (message, conversationHistory = [], suggestedQuestionId = "") => {
  const response = await fetch("/api/agents/mira/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      ...(suggestedQuestionId ? { suggestedQuestionId } : {}),
      conversationHistory,
      persona: "Warm Guide",
      memoryTheme: "Public website content",
      empathyState: "Welcoming",
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.message || "Mira endpoint request failed.");
    error.status = response.status;
    error.code = data.error;
    throw error;
  }
  return data;
};

const buildMiraConversationHistory = (turns) => {
  let totalChars = 0;
  const recentTurns = turns
    .filter(
      (turn) =>
        ["user", "assistant"].includes(turn.role) &&
        typeof turn.content === "string" &&
        turn.content.trim(),
    )
    .slice(-MIRA_HISTORY_LIMIT)
    .reverse();
  const history = [];

  for (const turn of recentTurns) {
    const content = turn.content.trim().slice(0, 700);
    if (totalChars + content.length > MIRA_HISTORY_TOTAL_LIMIT) continue;
    totalChars += content.length;
    history.push({
      role: turn.role,
      content,
      ...(turn.role === "assistant" && turn.response?.conversationEntities?.length
        ? { conversationEntities: turn.response.conversationEntities }
        : {}),
    });
  }

  return history.reverse();
};

const splitMiraParagraphs = (text) =>
  String(text || "")
    .split(/(?<=\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const formatMiraAnswerBlocks = (text) => {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+-\s+(?=[A-Z0-9])/g, "\n- ");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const blocks = [];
  let pendingBullets = [];

  const flushBullets = () => {
    if (pendingBullets.length) {
      blocks.push({ type: "list", items: pendingBullets });
      pendingBullets = [];
    }
  };

  for (const line of lines) {
    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      pendingBullets.push(bulletMatch[1].trim());
      continue;
    }

    flushBullets();

    if (/^[A-Z][A-Za-z0-9 &/,-]{2,48}:$/.test(line)) {
      blocks.push({ type: "heading", text: line.replace(/:$/, "") });
      continue;
    }

    const paragraphs = splitMiraParagraphs(line);
    if (paragraphs.length > 1 && line.length > 220) {
      blocks.push(...paragraphs.map((paragraph) => ({ type: "paragraph", text: paragraph })));
    } else {
      blocks.push({ type: "paragraph", text: line });
    }
  }

  flushBullets();
  return blocks.length ? blocks : [{ type: "paragraph", text }];
};

const getMiraAnswerBlocks = (content) => {
  const structuredBlocks = formatStructuredMiraAnswerBlocks(content);
  return structuredBlocks.length
    ? structuredBlocks
    : formatMiraAnswerBlocks(content);
};

const MiraFallbackAnswerContent = ({ content }) => (
  <div className="grid min-w-0 max-w-full gap-3 break-words [overflow-wrap:anywhere]">
    {getMiraAnswerBlocks(content).map((block, index) => {
      const key = `${block.type}-${index}`;
      if (block.type === "heading") {
        return (
          <p key={key} className="text-xs font-semibold uppercase tracking-wide text-red-200">
            {block.text}
          </p>
        );
      }
      if (block.type === "list") {
        return (
          <ul key={key} className="ml-5 min-w-0 max-w-full list-disc space-y-1 break-words [overflow-wrap:anywhere]">
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        );
      }
      if (block.type === "entity-section") {
        return (
          <section
            key={key}
            className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.04] p-4"
          >
            <div className="flex items-start gap-3">
              <span
                className="flex h-7 min-w-7 items-center justify-center rounded-full bg-red-600 px-2 text-xs font-bold text-white"
                aria-hidden="true"
              >
                {block.number}
              </span>
              <h3 className="pt-0.5 text-base font-bold leading-6 text-white">
                {block.heading}
              </h3>
            </div>
            {block.items.length ? (
              <ul className="ml-10 list-disc space-y-1.5 text-zinc-200">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      }
      if (block.type === "important-note") {
        return (
          <aside
            key={key}
            className="mt-1 rounded-lg border border-amber-300/25 bg-amber-400/10 p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-100">
              {block.heading}
            </p>
            {block.text ? <p className="mt-2 text-zinc-200">{block.text}</p> : null}
            {block.items.length ? (
              <ul className="mt-2 ml-4 list-disc space-y-1 text-zinc-200">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </aside>
        );
      }
      return <p key={key}>{block.text}</p>;
    })}
  </div>
);

const miraEntityTypeLabel = (entityType) =>
  String(entityType || "offering").replaceAll("_", " ");

const MiraStructuredSection = ({ section, nested = false }) => (
  <section
    className={
      nested
        ? "ml-0 grid min-w-0 max-w-full gap-2 border-l border-white/15 pl-3 sm:ml-4 sm:pl-4"
        : "grid min-w-0 max-w-full gap-3 overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] p-3 sm:p-4"
    }
  >
    <div className="flex items-start gap-3">
      {!nested && section.number ? (
        <span
          className="flex h-7 min-w-7 items-center justify-center rounded-full bg-red-600 px-2 text-xs font-bold text-white"
          aria-hidden="true"
        >
          {section.number}
        </span>
      ) : null}
      <div className="min-w-0 max-w-full">
        <h3 className="break-words text-base font-bold leading-6 text-white [overflow-wrap:anywhere]">
          {section.heading}
        </h3>
        {section.entityType ? (
          <p className="mt-1 break-words text-xs font-semibold uppercase tracking-wide text-red-200 [overflow-wrap:anywhere]">
            {miraEntityTypeLabel(section.entityType)}
          </p>
        ) : null}
      </div>
    </div>
    {section.summary ? (
      <p className={`${nested ? "text-sm text-zinc-300" : "ml-0 text-zinc-200 sm:ml-10"} break-words [overflow-wrap:anywhere]`}>
        {section.summary}
      </p>
    ) : null}
    {section.bullets?.length ? (
      <ul
        className={`${nested ? "ml-5" : "ml-5 sm:ml-14"} min-w-0 max-w-full list-disc space-y-1.5 break-words text-zinc-200 [overflow-wrap:anywhere]`}
      >
        {section.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
    ) : null}
    {section.children?.length ? (
      <div className="grid gap-3 pt-1">
        {section.children.map((child) => (
          <MiraStructuredSection key={child.id} section={child} nested />
        ))}
      </div>
    ) : null}
  </section>
);

const MiraStructuredAnswerContent = ({ structure }) => (
  <div className="grid min-w-0 max-w-full gap-4 overflow-x-hidden break-words [overflow-wrap:anywhere]">
    {structure.introduction ? (
      <p className="break-words [overflow-wrap:anywhere]">
        {structure.introduction}
      </p>
    ) : null}
    {structure.sections.map((section) => (
      <MiraStructuredSection key={section.id} section={section} />
    ))}
    {structure.importantNote ? (
      <aside className="rounded-lg border border-amber-300/25 bg-amber-400/10 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-100">
          Important note
        </p>
        <p className="mt-2 break-words text-zinc-200 [overflow-wrap:anywhere]">
          {structure.importantNote}
        </p>
      </aside>
    ) : null}
    {structure.followUpQuestion ? (
      <p className="max-w-full break-words rounded-lg border border-red-400/20 bg-red-950/20 p-3 font-medium text-red-100 [overflow-wrap:anywhere] sm:p-4">
        {structure.followUpQuestion}
      </p>
    ) : null}
  </div>
);

const MiraAnswerContent = ({ content, structure }) =>
  structure?.sections?.length ? (
    <MiraStructuredAnswerContent structure={structure} />
  ) : (
    <MiraFallbackAnswerContent content={content} />
  );

const PERSONA_CHAT_METADATA = {
  "theo-mercer": {
    initials: "TM",
    badgeColor: "bg-slate-700 text-slate-100 border-slate-500",
    nameColor: "text-sky-300",
    role: "Reserved & precise",
  },
  "elena-cross": {
    initials: "EC",
    badgeColor: "bg-amber-600/90 text-amber-50 border-amber-400",
    nameColor: "text-amber-300",
    role: "Witty & observant",
  },
  "ravi-sen": {
    initials: "RS",
    badgeColor: "bg-emerald-700 text-emerald-50 border-emerald-500",
    nameColor: "text-emerald-300",
    role: "Tactical & discursive",
  },
  "selene-hart": {
    initials: "SH",
    badgeColor: "bg-indigo-700 text-indigo-50 border-indigo-400",
    nameColor: "text-indigo-300",
    role: "Reflective & questioning",
  },
};

const getPersonaChatMeta = (id, fallbackName = "") => {
  if (PERSONA_CHAT_METADATA[id]) return PERSONA_CHAT_METADATA[id];
  const initials = fallbackName
    ? fallbackName
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "AI";
  return {
    initials,
    badgeColor: "bg-zinc-700 text-zinc-200 border-zinc-600",
    nameColor: "text-red-300",
    role: "AI Agent",
  };
};

const getLiveFormattedTime = (date) => {
  const d = date instanceof Date ? date : date ? new Date(date) : new Date();
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

const renderTextWithMentions = (text) => {
  if (typeof text !== "string") return "";
  const parts = text.split(/(@[A-Za-z]+(?:\s[A-Za-z]+)?)/g);
  return parts.map((part, index) => {
    if (part.startsWith("@")) {
      return (
        <span
          key={index}
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-semibold bg-red-500/20 text-red-200 border border-red-400/40 shadow-sm"
        >
          {part}
        </span>
      );
    }
    return part;
  });
};

const CafeConversationTranscript = ({ conversation, personaNames }) => {
  const [copied, setCopied] = useState(false);
  const [localExchanges, setLocalExchanges] = useState(
    conversation?.exchanges || [],
  );
  const [visitorInput, setVisitorInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendingStatusText, setSendingStatusText] = useState("");
  const [replyError, setReplyError] = useState("");
  const [showTagMenu, setShowTagMenu] = useState(false);

  // Preserve visitor-selected topic across session
  const [activeTopic, setActiveTopic] = useState(() => {
    try {
      const saved =
        typeof window !== "undefined"
          ? window.sessionStorage?.getItem("cafe_session_topic")
          : null;
      return saved || conversation?.seedTopic || cafeSeedTopics[0];
    } catch {
      return conversation?.seedTopic || cafeSeedTopics[0];
    }
  });
  const [customTopicInput, setCustomTopicInput] = useState("");

  const handleSelectTopic = (newTopic) => {
    if (!newTopic || !newTopic.trim()) return;
    const trimmed = newTopic.trim();
    setActiveTopic(trimmed);
    try {
      window.sessionStorage?.setItem("cafe_session_topic", trimmed);
    } catch {}
  };

  // Live creation / simulation state
  const [isLiveCreating, setIsLiveCreating] = useState(false);
  const [liveIndex, setLiveIndex] = useState(0);
  const [currentlyTypingSpeaker, setCurrentlyTypingSpeaker] = useState(null);
  const liveTimerRef = useRef(null);

  const chatEndRef = useRef(null);
  const inputRef = useRef(null);
  const tagMenuRef = useRef(null);

  const allSourceExchanges = useMemo(
    () => conversation?.exchanges || [],
    [conversation],
  );

  const participants = conversation?.participants || [];
  const speakerAId =
    participants[0] || allSourceExchanges[0]?.speaker || "";
  const speakerBId =
    participants[1] ||
    allSourceExchanges.find((e) => e.speaker !== speakerAId)?.speaker ||
    "";

  const speakerAName = personaNames[speakerAId] || speakerAId || "Agent 1";
  const speakerBName = personaNames[speakerBId] || speakerBId || "Agent 2";
  const metaA = getPersonaChatMeta(speakerAId, speakerAName);
  const metaB = getPersonaChatMeta(speakerBId, speakerBName);

  const availableAgents = cafePersonas.map((p) => ({
    id: p.id,
    name: p.name,
    firstName: p.name.split(" ")[0],
    isAtTable: p.id === speakerAId || p.id === speakerBId,
    meta: getPersonaChatMeta(p.id, p.name),
  }));

  const startLiveCreation = useCallback(() => {
    if (!allSourceExchanges.length) return;
    clearTimeout(liveTimerRef.current);
    setIsLiveCreating(true);
    setLocalExchanges([allSourceExchanges[0]]);
    setLiveIndex(1);
  }, [allSourceExchanges]);

  const skipLiveCreation = useCallback(() => {
    clearTimeout(liveTimerRef.current);
    setIsLiveCreating(false);
    setCurrentlyTypingSpeaker(null);
    setLocalExchanges(allSourceExchanges);
  }, [allSourceExchanges]);

  // Sync conversation changes or trigger live generation on new creation
  useEffect(() => {
    clearTimeout(liveTimerRef.current);
    setVisitorInput("");
    setReplyError("");
    setShowTagMenu(false);

    if (conversation?.isNewlyGenerated && allSourceExchanges.length > 1) {
      startLiveCreation();
    } else {
      setIsLiveCreating(false);
      setCurrentlyTypingSpeaker(null);
      setLocalExchanges(allSourceExchanges);
    }

    return () => clearTimeout(liveTimerRef.current);
  }, [conversation?.id, conversation?.isNewlyGenerated, allSourceExchanges, startLiveCreation]);

  // Handle live turn-by-turn progressive reveal
  useEffect(() => {
    if (isLiveCreating && liveIndex < allSourceExchanges.length) {
      const nextTurn = allSourceExchanges[liveIndex];
      setCurrentlyTypingSpeaker(nextTurn.speaker);

      liveTimerRef.current = setTimeout(() => {
        setLocalExchanges((prev) => [...prev, nextTurn]);
        setCurrentlyTypingSpeaker(null);
        setLiveIndex((prev) => prev + 1);
      }, 2200);
    } else if (isLiveCreating && liveIndex >= allSourceExchanges.length) {
      setIsLiveCreating(false);
      setCurrentlyTypingSpeaker(null);
    }

    return () => clearTimeout(liveTimerRef.current);
  }, [isLiveCreating, liveIndex, allSourceExchanges]);

  if (!conversation) return null;

  const inviterName = conversation.invitedBy
    ? personaNames[conversation.invitedBy] || conversation.invitedBy
    : "";
  const invitedParticipantName = conversation.invitedBy
    ? personaNames[
        conversation.participants?.find(
          (participantId) => participantId !== conversation.invitedBy,
        )
      ] || ""
    : "";

  const isLiveGenerated =
    conversation.status === "unpublished" || Boolean(conversation.draftId);
  const rawDate =
    conversation.publishedAt ||
    conversation.conversationDay ||
    conversation.generatedAt?.slice(0, 10);
  const formattedDate = rawDate
    ? new Date(`${rawDate}T00:00:00`).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  const getExchangeTime = (exchange, index) => {
    if (exchange.liveTime) return exchange.liveTime;
    // Compute progressive live time relative to now
    const now = new Date();
    const minutesAgo = (localExchanges.length - 1 - index) * 2;
    const msgDate = new Date(now.getTime() - minutesAgo * 60000);
    return getLiveFormattedTime(msgDate);
  };

  const handleCopyTranscript = async () => {
    if (!localExchanges.length) return;
    const transcriptText = localExchanges
      .map((e) => {
        const name =
          e.speaker === "visitor"
            ? "You"
            : personaNames[e.speaker] || e.speaker;
        return `${name}: ${e.text}`;
      })
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(transcriptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is restricted
    }
  };

  const handleTagAgent = (agentName) => {
    const mentionText = `@${agentName} `;
    setVisitorInput((prev) => {
      if (prev.endsWith("@")) {
        return prev.slice(0, -1) + mentionText;
      }
      if (!prev || prev.endsWith(" ")) {
        return prev + mentionText;
      }
      return prev + " " + mentionText;
    });
    setShowTagMenu(false);
    inputRef.current?.focus();
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setVisitorInput(val);

    if (val.endsWith("@") || val.endsWith("@ ")) {
      setShowTagMenu(true);
    }
  };

  const handleSendOpinion = async (e) => {
    if (e) e.preventDefault();
    const trimmed = visitorInput.trim();
    if (!trimmed || isSending) return;

    // Pause/halt scripted replay when visitor joins live
    if (isLiveCreating) {
      clearTimeout(liveTimerRef.current);
      setIsLiveCreating(false);
      setCurrentlyTypingSpeaker(null);
    }

    setReplyError("");
    setShowTagMenu(false);
    const userExchange = {
      speaker: "visitor",
      text: trimmed,
      liveTime: getLiveFormattedTime(new Date()),
    };

    const lowerTrimmed = trimmed.toLowerCase();
    let indicatorText = `${speakerAName.split(" ")[0]} is thinking…`;
    const tagged = cafePersonas.filter(
      (p) =>
        lowerTrimmed.includes(`@${p.name.toLowerCase()}`) ||
        lowerTrimmed.includes(`@${p.name.split(" ")[0].toLowerCase()}`) ||
        lowerTrimmed.includes(`@${p.id.toLowerCase()}`),
    );
    if (tagged.length === 1) {
      indicatorText = `${tagged[0].name.split(" ")[0]} is thinking…`;
    } else if (tagged.length > 1) {
      indicatorText = `${tagged.map((p) => p.name.split(" ")[0]).join(" and ")} are thinking…`;
    }
    setSendingStatusText(indicatorText);

    const updatedList = [...localExchanges, userExchange];
    setLocalExchanges(updatedList);
    setVisitorInput("");
    setIsSending(true);

    try {
      const res = await fetch("/api/agents/cafe/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantIds: conversation.participants || [speakerAId, speakerBId],
          seedTopic: activeTopic || conversation.seedTopic || "everyday observations",
          recentExchanges: updatedList,
          visitorMessage: trimmed,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success || !Array.isArray(data.replies)) {
        throw new Error(
          data.message || "Failed to receive replies from agents.",
        );
      }

      const replies = data.replies;
      if (replies.length === 0) {
        setIsSending(false);
        setSendingStatusText("");
        return;
      }

      // Display first reply as soon as it arrives
      const arrivalTime1 = replies[0].timestamp
        ? getLiveFormattedTime(new Date(replies[0].timestamp))
        : getLiveFormattedTime(new Date());
      setLocalExchanges((prev) => [...prev, { ...replies[0], liveTime: arrivalTime1 }]);

      if (replies.length > 1) {
        const nextSpeaker = replies[1].speaker;
        const nextName = (personaNames[nextSpeaker] || nextSpeaker).split(" ")[0];
        setSendingStatusText(`${nextName} is thinking…`);

        setTimeout(() => {
          const arrivalTime2 = replies[1].timestamp
            ? getLiveFormattedTime(new Date(replies[1].timestamp))
            : getLiveFormattedTime(new Date());
          setLocalExchanges((prev) => [...prev, { ...replies[1], liveTime: arrivalTime2 }]);
          setIsSending(false);
          setSendingStatusText("");
        }, 800);
      } else {
        setIsSending(false);
        setSendingStatusText("");
      }
    } catch {
      setReplyError(
        "The conversation paused for a moment while the table reflects. Please say something else or try again in a moment.",
      );
      setIsSending(false);
      setSendingStatusText("");
    }
  };

  return (
    <article className="overflow-hidden rounded-2xl border border-white/10 bg-[#0e0e12] shadow-2xl shadow-red-950/25 transition">
      {/* OneSmarter Themed Chat Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#141418] px-4 py-3 sm:px-6 sm:py-3.5">
        <div className="flex items-center gap-3">
          {/* Overlapping Agent Avatars */}
          <div className="relative flex items-center" aria-hidden="true">
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-bold shadow-md ${metaA.badgeColor}`}
            >
              {metaA.initials}
            </span>
            <span
              className={`-ml-2.5 flex h-9 w-9 items-center justify-center rounded-full border text-xs font-bold shadow-md ${metaB.badgeColor}`}
            >
              {metaB.initials}
            </span>
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-[#141418] bg-red-500"></span>
            </span>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-white sm:text-base">
                {speakerAName} and {speakerBName}
              </h3>
              {isLiveCreating ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-red-200 animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-ping" />
                  Live Generation Active
                </span>
              ) : isLiveGenerated ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                  <Sparkles className="h-2.5 w-2.5 text-amber-300" />
                  Live Generated Chat
                </span>
              ) : null}
            </div>
            <p className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400"></span>
              <span>The Café • Interactive character discussion</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Live Replay / Skip Toggle */}
          {allSourceExchanges.length > 1 && (
            <button
              type="button"
              onClick={isLiveCreating ? skipLiveCreation : startLiveCreation}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-200 transition hover:bg-red-500/20 active:scale-95"
            >
              {isLiveCreating ? (
                <>
                  <SkipForward className="h-3 w-3 text-red-300" />
                  <span>Skip to full chat</span>
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 text-red-300" />
                  <span>Live replay</span>
                </>
              )}
            </button>
          )}

          {formattedDate && (
            <time
              className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-400"
              dateTime={rawDate}
            >
              {formattedDate}
            </time>
          )}

          <button
            type="button"
            onClick={handleCopyTranscript}
            aria-label="Copy transcript"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-300 transition hover:border-white/25 hover:bg-white/[0.08]"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-red-400" />
                <span className="text-red-300">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Chat canvas body with OneSmarter Obsidian styling */}
      <div className="relative p-4 sm:p-6 md:p-8">
        {/* Date pill */}
        {formattedDate && (
          <div className="mb-4 flex justify-center">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1 text-[11px] font-medium uppercase tracking-wider text-zinc-400 shadow-sm">
              {formattedDate}
            </span>
          </div>
        )}

        {/* System discussion topic bubble */}
        {conversation.seedTopic && (
          <div className="mx-auto mb-6 max-w-lg rounded-xl border border-red-500/25 bg-red-950/20 px-4 py-2.5 text-center shadow-sm">
            <p className="text-xs text-rose-200">
              <span className="font-semibold text-red-400">Discussion topic: </span>
              <span className="italic text-zinc-100">“{conversation.seedTopic}”</span>
            </p>
            {inviterName && invitedParticipantName && (
              <p className="mt-1 text-[11px] italic text-zinc-400">
                {inviterName} invited {invitedParticipantName} to the Café.
              </p>
            )}
          </div>
        )}

        {/* Empty state welcome card */}
        {localExchanges.length === 0 && (
          <div className="mx-auto my-8 max-w-md rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center backdrop-blur-sm sm:p-8">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-red-500/30 bg-red-600/20 text-red-400 shadow-md">
              <Coffee className="h-6 w-6" />
            </div>
            <h4 className="text-base font-semibold text-white">The table is open</h4>
            <p className="mt-2 text-xs leading-relaxed text-zinc-300">
              {speakerAName} and {speakerBName} are seated at the table. Say something to the table below and join the discussion live.
            </p>
            <p className="mt-3 text-[11px] text-zinc-500">
              Conversations are live and session-only. Refreshing the website resets everything.
            </p>
          </div>
        )}

        {/* Messages List: OneSmarter Obsidian & Crimson Alternating Bubbles */}
        <div
          className="space-y-4"
          role="log"
          aria-label="Café conversation exchanges"
        >
          {localExchanges.map((exchange, exchangeIndex) => {
            const isVisitor = exchange.speaker === "visitor";
            const isLeftSpeaker = exchange.speaker === speakerAId;
            const currentSpeakerName = isVisitor
              ? "You"
              : personaNames[exchange.speaker] || exchange.speaker;
            const currentMeta = isVisitor
              ? {
                  initials: "YOU",
                  badgeColor: "bg-red-700 text-white border-red-400",
                  nameColor: "text-rose-100",
                  role: "Visitor at Table",
                }
              : getPersonaChatMeta(exchange.speaker, currentSpeakerName);

            const displayTime = getExchangeTime(exchange, exchangeIndex);

            // Case 1: Visitor / You (User opinion sent into the chat)
            if (isVisitor) {
              return (
                <div
                  key={`${conversation.id}-turn-${exchangeIndex}`}
                  className="group flex items-end justify-end gap-2.5 sm:gap-3"
                >
                  {/* User Bubble - OneSmarter Crimson Gradient */}
                  <div className="relative max-w-[85%] rounded-2xl rounded-br-xs border border-red-400/50 bg-gradient-to-r from-red-600 via-rose-600 to-red-700 p-3.5 text-white shadow-xl shadow-red-950/40 sm:max-w-[78%] sm:p-4 md:max-w-[70%]">
                    {/* Header */}
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-red-400/30 pb-1">
                      <span className="text-xs font-semibold tracking-wide text-white sm:text-[13px]">
                        You (Visitor)
                      </span>
                      <span className="text-[10px] font-medium text-rose-100/90">
                        Joined conversation
                      </span>
                    </div>

                    {/* Content with mention badges */}
                    <p className="min-w-0 break-words text-sm leading-relaxed text-white whitespace-pre-wrap sm:text-[14.5px]">
                      {renderTextWithMentions(exchange.text)}
                    </p>

                    {/* Footer with real live time */}
                    <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-rose-100/90">
                      <span>Turn {exchangeIndex + 1}</span>
                      <span>•</span>
                      <span>{displayTime}</span>
                      <CheckCheck
                        className="inline h-3.5 w-3.5 text-white"
                        aria-label="Delivered"
                      />
                    </div>
                  </div>

                  {/* User Avatar */}
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-400 bg-red-600 text-xs font-bold text-white shadow-lg sm:h-9 sm:w-9"
                    title="You (Visitor)"
                    aria-hidden="true"
                  >
                    YOU
                  </div>
                </div>
              );
            }

            // Case 2: Agent 1 (Left-aligned bubble - OneSmarter Obsidian Card)
            if (isLeftSpeaker) {
              return (
                <div
                  key={`${conversation.id}-turn-${exchangeIndex}`}
                  className="group flex items-end justify-start gap-2.5 sm:gap-3"
                >
                  {/* Left Avatar */}
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold shadow-md sm:h-9 sm:w-9 ${currentMeta.badgeColor}`}
                    title={`${currentSpeakerName} (${currentMeta.role})`}
                    aria-hidden="true"
                  >
                    {currentMeta.initials}
                  </div>

                  {/* Left Bubble */}
                  <div className="relative max-w-[85%] rounded-2xl rounded-bl-xs border border-white/10 bg-[#16161c] p-3.5 text-zinc-100 shadow-lg backdrop-blur-sm transition-all hover:border-white/20 sm:max-w-[78%] sm:p-4 md:max-w-[70%]">
                    {/* Header */}
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-white/5 pb-1">
                      <span
                        className={`text-xs font-semibold tracking-wide sm:text-[13px] ${currentMeta.nameColor}`}
                      >
                        {currentSpeakerName}
                      </span>
                      <span className="text-[10px] font-medium text-zinc-400">
                        {currentMeta.role}
                      </span>
                    </div>

                    {/* Content with mention badges */}
                    <p className="min-w-0 break-words text-sm leading-relaxed text-zinc-100 whitespace-pre-wrap sm:text-[14.5px]">
                      {renderTextWithMentions(exchange.text)}
                    </p>

                    {/* Footer with real live time */}
                    <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-zinc-500">
                      <span>Turn {exchangeIndex + 1}</span>
                      <span>•</span>
                      <span>{displayTime}</span>
                      <CheckCheck
                        className="h-3 w-3 text-zinc-500"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                </div>
              );
            }

            // Case 3: Agent 2 (Right-aligned bubble - OneSmarter Dark Wine Card)
            return (
              <div
                key={`${conversation.id}-turn-${exchangeIndex}`}
                className="group flex items-end justify-end gap-2.5 sm:gap-3"
              >
                {/* Right Bubble */}
                <div className="relative max-w-[85%] rounded-2xl rounded-br-xs border border-red-500/35 bg-gradient-to-br from-[#2a0e14]/95 via-[#1e0a0f]/95 to-[#15070a]/95 p-3.5 text-rose-50 shadow-lg backdrop-blur-sm transition-all hover:border-red-400/50 sm:max-w-[78%] sm:p-4 md:max-w-[70%]">
                  {/* Header */}
                  <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-red-500/20 pb-1">
                    <span
                      className={`text-xs font-semibold tracking-wide sm:text-[13px] ${currentMeta.nameColor}`}
                    >
                      {currentSpeakerName}
                    </span>
                    <span className="text-[10px] font-medium text-rose-300/70">
                      {currentMeta.role}
                    </span>
                  </div>

                  {/* Content with mention badges */}
                  <p className="min-w-0 break-words text-sm leading-relaxed text-rose-50 whitespace-pre-wrap sm:text-[14.5px]">
                    {renderTextWithMentions(exchange.text)}
                  </p>

                  {/* Footer with OneSmarter Rose Double Checkmarks */}
                  <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-rose-400/75">
                    <span>Turn {exchangeIndex + 1}</span>
                    <span>•</span>
                    <span>{displayTime}</span>
                    <CheckCheck
                      className="inline h-3.5 w-3.5 text-rose-400"
                      aria-label="Read receipt"
                    />
                  </div>
                </div>

                {/* Right Avatar */}
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold shadow-md sm:h-9 sm:w-9 ${currentMeta.badgeColor}`}
                  title={`${currentSpeakerName} (${currentMeta.role})`}
                  aria-hidden="true"
                >
                  {currentMeta.initials}
                </div>
              </div>
            );
          })}

          {/* Typing Indicator for Live Creation or Visitor Opinion response */}
          {(isSending || currentlyTypingSpeaker) && (
            <div className="flex items-end justify-start gap-2.5 sm:gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-500/30 bg-red-950/40 text-[10px] font-bold text-red-200 sm:h-9 sm:w-9">
                AI
              </div>
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-xs border border-white/10 bg-[#16161c] px-4 py-3 text-xs text-zinc-300 shadow-md">
                <span>
                  {currentlyTypingSpeaker
                    ? `${personaNames[currentlyTypingSpeaker] || currentlyTypingSpeaker} is speaking...`
                    : sendingStatusText || `${speakerAName} and ${speakerBName} are discussing your opinion...`}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-red-500"></span>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-red-500 [animation-delay:0.2s]"></span>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-red-500 [animation-delay:0.4s]"></span>
                </span>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Interactive Opinion & Topic Selection Bar */}
      <form
        onSubmit={handleSendOpinion}
        className="relative border-t border-white/10 bg-[#141418] p-3 sm:p-4"
      >
        {/* Topic Chips and Custom Topic Field */}
        <div className="mb-3 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-zinc-400">Topics:</span>
            {cafeSeedTopics.slice(0, 6).map((topic) => (
              <button
                key={topic}
                type="button"
                onClick={() => handleSelectTopic(topic)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                  activeTopic === topic
                    ? "border-red-500 bg-red-600/30 text-white shadow-sm"
                    : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/25 hover:bg-white/[0.07]"
                }`}
              >
                {topic}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="custom-topic-input" className="sr-only">
              or suggest your own
            </label>
            <input
              id="custom-topic-input"
              type="text"
              value={customTopicInput}
              onChange={(e) => setCustomTopicInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSelectTopic(customTopicInput);
                  setCustomTopicInput("");
                }
              }}
              placeholder="or suggest your own"
              aria-label="or suggest your own"
              className="w-full max-w-xs rounded-full border border-white/15 bg-[#181820] px-3.5 py-1.5 text-xs text-white placeholder:text-zinc-500 transition focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 sm:w-64"
            />
            {customTopicInput.trim() && (
              <button
                type="button"
                onClick={() => {
                  handleSelectTopic(customTopicInput);
                  setCustomTopicInput("");
                }}
                className="rounded-full border border-red-500/40 bg-red-600/20 px-3 py-1 text-xs font-semibold text-red-200 transition hover:bg-red-600/30"
              >
                Set topic
              </button>
            )}
          </div>
        </div>

        {/* Main Input Row: Single Message Box labelled Say something to the table. */}
        <div className="flex items-center gap-2 sm:gap-3">
          <label htmlFor="cafe-table-message" className="sr-only">
            Say something to the table.
          </label>
          <div className="relative flex flex-1 items-center">
            <input
              id="cafe-table-message"
              ref={inputRef}
              type="text"
              value={visitorInput}
              onChange={(e) => setVisitorInput(e.target.value)}
              placeholder="Say something to the table."
              aria-label="Say something to the table."
              disabled={isSending}
              maxLength={400}
              className="w-full rounded-full border border-white/15 bg-[#181820] px-4 py-2.5 text-xs text-white placeholder:text-zinc-400 transition focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 sm:text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={isSending || !visitorInput.trim()}
            aria-label="Send your opinion to the table"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-lg shadow-red-950/50 transition hover:from-red-500 hover:to-rose-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            ) : (
              <Send className="h-4 w-4 text-white" />
            )}
          </button>
        </div>
        {replyError && (
          <p className="mt-2 text-xs text-red-400">{replyError}</p>
        )}
      </form>

      {/* Chat App Footer with OneSmarter Obsidian palette */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-[#101014] px-4 py-2 text-[11px] text-zinc-400 sm:px-6">
        <span className="flex items-center gap-1.5">
          <Coffee className="h-3.5 w-3.5 text-red-400" />
          <span>Characters stay strictly in persona • Autonomous local AI</span>
        </span>
        <span className="font-medium text-zinc-400">
          {localExchanges.length} {localExchanges.length === 1 ? "message" : "messages"}
        </span>
      </footer>
    </article>
  );
};

const MiraConversationPanel = () => {
  const latestRequestId = useRef(0);
  const threadEndRef = useRef(null);
  const conversationScrollRef = useRef(null);
  const shouldAutoFollowRef = useRef(true);
  const answerPanelRef = useRef(null);
  const guidanceTimeoutRef = useRef(null);
  const highlightTimeoutRef = useRef(null);
  const copyStatusTimeoutRef = useRef(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [showSampleGuidance, setShowSampleGuidance] = useState(false);
  const [isAnswerHighlighted, setIsAnswerHighlighted] = useState(false);
  const [conversationTurns, setConversationTurns] = useState([]);
  const [customQuestion, setCustomQuestion] = useState("");
  const [inputWarning, setInputWarning] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [copyStatus, setCopyStatus] = useState("idle");
  const latestMiraAnswer = [...conversationTurns]
    .reverse()
    .find((turn) => turn.role === "assistant" && !turn.error)?.content;
  useEffect(() => {
    const conversationScroll = conversationScrollRef.current;
    if (!conversationScroll || !shouldAutoFollowRef.current) return;

    conversationScroll.scrollTo({
      top: conversationScroll.scrollHeight,
      behavior:
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
    });
  }, [conversationTurns, isLoading, errorMessage]);

  useEffect(
    () => () => {
      window.clearTimeout(guidanceTimeoutRef.current);
      window.clearTimeout(highlightTimeoutRef.current);
      window.clearTimeout(copyStatusTimeoutRef.current);
    },
    [],
  );

  const handleConversationScroll = () => {
    const conversationScroll = conversationScrollRef.current;
    if (!conversationScroll) return;

    const distanceFromBottom =
      conversationScroll.scrollHeight -
      conversationScroll.scrollTop -
      conversationScroll.clientHeight;
    shouldAutoFollowRef.current = distanceFromBottom < 80;
  };

  const guideToAnswerPanel = () => {
    window.clearTimeout(guidanceTimeoutRef.current);
    window.clearTimeout(highlightTimeoutRef.current);
    setShowSampleGuidance(true);
    setIsAnswerHighlighted(true);

    window.requestAnimationFrame(() => {
      threadEndRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "end",
      });
    });

    highlightTimeoutRef.current = window.setTimeout(
      () => setIsAnswerHighlighted(false),
      1400,
    );
    guidanceTimeoutRef.current = window.setTimeout(
      () => setShowSampleGuidance(false),
      3200,
    );
  };

  const requestMiraAnswer = async (message, suggestedQuestionId = "") => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    const history = buildMiraConversationHistory(conversationTurns);
    const userTurn = {
      id: `user-${requestId}`,
      role: "user",
      content: message,
    };
    window.clearTimeout(copyStatusTimeoutRef.current);
    setCopyStatus("idle");
    setIsLoading(true);
    setErrorMessage("");
    setInputWarning("");
    setConversationTurns((turns) => [...turns, userTurn]);

    try {
      const response = await askMiraEndpoint(message, history, suggestedQuestionId);
      if (requestId !== latestRequestId.current) return;
      setConversationTurns((turns) => [
        ...turns,
        {
          id: `mira-${requestId}`,
          role: "assistant",
          content: response.answer,
          response,
        },
      ]);
    } catch (error) {
      if (requestId !== latestRequestId.current) return;
      const fallbackMessage =
        error.status === 429
          ? "Mira is receiving too many requests right now. Please try again shortly or email care@onesmarter.com."
          : "Mira is not available right now. For business inquiries, email care@onesmarter.com.";
      setErrorMessage(fallbackMessage);
      setConversationTurns((turns) => [
        ...turns,
        {
          id: `mira-error-${requestId}`,
          role: "assistant",
          content: fallbackMessage,
          error: true,
        },
      ]);
    } finally {
      if (requestId === latestRequestId.current) {
        setIsLoading(false);
      }
    }
  };

  const handleQuestionClick = async (example, index) => {
    setSelectedIndex(index);
    setCustomQuestion(example.question);
    const answerRequest = requestMiraAnswer(example.question);
    guideToAnswerPanel();
    await answerRequest;
    setCustomQuestion("");
  };

  const handleCustomQuestionChange = (event) => {
    const value = event.target.value;
    setCustomQuestion(value);
    if (value.length >= MIRA_INPUT_LIMIT) {
      setInputWarning("Question limit reached. Please keep your question to 500 characters.");
    } else if (inputWarning) {
      setInputWarning("");
    }
  };

  const handleCustomQuestionSubmit = async (event) => {
    event.preventDefault();

    const trimmedQuestion = customQuestion.trim();
    if (!trimmedQuestion || trimmedQuestion.length > MIRA_INPUT_LIMIT || isLoading) return;
    event.currentTarget.querySelector("button[type='submit']")?.blur();
    setSelectedIndex(null);
    const answerRequest = requestMiraAnswer(trimmedQuestion);
    setTimeout(() => guideToAnswerPanel(), 0);
    await answerRequest;
    setCustomQuestion("");
  };

  const handleCustomQuestionKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleStartNewConversation = () => {
    latestRequestId.current += 1;
    window.clearTimeout(guidanceTimeoutRef.current);
    window.clearTimeout(highlightTimeoutRef.current);
    window.clearTimeout(copyStatusTimeoutRef.current);
    setSelectedIndex(null);
    setShowSampleGuidance(false);
    setIsAnswerHighlighted(false);
    setConversationTurns([]);
    setIsLoading(false);
    setErrorMessage("");
    setInputWarning("");
    setCustomQuestion("");
    setCopyStatus("idle");
  };

  const handleCopyAnswer = async () => {
    if (!latestMiraAnswer || isLoading) return;

    window.clearTimeout(copyStatusTimeoutRef.current);

    try {
      await navigator.clipboard.writeText(latestMiraAnswer);
      setCopyStatus("copied");
      copyStatusTimeoutRef.current = window.setTimeout(
        () => setCopyStatus("idle"),
        2000,
      );
    } catch {
      setCopyStatus("failed");
    }
  };

  const isSubmitDisabled = isLoading || !customQuestion.trim() || customQuestion.length > MIRA_INPUT_LIMIT;

  return (
    <div className="grid min-w-0 max-w-full gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="min-w-0">
        <p className="text-sm leading-7 text-zinc-300">Ask about OneSmarter platforms, services, or trust posture. Choose a question to get started.</p>
        <div className="mt-5 flex flex-wrap gap-2" aria-label="Sample questions">
          {conversationExamples.map((example, index) => (
            <button key={example.id} type="button" onClick={() => handleQuestionClick(example, index)} disabled={isLoading}
              aria-label={`Ask Mira: ${example.question}`} aria-pressed={selectedIndex === index}
              className="min-h-11 max-w-full whitespace-normal break-words rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-left text-sm text-zinc-200 transition hover:border-red-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 disabled:opacity-50">
              {example.question}
            </button>
          ))}
        </div>
        {showSampleGuidance && <p role="status" className="mt-3 text-sm text-red-200">Your selected question has been sent to Mira.</p>}
        <form onSubmit={handleCustomQuestionSubmit} className="mt-6">
          <label htmlFor="mira-question" className="text-sm font-semibold">Ask Mira a question</label>
          <textarea id="mira-question" value={customQuestion} onChange={handleCustomQuestionChange} onKeyDown={handleCustomQuestionKeyDown}
            maxLength={MIRA_INPUT_LIMIT} rows={4} aria-describedby="mira-safety-notice mira-question-count"
            placeholder="What would you like to know about OneSmarter?" disabled={isLoading}
            className="mt-2 min-h-28 w-full min-w-0 resize-y rounded-md border border-white/15 bg-black/30 p-4 text-sm text-white placeholder:text-zinc-500 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/30" />
          <p id="mira-question-count" className="mt-2 text-xs text-zinc-400">{inputWarning || `${customQuestion.length}/${MIRA_INPUT_LIMIT} characters`}</p>
          <button type="submit" disabled={isSubmitDisabled} className="mt-4 min-h-11 rounded-md bg-red-600 px-5 py-3 text-sm font-semibold hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400">
            {isLoading ? "Asking Mira..." : "Ask Mira"}
          </button>
        </form>
      </div>
      <div ref={answerPanelRef} className={`min-w-0 max-w-full overflow-x-hidden rounded-lg border bg-black/25 p-4 sm:p-6 ${isAnswerHighlighted ? "border-red-400" : "border-white/10"}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <h3 className="font-semibold">Mira&apos;s response</h3>
          <button type="button" onClick={handleStartNewConversation} disabled={isLoading || conversationTurns.length === 0} className="min-h-11 rounded-md border border-white/15 px-3 py-2 text-xs text-zinc-300 hover:border-red-400 disabled:opacity-40">Start new conversation</button>
        </div>
        <div ref={conversationScrollRef} onScroll={handleConversationScroll} className="mt-5 grid max-h-[36rem] min-h-64 min-w-0 gap-4 overflow-y-auto [overflow-wrap:anywhere]" aria-live="polite" aria-label="Mira conversation">
          {conversationTurns.length === 0 && <p className="text-sm leading-7 text-zinc-400">Choose a sample question or type your own. I&apos;ll help you find the information you need.</p>}
          {conversationTurns.map((turn) => (
            <div key={turn.id} className={`min-w-0 rounded-lg p-4 text-sm leading-7 ${turn.role === "user" ? "bg-white/10" : "bg-white/[0.03]"}`}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-300">{turn.role === "user" ? "You" : "Mira"}</p>
              <MiraAnswerContent content={turn.content} structure={turn.response?.answerStructure} />
            </div>
          ))}
          {isLoading && <p role="status" className="text-sm text-zinc-300">Looking into your question...</p>}
          {errorMessage && <p className="sr-only" role="alert">{errorMessage}</p>}
          <div ref={threadEndRef} />
        </div>
        {latestMiraAnswer && <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <span role="status" className="text-xs text-zinc-400">{copyStatus === "copied" ? "Answer copied." : copyStatus === "failed" ? "Could not copy. Please select the answer text." : ""}</span>
          <button type="button" onClick={handleCopyAnswer} disabled={isLoading} className="min-h-11 rounded-md border border-white/15 px-3 py-2 text-xs text-zinc-300 hover:border-red-400">Copy answer</button>
        </div>}
      </div>
    </div>
  );
};

const AiAgentsPage = () => {
  const [mode, setMode] = useState("question");
  const [cafeNow] = useState(() => new Date());
  const [viewedCafeConversationId, setViewedCafeConversationId] = useState("");
  const [generatedCafeConversations, setGeneratedCafeConversations] = useState([]);
  const cafeTranscriptRef = useRef(null);

  const handleCafeSelection = (id) => {
    setViewedCafeConversationId(id);
    // Wait for React to render the selected transcript before positioning it.
    requestAnimationFrame(() => {
      cafeTranscriptRef.current?.focus({ preventScroll: true });
      cafeTranscriptRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        block: "start",
      });
    });
  };

  const handleConversationGenerated = (newConversation) => {
    setGeneratedCafeConversations((prev) => [newConversation, ...prev]);
    setViewedCafeConversationId(newConversation.id);
    requestAnimationFrame(() => {
      cafeTranscriptRef.current?.focus({ preventScroll: true });
      cafeTranscriptRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        block: "start",
      });
    });
  };

  const currentCafeConversation = selectCafeConversation(undefined, cafeNow);
  useEffect(() => {
    if (!currentCafeConversation || !isCafeConversationActive(cafeNow)) return undefined;

    const bucketKey = getCafeWeekBucket(cafeNow).key;
    const requestKey = `onesmarter:cafe-restoration:${bucketKey}:${currentCafeConversation.id}`;
    if (requestedCafeRestorationEvents.has(requestKey)) return undefined;
    requestedCafeRestorationEvents.add(requestKey);
    fetch("/api/agents/cafe/restoration", {
      method: "POST",
    }).catch(() => requestedCafeRestorationEvents.delete(requestKey));
    return undefined;
  }, [cafeNow, currentCafeConversation]);

  const defaultLiveCafeConversation = useMemo(
    () => ({
      id: "live-cafe-table",
      participants: currentCafeConversation?.participants || ["theo-mercer", "ravi-sen"],
      seedTopic: currentCafeConversation?.seedTopic || "everyday observations and ideas",
      exchanges: [],
      status: "live",
    }),
    [currentCafeConversation],
  );

  const viewedCafeConversation =
    generatedCafeConversations[0] || defaultLiveCafeConversation;

  const cafePersonaNames = Object.fromEntries(
    cafePersonas.map((persona) => [persona.id, persona.name]),
  );
  return (
    <main className="overflow-x-hidden bg-zinc-950 text-white">
      <section id="ai-agents-hero" className="px-5 pb-16 pt-36 md:px-12 md:pb-20 md:pt-44">
        <div className="qa-container mx-auto">
          <p className="text-sm font-semibold uppercase tracking-wide text-red-400">AI Agents</p>
          <h1 className="mt-4 max-w-4xl text-4xl font-bold leading-tight md:text-5xl lg:text-6xl">Practical AI Agents for Secure, Accountable Workflows</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-300">Ask Mira about OneSmarter platforms, services, and trust posture using approved content. Or paste a page to review its clarity, evidence, and AI readability.</p>
          <a href="#mira-professional-guide" className="mt-8 inline-flex min-h-11 items-center rounded-md bg-red-600 px-6 py-3 font-semibold hover:bg-red-500">Open Mira</a>
        </div>
      </section>
      <section id="mira-professional-guide" className="scroll-mt-24 border-y border-white/10 bg-[#111111] px-5 py-12 md:px-12 md:py-16">
        <div className="qa-container mx-auto min-w-0">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-bold" aria-hidden="true">MV</div>
            <div><h2 className="text-2xl font-bold md:text-3xl">Mira Vale</h2><p className="mt-1 text-zinc-400">Your OneSmarter guide</p></div>
          </div>
          <p className="mt-5 max-w-2xl leading-7 text-zinc-300">I can help you understand OneSmarter or review public page content you share here. Where would you like to start?</p>
          <div className="mt-6 flex flex-wrap gap-3" role="group" aria-label="Choose how Mira can help">
            <button type="button" aria-pressed={mode === "question"} aria-controls="mira-question-panel" onClick={() => setMode("question")} className={`min-h-11 rounded-md border px-5 py-3 text-sm font-semibold ${mode === "question" ? "border-red-500 bg-red-600 text-white" : "border-white/20 text-zinc-300 hover:border-red-400"}`}>Ask a question</button>
            <button type="button" aria-pressed={mode === "analysis"} aria-controls="mira-analysis-panel" onClick={() => setMode("analysis")} className={`min-h-11 rounded-md border px-5 py-3 text-sm font-semibold ${mode === "analysis" ? "border-red-500 bg-red-600 text-white" : "border-white/20 text-zinc-300 hover:border-red-400"}`}>Check my page</button>
          </div>
          <p id="mira-safety-notice" className="mt-5 max-w-3xl text-xs leading-6 text-zinc-400">AI-generated responses may contain errors. Do not provide PHI or confidential information. For sensitive business, security, compliance, or procurement questions, contact <a href="mailto:care@onesmarter.com" className="text-zinc-200 underline underline-offset-4">care@onesmarter.com</a>.</p>
          <div id="mira-question-panel" hidden={mode !== "question"} className="mt-8"><MiraConversationPanel /></div>
          <div id="mira-analysis-panel" hidden={mode !== "analysis"} className="mt-8"><MiraPageReview /></div>
        </div>
      </section>
      <section id="agent-cafe" className="bg-zinc-950 px-5 py-16 text-white md:px-12">
        <div className="qa-container mx-auto rounded-lg border border-white/10 bg-white/[0.04] p-6 md:p-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-red-400">
            The Café
          </p>
          <h2 className="text-2xl font-bold md:text-4xl">
            A conversation over coffee
          </h2>
          <p className="mt-4 leading-7 text-zinc-300">
            These conversations are generated, not written, and nobody reviews them before they appear. The agents are given a small everyday subject and talk about it in character. Everything in them is invented — the incidents, the details, the people mentioned — and automated rules keep them away from our work, our customers, and anything real. They are here to show how the agents differ from each other, not as a record of anything that happened.
          </p>

          <CafeConversationGenerator
            onConversationGenerated={handleConversationGenerated}
            generatedConversations={generatedCafeConversations}
            activeConversationId={viewedCafeConversation?.id || ""}
            onSelectConversation={handleCafeSelection}
            currentWeeklyConversationId={currentCafeConversation?.id || ""}
          />

          <div className="mt-8">
            <div id="cafe-selected-conversation" ref={cafeTranscriptRef} tabIndex={-1} className="scroll-mt-24 focus:outline-none">
              <CafeConversationTranscript
                conversation={viewedCafeConversation}
                personaNames={cafePersonaNames}
              />
            </div>
          </div>
        </div>
      </section>

      <section id="ai-agents-contact" className="bg-white px-5 py-14 text-zinc-950 md:px-12 md:py-16">
        <div className="qa-container mx-auto flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div><p className="text-sm font-semibold uppercase tracking-wide text-red-600">Contact</p><h2 className="mt-3 text-2xl font-bold md:text-3xl">Let&apos;s talk about your next step.</h2><p className="mt-4 max-w-2xl leading-7 text-zinc-600">For business, security, compliance, and procurement questions, get in touch with our team.</p></div>
          <a href="mailto:care@onesmarter.com" className="inline-flex min-h-11 max-w-full items-center break-all rounded-md bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700">care@onesmarter.com</a>
        </div>
      </section>
    </main>
  );
};

export default AiAgentsPage;
