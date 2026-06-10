//! Term evaluation: select/union/mask over DSet (SPEC-2 §4.1-4.3), group into HView (§4.4),
//! prune over HView (§4.6). Mirrors ../ts/src/eval.ts. Sorts are checked at evaluation time (E9).

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::cbor::{encode, CborValue};
use crate::hview::{hview_canonical_hex, HVEntry, HView};
use crate::pred::{eval_pred, str_match, Pred, StrMatch};
use crate::set::{fork, merge, DeltaSet};
use crate::types::{Delta, Target};

#[derive(Debug, Clone, PartialEq)]
pub enum MaskPolicy {
    Drop,
    Annotate,
    Trust(Pred),
}

#[derive(Debug, Clone, PartialEq)]
pub enum GroupKey {
    ByTargetContext,
    ByRole,
    Const(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum PruneKeep {
    All,
    Match(StrMatch),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Term {
    Input,
    Select { pred: Pred, of: Box<Term> },
    Union { left: Box<Term>, right: Box<Term> },
    Mask { policy: MaskPolicy, of: Box<Term> },
    Group { key: GroupKey, of: Box<Term> },
    Prune { keep: PruneKeep, of: Box<Term> },
}

#[derive(Debug, Clone, PartialEq)]
pub enum EvalResult {
    DSet {
        set: DeltaSet,
        /// Negation tags from mask(annotate); consumed by group (E7) or surfaced top-level (E2).
        negated: BTreeSet<String>,
        annotated: bool,
    },
    HView(HView),
}

fn dset_result(set: DeltaSet) -> EvalResult {
    EvalResult::DSet {
        set,
        negated: BTreeSet::new(),
        annotated: false,
    }
}

fn is_negated(
    id: &str,
    negators: &HashMap<String, Vec<String>>,
    memo: &mut HashMap<String, bool>,
) -> bool {
    if let Some(&v) = memo.get(id) {
        return v;
    }
    // Guard: cycles are impossible with verified ids, but degrade safely (E5).
    memo.insert(id.to_string(), false);
    let result = negators
        .get(id)
        .is_some_and(|ns| ns.iter().any(|nid| !is_negated(nid, negators, memo)));
    memo.insert(id.to_string(), result);
    result
}

/// negated(d, D) per SPEC-2 §4.3, over candidate negations restricted by `trusted` (E4).
fn compute_negated(d: &DeltaSet, trusted: Option<&Pred>) -> BTreeSet<String> {
    let mut negators: HashMap<String, Vec<String>> = HashMap::new();
    for n in d.iter() {
        if let Some(p) = trusted {
            if !eval_pred(p, n) {
                continue;
            }
        }
        for ptr in &n.claims.pointers {
            if ptr.role == "negates" {
                if let Target::Delta(dr) = &ptr.target {
                    negators
                        .entry(dr.delta.clone())
                        .or_default()
                        .push(n.id.clone());
                }
            }
        }
    }
    let mut memo: HashMap<String, bool> = HashMap::new();
    d.iter()
        .filter(|delta| is_negated(&delta.id, &negators, &mut memo))
        .map(|delta| delta.id.clone())
        .collect()
}

/// group(key, D) @ root — filing rules per ERRATA-2 E6; annotate tags thread into entries (E7).
fn eval_group(key: &GroupKey, set: &DeltaSet, negated: &BTreeSet<String>, root: &str) -> HView {
    let mut buckets: BTreeMap<String, BTreeMap<String, HVEntry>> = BTreeMap::new();
    let mut file = |prop: &str, d: &Delta| {
        buckets
            .entry(prop.to_string())
            .or_default()
            .entry(d.id.clone())
            .or_insert_with(|| HVEntry {
                delta: d.clone(),
                negated: negated.contains(&d.id),
            });
    };
    for d in set.iter() {
        if let GroupKey::Const(prop) = key {
            file(prop, d);
            continue;
        }
        for ptr in &d.claims.pointers {
            let Target::Entity(er) = &ptr.target else {
                continue;
            };
            if er.id != root {
                continue;
            }
            match key {
                GroupKey::ByTargetContext => {
                    if let Some(ctx) = &er.context {
                        file(ctx, d);
                    }
                }
                GroupKey::ByRole => file(&ptr.role, d),
                GroupKey::Const(_) => unreachable!("handled above"),
            }
        }
    }
    // BTreeMap iteration is id-sorted already (entries keyed by id).
    let props = buckets
        .into_iter()
        .map(|(prop, bucket)| (prop, bucket.into_values().collect()))
        .collect();
    HView {
        id: root.to_string(),
        props,
    }
}

pub fn eval_term(term: &Term, input: &DeltaSet, root: Option<&str>) -> Result<EvalResult, String> {
    fn expect_dset(r: EvalResult, op: &str) -> Result<(DeltaSet, BTreeSet<String>, bool), String> {
        match r {
            EvalResult::DSet {
                set,
                negated,
                annotated,
            } => Ok((set, negated, annotated)),
            EvalResult::HView(_) => Err(format!("{op} requires a DSet operand (E9)")),
        }
    }
    match term {
        Term::Input => Ok(dset_result(input.clone())),
        Term::Select { pred, of } => {
            let (set, _, _) = expect_dset(eval_term(of, input, root)?, "select")?;
            Ok(dset_result(fork(&set, |d: &Delta| eval_pred(pred, d))))
        }
        Term::Union { left, right } => {
            let (l, _, _) = expect_dset(eval_term(left, input, root)?, "union")?;
            let (r, _, _) = expect_dset(eval_term(right, input, root)?, "union")?;
            Ok(dset_result(merge(&l, &r)))
        }
        Term::Mask { policy, of } => {
            let (set, _, _) = expect_dset(eval_term(of, input, root)?, "mask")?;
            Ok(match policy {
                MaskPolicy::Drop => {
                    let negated = compute_negated(&set, None);
                    dset_result(fork(&set, |d: &Delta| !negated.contains(&d.id)))
                }
                MaskPolicy::Annotate => {
                    let negated = compute_negated(&set, None);
                    EvalResult::DSet {
                        set,
                        negated,
                        annotated: true,
                    }
                }
                MaskPolicy::Trust(pred) => {
                    let negated = compute_negated(&set, Some(pred));
                    dset_result(fork(&set, |d: &Delta| !negated.contains(&d.id)))
                }
            })
        }
        Term::Group { key, of } => {
            let root = root.ok_or("group requires an ambient root entity (E9)")?;
            let (set, negated, _) = expect_dset(eval_term(of, input, Some(root))?, "group")?;
            Ok(EvalResult::HView(eval_group(key, &set, &negated, root)))
        }
        Term::Prune { keep, of } => {
            let r = eval_term(of, input, root)?;
            let EvalResult::HView(h) = r else {
                return Err("prune requires an HView operand (E9)".to_string());
            };
            Ok(EvalResult::HView(match keep {
                PruneKeep::All => h,
                PruneKeep::Match(m) => HView {
                    id: h.id,
                    props: h
                        .props
                        .into_iter()
                        .filter(|(prop, _)| str_match(m, prop))
                        .collect(),
                },
            }))
        }
    }
}

/// Canonical serialization of an evaluation result (ERRATA-2 E2, E7).
pub fn result_canonical_hex(result: &EvalResult) -> String {
    match result {
        EvalResult::HView(h) => hview_canonical_hex(h),
        EvalResult::DSet {
            set,
            negated,
            annotated,
        } => {
            let ids: Vec<CborValue> = set
                .ids()
                .into_iter()
                .map(|id| CborValue::Tstr(id.to_string()))
                .collect();
            let bytes = if !annotated {
                encode(&CborValue::Array(ids))
            } else {
                let negated: Vec<CborValue> = negated
                    .iter()
                    .map(|id| CborValue::Tstr(id.clone()))
                    .collect();
                encode(&CborValue::Map(vec![
                    ("ids".to_string(), CborValue::Array(ids)),
                    ("negated".to_string(), CborValue::Array(negated)),
                ]))
            };
            hex::encode(bytes)
        }
    }
}
