"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { GrokTab } from "@/components/classify/grok-tab";
import { OllamaTab } from "@/components/classify/ollama-tab";

type Tab = "grok" | "ollama";

const TABS: { id: Tab; label: string }[] = [
  { id: "grok",   label: "Grok" },
  { id: "ollama", label: "Ollama" },
];

export function ClassifyClient() {
  const [activeTab, setActiveTab] = useState<Tab>("grok");

  return (
    <div>
      {/* Header */}
      <div className="px-8 pt-8 pb-6 border-b border-border">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">
          Classify
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Visual Classification</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload an image or video and classify it against the project taxonomy.
        </p>
      </div>

      {/* Tab bar */}
      <div className="px-8 pt-5 pb-0">
        <div className="flex gap-1 border-b border-border">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium transition-colors relative",
                "border-b-2 -mb-px",
                activeTab === tab.id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="px-8 py-6">
        {activeTab === "grok"   && <GrokTab />}
        {activeTab === "ollama" && <OllamaTab />}
      </div>
    </div>
  );
}
