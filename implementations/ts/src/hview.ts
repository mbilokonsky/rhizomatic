// The HyperView: the output sort of group (and later expand/prune) — SPEC-3 §4, encoded per
// ERRATA-2 E7. Provenance-complete: every entry carries the full delta.

import { type CborValue, array, bool, encode, map, tstr } from "./cbor.js";
import { claimsToCbor } from "./delta.js";
import { bytesToHex } from "./hash.js";
import type { Delta } from "./types.js";

export interface HVEntry {
  readonly delta: Delta;
  // Annotate tag threaded through group from a mask(annotate) operand (E7).
  readonly negated: boolean;
}

export interface HView {
  readonly id: string;
  readonly props: ReadonlyMap<string, readonly HVEntry[]>;
}

export function hvEntryToCbor(e: HVEntry): CborValue {
  const entries: Array<[string, CborValue]> = [
    ["id", tstr(e.delta.id)],
    ["claims", claimsToCbor(e.delta.claims)],
  ];
  if (e.delta.sig !== undefined) entries.push(["sig", tstr(e.delta.sig)]);
  if (e.negated) entries.push(["negated", bool(true)]);
  return map(entries);
}

export function hviewToCbor(h: HView): CborValue {
  const props: Array<[string, CborValue]> = [...h.props.entries()].map(([prop, entries]) => [
    prop,
    array(entries.map(hvEntryToCbor)),
  ]);
  return map([
    ["id", tstr(h.id)],
    ["props", map(props)],
  ]);
}

// HyperViews are content-addressable (SPEC-3 §4): same (schema, DSet) => byte-identical form.
export function hviewCanonicalHex(h: HView): string {
  return bytesToHex(encode(hviewToCbor(h)));
}
