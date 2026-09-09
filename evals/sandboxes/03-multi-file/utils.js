function formatPrice(cents) {
    //BUG: should divide by 100 to convert cents to dollars, but multiplies
    return "$" + (cents * 100).toFixed(2);
}

function applyDiscount(cents, percent) {
    return cents - (cents * percent)/100;
}

module.exports = { formatPrice, applyDiscount };