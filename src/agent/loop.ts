import type { AgentEventListener } from "./events";

export interface RunOptions {
    task: string;
    cwd: string;
    maxSteps?: number;
    model?: string;
    onEvent?: AgentEventListener
}; 

export interface RunResult {
    stopReason: "completed" | "max_steps";
    steps: number;
}

const SYSTEM_PROMPT = `You are a coding agent working in a real filesystem. You have tools to read, write, and edit files, and to run shell commands. Work step by step: inspect files before editing, make the smallest change that solves the task, and verify your work by running tests or build commands. When a command fails, read the error output and fix the actual problem — do not guess blindly or claim success without verifying.`;