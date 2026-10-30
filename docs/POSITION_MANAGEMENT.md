# THRYNT position management boundary

THRYNT keeps entry automation and position management as separate authority paths.
The current production account is flat, and no position-management transaction has
been broadcast by THRYNT.

## Exchange-enforced protection

The pinned `@somnia-chain/markets-sdk@0.32.1` `placePerpStopOrder` implementation
creates a reduce-only perp stop when called with `intent: "reduceOnly"`. A linked
pair is a one-cancels-other bracket. `quantity: 0n` means the full live position at
trigger time. The SDK reads the payment from the selected per-market stop registry;
THRYNT does not assume a fixed STT amount.

The owner wallet must authorize the market stop registry for the pool's
`placeOrderFor` selector through `OperatorPermissionsRegistry`, and the owner wallet
must sign the bracket placement. A linked bot permission is not equivalent to that
owner approval. THRYNT does not custody or request the owner's private key. When a
position exists, Positions & Risk provides the exact owner-assisted route: verify the
market and tick-aligned TP/SL in DreamDEX, sign there, then refresh THRYNT. The engine
reads the discovered registry, effective owner approval, pending stop IDs/status and
reports `confirmed`, `not_found`, `unknown` or `unavailable`. A saved app setting is
never treated as exchange protection.

References:

- [DreamDEX stop-order implementation](https://raw.githubusercontent.com/somnia-chain/dreamdex-bot-kit/main/packages/perp-core/src/stops.ts)
- [DreamDEX linked-bot documentation](https://app.dreamdex.io/docs/trading/common/link-a-bot)
- [DreamDEX perps order documentation](https://app.dreamdex.io/docs/trading/perps-testnet/orders)

## Linked-bot close planning

DreamDEX's bot kit `closePosition()` uses an opposite-side IOC. `placeOrderFor` has
no reduce-only flag. This route can reduce or close a position, but it can also
increase or reverse exposure if the position changes before fill. `reduceOrderFor`
accepts an order ID and remaining quantity; it changes a resting order and is not a
filled-position close.

THRYNT now has a pure, tested planner for this risk-bearing route. It:

1. reads signed position and `getReducingCapacity(owner)` from the pool;
2. clamps requested size to the live position and effective capacity;
3. aligns quantity to lot/minimum grids;
4. uses the executable ask for a short-position close or bid for a long-position
   close;
5. applies side-aware slippage and tick alignment;
6. enforces an optional notional ceiling; and
7. labels the result `guaranteedReduceOnly: false`.

The autonomous event strategy does not broadcast this route. A future explicit close
action would require a fresh owner authorization, a durable unique intent, lease and
fencing checks, an immediate capacity re-read, one broadcast maximum and receipt,
order and final-position reconciliation. Unknown submission outcomes must quarantine
the action; no automatic resend is allowed.

## Protection states

- `no_position`: no active position is published.
- `protection_confirmed`: a pending exchange-held stop is returned for the market.
- `protection_not_found`: the market has a stop registry but no pending stop was
  indexed; this is not a claim that a stop never existed.
- `protection_unknown`: the indexer or authoritative registry read failed.
- `protection_unavailable`: SDK market discovery returned no stop registry.

These states are evidence labels, not guarantees of future execution. The global
pause stops new THRYNT submissions; it does not cancel exchange-held orders or close
positions.
