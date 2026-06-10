// Term evaluation: select/union/mask over DSet (SPEC-2 §4.1-4.3), group into HView (§4.4),
// prune over HView (§4.6). eval is a pure function; order-blind; deterministic (SPEC-2 §5).
// Sorts are checked at evaluation time in v0 (ERRATA-2 E9).

import { array, encode, map, tstr } from "./cbor.js";
import { bytesToHex } from "./hash.js";
import { hviewCanonicalHex, type HVEntry, type HView } from "./hview.js";
import { evalPred, strMatch, type Pred, type StrMatch } from "./pred.js";
import { DeltaSet, fork, merge } from "./set.js";
import type { Delta } from "./types.js";

export type MaskPolicy =
  | { readonly kind: "drop" }
  | { readonly kind: "annotate" }
  | { readonly kind: "trust"; readonly pred: Pred };

export type GroupKey =
  | { readonly kind: "byTargetContext" }
  | { readonly kind: "byRole" }
  | { readonly kind: "const"; readonly prop: string };

export type Term =
  | { readonly kind: "input" }
  | { readonly kind: "select"; readonly pred: Pred; readonly of: Term }
  | { readonly kind: "union"; readonly left: Term; readonly right: Term }
  | { readonly kind: "mask"; readonly policy: MaskPolicy; readonly of: Term }
  | { readonly kind: "group"; readonly key: GroupKey; readonly of: Term }
  | { readonly kind: "prune"; readonly keep: "all" | StrMatch; readonly of: Term };

interface DSetResult {
  readonly sort: "dset";
  readonly set: DeltaSet;
  // Negation tags from mask(annotate); consumed by group (E7) or surfaced at top level (E2).
  readonly negated: ReadonlySet<string>;
  readonly annotated: boolean;
}

interface HViewResult {
  readonly sort: "hview";
  readonly hview: HView;
}

export type EvalResult = DSetResult | HViewResult;

const dsetResult = (set: DeltaSet): DSetResult => ({
  sort: "dset",
  set,
  negated: new Set(),
  annotated: false,
});

function expectDSet(r: EvalResult, op: string): DSetResult {
  if (r.sort !== "dset") throw new Error(`${op} requires a DSet operand (E9)`);
  return r;
}

function expectHView(r: EvalResult, op: string): HViewResult {
  if (r.sort !== "hview") throw new Error(`${op} requires an HView operand (E9)`);
  return r;
}

// negated(d, D) per SPEC-2 §4.3, over candidate negations restricted by `trusted` (E4).
// Memoized with an in-progress default of "not negated" (E5 recursion guard).
function computeNegated(d: DeltaSet, trusted?: (n: Delta) => boolean): Set<string> {
  const negators = new Map<string, string[]>(); // target delta id -> negation delta ids
  for (const n of d) {
    if (trusted !== undefined && !trusted(n)) continue;
    for (const ptr of n.claims.pointers) {
      if (ptr.role === "negates" && ptr.target.kind === "delta") {
        const list = negators.get(ptr.target.deltaRef.delta);
        if (list === undefined) negators.set(ptr.target.deltaRef.delta, [n.id]);
        else list.push(n.id);
      }
    }
  }
  const memo = new Map<string, boolean>();
  const isNegated = (id: string): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    memo.set(id, false); // guard: cycles are impossible with verified ids, but degrade safely
    const result = (negators.get(id) ?? []).some((nid) => !isNegated(nid));
    memo.set(id, result);
    return result;
  };
  const out = new Set<string>();
  for (const delta of d) if (isNegated(delta.id)) out.add(delta.id);
  return out;
}

// group(key, D) @ root — filing rules per ERRATA-2 E6; annotate tags thread into entries (E7).
function evalGroup(key: GroupKey, operand: DSetResult, root: string): HView {
  const buckets = new Map<string, Map<string, HVEntry>>(); // prop -> deltaId -> entry
  const file = (prop: string, d: Delta) => {
    let bucket = buckets.get(prop);
    if (bucket === undefined) {
      bucket = new Map();
      buckets.set(prop, bucket);
    }
    if (!bucket.has(d.id)) bucket.set(d.id, { delta: d, negated: operand.negated.has(d.id) });
  };
  for (const d of operand.set) {
    if (key.kind === "const") {
      file(key.prop, d);
      continue;
    }
    for (const ptr of d.claims.pointers) {
      if (ptr.target.kind !== "entity" || ptr.target.entity.id !== root) continue;
      if (key.kind === "byTargetContext") {
        const ctx = ptr.target.entity.context;
        if (ctx !== undefined) file(ctx, d);
      } else {
        file(ptr.role, d);
      }
    }
  }
  const props = new Map<string, HVEntry[]>();
  for (const [prop, bucket] of buckets) {
    props.set(
      prop,
      [...bucket.values()].sort((a, b) => (a.delta.id < b.delta.id ? -1 : 1)),
    );
  }
  return { id: root, props };
}

export function evalTerm(term: Term, input: DeltaSet, root?: string): EvalResult {
  switch (term.kind) {
    case "input":
      return dsetResult(input);
    case "select": {
      const of = expectDSet(evalTerm(term.of, input, root), "select");
      return dsetResult(fork(of.set, (d) => evalPred(term.pred, d)));
    }
    case "union": {
      const left = expectDSet(evalTerm(term.left, input, root), "union");
      const right = expectDSet(evalTerm(term.right, input, root), "union");
      return dsetResult(merge(left.set, right.set));
    }
    case "mask": {
      const of = expectDSet(evalTerm(term.of, input, root), "mask");
      switch (term.policy.kind) {
        case "drop": {
          const negated = computeNegated(of.set);
          return dsetResult(fork(of.set, (d) => !negated.has(d.id)));
        }
        case "annotate": {
          const negated = computeNegated(of.set);
          return { sort: "dset", set: of.set, negated, annotated: true };
        }
        case "trust": {
          const pred = term.policy.pred;
          const negated = computeNegated(of.set, (n) => evalPred(pred, n));
          return dsetResult(fork(of.set, (d) => !negated.has(d.id)));
        }
      }
      break;
    }
    case "group": {
      if (root === undefined) throw new Error("group requires an ambient root entity (E9)");
      const of = expectDSet(evalTerm(term.of, input, root), "group");
      return { sort: "hview", hview: evalGroup(term.key, of, root) };
    }
    case "prune": {
      const of = expectHView(evalTerm(term.of, input, root), "prune");
      if (term.keep === "all") return of;
      const keep = term.keep;
      const props = new Map<string, readonly HVEntry[]>();
      for (const [prop, entries] of of.hview.props) {
        if (strMatch(keep, prop)) props.set(prop, entries);
      }
      return { sort: "hview", hview: { id: of.hview.id, props } };
    }
  }
}

// Canonical serialization of an evaluation result (ERRATA-2 E2, E7).
export function resultCanonicalHex(result: EvalResult): string {
  if (result.sort === "hview") return hviewCanonicalHex(result.hview);
  const ids = result.set.ids().map(tstr);
  if (!result.annotated) return bytesToHex(encode(array(ids)));
  const negated = [...result.negated].sort().map(tstr);
  return bytesToHex(
    encode(
      map([
        ["ids", array(ids)],
        ["negated", array(negated)],
      ]),
    ),
  );
}
