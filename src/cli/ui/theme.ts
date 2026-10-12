// colour only for status: lime = running/passed, green/red = diffs and test results.
export const theme = {
    foreground: "#F5F6F7", // the user's prompt, keywords in code
    strong: "#D0D3D8", // tool arguments, code, the agent's replies
    mute: "#8A8F98", // tool names, ❯, passing test names, strings in code
    faint: "#5C6068", // bullets, line numbers, comments in code
    lime: "#C6F432",
    add: "#4CB782",
    del: "#EB5757",
    addBg: "#16241F", // add at 12% over the panel colour (bg-add/12)
    delBg: "#291819", // del at 12% over the panel colour (bg-del/12)
};
