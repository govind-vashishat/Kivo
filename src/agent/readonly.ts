const READ_ONLY = new Set([
    "ls",
    "pwd",
    "cat",
    "head",
    "tail",
    "wc",
    "grep",
    "find",
    "stat",
    "du",
    "which",
    "echo",
    "diff",
    "cut",
]);

const READ_ONLY_GIT = new Set(["status", "diff", "log", "show", "ls-files", "rev-parse", "blame"]);

const FIND_WRITES = [
    "-exec",
    "-execdir",
    "-ok",
    "-okdir",
    "-delete",
    "-fprint",
    "-fprintf",
    "-fls",
];

export function isReadOnlyCommand(command: string): boolean {
    // Anything that chains, redirects or substitutes could hide a write: ; && || & > < ` $( newline
    if (/[;&><`\n]|\$\(/.test(command)) return false;

    return command.split("|").every((part) => {
        const words = part.trim().split(/\s+/);
        const [program, sub] = words;
        if (!program) return false;

        if (program === "git") return sub !== undefined && READ_ONLY_GIT.has(sub);
        if (program === "find") return !words.some((w) => FIND_WRITES.includes(w));
        return READ_ONLY.has(program);
    });
}
