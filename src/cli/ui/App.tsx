import { render, Static, useApp } from "ink";
import { useEffect, useRef, useState } from "react";
import { ContextManager } from "../../agent/context";
import type { AgentEvent } from "../../agent/events";
import { runAgent } from "../../agent/loop";
import type { ApprovalRequest } from "../../agent/tools";
import { describeError } from "../render";
import { ApprovalPrompt, Input, type Item, ItemView, Spinner, ToolLine } from "./views";

const HELP = ` /clear   start a fresh conversation
 /help    show this
 /exit    quit`;

interface AppProps {
    initialTask?: string; // one-shot mode: run this, then exit
    autoApprove?: boolean; // --yes
}

interface Pending {
    request: ApprovalRequest;
    resolve: (approved: boolean) => void;
}

export function App({ initialTask, autoApprove = false }: AppProps) {
    const { exit } = useApp();
    const [items, setItems] = useState<Item[]>([{ kind: "banner" }]);
    const [busy, setBusy] = useState(false);
    const [pending, setPending] = useState<Pending | null>(null);
    const [running, setRunning] = useState<{ name: string; input: unknown } | null>(null);

    const context = useRef(new ContextManager()); // one conversation per session
    const toolStarts = useRef(new Map<string, { name: string; input: unknown }>());

    const add = (item: Item) => setItems((prev) => [...prev, item]);

    // Agent events -> transcript items
    const onEvent = (e: AgentEvent) => {
        switch (e.type) {
            case "text_delta":
                add({ kind: "text", text: e.text });
                break;
            case "tool_start":
                toolStarts.current.set(e.id, { name: e.name, input: e.input });
                setRunning({ name: e.name, input: e.input });
                break;
            case "tool_result": {
                const start = toolStarts.current.get(e.id);
                setRunning(null);
                add({
                    kind: "tool",
                    name: start?.name ?? "tool",
                    input: start?.input ?? {},
                    output: e.output,
                    isError: e.isError,
                });
                break;
            }
            case "usage":
                if (process.env.DEBUG)
                    add({
                        kind: "info",
                        text: `tokens in ${e.inputTokens} (cached ${e.cachedInputTokens}), out ${e.outputTokens}`,
                    });
                break;
            case "error":
                add({ kind: "error", text: e.message });
                break;
        }
    };

    // Called by the agent before a change; resolves when the user presses y or n
    const approve = (request: ApprovalRequest): Promise<boolean> => {
        if (autoApprove) {
            add({ kind: "change", request, approved: true });
            return Promise.resolve(true);
        }
        return new Promise((resolve) => setPending({ request, resolve }));
    };

    const decide = (approved: boolean) => {
        if (!pending) return;
        add({ kind: "change", request: pending.request, approved });
        pending.resolve(approved);
        setPending(null);
    };

    const run = async (task: string) => {
        add({ kind: "user", text: task });
        setBusy(true);
        try {
            await runAgent({
                task,
                cwd: process.cwd(),
                context: context.current,
                onEvent,
                approve,
            });
        } catch (err) {
            add({ kind: "error", text: describeError(err) });
        } finally {
            setBusy(false);
            setRunning(null);
            setPending(null);
        }
    };

    const submit = (line: string) => {
        const text = line.trim();
        if (!text) return;
        if (text === "/exit" || text === "/quit") return exit();
        if (text === "/help") return add({ kind: "info", text: HELP });
        if (text === "/clear") {
            context.current = new ContextManager();
            return add({ kind: "info", text: "(conversation cleared)" });
        }
        void run(text);
    };

    // One-shot mode: run the task once on start, then quit
    // biome-ignore lint/correctness/useExhaustiveDependencies: must run exactly once, on mount
    useEffect(() => {
        if (initialTask) void run(initialTask).then(() => exit());
    }, []);

    return (
        <>
            {/* Finished items are printed once and never re-rendered */}
            <Static items={items}>{(item, i) => <ItemView key={i} item={item} />}</Static>

            {pending ? (
                <ApprovalPrompt request={pending.request} onDecide={decide} />
            ) : running ? (
                <ToolLine name={running.name} input={running.input} running />
            ) : busy ? (
                <Spinner label="thinking" />
            ) : initialTask ? null : (
                <Input onSubmit={submit} />
            )}
        </>
    );
}

export async function startUI(props: AppProps) {
    const { waitUntilExit } = render(<App {...props} />);
    await waitUntilExit();
}
