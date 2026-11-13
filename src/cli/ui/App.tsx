import { type Key, render, Static, useApp, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { loadCatalog } from "../../agent/catalog";
import { ContextManager } from "../../agent/context";
import type { AgentEvent } from "../../agent/events";
import { runAgent } from "../../agent/loop";
import { findModel, findReasoning, type Model, type ModelSettings } from "../../agent/models";
import type { ApprovalRequest } from "../../agent/tools";
import { describeError } from "../render";
import { type CatalogState, filterModels, ModelPicker } from "./ModelPicker";
import { ApprovalPrompt, Input, type Item, ItemView, Spinner, ToolLine } from "./views";

const HELP = ` /model [name]        pick a model from a list, or switch directly, e.g. /model openai/gpt-5-mini
 /reasoning [level]   show or set reasoning: default, none, minimal, low, medium, high, xhigh, max
 /auto                turn auto-approve on or off
 /clear               start a fresh conversation
 /help                show this
 /exit                quit`;

interface AppProps {
    initialTask?: string; // one-shot mode: run this, then exit
    autoApprove?: boolean; // --yes
    modelSettings: ModelSettings;
}

interface Pending {
    request: ApprovalRequest;
    resolve: (approved: boolean) => void;
}

export function App({ initialTask, autoApprove = false, modelSettings }: AppProps) {
    const { exit } = useApp();
    const [items, setItems] = useState<Item[]>([{ kind: "banner" }]);
    const [busy, setBusy] = useState(false);
    const [pending, setPending] = useState<Pending | null>(null);
    const [running, setRunning] = useState<{ name: string; input: unknown } | null>(null);
    const [draft, setDraft] = useState("");
    const [auto, setAuto] = useState(autoApprove);
    const [settings, setSettings] = useState(modelSettings);
    const [catalog, setCatalog] = useState<CatalogState>("loading");
    const [picker, setPicker] = useState<{ query: string; index: number } | null>(null);

    const context = useRef(new ContextManager()); // one conversation per session
    const toolStarts = useRef(new Map<string, { name: string; input: unknown }>());
    // The pending approval also lives in a ref, so a keypress always sees the latest one
    const pendingRef = useRef<Pending | null>(null);
    const autoRef = useRef(autoApprove);
    const setAutoApprove = (on: boolean) => {
        autoRef.current = on;
        setAuto(on);
    };

    const status = [
        settings.model.name,
        `${settings.reasoning} reasoning`,
        auto ? "auto-approve on" : "approvals on",
    ].join(" ");

    const add = (item: Item) => setItems((prev) => [...prev, item]);

    // The picker's rows for what's typed so far; both the view and the keys read this
    const matches = picker && Array.isArray(catalog) ? filterModels(catalog, picker.query) : [];

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
            case "compaction":
                add({
                    kind: "info",
                    text: `context: cleared ${e.cleared} old tool outputs (${e.charsBefore.toLocaleString("en-US")} → ${e.charsAfter.toLocaleString("en-US")} chars)`,
                });
                break;
        }
    };

    // Called by the agent before a change; resolves when the user presses y or n
    const approve = (request: ApprovalRequest): Promise<boolean> => {
        if (autoRef.current) {
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
                modelSettings: settings,
                onEvent,
                approve,
            });
        } catch (err) {
            add({ kind: "error", text: describeError(err, settings.model) });
        } finally {
            setBusy(false);
            setRunning(null); // a crashed run never sends tool_result, so clear it here
            pendingRef.current = null;
            setPending(null);
        }
    };

    // `/model` alone opens the picker; `/model name` switches straight away
    const switchModel = (arg: string) => {
        if (!arg) return setPicker({ query: "", index: 0 });
        try {
            applyModel(findModel(arg));
        } catch (err) {
            add({ kind: "error", text: describeError(err) });
        }
    };

    // The one place a model gets switched, from the picker or from a typed name
    const applyModel = (model: Model) => {
        const { keyEnv } = model.provider;
        if (!process.env[keyEnv]) {
            return add({
                kind: "error",
                text: `${keyEnv} isn't set, staying on ${settings.model.name}. Set it and restart kivo.`,
            });
        }
        setSettings((s) => ({ ...s, model }));
        add({ kind: "info", text: `model set to ${model.name}` });

        // A name models.dev doesn't know is still accepted: the list can lag behind a release
        if (Array.isArray(catalog) && !catalog.some((m) => m.model.name === model.name)) {
            add({
                kind: "info",
                text: `note: ${model.name} isn't in the models.dev list, check the name if the next prompt fails`,
            });
        }
    };

    // Keys while the picker is open
    const pickerKey = (p: { query: string; index: number }, input: string, key: Key) => {
        if (key.escape) return setPicker(null);
        if (key.return) {
            setPicker(null);
            const picked = matches[p.index];
            if (picked) return applyModel(picked.model);
            if (p.query.trim()) return switchModel(p.query.trim()); // no match: use it as typed
            return;
        }
        if (key.upArrow) return setPicker({ ...p, index: Math.max(0, p.index - 1) });
        if (key.downArrow) {
            return setPicker({ ...p, index: Math.min(matches.length - 1, p.index + 1) });
        }
        // Typing changes the list, so the highlight goes back to the top
        if (key.backspace || key.delete)
            return setPicker({ query: p.query.slice(0, -1), index: 0 });
        if (input && !key.ctrl && !key.meta && !key.tab) {
            setPicker({ query: p.query + input, index: 0 });
        }
    };

    const switchReasoning = (arg: string) => {
        if (!arg) {
            return add({ kind: "info", text: `reasoning: ${settings.reasoning}` });
        }
        try {
            const reasoning = findReasoning(arg);
            setSettings((s) => ({ ...s, reasoning }));
            add({ kind: "info", text: `reasoning set to ${reasoning}` });
        } catch (err) {
            add({ kind: "error", text: describeError(err) });
        }
    };

    const submit = (line: string) => {
        const text = line.trim();
        if (!text) return;

        const [command = "", ...rest] = text.split(/\s+/);
        const arg = rest.join(" ");

        if (command === "/exit" || command === "/quit") return exit();
        if (command === "/help") return add({ kind: "info", text: HELP });
        if (command === "/model") return switchModel(arg);
        if (command === "/reasoning") return switchReasoning(arg);
        if (command === "/auto") {
            const on = !autoRef.current;
            setAutoApprove(on);
            return add({
                kind: "info",
                text: on ? "auto-approve on: changes run without asking" : "auto-approve off",
            });
        }
        if (command === "/clear") {
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
                if (input === "a" || input === "A") {
                    setAutoApprove(true);
                    decide(true);
                    add({
                        kind: "info",
                        text: "auto-approve on for this session (/auto to turn off)",
                    });
                }
                return;
            }
            if (picker) return pickerKey(picker, input, key);
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

    // One-shot mode: run the task once on start, then quit.
    // Otherwise fetch the model list now, so the picker is ready when /model is typed.
    // biome-ignore lint/correctness/useExhaustiveDependencies: must run exactly once, on mount
    useEffect(() => {
        if (initialTask) {
            void run(initialTask).then(() => exit());
            return;
        }
        loadCatalog().then(setCatalog, (err) => setCatalog({ error: describeError(err) }));
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
            ) : initialTask ? null : picker ? (
                <ModelPicker
                    catalog={catalog}
                    matches={matches}
                    query={picker.query}
                    index={picker.index}
                    current={settings.model.name}
                />
            ) : (
                <Input value={draft} status={status} />
            )}
        </>
    );
}

export async function startUI(props: AppProps) {
    const { waitUntilExit } = render(<App {...props} />);
    await waitUntilExit();
}
