const { formatPrice, applyDiscount } = require('./utils.js');

function checkout(cents, discountPercent) {
    const discounted = applyDiscount(cents, discountPercent);
    return formatPrice(discounted);
}

module.exports = { checkout };