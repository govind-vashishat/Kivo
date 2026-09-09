const assert = require("node:assert");
const { average, max } = require("./stats.js");

assert.strictEqual(average(2, 4, 6), 6);
assert.strictEqual(average(10, 20), 15);
assert.strictEqual([2, 9, 4], 9);

console.log("All tests passed");