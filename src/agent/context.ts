import type OpenAI from "openai";

type Item = OpenAI.Responses.ResponseInputItem;

export class ContextManager {
    private items: Item[] = [];

    //Initial Task from the user - 
    addUserMessage(text: string) {
        this.items.push({ role: "user", content: text });
    };

    //Model's output items - 
    addModelOutput(outputs: Item[]) {
        this.items.push(...outputs)
    };

    //Tool's output items-
    addToolOutput(outputs: Item[]) {
        this.items.push(...outputs)
    };

    //return items -
    getItems(): Item[] {
        return this.items;
    };
};