# @kilnai/gateway-contracts

Shared HTTP and WebSocket frame contracts for the Kiln operator gateway.

Both the runtime gateway (`@kilnai/runtime`) and the GUI client (`@kilnai/gui`) depend on this package so that frame shapes are defined once and consumed by both sides. Neither side defines its own copy of these types; any shape change is made here and takes effect on the next build for all consumers.
