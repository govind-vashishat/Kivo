import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import type { ApprovalRequest } from "../../agent/tools";
import { DiffView } from "./DiffView";
import { theme } from "./theme";

// Everything that can appear in the transcript.
export type Item =
    | { kind: "banner" }
    | { kind: "user"; text: string }
    | { kind: "text"; text: string }
    | { kind: "tool"; name: string; input: any; output: string; isError: boolean }
    | { kind: "change"; request: ApprovalRequest; approved: boolean }
    | { kind: "info"; text: string }
    | { kind: "error"; text: string };

const LOGO = `
 ██╗  ██╗██╗██╗   ██╗ ██████╗
 ██║ ██╔╝██║██║   ██║██╔═══██╗
 █████╔╝ ██║██║   ██║██║   ██║
 ██╔═██╗ ██║╚██╗ ██╔╝██║   ██║
 ██║  ██╗██║ ╚████╔╝ ╚██████╔╝
 ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═════╝`;

export function ItemView({ item }: { item: Item }) {
    switch (item.kind) {
        case "banner":
            return (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color={theme.strong}>{LOGO}</Text>
                    <Text color={theme.mute}> a terminal coding agent · {process.cwd()}</Text>
                    <Text color={theme.faint}> /help for commands · ctrl-c to quit</Text>
                </Box>
            );
        case "user":
            return (
                <Box marginY={1}>
                    <Text color={theme.mute}>❯ </Text>
                    <Text color={theme.foreground}>{item.text}</Text>
                </Box>
            );
        case "text":
            return (
                <Box marginY={1}>
                    <Text color={theme.strong}>{item.text}</Text>
                </Box>
            );
        case "tool":
            return <ToolResult {...item} />;
        case "change":
            return (
                <Box flexDirection="column" marginY={1}>
                    <ChangeView request={item.request} />
                    {!item.approved && <Text color={theme.del}>✗ rejected</Text>}
                </Box>
            );
        case "info":
            return <Text color={theme.mute}>{item.text}</Text>;
        case "error":
            return <Text color={theme.del}>✗ {item.text}</Text>;
    }
}

const TOOL_LABELS: Record<string, string> = { run_bash: "run" };

// "● read_file  src/rates.js": grey dot when done, lime while it runs
export function ToolLine({
    name,
    input,
    running,
}: {
    name: string;
    input: any;
    running?: boolean;
}) {
    const label = (TOOL_LABELS[name] ?? name).padEnd(10);
    const arg = name === "run_bash" ? input?.command : input?.path;

    return (
        <Text>
            <Text color={running ? theme.lime : theme.faint}>● </Text>
            <Text color={theme.mute}>{label} </Text>
            <Text color={theme.strong}>{arg}</Text>
        </Text>
    );
}

// A finished tool call; "run" also shows the command's output
function ToolResult({ name, input, output, isError }: Omit<Item & { kind: "tool" }, "kind">) {
    return (
        <Box flexDirection="column">
            <ToolLine name={name} input={input} />
            {name === "run_bash" && <CommandOutput output={output} />}
            {name !== "run_bash" && isError && (
                <Text color={theme.del}> {output.slice(0, 200)}</Text>
            )}
        </Box>
    );
}

const MAX_OUTPUT_LINES = 14;

// The last lines of a command's output, coloured like the landing page's test visual
function CommandOutput({ output }: { output: string }) {
    // tools.ts formats it as "stdout:\n...\nstderr:\n...\n(exit code N)"
    const stdout = output.split("\nstderr:")[0]?.replace(/^stdout:\n/, "") ?? "";
    const stderr = output.split("\nstderr:\n")[1]?.replace(/\n\(exit code \d+\)$/, "") ?? "";
    const exitCode = output.match(/\(exit code (\d+)\)$/)?.[1] ?? "0";

    const text = stdout.trim() ? stdout : stderr;
    const lines = dedent(text.split("\n").filter((l) => l.trim() !== ""));
    const shown = lines.slice(-MAX_OUTPUT_LINES);

    const passed = text.match(/(\d+) pass/)?.[1];
    const failed = Number(text.match(/(\d+) fail/)?.[1] ?? 0);

    return (
        <Box flexDirection="column" marginLeft={2} marginY={1}>
            {lines.length > shown.length && (
                <Text color={theme.faint}>… {lines.length - shown.length} earlier lines</Text>
            )}
            {shown.map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: output lines never reorder
                <OutputLine key={i} line={line} />
            ))}
            {lines.length === 0 && <Text color={theme.faint}>(no output)</Text>}
            {exitCode === "0" && passed && failed === 0 && (
                <Box marginTop={1}>
                    <Text color={theme.lime}>✓ {passed} tests passed</Text>
                </Box>
            )}
        </Box>
    );
}

