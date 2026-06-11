# ERRATA & Decisions — SPEC-8 (Storage Profile / Packs)

## P1 — v0 pack format

Folded into SPEC-8 §3 (2026-06-11); history in git.

## P2 — The two invariants, operationalized

Folded into SPEC-8 §2 (2026-06-11); history in git.

## P3 — Deferred physical conveniences

The random-access index (`deltaId -> (section, offset)`), shared dictionaries (`dictRef`), and
ranged/partial reads are deferred: v0 packs decode wholesale in memory, so the index buys nothing
yet. They return when packs become reactor checkpoints over real I/O. Repacking is trivially
semantics-free in v0 because pack bytes are a pure function of the delta set (same set ⇒ same
bytes; the spec's repacking latitude becomes interesting only with physical layout choices).
