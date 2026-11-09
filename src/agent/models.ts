import { anthropic } from "@ai-sdk/anthropic";
import { deepseek } from "@ai-sdk/deepseek";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

// Providers -
interface Provider {
    label: string;
    keyEnv: string;
    reasoningTag: string | null;
    create: (id: string) => LanguageModel;
}

const providers: Record<string, Provider> = {
    openai: {
        label: "OpenAI",
        keyEnv: "OPENAI_API_KEY",
        reasoningTag: "openai",
        create: (id) => openai(id),
    },
    anthropic: {
        label: "Anthropic",
        keyEnv: "ANTHROPIC_API_KEY",
        reasoningTag: "anthropic",
        create: (id) => anthropic(id),
    },
    deepseek: {
        label: "DeepSeek",
        keyEnv: "DEEPSEEK_API_KEY",
        reasoningTag: null,
        create: (id) => deepseek(id),
    },
};

// Models -

export interface Model {
    name: string;
    id: string;
    provider: Provider;
}

export const DEFAULT_MODEL = "openai/gpt-5";

export function findModel(text: string): Model {
    const trimmed = text.trim();
    const slash = trimmed.indexOf("/");
    const providerKey = slash === -1 ? "openai" : trimmed.slice(0, slash);
    const id = slash === -1 ? trimmed : trimmed.slice(slash + 1);

    const provider = Object.hasOwn(providers, providerKey) ? providers[providerKey] : undefined;
    if (!provider) {
        const available = Object.keys(providers).join(" ");
        throw new Error(`unknown provider "${providerKey}" (available: ${available})`);
    }
    if (!id) throw new Error(`missing model name in "${text}"`);

    return { name: `${providerKey}/${id}`, id, provider };
}

//Reasoning -

export const REASONING_LEVELS = [
    "default",
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
] as const;

export type Reasoning = (typeof REASONING_LEVELS)[number];

export function findReasoning(text: string): Reasoning {
    const level = REASONING_LEVELS.find((l) => l === text.trim().toLowerCase());
    if (!level) {
        throw new Error(
            `unknown reasoning level ${text} (use one of ${REASONING_LEVELS.join(", ")})`,
        );
    }
    return level;
}

// Settings -
export interface ModelSettings {
    model: Model;
    reasoning: Reasoning;
}

export function loadModelSettings(
    flags: { model?: string; reasoning?: string } = {},
): ModelSettings {
    return {
        model: findModel(flags.model || process.env.KIVO_MODEL || DEFAULT_MODEL),
        reasoning: findReasoning(flags.reasoning || process.env.KIVO_REASONING || "default"),
    };
}