function OutputLine({ line }: { line: string }) {
    const indent = line.slice(0, line.length - line.trimStart().length);
    const t = line.trim();

    // ✓ green + muted name for passing tests, ✗ red + bright name for failing ones
    if (t.startsWith("✓") || t.startsWith("✗") || t.startsWith("✕")) {
        const pass = t.startsWith("✓");
        return (
            <Text>
                {indent}
                <Text color={pass ? theme.add : theme.del}>{pass ? "✓" : "✗"}</Text>
                <Text color={pass ? theme.mute : theme.strong}>{t.slice(1)}</Text>
            </Text>
        );
    }

    // "expected X" in green, "actual/received X" in red
    const value = line.match(/^(\s*)(expected|actual|received)(\s+)(.*)$/);
    if (value) {
        const color = value[2] === "expected" ? theme.add : theme.del;
        return (
            <Text>
                <Text color={theme.mute}>{`${value[1]}${value[2]}${value[3]}`}</Text>
                <Text color={color}>{value[4]}</Text>
            </Text>
        );
    }

    // "10 passed, 3 failed": pass part green, fail part red when > 0
    const summary = line.match(/^(.*?)(\d+ pass\w*)(.*?)(\d+) (fail\w*)(.*)$/);
    if (summary) {
        return (
            <Text color={theme.mute}>
                {summary[1]}
                <Text color={theme.add}>{summary[2]}</Text>
                {summary[3]}
                <Text color={summary[4] === "0" ? theme.mute : theme.del}>
                    {summary[4]} {summary[5]}
                </Text>
                {summary[6]}
            </Text>
        );
    }
    return <Text color={theme.mute}>{line}</Text>;
}

// Remove the indentation every line shares, keep the rest (so nesting survives)
function dedent(lines: string[]): string[] {
    const indent = Math.min(...lines.map((l) => l.length - l.trimStart().length));
    return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
}

// The diff for file changes, or the command for run_bash.
function ChangeView({ request }: { request: ApprovalRequest }) {
    if (request.tool === "run_bash") {
        return (
            <Text>
                <Text color={theme.faint}>$ </Text>
                <Text color={theme.strong}>{request.command}</Text>
            </Text>
        );
    }
    return (
        <DiffView
            path={request.path ?? ""}
            before={request.before ?? ""}
            after={request.after ?? ""}
        />
    );
}

export function ApprovalPrompt({
    request,
    onDecide,
}: {
    request: ApprovalRequest;
    onDecide: (approved: boolean) => void;
}) {
    useInput((input) => {
        if (input === "y" || input === "Y") onDecide(true);
        if (input === "n" || input === "N") onDecide(false);
    });

    const question = request.tool === "run_bash" ? "Run this command?" : "Apply this change?";
    return (
        <Box flexDirection="column" marginY={1}>
            <ChangeView request={request} />
            <Box marginTop={1}>
                <Text color={theme.foreground}>{question} </Text>
                <Text color={theme.lime}>y</Text>
                <Text color={theme.faint}> / </Text>
                <Text color={theme.foreground}>n</Text>
            </Box>
        </Box>
    );
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({ label }: { label: string }) {
    const [frame, setFrame] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
        return () => clearInterval(timer);
    }, []);

    return (
        <Text>
            <Text color={theme.lime}>{FRAMES[frame]} </Text>
            <Text color={theme.mute}>{label}…</Text>
        </Text>
    );
}

// A one-line text input; Ink owns stdin, so we read keys ourselves (no readline).
export function Input({ onSubmit }: { onSubmit: (line: string) => void }) {
    const [value, setValue] = useState("");

    useInput((input, key) => {
        if (key.return) {
            onSubmit(value);
            setValue("");
        } else if (key.backspace || key.delete) {
            setValue((v) => v.slice(0, -1));
        } else if (!key.ctrl && !key.meta && !key.tab && !key.upArrow && !key.downArrow) {
            setValue((v) => v + input);
        }
    });

    return (
        <Box marginTop={1}>
            <Text color={theme.mute}>❯ </Text>
            <Text color={theme.foreground}>{value}</Text>
            <Text backgroundColor={theme.mute}> </Text>
        </Box>
    );
}
