//! The HyperView (SPEC-3 §4), encoded per ERRATA-2 E7. Mirrors ../ts/src/hview.ts.

use std::collections::BTreeMap;

use crate::cbor::{encode, CborValue};
use crate::delta::claims_to_cbor;
use crate::types::Delta;

#[derive(Debug, Clone, PartialEq)]
pub struct HVEntry {
    pub delta: Delta,
    /// Annotate tag threaded through group from a mask(annotate) operand (E7).
    pub negated: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HView {
    pub id: String,
    /// BTreeMap keeps properties canonically ordered; entries are sorted by delta id.
    pub props: BTreeMap<String, Vec<HVEntry>>,
}

pub fn hv_entry_to_cbor(e: &HVEntry) -> CborValue {
    let mut entries = vec![
        ("id".to_string(), CborValue::Tstr(e.delta.id.clone())),
        ("claims".to_string(), claims_to_cbor(&e.delta.claims)),
    ];
    if let Some(sig) = &e.delta.sig {
        entries.push(("sig".to_string(), CborValue::Tstr(sig.clone())));
    }
    if e.negated {
        entries.push(("negated".to_string(), CborValue::Bool(true)));
    }
    CborValue::Map(entries)
}

pub fn hview_to_cbor(h: &HView) -> CborValue {
    let props: Vec<(String, CborValue)> = h
        .props
        .iter()
        .map(|(prop, entries)| {
            (
                prop.clone(),
                CborValue::Array(entries.iter().map(hv_entry_to_cbor).collect()),
            )
        })
        .collect();
    CborValue::Map(vec![
        ("id".to_string(), CborValue::Tstr(h.id.clone())),
        ("props".to_string(), CborValue::Map(props)),
    ])
}

/// HyperViews are content-addressable (SPEC-3 §4): same (schema, DSet) => byte-identical form.
pub fn hview_canonical_hex(h: &HView) -> String {
    hex::encode(encode(&hview_to_cbor(h)))
}
