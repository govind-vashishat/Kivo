import { render, Static, useApp, useInput } from "ink";
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
    const [draft, setDraft] = useState(""); // what's typed in the input box

    const context = useRef(new ContextManager()); // one conversation per session
    const toolStarts = useRef(new Map<string, { name: string; input: unknown }>());
    // The pending approval also lives in a ref, so a keypress always sees the latest one
    const pendingRef = useRef<Pending | null>(null);

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
        return new Promise((resolve) => {
            pendingRef.current = { request, resolve };
            setPending(pendingRef.current);
        });
    };

    const decide = (approved: boolean) => {
        const p = pendingRef.current;
        if (!p) return;
        pendingRef.current = null; // clear first, so a double press can't answer twice
        setPending(null);
        add({ kind: "change", request: p.request, approved });
        p.resolve(approved);
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
            setRunning(null); // a crashed run never sends tool_result, so clear it here
            pendingRef.current = null;
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

    // The ONLY keyboard handler in the app. It stays mounted for the whole session, so the
    // terminal never leaves raw mode: keys pressed while the agent works are seen and dropped
    // here, instead of piling up and silently answering the next approval prompt.
    useInput(
        (input, key) => {
            if (pendingRef.current) {
                if (input === "y" || input === "Y") decide(true);
                if (input === "n" || input === "N") decide(false);
                return;
            }
            if (busy || initialTask) return; // agent is working: ignore typing

            if (key.return) {
                submit(draft);
                setDraft("");
            } else if (key.backspace || key.delete) {
                setDraft((v) => v.slice(0, -1));
            } else if (!key.ctrl && !key.meta && !key.tab && !key.upArrow && !key.downArrow) {
                setDraft((v) => v + input);
            }
        },
        { isActive: Boolean(process.stdin.isTTY) }, // e.g. `kivo --yes "..."` in a script
    );

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
                <ApprovalPrompt request={pending.request} />
            ) : running ? (
                <ToolLine name={running.name} input={running.input} running />
            ) : busy ? (
                <Spinner label="thinking" />
            ) : initialTask ? null : (
                <Input value={draft} />
            )}
        </>
    );
}

export async function startUI(props: AppProps) {
    const { waitUntilExit } = render(<App {...props} />);
    await waitUntilExit();
}
