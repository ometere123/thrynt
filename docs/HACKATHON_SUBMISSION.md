# THRYNT — DreamDEX Perps Builder Bounty submission pack

Status as of 2026-10-30: the repository, public demo, real Hideki event ingestion, safety-rejection evidence and one supervised DreamDEX order lifecycle are ready for review. The order was broadcast exactly once under a bounded owner authorization, filled, independently reconciled and shut down safely. The Fly SDK tail has recovered from the earlier Hideki/indexer degradation; a bounded production sample reported ready with six watches, a connected WebSocket, no SDK failure and 19-block indexer lag. No X URL is fabricated in this document.

## Official MVP requirements checked

The [official bounty page](https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail) states that the MVP must:

- place real perpetual orders on Somnia Tokyo testnet;
- provide a GitHub repository;
- explain what the MVP does, who it is for and how to run it in the README;
- include a README section titled `X posts` with links to two or three posts about the MVP tagging `@DreamDEXSomnia`;
- show a working demonstration, transaction hashes, repository and demo as part of evaluation; and
- use a DoraHacks account whose email is whitelisted for Build submission.

The listed submission deadline is **2026-11-01 23:59 UTC**. The page says that a non-whitelisted email should be added through the dreamDEX Discord or SomniaHacks Telegram using the email registered on DoraHacks. This repository does not claim whitelist or submission confirmation until the owner account visibly confirms it.

## Project fields

| Field | Value |
|---|---|
| Title | THRYNT — Set the condition. Prove the execution. |
| Category | Trader tools / bots and agents |
| Repository | https://github.com/ometere123/thrynt |
| Demo | https://thrynt.vercel.app |
| API | https://thrynt.delealufejoel.workers.dev |
| Network | Somnia Tokyo / Hideki testnet, chain 50383 |
| SDK | `@somnia-chain/markets-sdk@0.32.1` |
| Deadline | 2026-11-01 23:59 UTC |

## Submission description

THRYNT is an event-driven DreamDEX perpetuals automation and decision-audit system. A trader creates a deterministic cross-market rule in Strategy Studio, validates and simulates an immutable version, arms it, and observes the same stored version against real Somnia pool events. Before any order, an independent risk gateway checks the pause state, lease ownership, freshness, market precision, book-side price protection, linked-bot authorization, margin, exposure, daily action and durable intent constraints. If the bounded testnet order is submitted, the Decision Trace distinguishes the event, matched conditions, safety checks, transaction receipt and actual DreamDEX order/fill state. If a check fails, THRYNT records why it skipped the action. The browser never holds a private key.

## Evidence available now

- Fly `/readyz` reports chain 50383, one held lease, `mode: observe`, `liveOptIn: false`, `wsConnected: true`, six SDK watch lanes, fresh block progress and healed gaps. This is a bounded observation; if Hideki `eth_getLogs` or indexer freshness degrades, `/readyz` returns `503` and signing remains disabled.
- Cloudflare public overview reports live BTC/ETH snapshots, approximately 1,000 USDso-equivalent available margin, the owner account currently flat after a separate owner-managed close, and global pause enabled.
- Genuine `OpenInterestUpdated` BTC events matched the controlled proof rule and were rejected while paused; the public Decision Trace shows event transaction hashes, blocks, matched conditions and the no-submission result.
- The approved production session completed authenticated save, simulation, arming and pausing. The three product templates remain present and reusable.
- The Fly runtime derives the linked bot address `0x94d8333f14a5ED04634F0F5b7200f5c2f1D294F1`, matching the configured public address. The owner trading wallet is `0xdA80A0D2FBDEF6eEe94e2e27F82a34896B444126`.
- The one authorized order is independently verified: transaction [`0xdd685a4c40f5a4fd025ff50588442823e57c581cae79e38dcc0877c67da580de`](https://explorer.testnet.somnia.network/tokyo/tx/0xdd685a4c40f5a4fd025ff50588442823e57c581cae79e38dcc0877c67da580de), block `35175637`, DreamDEX order `16472942457822639999900`, receipt `success`, one `0.004 ETH` fill at `2348.48 USDso`, indexed status `Filled`, no resting order.
- After the broadcast, Fly is `observe` with live opt-in disabled, global pause is enabled, the temporary order-price floor secret is removed, and the public trace intent is `reconciled` with `order_state=filled`. THRYNT did not auto-close the resulting short position. A later owner-managed close is recorded separately in the repository verification notes and is not presented as THRYNT evidence.

## Live-order evidence recorded

The production evidence contains all of the following without redaction of public transaction identifiers:

1. fresh preflight with event, immutable strategy version, market, side, quantity, book and price band;
2. one transaction hash and Somnia Explorer link;
3. receipt status and block number;
4. DreamDEX order ID and independently reconciled full-fill state;
5. Decision Trace showing submitted, receipt and reconciliation states; and
6. post-test state proving `EXECUTION_MODE=observe`, `ENABLE_TESTNET_EXECUTION=false` and global pause enabled.

If the IOC does not fill, report `IOC no-fill` rather than treating a successful receipt as a fill. Do not submit a second order to compensate for a delayed or unknown result.

## X posts — publication-ready drafts

These are drafts only. The owner must publish them from the intended X account and then replace the pending rows in the README with the real URLs. Do not publish transaction details until the transaction exists and has been independently reconciled.

### Post 1 — product

> THRYNT is a deterministic DreamDEX perps control room for Somnia Hideki: set a cross-market condition, validate and simulate an immutable version, enforce account-level safety, then inspect exactly why an action executed or was skipped. Set the condition. Prove the execution. @DreamDEXSomnia

### Post 2 — architecture

> A THRYNT decision is a chain of evidence: genuine Somnia pool event → typed BTC/ETH conditions → independent margin, precision, book-side price and linked-bot checks → durable one-shot intent → DreamDEX `placeOrderFor` → receipt and order reconciliation. Observation mode records the same path without signing. @DreamDEXSomnia

### Post 3 — evidence, after a real order

> THRYNT’s Decision Trace links the real Hideki event, immutable strategy version, risk verdict, DreamDEX transaction receipt and independently reconciled IOC fill. Explorer: https://explorer.testnet.somnia.network/tokyo/tx/0xdd685a4c40f5a4fd025ff50588442823e57c581cae79e38dcc0877c67da580de @DreamDEXSomnia

## Remaining owner-controlled submission actions

- If not already whitelisted, request DoraHacks Build whitelist access using the same email registered on DoraHacks.
- Publish two or three drafts above and paste their real URLs into the README `X posts` section.
- Submit the Build through DoraHacks and retain the visible confirmation page or ID.
