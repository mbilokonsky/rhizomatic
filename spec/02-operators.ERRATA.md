# ERRATA & Decisions — SPEC-2 (Operator Algebra)

v0 decisions filling gaps SPEC-2 leaves open, pinned by `vectors/l1-eval/`. Same rules as the
SPEC-1 ERRATA: explicit, revisitable, never silently encoded in one implementation.

## E1 — JSON term profile

Folded into SPEC-2 §9 (appendix) (2026-06-11); history in git.


## E2 — Canonical result encoding for DSet-sort evaluations

Folded into SPEC-2 §5 (2026-06-11); history in git.


## E3 — Canonical total order over primitives

Folded into SPEC-2 §3 (2026-06-11); history in git.


## E4 — `trust(Pred)` semantics

Folded into SPEC-2 §4.3 (2026-06-11); history in git.


## E5 — Negation recursion guard

Folded into SPEC-2 §4.3 (2026-06-11); history in git.


## E6 — `group` filing rules

Folded into SPEC-2 §4.4 (2026-06-11); history in git.


## E7 — HyperView canonical form

Folded into SPEC-2 §5 (2026-06-11); history in git.


## E8 — `prune` operates at property granularity (v0)

`prune(keep: StrMatch | all)` retains the HView properties whose **name** matches (`all` = keep
everything, the identity). SPEC-2 §4.6's "drop pointers" reading — trimming pointer lists inside
entries — is **closed as out of `alg: 0`** (decided 2026-06-11): it tensions with SPEC-3 §4's
provenance-completeness ("every HVEntry is a full delta") and no consumer exists to vector it.
Property-level granularity is the law for `alg: 0`; pointer-level pruning, if a consumer ever
materializes (e.g. federation payload minimization), enters as an `alg`-versioned capability.

## E9 — Sorts are checked at evaluation time (v0)

Terms are dynamically sorted in v0: applying `select`/`union`/`mask` to an HView, `group` to an
HView, or `prune` to a DSet is an evaluation error; `group` without an ambient root (supplied by
the evaluation call, later by `fix`) is an evaluation error. Static term sort-checking can arrive
with the schema registry (M1.3+) without changing any vector.

## E10 — Schema registry, `$root`, and SchemaRef

Folded into SPEC-2 §4.8 (2026-06-11); history in git.


## E11 — Expanded HVEntry encoding

Folded into SPEC-2 §4.5 (2026-06-11); history in git.


## E12 — Term canonical CBOR and term hashes

Folded into SPEC-2 §7 (2026-06-11); history in git.


## E13 — SchemaRef gains the pinned mode

Folded into SPEC-3 §6 (2026-06-11); history in git.


## E14 — Annotation metadata does not survive `select`/`union`

Folded into SPEC-2 §4.3 (decided 2026-06-11: consumed-or-dropped is the invariant) (2026-06-11); history in git.


## E15 — Parameterized terms: `hole(name)`, bound at `fix` time

Folded into SPEC-2 §4.8 + §9 (appendix) (2026-06-11); history in git.

