//Event types -
export type AgentEvent =
    | { type: "turn_start"; step: number }
    | { type: "text_delta"; text: string }
    | {
          type: "usage";
          step: number;
          inputTokens: number;
          cachedInputTokens: number;
          outputTokens: number;
          reasoningTokens: number;
      }
    | { type: "tool_start"; name: string; input: unknown; id: string }
    | { type: "tool_result"; id: string; output: string; isError: boolean }
    | { type: "turn_end"; stopReason: string }
    | { type: "error"; message: string }
    | { type: "thinking_start" }
    | { type: "thinking_end" };

export type AgentEventListener = (event: AgentEvent) => void;
