import type { ModelMessage } from "ai";
import type { Model } from "./models";

export function ownReasoningOnly(messages: ModelMessage[], model: Model): ModelMessage[] {
    const tag = model.provider.reasoningTag;

    return messages.flatMap((message) => {
        if (message.role !== "assistant" || typeof message.content === "string") return [message];

        const content = message.content.filter((part) => {
            if (part.type !== "reasoning") return true;
            const tags = Object.keys(part.providerOptions ?? {});
            return tag ? tags.includes(tag) : tags.length === 0;
        });
        if (content.length === message.content.length) return [message];
        if (content.length === 0) return [];
        return [{ ...message, content }];
    });
}
