# ERRATA & Decisions — SPEC-7 (Derivation)

> The portability layer this file defers is now drafted:
> [07-derivation-abi.PROPOSAL.md](07-derivation-abi.PROPOSAL.md) (status: proposal, not adopted).

## G1 — v0 derived authors are native functions

SPEC-7 §7 already concedes that host-language-native functions are "conformant locally but not
portable claims-of-identity". v0 implements exactly that tier: a derived function is a host
closure `(HView, root) -> [substantive pointer lists]`, identified by a declared `fnId` entity
(the content-addressed WASM artifact replaces the declared id when the ABI lands). Everything
else in the lifecycle is implemented for real: binding installation, provenance emission,
emission policies, budgets, the loop guard, and pure-replay verification.

## G2 — The derivation host wraps the reactor

Folded into SPEC-7 §6 (2026-06-11); history in git.

## G3 — Provenance pointers and deterministic timestamps

Folded into SPEC-7 §5 (2026-06-11); history in git.

## G4 — Emission policies

Folded into SPEC-7 §5 (2026-06-11); history in git.

## G5 — Pure-replay verification

Folded into SPEC-7 §4 (2026-06-11); history in git.

