# Reservation Retry Contract

- `units` must be a positive integer.
- Repeating a reservation with the same `orderId` and `sku` is idempotent: a
  retry must not increase the reserved units or create a duplicate reservation.
