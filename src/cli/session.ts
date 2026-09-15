import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ContextManager } from "../agent/context";
import { runAgent } from "../agent/loop";
import { renderEvent, rule, c } from "./render";

const BANNER = `
\x1b[36m
 ██╗  ██╗██╗██╗   ██╗ ██████╗
 ██║ ██╔╝██║██║   ██║██╔═══██╗
 █████╔╝ ██║██║   ██║██║   ██║
 ██╔═██╗ ██║╚██╗ ██╔╝██║   ██║
 ██║  ██╗██║ ╚████╔╝ ╚██████╔╝
 ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═════╝
\x1b[0m
 a terminal coding agent
 \x1b[90mcwd: ${process.cwd()}\x1b[0m

 Type a task and press enter. Commands:
   \x1b[33m/clear\x1b[0m   start a fresh conversation
   \x1b[33m/help\x1b[0m    show this again
   \x1b[33m/exit\x1b[0m    quit
`;

const HELP = ` Commands:
   /clear   start a fresh conversation
   /help    show commands
   /exit    quit`;

export async function startSession() {
    console.log(BANNER);
    console.log(rule("─"));

    const r1 = readline.createInterface({ input: stdin, output: stdout });

    //One context for the whole session -
    let context = new ContextManager();

    while(true) {
        const line = (await r1.question(`\n${c.prompt}kivo ›${c.reset} `)).trim();
        if(!line) continue;

        if(line === "/exit" || line === "/quit") {
            console.log(`${c.dim}bye 👋${c.reset}`);
            break;
        }

        if(line === "/help") {
            console.log(HELP);
            continue;
        }

        if(line === "/clear") {
            context = new ContextManager();
            console.log(` ${c.dim}(conversation cleared)${c.reset}`);
            continue;
        }

        try {
            await runAgent({
                task: line,
                cwd: process.cwd(),
                context,
                onEvent: renderEvent,
            })
        } catch (err) {
            console.error(`\n${c.red}[error]${c.reset}`, err);
        }
    }
    r1.close();
}