# THRYNT — ONE TRADE. EVERY REASON.

This is the evidence-first demonstration package for the DreamDEX × Somnia Perps
Builder Bounty. It uses the real THRYNT production UI, real Hideki telemetry and the
independently verifiable entry transaction. It does not imply that the later
owner-managed close was sent by THRYNT.

## Main cut (2–3 minutes)

**0:00–0:15 — The receipt**

Open the Somnia Explorer receipt for the THRYNT entry transaction, then cut to the
Decision Trace card. Caption: “The trade is visible onchain. The decision behind it
usually isn't.” Show ETH-PERP, short IOC, `0.004 ETH`, one fill and order ID
`16472942457822639999900`.

**0:15–0:40 — The condition**

Open Strategy Studio and show the immutable Controlled Testnet Execution Proof rule:
the genuine BTC `OpenInterestUpdated` trigger, cross-market BTC/ETH metrics, typed
comparisons, expiry and one bounded action. Explain that the same rule was stored and
replayed; it was not an arbitrary timer or AI-selected action.

**0:40–1:10 — The decision chain**

Animate or caption the actual sequence:

`Somnia event → immutable rule → matched conditions → risk gateway → durable intent → DreamDEX placeOrderFor → receipt → order/fill reconciliation`

Use the Decision Trace event block, transaction hash and risk evidence. Make clear
that application records explain the decision while the receipt and explorer are the
independent chain evidence.

**1:10–1:35 — The safety layer**

Show a real paused/matched Decision Trace entry and the Settings emergency control.
Point out the mandatory gates: global pause, fresh oracle/book, precision, margin,
exposure, linked-bot permission, protocol size and unique intent. Label any browser
simulation or injected fault as “simulation” or “controlled test,” never as a live
chain event.

**1:35–2:00 — Position protection**

Show Positions & Risk with the flat authoritative state and the owner-held protection
workflow. Explain that DreamDEX `placePerpStopOrder` is protocol reduce-only, while
the linked-bot opposite-side IOC close is best-effort and can reverse if stale. THRYNT
does not custody the owner key. If a real position is available during recording,
show the verified registry approval and pending stop IDs; otherwise keep the flat state
and say that protection is not active without a position.

**2:00–2:20 — The proof**

Return to the explorer and Decision Trace. Show event tx, strategy version, intent,
receipt, order ID, fill quantity and reconciled state. Mention that after the one
broadcast THRYNT returned to observation mode and global pause.

**2:20–2:35 — Close**

End on: “THRYNT — Set the condition. Prove the execution.”

## 30–45 second social cut

1. 0–6s: Explorer transaction + “One real Hideki order.”
2. 6–15s: Strategy Studio + “Event-driven, deterministic, versioned.”
3. 15–26s: Decision Trace chain + “Every condition and safety check recorded.”
4. 26–36s: Risk rejection + “Paused, stale or unsafe means no broadcast.”
5. 36–45s: Explorer link + product end card.

## Capture checklist

- Desktop 16:9: Overview, Strategy Studio, Markets, Live Pulse, Positions & Risk,
  Decision Trace and Settings.
- Mobile 9:16: Overview, Strategy Studio and Decision Trace with the drawer open.
- Explorer receipt for the THRYNT entry transaction.
- A real paused/matched rejection trace.
- No owner tokens, private keys or session URLs in any frame.
- Overlay a UTC timestamp and label data as `LIVE HIDEKI`, `RECONCILED`,
  `SIMULATION` or `CONTROLLED TEST` as appropriate.

The checked-in capture set is generated from the public production frontend by
`node scripts/capture-demo.mjs`:

- `docs/assets/demo/desktop-*.png` — seven desktop screen captures.
- `docs/assets/demo/mobile-*.png` — seven mobile screen captures.
- `docs/assets/demo/entry-explorer.png` — the genuine entry receipt page.
- `docs/assets/demo/thrynt-main-browser-capture.webm` — silent browser capture,
  approximately 80 seconds; add the supplied script as voiceover/captions for the
  2–3 minute presentation edit.
- `docs/assets/demo/thrynt-social-cut.webm` — silent 35-second social cut.

Playwright's temporary recording files are intentionally not submission assets and
are not added to Git.

## Evidence links

- Frontend: https://thrynt.vercel.app
- Repository: https://github.com/ometere123/thrynt
- Entry transaction: https://explorer.testnet.somnia.network/tokyo/tx/0xdd685a4c40f5a4fd025ff50588442823e57c581cae79e38dcc0877c67da580de
- Owner-managed exit (not a THRYNT transaction): https://explorer.testnet.somnia.network/tokyo/tx/0xc41fc769df942e19ed493f837a3d241cfbc2b92c7bd9f86c1a4254bfab12e042

## Publication-ready X drafts

### Product

THRYNT is a deterministic DreamDEX perps control room for Somnia Hideki. Set a
cross-market condition, validate and simulate an immutable version, then inspect why
THRYNT executed—or refused to. This is automation with an evidence trail, not a
timer-triggered dashboard. Set the condition. Prove the execution. @DreamDEXSomnia

### Engineering

THRYNT connects genuine Somnia pool events to typed BTC/ETH conditions, independent
margin/precision/book checks, linked-bot authorization, a Postgres-backed intent
fence, DreamDEX `placeOrderFor`, and receipt/order reconciliation. The Fly engine
fails closed when SDK hydration or indexer freshness is unsafe. @DreamDEXSomnia

### Proof

One supervised THRYNT testnet order, one broadcast, one reconciled result:
ETH-PERP short IOC, `0.004 ETH`, DreamDEX order
`16472942457822639999900`, filled at `2348.48 USDso`.
Explorer: https://explorer.testnet.somnia.network/tokyo/tx/0xdd685a4c40f5a4fd025ff50588442823e57c581cae79e38dcc0877c67da580de
The Decision Trace links the event, immutable strategy, risk verdict, receipt and
fill. @DreamDEXSomnia

These are drafts. Publish only from the owner's intended X account with owner
approval, then add the real post URLs to README's `X posts` section. Do not replace
them with invented placeholders.
