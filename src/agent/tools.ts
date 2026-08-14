import { $ } from "bun";
import { resolve } from "node:path";

//Tool schemas -
export const toolDefinitions = [
    {
        type: "function" as const,
        name: "read_file",
        description: "Read the full contents of a file at the given path.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Relative or absolute file path" },
            },
            required: ["path"],
        },
    },
    {
        type: "function" as const,
        name: "write_file",
        description:
          "Create a file or overwrite it entirely. Use for new files; prefer edit_file for existing ones.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string" },
                content: { type: "string" }
            },
            required: ["path", "content"],
        },
    },
    {
        type: "function" as const,
        name: "edit_file",
        description: 
          "Replace an exact snippet in an existing file. old_text must appear exactly once. Cheaper and safer than rewriting the whole file.",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string" },
                old_text: { type: "string" },
                new_text: { type: "string" },
            },
            required: ["path", "old_text", "new_text"],
        },
    },
    {
        type: "function" as const,
        name: "run_bash",
        description: 
          "Run a shell command in the working directory (e.g. to run tests). Returns stdout, stderr, and exit code.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string" },
            },
            required: ["command"],
        },
    },
];

export type ToolName = "read_file" | "write_file" | "edit_file" | "run_bash";

//Tool executor - 
export async function executeTool(
    name: ToolName,
    input: any,
    cwd: string
) {
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
                    return { output: `old_text not found in ${input.path}`, isError: true }
                if (count > 1)
                    return { output: `old_text matches ${count} times — must be unique. Add surrounding context.`, isError: true }

                const updated = original.replace(input.old_text, input.new_text);
                await Bun.write(path, updated);
                return { output: `Edited ${input.path}`, isError: false }
            }

            case "run_bash": {
                const result = await $`${{ raw: input.command }}`
                    .cwd(cwd)
                    .nothrow()
                    .quiet();

                const out = result.stdout.toString();
                const err = result.stderr.toString();
                const body = `stdout:\n${out}\stderr:\n${err}\n(exit code ${result.exitCode})`;

                return { output: body, isError: result.exitCode !== 0 };
            }

            default: {
                return { output: `Unknown tool: ${name}`, isError: true };
            }
        };
    } catch (err: any) {
        return { output: String(err?.message ?? err), isError: true }
    }
};