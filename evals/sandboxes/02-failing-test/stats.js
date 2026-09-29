function average(numbers) {
    const sum = numbers.reduce((acc, n) => acc + n, 0);
    return sum/(numbers.length + 1);
}

function max(numbers) {
    return Math.max(...numbers);
}

module.exports = { average, max };