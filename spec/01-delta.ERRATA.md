# ERRATA & Decisions — SPEC-1 (Delta Layer)

Per the README "Rules of engagement" and [CLAUDE.md](../CLAUDE.md): where implementation meets a gap
or contradiction in the spec, we record it here, resolve it explicitly, and let the conformance
vectors pin it. Nothing here is silently encoded into one implementation.

SPEC-1 specifies the *abstract* delta structure and mandates "deterministic CBOR (RFC 8949 §4.2.1)"
but does not give the *concrete* CBOR layout of pointers/targets or the number-encoding rule. The
decisions below fill that gap for **v0**. They are pinned by `vectors/l0-delta/` and are revisitable
(a change is a vector regen, cheap while pre-conformance).

## D1 — Number encoding (numbers are floats only)

Folded into SPEC-1 §4.1 (2026-06-11); history in git.


## D2 — String encoding

Folded into SPEC-1 §4.1 (2026-06-11); history in git.


## D3 — Boolean encoding

Folded into SPEC-1 §4.1 (2026-06-11); history in git.


## D4 — Map key ordering

Folded into SPEC-1 §4.1 (2026-06-11); history in git.


## D5 — Pointer & target layout

Folded into SPEC-1 §4.1 (2026-06-11); history in git.


## D6 — `claims` layout

Folded into SPEC-1 §4.1 (2026-06-11); history in git.


## D7 — Content address (`id`)

Folded into SPEC-1 §4.1 (2026-06-11); history in git.


## D8 — Author encoding for signed deltas

Folded into SPEC-1 §5 (2026-06-11); history in git.


## D9 — Signature definition

Folded into SPEC-1 §5 (2026-06-11); history in git.


## D10 — Set digest (PROVISIONAL helper — confirmed 2026-06-11: stays provisional until sublinear reconciliation exists)

`digest(S)` = `contentAddress( canonical CBOR array of S's id strings, sorted lexicographically )`.
A cheap canonical fingerprint of set membership, used by the implementations to compare delta sets
(CRDT property tests, parity checks). It is **NOT** the SPEC-6 §4 reconciliation digest — that
Merkle/IBLT construction is still an open question there. Pinned by
`vectors/l0-delta/set-digest.json` only so both implementations agree while it remains a helper;
promotion to normative status is a SPEC-6 decision.

## D11 — NFC is validated at the boundary, not repaired at encode time

Folded into SPEC-1 §4.1 (2026-06-11); history in git.


## JSON debug profile (for vectors)

Folded into SPEC-1 §4.2 (2026-06-11); history in git.
