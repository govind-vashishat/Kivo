import { Box, Text } from "ink";
import pkg from "../../../package.json";
import { theme } from "./theme";

// The Kivo cube as pixel art, one character per pixel.
// "M" = mint top face and prompt, "1" "2" "3" = the three slabs of the left face (lighter to
// darker), "F" = the dark right face, "." = empty.
const MARK = [
    ".........MM.........",
    ".......MMMMMM.......",
    ".....MMMMMMMMMM.....",
    "...MMMMMMMMMMMMMM...",
    ".MMMMMMMMMMMMMMMMMM.",
    "1MMMMMMMMMMMMMMMMMMF",
    "111MMMMMMMMMMMMMMFFF",
    "11111MMMMMMMMMMFFFFF",
    ".111111MMMMMMFFFFFFF",
    "2..111111MMFFFFFFFFF",
    "222..11111FFMFFFFFFF",
    "22222..111FFFMFFFFFF",
    ".222222..1FFFFMFFFFF",
    "3..222222.FFFMFFFMMF",
    "333..22222FFMFFMMFFF",
    "33333..222FFFFFFFFFF",
    ".333333..2FFFFFFFFF.",
    "...333333.FFFFFFF...",
    ".....33333FFFFF.....",
    ".......333FFF.......",
    ".........3F.........",
];

const COLORS: Record<string, string | undefined> = {
    M: theme.mint,
    "1": theme.slab1,
    "2": theme.slab2,
    "3": theme.slab3,
    F: theme.face,
};

// A terminal cell is about twice as tall as it is wide, so each cell draws TWO pixels:
// "▀" paints its top half in the text colour and its bottom half in the background colour.
// That gives square pixels, so the cube keeps its proportions.
function Cell({ top, bottom }: { top?: string; bottom?: string }) {
    if (!top && !bottom) return <Text> </Text>;
    if (!top) return <Text color={bottom}>▄</Text>;
    return (
        <Text color={top} backgroundColor={bottom}>
            ▀
        </Text>
    );
}

function Mark() {
    const rows = MARK.length % 2 ? [...MARK, ".".repeat(MARK[0]?.length ?? 0)] : MARK;
    const lines: [string, string][] = [];
    for (let y = 0; y < rows.length; y += 2) lines.push([rows[y] ?? "", rows[y + 1] ?? ""]);

    return (
        <Box flexDirection="column">
            {lines.map(([top, bottom], y) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed grid, never reorders
                <Text key={y}>
                    {[...top].map((pixel, x) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: fixed grid, never reorders
                        <Cell key={x} top={COLORS[pixel]} bottom={COLORS[bottom[x] ?? "."]} />
                    ))}
                </Text>
            ))}
        </Box>
    );
}

export function Banner() {
    const home = process.env.HOME ?? "";
    const cwd =
        home && process.cwd().startsWith(home)
            ? `~${process.cwd().slice(home.length)}`
            : process.cwd();

    return (
        <Box marginTop={1} marginBottom={1} gap={4} alignItems="center">
            <Mark />
            <Box flexDirection="column">
                <Text>
                    <Text color={theme.foreground} bold>
                        kivo
                    </Text>
                    <Text color={theme.faint}> v{pkg.version}</Text>
                </Text>
                <Text color={theme.mute}>a terminal coding agent</Text>
                <Text color={theme.faint}>{cwd}</Text>
                <Text>
                    <Text color={theme.mint}>/help</Text>
                    <Text color={theme.faint}> for commands · </Text>
                    <Text color={theme.mint}>ctrl-c</Text>
                    <Text color={theme.faint}> to quit</Text>
                </Text>
            </Box>
        </Box>
    );
}
