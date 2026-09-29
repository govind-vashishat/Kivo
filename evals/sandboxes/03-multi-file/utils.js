function formatPrice(cents) {
    return "$" + (cents * 100).toFixed(2);
}

function applyDiscount(cents, percent) {
    return cents - (cents * percent)/100;
}

module.exports = { formatPrice, applyDiscount };