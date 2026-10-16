import { resolve } from "node:path";
import { tool } from "ai";
import z from "zod";
import { isReadOnlyCommand } from "./readonly";

//Tool schemas -
export const toolDefinitions = {
    read_file: tool({
        description: "Read the full contents of a file at the given path.",
        inputSchema: z.object({
            path: z.string().describe("Relative or absolute file path"),
        }),
    }),

    write_file: tool({
        description:
            "Create a file or overwrite it entirely. Use for new files; prefer edit_file for existing ones.",
        inputSchema: z.object({
            path: z.string(),
            content: z.string(),
        }),
    }),

    edit_file: tool({
        description:
            "Replace an exact snippet in an existing file. old_text must appear exactly once. Cheaper and safer than rewriting the whole file.",
        inputSchema: z.object({
            path: z.string(),
            old_text: z
                .string()
                .describe(
                    "Exact text to replace, including whitespace and indentation. Must appear exactly once in the file.",
                ),
            new_text: z.string().describe("Text to replace it with"),
        }),
    }),

    run_bash: tool({
        description:
            "Run a shell command in the working directory (e.g. to run tests). Returns stdout, stderr, and exit code.",
        inputSchema: z.object({
            command: z.string().describe("Shell command to run, e.g. 'node test.js'"),
        }),
    }),
};

export type ToolName = keyof typeof toolDefinitions;

export const COMMAND_TIMEOUT_MINUTES = 5;

//Tool executor -
export async function executeTool(name: ToolName, input: any, cwd: string) {
    try {
        switch (name) {
            case "read_file": {
                const path = resolve(cwd, input.path);
                const content = await Bun.file(path).text();
                return { output: content, isError: false };
            }

            case "write_file": {
                const path = resolve(cwd, input.path);
                await Bun.write(path, input.content);
                return { output: `Wrote ${input.path}`, isError: false };
            }

            case "edit_file": {
                const path = resolve(cwd, input.path);
                const original = await Bun.file(path).text();

                const count = original.split(input.old_text).length - 1;
                if (count === 0)
                    return { output: `old_text not found in ${input.path}`, isError: true };
                if (count > 1)
                    return {
                        output: `old_text matches ${count} times — must be unique. Add surrounding context.`,
                        isError: true,
                    };

                const updated = original.replace(input.old_text, input.new_text);
                await Bun.write(path, updated);
                return { output: `Edited ${input.path}`, isError: false };
            }

            case "run_bash": {
                const { out, err, exitCode, timedOut } = await runCommand(input.command, cwd);
                const note = timedOut
                    ? `\n(stopped after ${COMMAND_TIMEOUT_MINUTES} minutes: the command did not finish. It may be waiting for input or running forever, like a dev server.)`
                    : "";
                const body = `stdout:\n${out}\nstderr:\n${err}${note}\n(exit code ${exitCode})`;

                return { output: body, isError: timedOut || exitCode !== 0 };
            }

            default: {
                return { output: `Unknown tool: ${name}`, isError: true };
            }
        }
    } catch (err: any) {
        return { output: String(err?.message ?? err), isError: true };
    }
}

async function runCommand(command: string, cwd: string) {
    const proc = Bun.spawn(["bash", "-c", command], {
        cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
        env: { ...process.env, CI: "1", npm_config_yes: "true", NO_COLOUR: "1" },
    });

    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        try {
            process.kill(-proc.pid, "SIGKILL");
        } catch {}
    }, COMMAND_TIMEOUT_MINUTES * 60_000);

    const [out, err, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    clearTimeout(timer);

    return { out, err, exitCode, timedOut };
}

// What a tool is about to change, so the UI can show it and ask first
export interface ApprovalRequest {
    tool: ToolName;
    path?: string;
    before?: string;
    after?: string;
    command?: string;
}

export async function describeChange(
    name: ToolName,
    input: any,
    cwd: string,
): Promise<ApprovalRequest | null> {
    switch (name) {
        case "write_file": {
            const file = Bun.file(resolve(cwd, input.path));
            const before = (await file.exists()) ? await file.text() : "";
            return { tool: name, path: input.path, before, after: input.content };
        }

        case "edit_file": {
            const file = Bun.file(resolve(cwd, input.path));
            if (!(await file.exists())) return null;

            const before = await file.text();
            if (before.split(input.old_text).length - 1 !== 1) return null;
            return {
                tool: name,
                path: input.path,
                before,
                after: before.replace(input.old_text, input.new_text),
            };
        }

        case "run_bash":
            if (isReadOnlyCommand(input.command)) return null;
            return { tool: name, command: input.command };

        default:
            return null;
    }
}
