# Formal Screening Methodology

Formal screening compares paired control (`C0`) and treatment (`T`) runs under
one fixed model/account route, budget, private case package, hidden behavioral
oracle, and sealed Dafny qualification. Treatment exposes `lemma_check`; control
does not. Both arms receive the same candidate workspace and host-owned final
verification.

Primary correctness is `qualifiedCorrect`: the hidden oracle passes, the
candidate contract digest remains bound, trust policy is clean, and the sealed
Dafny run passes under the recorded toolchain. Model claims and stale tool
observations are not qualification evidence.
