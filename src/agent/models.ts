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
    "max",
] as const;

export type Reasoning = (typeof REASONING_LEVELS)[number];

export interface ModelSettings {
    model: string;
    reasoning: Reasoning;
}

const providers: Record<string, (id: string) => LanguageModel> = {
    openai: (id) => openai(id),
};

function parseModel(name: string) {
    const text = name.trim();
    const slash = text.indexOf("/");
    const provider = slash === -1 ? "openai" : text.slice(0, slash);
    const id = slash === -1 ? text : text.slice(slash + 1);

    const create = Object.hasOwn(providers, provider) ? providers[provider] : undefined;
    if (!create) {
        const available = Object.keys(providers).join(" ");
        throw new Error(`unknown provider "${provider}" (available: ${available})`);
    }
    if (!id) throw new Error(`missing model name in "${name}"`);
    return { provider, id, create };
}

export function normalizeModel(name: string): string {
    const { provider, id } = parseModel(name);
    return `${provider}/${id}`;
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
