#!/usr/bin/env bun

import { runAgent } from "../agent/loop";
import { renderEvent } from "./render";

const task = process.argv.slice(2).join(" ");
if (task) {
    await runAgent({
        task,
        cwd: process.cwd(),
        onEvent: renderEvent,
    })
}