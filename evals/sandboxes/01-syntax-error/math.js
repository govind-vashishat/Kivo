function add(a, b) {
    return a + b;
}

function multiply(a, b) {
    return a * b;
}

//BUG: unclosed parenthesis - this file won't even parse
function subtract(a, b) {
    return (a - b;
}

module.exports = { add, multiply, subtract };