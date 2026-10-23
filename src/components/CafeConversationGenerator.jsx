import React, { useState } from "react";
import {
  Coffee,
  Sparkles,
  RefreshCw,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Check,
  AlertCircle,
  Shuffle,
  X,
} from "lucide-react";
import { cafePersonas } from "../data/agentPresentation/cafePersonas.js";
import { cafeSeedTopics } from "../data/cafeSeedTopics.js";

const POPULAR_TOPICS = [
  "a local dispute over a hedge, bin, or parking space",
  "unusual bird behavior",
  "a bakery changing the shape of a familiar pastry",
  "an unseasonably warm week",
  "a library book returned decades late",
  "a forgotten object found in a coat pocket",
];

const PERSONA_STYLES = {
  "theo-mercer": {
    badge: "TM",
    badgeColor: "bg-zinc-700 text-zinc-200 border-zinc-600",
    role: "Reserved & precise",
  },
  "elena-cross": {
    badge: "EC",
    badgeColor: "bg-amber-600/80 text-amber-100 border-amber-500",
    role: "Witty & observant",
  },
  "ravi-sen": {
    badge: "RS",
    badgeColor: "bg-emerald-700 text-emerald-100 border-emerald-600",
    role: "Tactical & discursive",
  },
  "selene-hart": {
    badge: "SH",
    badgeColor: "bg-indigo-700 text-indigo-100 border-indigo-600",
    role: "Reflective & questioning",
  },
};

