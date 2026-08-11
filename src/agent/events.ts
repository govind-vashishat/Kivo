export type AgentEvent =
    | { type: "text_delta"; text: string }
    | { type: "tool_start"; name: string  }
    | { type: "tool_result"; id: string; output: string; isError: boolean }
    | { type: "turn_end"; stopReason: string }
    | { type: "error"; message: string }

export type AgentEventListener = (event: AgentEvent) => void;