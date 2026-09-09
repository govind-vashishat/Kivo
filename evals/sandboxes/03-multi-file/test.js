const assert = require("node:assert");
const { checkout } = require('./index.js');

assert.strictEqual(checkout(1000, 10), "$9.00");
assert.strictEqual(checkout(checkout(2500, 20), "$20.00"));

console.log("all tests passed");