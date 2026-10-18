/**
 * The whole pipeline: parse -> normalize -> enrich -> aggregate -> report.
 *
 * Run it on the sample data with:  node src/pipeline.js
 */

const fs = require("node:fs");
const path = require("node:path");
const { parseLog } = require("./parse");
const { normalize } = require("./normalize");
const { enrich } = require("./enrich");
const { aggregate } = require("./aggregate");
const { formatReport } = require("./report");

/**
 * @param {string} logText
 * @param {object[]} users
 */
function runPipeline(logText, users) {
    const parsed = parseLog(logText);
    const normalized = normalize(parsed.records);
    const enriched = enrich(normalized.events, users);
    const metrics = aggregate(enriched);

    const counts = {
        skipped: parsed.rejected.length + normalized.rejected.length,
        duplicates: normalized.duplicates,
    };

    return { metrics, counts, report: formatReport(metrics, counts) };
}

function runOnFiles(eventsPath, usersPath) {
    const logText = fs.readFileSync(eventsPath, "utf-8");
    const users = JSON.parse(fs.readFileSync(usersPath, "utf-8"));
    return runPipeline(logText, users);
}

if (require.main === module) {
    const dataDir = path.join(__dirname, "..", "data");
    const { report } = runOnFiles(
        path.join(dataDir, "events.log"),
        path.join(dataDir, "users.json"),
    );
    console.log(report);
}

module.exports = { runPipeline, runOnFiles };
