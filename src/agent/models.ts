import { anthropic } from "@ai-sdk/anthropic";
import { deepseek } from "@ai-sdk/deepseek";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export const DEFAULT_MODEL = "openai/gpt-5";

export const REASONING_LEVELS = [
    "provider-default",
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
] as const;

export type Reasoning = (typeof REASONING_LEVELS)[number];

export interface ModelSettings {
    model: string;
    reasoning: Reasoning;
}

interface Provider {
    name: string;
    keyEnv: string;
    create: (id: string) => LanguageModel;
}

const providers: Record<string, Provider> = {
    openai: { name: "OpenAI", keyEnv: "OPENAI_API_KEY", create: (id) => openai(id) },
    anthropic: { name: "Anthropic", keyEnv: "ANTHROPIC_API_KEY", create: (id) => anthropic(id) },
    deepseek: { name: "Deepseek", keyEnv: "DEEPSEEK_API_KEY", create: (id) => deepseek(id) },
};

function parseModel(name: string) {
    const text = name.trim();
    const slash = text.indexOf("/");
    const providerKey = slash === -1 ? "openai" : text.slice(0, slash);
    const id = slash === -1 ? text : text.slice(slash + 1);

    const provider = Object.hasOwn(providers, providerKey) ? providers[providerKey] : undefined;
    if (!provider) {
        const available = Object.keys(providers).join(" ");
        throw new Error(`unknown provider "${providerKey}" (available: ${available})`);
    }
    if (!id) throw new Error(`missing model name in "${name}"`);
    return { providerKey, id, provider };
}

export function normalizeModel(name: string): string {
    const { providerKey, id } = parseModel(name);
    return `${providerKey}/${id}`;
}

export function resolveModel(name: string): LanguageModel {
    const { id, provider } = parseModel(name);
    return provider.create(id);
}

export function modelInfo(name: string) {
    const { id, provider } = parseModel(name);
    return { id, provider: provider.name, keyEnv: provider.keyEnv };
}

export function missingKey(name: string): string | undefined {
    const { keyEnv } = modelInfo(name);
    return process.env[keyEnv] ? undefined : keyEnv;
}

export function parseReasoning(value: string): Reasoning {
    const text = value.trim().toLowerCase();
    const level = text === "default" ? "provider-default" : text;
    const found = REASONING_LEVELS.find((l) => l === level);
    if (!found) {
        const options = ["default", ...REASONING_LEVELS.slice(1)].join(", ");
        throw new Error(`unknown reasoning level "${value}" (use one of: ${options})`);
    }
    return found;
}

export function resolveModelSettings(
    overrides: { model?: string; reasoning?: string } = {},
): ModelSettings {
    return {
        model: normalizeModel(overrides.model || process.env.KIVO_MODEL || DEFAULT_MODEL),
        reasoning: parseReasoning(overrides.reasoning || process.env.KIVO_REASONING || "default"),
    };
}

export function reasoningLabel(reasoning: Reasoning): string {
    return reasoning === "provider-default" ? "default" : reasoning;
}
