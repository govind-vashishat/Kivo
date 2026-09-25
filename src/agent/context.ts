import type { ModelMessage, ToolResultPart } from "ai";

export class ContextManager {
    private items: ModelMessage[] = [];

    //Initial Task from the user - 
    addUserMessage(text: string) {
        this.items.push({ role: "user", content: text });
    };

    //Model's output items - 
    addModelOutput(messages: ModelMessage[]) {
        this.items.push(...messages);
    };

    //Tool results - all parts from one turn go in a single tool message -
    addToolOutput(parts: ToolResultPart[]) {
        this.items.push({ role: "tool", content: parts });
    };

    //return items -
    getItems(): ModelMessage[] {
        return this.items;
    };
};