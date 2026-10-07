import { structuredPatch } from "diff";
import { Box, Text } from "ink";
import { theme } from "./theme";

const MAX_ROWS = 40;

interface Row {
    type: "ctx" | "add" | "del" | "gap";
    oldNo?: number;
    newNo?: number;
    code: string;
}

// "Changed 1 file  +1 −1", the path, then a unified diff with old/new line numbers.
export function DiffView({ path, before, after }: { path: string; before: string; after: string }) {
    const rows = toRows(before, after);
    const added = rows.filter((r) => r.type === "add").length;
    const removed = rows.filter((r) => r.type === "del").length;

    return (
        <Box flexDirection="column">
            <Text>
                <Text color={theme.strong}>Changed 1 file </Text>
                <Text color={theme.add}> +{added}</Text>
                <Text color={theme.del}> −{removed}</Text>
            </Text>
            <Text color={theme.mute}>{path}</Text>
            <Box flexDirection="column" marginTop={1}>
                {rows.slice(0, MAX_ROWS).map((row, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: diff rows never reorder
                    <DiffRow key={i} row={row} />
                ))}
                {rows.length > MAX_ROWS && (
                    <Text color={theme.faint}>… {rows.length - MAX_ROWS} more lines</Text>
                )}
            </Box>
        </Box>
    );
}

const SIGN = { ctx: " ", add: "+", del: "−" };
const SIGN_COLOR = { ctx: theme.faint, add: theme.add, del: theme.del };
const ROW_BG = { ctx: undefined, add: theme.addBg, del: theme.delBg };

function DiffRow({ row }: { row: Row }) {
    if (row.type === "gap") return <Text color={theme.faint}> ⋯</Text>;
    const num = (n?: number) => (n === undefined ? "" : String(n)).padStart(4);

    return (
        <Box backgroundColor={ROW_BG[row.type]}>
            <Text color={theme.faint}>{`${num(row.oldNo)}${num(row.newNo)}`}</Text>
            <Text color={SIGN_COLOR[row.type]}> {SIGN[row.type]} </Text>
            <Code code={row.code} />
        </Box>
    );
}

// Greyscale syntax highlighting, same rule as the landing page:
// keywords brighter, strings dimmer, comments dimmest.
const TOKEN =
    /(\/\/.*$|"[^"]*"|`[^`]*`|\b(?:import|export|from|const|let|return|function|async|await|for|of|while|if|type|true|yield)\b)/g;

function Code({ code }: { code: string }) {
    return (
        <Text color={theme.strong}>
            {code.split(TOKEN).map((part, i) => {
                if (i % 2 === 0) return part;
                const color = part.startsWith("//")
                    ? theme.faint
                    : part.startsWith('"') || part.startsWith("`")
                      ? theme.mute
                      : theme.foreground;
                return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: tokens never reorder
                    <Text key={i} color={color}>
                        {part}
                    </Text>
                );
            })}
        </Text>
    );
}

// Turn a patch into rows that carry their own old/new line numbers.
function toRows(before: string, after: string): Row[] {
    const patch = structuredPatch("a", "b", before, after, "", "", { context: 3 });
    const rows: Row[] = [];

    patch.hunks.forEach((hunk, h) => {
        if (h > 0) rows.push({ type: "gap", code: "" });
        let oldNo = hunk.oldStart;
        let newNo = hunk.newStart;
        for (const line of hunk.lines) {
            const code = line.slice(1);
            if (line.startsWith("+")) rows.push({ type: "add", newNo: newNo++, code });
            else if (line.startsWith("-")) rows.push({ type: "del", oldNo: oldNo++, code });
            else if (line.startsWith(" "))
                rows.push({ type: "ctx", oldNo: oldNo++, newNo: newNo++, code });
            // lines starting with "\" ("No newline at end of file") are skipped
        }
    });
    return rows;
}