const CafeConversationGenerator = ({
  onConversationGenerated,
  generatedConversations = [],
  activeConversationId = "",
  onSelectConversation,
  currentWeeklyConversationId = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState([]);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [customTopic, setCustomTopic] = useState("");
  const [exchangeCount, setExchangeCount] = useState(6);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const handleToggleParticipant = (personaId) => {
    setSelectedParticipants((prev) => {
      if (prev.includes(personaId)) {
        return prev.filter((id) => id !== personaId);
      }
      if (prev.length >= 2) {
        // Replace second participant
        return [prev[0], personaId];
      }
      return [...prev, personaId];
    });
  };

  const handlePickRandomTopic = () => {
    const randomTopic =
      cafeSeedTopics[Math.floor(Math.random() * cafeSeedTopics.length)];
    setSelectedTopic(randomTopic);
    setCustomTopic("");
  };

  const handleResetOptions = () => {
    setSelectedParticipants([]);
    setSelectedTopic("");
    setCustomTopic("");
    setExchangeCount(6);
    setErrorMessage("");
  };

  const hasCustomOptions =
    selectedParticipants.length > 0 ||
    Boolean(selectedTopic) ||
    Boolean(customTopic.trim()) ||
    exchangeCount !== 6;

  const handleGenerate = async (e) => {
    if (e) e.preventDefault();
    if (isGenerating) return;

    if (selectedParticipants.length === 1) {
      setErrorMessage(
        "Please select a second agent, or deselect all to pick a random pair.",
      );
      return;
    }

    setErrorMessage("");
    setIsGenerating(true);
    setStatusMessage("Brewing a conversation with local Ollama...");

    const topic = customTopic.trim() || selectedTopic || undefined;
    const participants =
      selectedParticipants.length === 2 ? selectedParticipants : undefined;

    try {
      const response = await fetch("/api/agents/cafe/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantIds: participants,
          seedTopic: topic,
          exchangeCount: Number(exchangeCount) || 6,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success || !data.conversation) {
        throw new Error(
          data.message ||
            "Unable to generate Café conversation. Please check local Ollama.",
        );
      }

      setStatusMessage("Conversation ready!");
      onConversationGenerated({ ...data.conversation, isNewlyGenerated: true });
      // Brief success message before clearing
      setTimeout(() => setStatusMessage(""), 3000);
    } catch (err) {
      setErrorMessage(
        err.message ||
          "Generation failed. Make sure Ollama is running locally on port 11434 with qwen2.5:0.5b.",
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="mt-8 rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-5 md:p-6 backdrop-blur-sm">
      {/* Top action row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-600/20 text-red-400 border border-red-500/30">
            <Coffee className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white md:text-lg">
              Live Conversation Generator
            </h3>
            <p className="text-xs text-zinc-400">
              Generate spontaneous, unscripted agent dialogue powered by local Ollama
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-expanded={isOpen}
            className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium transition ${
              isOpen || hasCustomOptions
                ? "border-red-400/50 bg-red-500/10 text-red-200"
                : "border-white/15 bg-white/[0.04] text-zinc-300 hover:border-white/30 hover:bg-white/[0.08]"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Options</span>
            {hasCustomOptions && (
              <span className="flex h-2 w-2 rounded-full bg-red-400" />
            )}
            {isOpen ? (
              <ChevronUp className="h-3.5 w-3.5 text-zinc-400" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
            )}
          </button>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-red-600 to-rose-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-red-950/50 transition hover:from-red-500 hover:to-rose-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin text-white" />
                <span>Brewing...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 text-amber-200" />
                <span>Generate Chat</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Progress / Status Banner */}
      {isGenerating && (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200 animate-pulse"
        >
          <Coffee className="h-4 w-4 shrink-0 text-red-400 animate-bounce" />
          <span>{statusMessage || "Agents are taking their seats at the Café..."}</span>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-950/40 p-4 text-sm text-red-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-red-300">Generation note</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-300">{errorMessage}</p>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage("")}
            className="text-zinc-400 hover:text-white"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Customizable Options Drawer */}
      {isOpen && (
        <div className="mt-5 border-t border-white/10 pt-5">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Section 1: Choose Participants */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  Participants
                </label>
                <span className="text-xs text-zinc-400">
                  {selectedParticipants.length === 0
                    ? "Random selection"
                    : `${selectedParticipants.length} of 2 selected`}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-400">
                Choose any 2 agents, or leave unselected for random pairing.
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2">
                {cafePersonas.map((persona) => {
                  const isSelected = selectedParticipants.includes(persona.id);
                  const style = PERSONA_STYLES[persona.id] || {
                    badge: persona.name.slice(0, 2).toUpperCase(),
                    badgeColor: "bg-zinc-700 text-zinc-200 border-zinc-600",
                    role: "AI Agent",
                  };

                  return (
                    <button
                      key={persona.id}
                      type="button"
                      onClick={() => handleToggleParticipant(persona.id)}
                      className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition ${
                        isSelected
                          ? "border-red-400 bg-red-950/30 text-white ring-1 ring-red-400/50"
                          : "border-white/10 bg-black/20 text-zinc-300 hover:border-white/25 hover:bg-white/[0.04]"
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${style.badgeColor}`}
                      >
                        {style.badge}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <p className="truncate text-xs font-semibold text-white">
                            {persona.name}
                          </p>
                          {isSelected && (
                            <Check className="h-3 w-3 shrink-0 text-red-400" />
                          )}
                        </div>
                        <p className="truncate text-[10px] text-zinc-400">
                          {style.role}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Section 2: Choose Topic & Exchanges */}
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="cafe-custom-topic" className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                    Discussion Topic
                  </label>
                  <button
                    type="button"
                    onClick={handlePickRandomTopic}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-red-300 hover:text-red-200"
                  >
                    <Shuffle className="h-3 w-3" />
                    <span>Surprise topic</span>
                  </button>
                </div>

                <input
                  id="cafe-custom-topic"
                  type="text"
                  value={customTopic || selectedTopic}
                  onChange={(e) => {
                    setCustomTopic(e.target.value);
                    setSelectedTopic("");
                  }}
                  placeholder="e.g. an unexpected power cut during dinner, a stray cat..."
                  className="mt-2 w-full rounded-md border border-white/15 bg-black/40 px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
                />

                {/* Popular chips */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {POPULAR_TOPICS.slice(0, 4).map((topic) => (
                    <button
                      key={topic}
                      type="button"
                      onClick={() => {
                        setSelectedTopic(topic);
                        setCustomTopic("");
                      }}
                      className={`truncate max-w-[200px] rounded-full border px-2.5 py-1 text-[11px] transition ${
                        selectedTopic === topic
                          ? "border-red-400 bg-red-950/30 text-red-200"
                          : "border-white/10 bg-white/[0.02] text-zinc-400 hover:border-white/20 hover:text-zinc-200"
                      }`}
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              </div>

              {/* Exchange Count */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  Conversation Length
                </label>
                <div className="mt-2 flex gap-2">
                  {[
                    { count: 6, label: "6 turns (Quick)" },
                    { count: 8, label: "8 turns (Balanced)" },
                    { count: 10, label: "10 turns (Deep)" },
                  ].map(({ count, label }) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setExchangeCount(count)}
                      className={`flex-1 rounded-md border py-1.5 text-center text-xs font-medium transition ${
                        exchangeCount === count
                          ? "border-red-400 bg-red-950/40 text-red-200"
                          : "border-white/10 bg-black/20 text-zinc-400 hover:border-white/20 hover:text-zinc-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom actions inside options panel */}
          <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={handleResetOptions}
              disabled={!hasCustomOptions}
              className="text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
            >
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Generate with options</span>
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

export default CafeConversationGenerator;
