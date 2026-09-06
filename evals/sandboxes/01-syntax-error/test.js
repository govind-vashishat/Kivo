const assert = require("node:assert");
const { add, multiply, subtract } = require('./math.js');

assert.strictEqual(add(2, 3), 5);
assert.strictEqual(multiply(2, 3), 6);
assert.strictEqual(subtract(5, 3), 2);

console.log("all tests passed");