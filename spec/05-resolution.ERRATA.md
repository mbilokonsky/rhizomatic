# ERRATA & Decisions — SPEC-5 (Resolution, Views & the ABI)

v0 decisions filling gaps SPEC-5 leaves open, pinned by `vectors/l1-eval/eval-resolve.json`.

## R1 — Candidate value extraction

SPEC-5 says resolve collapses "each property's delta superposition into a value" but never defines
which part of an HVEntry's delta *is* the value. v0 rule, total and deterministic:

- **Filing pointers** (EntityRef pointers targeting the HView's root) are excluded — they are the
  edge's address, not its payload.
- Render the remaining pointers' targets: a primitive renders as itself; an unexpanded EntityRef
  renders as its entity-id string; a DeltaRef renders as its delta-id string; an **expanded**
  target renders as the nested HView resolved recursively **with the same policy** (R6).
- **Zero** non-filing pointers → the candidate is `true` (the bare fact of the edge).
- **Exactly one** → its rendered target.
- **Several** → an object `{ role: rendered }`; duplicate roles within one delta collect into an
  array in authored pointer order.

## R2 — MergeFn domains and fold order

`merge(fn)` folds over the property's candidates in **ascending delta-id order** (float addition
is order-dependent; the fold order must be pinned). Domains:

- `max`/`min`: all primitive candidates, by the canonical total order (ERRATA-2 E3) — mixed types
  resolve by type rank then value, exactly as SPEC-5 §4 demands ("defined, deterministic, ugly").
- `sum`: numeric candidates only. `and`/`or`: boolean candidates only.
- `count`: the number of surviving entries (all of them, regardless of candidate type).
- `concatSorted`: array of all primitive candidates sorted by the canonical order.
- Non-primitive candidates (objects/arrays from R1) are skipped by every MergeFn except `count`.
- A MergeFn with no candidates in its domain resolves to **absent**.

## R3 — Policy JSON profile

```
Policy     ::= { "props": { propName: PropPolicy, ... }, "default": PropPolicy }
PropPolicy ::= { "pick": { "order": Order } }
             | { "all": { "order": Order } }
             | { "merge": "max"|"min"|"sum"|"count"|"and"|"or"|"concatSorted" }
             | { "conflicts": { "order": Order } }
             | { "absentAs": { "const": Primitive, "then": PropPolicy } }
Order      ::= { "byTimestamp": "desc"|"asc" }
             | { "byAuthorRank": [author, ...] }     // first match ranks first; unlisted rank last
             | { "byPred": { "pred": Pred, "then": Order } }   // matches first, then `then`
             | "lexById"
```

Every order chain ends in an **implicit lexById tiebreak** (SPEC-5 §3 requires bottoming out in a
total order; we make it structural rather than trusting authors to remember). The resolved View
includes every property named in `policy.props` (so `absentAs` can fire for properties with no
deltas at all) plus every HView property not named (resolved via `default`).

## R4 — View shape and canonical form

A View is `primitive | View[] | { string: View }`. The View of an HView is the object of its
resolved properties — the root id is context the caller already holds, not a property. Canonical
serialization is the canonical CBOR of that structure (same profile as everything else); vectors
pin both a JSON rendering and the canonical hex.

## R5 — Annotate-tagged entries are candidates

Entries that survived into the HView under `mask(annotate)` are candidates even when tagged
negated — the schema chose an audit view; suppression is what `mask(drop)` is for. SPEC-5 §4's
"policies MAY use byPred over the tag" is **deferred**: the L2 Pred grammar sees only the delta,
and the tag is entry metadata. Filed as an open question (likely a `negated` pseudo-field on
`match`).

## R6 — Nested resolution

An expanded target resolves with the **same policy object** as the enclosing resolution. Per-depth
policies (a policy that names policies for child schemas) are deferred until a consumer needs them;
the recursion is deterministic either way.

## R7 — `resolve` in the term JSON profile

`{ "op": "resolve", "policy": Policy, "in": Term }`. Its operand must be HView-sort; its result
sort View is terminal — no operator consumes a View (SPEC-2 §4.7).
