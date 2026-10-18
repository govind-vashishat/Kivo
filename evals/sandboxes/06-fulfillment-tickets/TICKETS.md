# Fulfillment tickets

Open tickets for the nightly fulfillment run (`node src/index.js`).
`node test.js` has regression tests for each one, tagged with the ticket id.

---

## FUL-101 — Delivery estimates ignore Thanksgiving

**Status:** open · **Reported by:** customer support

Customers who ordered on Wednesday 25 Nov got confirmation emails saying their
parcel ships on Thursday 26 Nov. Both warehouses are closed on Thanksgiving and
the day after (26–27 Nov), so nothing ships until Monday 30 Nov. Support is
getting "where is my order" tickets because every estimate from that day is
two days early.

The closures are already listed in `data/holidays.json`, so it looks like the
date logic isn't picking them up. Christmas is going to have the same problem.

**Expected:** ship and delivery dates skip weekends *and* the holidays in
`data/holidays.json`.

---

## FUL-102 — Oversold USB-C hubs

**Status:** open · **Reported by:** warehouse EAST

Order o-1005 was a Desk setup bundle (which contains a USB-C hub) plus one
extra USB-C hub. EAST had a single hub left, but the run sent *both* hubs to
the EAST pick list. The packer came up one short, and the stock report the
next morning showed `EAST HUB-C7 -1`.

The allocation rules from FUL-88 still apply: a line ships from the preferred
warehouse if it has enough stock for the whole line, otherwise from the other
warehouse, otherwise it's backordered. Here the second hub should have come
from WEST, which had plenty.

**Expected:** an order can never take more of a sku from a warehouse than that
warehouse has, even when the sku appears on several lines (bundle components
included). Stock never goes negative.

---

## FUL-103 — Free shipping on nearly every order

**Status:** open · **Reported by:** finance

Standard shipping revenue dropped to almost zero this month. Example: a $24
order of sticky notes and a cable shipped for free.

Policy (unchanged): standard shipping is free when the merchandise total after
discounts is **$50 or more**. Below that, the customer pays the carrier rate.
Express is never free.

**Expected:** orders under $50 pay for standard shipping again.

---

## FUL-104 — Support the PAIRUP promo (buy one, get one 50% off)

**Status:** open · **Reported by:** marketing

Marketing added the `PAIRUP` code to `data/promotions.json` with a new
promotion type, `bogo`. Any order using it currently crashes the run.

Rules for `bogo` promotions:

- Only simple products in the promotion's `category` count. Bundles never
  count, even if they contain items from that category.
- Count units, not lines: 3 mice on one line are 3 units.
- Sort the qualifying units by unit price, highest first, and pair them up:
  1st with 2nd, 3rd with 4th, and so on.
- In each pair the second unit gets `percent`% off its unit price (rounded to
  the nearest cent, per unit). An unpaired last unit pays full price.
- Example with PAIRUP (peripherals, 50%): keyboard $89 + webcam $69 + 2 mice
  $29 → pairs ($89, $69) and ($29, $29) → discount $34.50 + $14.50 = $49.00.

**Expected:** PAIRUP orders are priced by these rules; nothing else changes.

---

## FUL-88 — Allocation rules for two warehouses

**Status:** closed

Ship each line from the closest warehouse if it can cover the whole line,
otherwise from the other one, otherwise backorder it. Never split a line.
Central customers prefer EAST.
