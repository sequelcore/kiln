# General Work Contracts: Cross-Domain Evidence on Dimension Separation

Status: active issue-backed research

Owner: issue #9

Evidence cutoff: 2026-08-04

Promotion target: an admitted cross-domain work-contract architecture or ADR.

Exit condition: record an explicit adoption or rejection decision, preserve
reusable evidence, and delete this research note.

## Purpose

This note records primary-source research on whether the separation of intent,
context/evidence, process/phase, capability/identity, and review as conditional
dimensions generalizes across governed work types beyond programming. It
responds to the operator's hypothesis (GitHub issue #9) that the conflation
`evidence===phase===route===capability===identity` is a monolithic design
pattern that limits work governance to programming. The research surveys
contract theory, professional/trade governance, evidence frameworks, hobby/
community structures, and quality management standards.

This is evidence gathering, not architecture design. No Kiln implementation
decisions are proposed.

## Scope

Sources reviewed between 2026-08-03 and 2026-08-04:

- Contract theory: Wikipedia survey of principal-agent theory, moral hazard,
  adverse selection, incomplete contracts (Hart & Holmström, 2016 Nobel Prize).
  Source: https://en.wikipedia.org/wiki/Contract_theory
- Construction contracts: FIDIC Rainbow Suite (1999, 2017 editions),
  construction contract types and features.
  Sources: https://en.wikipedia.org/wiki/Construction_contract,
  https://en.wikipedia.org/wiki/International_Federation_of_Consulting_Engineers
- Building codes and inspection: permit → build → inspect → occupancy lifecycle.
  Source: https://en.wikipedia.org/wiki/Building_code
- ISO 9001:2015 quality management systems: structure, PDCA cycle, seven
  quality management principles, process approach.
  Source: https://en.wikipedia.org/wiki/ISO_9000_family
- CMMI (Capability Maturity Model Integration): practice areas, maturity levels,
  appraisal method, v2.0 and v3.0 structure.
  Source: https://en.wikipedia.org/wiki/Capability_Maturity_Model_Integration
- Audit evidence: ISA 500, PCAOB AS 1105, sufficiency and appropriateness,
  evidence provenance hierarchy.
  Source: https://en.wikipedia.org/wiki/Audit_evidence
- Clinical pathways: evidence-based care pathways, variance tracking,
  multidisciplinary coordination.
  Source: https://en.wikipedia.org/wiki/Clinical_pathway
- Professional regulation: codes of conduct, licensing, disciplinary
  proceedings in EU and UK.
  Source: https://en.wikipedia.org/wiki/Professional_conduct
- Contributor License Agreements: open-source governance, copyright vs.
  license grant vs. relicensing authority.
  Source: https://en.wikipedia.org/wiki/Contributor_License_Agreement
- Existing Kiln research: #13 (work governance and verification),
  #20 (cross-domain task taxonomy), #31 (visual work abstraction).

---

## 1. Contract Theory and Labor Contracts

### 1.1 Dimensions of a Well-Formed Contract

Contract theory in economics — formalized by Arrow (1960s), Hart and Holmström
(2016 Nobel Prize) — studies how actors construct contractual arrangements under
information asymmetry. The theory explicitly separates several dimensions that
map to the operator's proposed axes:

**Intent/Scope (what must be delivered):** In principal-agent models, the
contract specifies an output function `y(e)` — the observable result as a
function of the agent's effort. The principal designs the wage function `w(y)`
to incentivize the desired output. The contract defines *what* counts as
performance, not *how* the agent achieves it.

Source: Contract theory, Wikipedia; Shavell (1979), "Risk sharing and
incentives in the principal and agent relationship", Bell Journal of Economics.

**Capability/Identity (who can do it):** Adverse selection models (Myerson,
Maskin, 1980s) explicitly separate the agent's *type* — a private
characteristic the principal cannot observe at contract time. The agent's
qualification, cost structure, or skill level is a distinct dimension from the
output specification. Spence's job-market signalling model (1973) formalizes
how agents signal capability to reduce information asymmetry.

Source: Contract theory, Wikipedia; Spence (1973), "Job Market Signaling",
Quarterly Journal of Economics, 87(3):355–374.

**Evidence/Verification (how performance is measured):** The moral hazard
model's central problem is that the principal *cannot observe* the agent's
action — only the output. Performance-based contracts "depend on observable and
verifiable output." The theory distinguishes between:
- Observable but not verifiable (cannot be enforced by courts)
- Verifiable but not observable (can be proven after the fact)
- Both observable and verifiable (enforceable in real time)

This is a direct separation of *evidence provenance* from *process*.

Source: Contract theory, Wikipedia; Grossman & Hart (1983), "An analysis of
the principal-agent problem", Econometrica, 51(1):7–46.

**Review/Acceptance (independent sign-off):** Incomplete contract theory
(Hart & Moore, 1988) recognizes that parties cannot write complete contingent
contracts. The law provides *default rules* that fill gaps. This is
functionally equivalent to a review/acceptance mechanism: when the contract is
silent, an external authority (court, arbitrator, default rule) determines
whether obligations were met.

Source: Hart & Moore (1988), "Incomplete Contracts and Renegotiation",
Econometrica, 56(4):755–785.

### 1.2 Is the Separation Recognized?

**Citation:** Yes. Contract theory explicitly separates:
1. Output specification (intent/scope)
2. Agent type (capability/identity)
3. Observable/verifiable signals (evidence)
4. Enforcement mechanism (review/acceptance)

These are not conflated in the theory. The moral hazard problem *exists
because* effort (process) is separated from output (evidence). The adverse
selection problem *exists because* agent type (identity) is separated from
contract terms (intent).

**Inference:** The separation is not just recognized — it is the *foundation*
of the field. The entire theory is built on analyzing what happens when these
dimensions are asymmetrically distributed between parties.

### 1.3 Construction Contracts: FIDIC and Standard Forms

Construction contracts provide the most explicit real-world separation of
governed-work dimensions:

**Intent/Scope:** The contract specifies the *works* — what must be built,
to what standard, by when. FIDIC contracts separate by project type:
- Red Book: employer-designed works
- Yellow Book: contractor-designed works
- Silver Book: EPC/turnkey
- Green Book: short-form

Each book varies *who controls the design* (intent ownership) while keeping
the same structural separation of dimensions.

Source: FIDIC Rainbow Suite (1999); Bunni, N.G. (2013), The FIDIC Forms of
Contract, Wiley.

**Evidence of completion:** Construction contracts use *practical completion*
— a formal certificate issued when work is "completed and accepted by the
client." This is distinct from the process used to build. The *retention*
mechanism (a percentage of payment withheld as security) separates evidence of
performance from payment, creating an independent verification hold.

Source: Construction contract, Wikipedia; Kempthorne, V. (2019), "The meaning
of 'Practical Completion'", Clarks Legal.

**Verification/Inspection:** *Snagging* — the process where the owner or
agent checks for defects before final payment — is an explicit review phase
separate from construction. Building codes require *independent inspection*
at defined stages (foundation, framing, electrical, plumbing, final) by
authorized inspectors who are not the builder.

Source: Building code, Wikipedia; Metropolitan Buildings Act 1844 (UK).

**Capability/Identity:** Building codes specify "qualification of individuals
or corporations doing the work." Licensed trades (electricians, plumbers,
structural engineers) must hold credentials independent of the specific
contract. The *permit* process requires proof of qualified personnel before
work begins.

Source: Building code, Wikipedia; International Building Code (IBC).

**Process/Phase:** Construction follows a legally mandated sequence:
plan → permit → build → inspect → occupancy. Each phase has distinct gates
and evidence requirements. The *base date* mechanism in FIDIC contracts
allocates risk for changes between tender pricing and contract signing —
a temporal context dimension separate from scope.

Source: FIDIC, Wikipedia; Construction contract, Wikipedia.

---

## 2. Professional/Trade Governance (Oficios, Profesiones)

### 2.1 Medical Governance: Clinical Pathways

Clinical pathways are "multidisciplinary management tools based on
evidence-based practice for a specific group of patients with a predictable
clinical course, in which the different tasks (interventions) by the
professionals involved in the patient care are defined, optimized and
sequenced."

Source: Kinsman et al. (2010), "What is a clinical pathway?: development of
a definition to inform the debate", BMC Medicine, 8:31.

The separation of dimensions in medical governance:

**Intent (diagnosis → treatment plan):** The clinical pathway defines the
expected course for a condition. It is based on evidence-based guidelines but
is *not prescriptive* — "the patient's journey is an individual one."

**Capability/Identity (licensing, specialization):** Medical practice requires
licensure (medical degree, residency, board certification) independent of any
specific patient case. Specialization (cardiology, surgery, psychiatry)
further segments who can perform which interventions.

**Process/Phase (care pathway stages):** Pathways define sequenced
interventions — assessment, diagnosis, treatment, monitoring, discharge —
with defined roles at each stage. The pathway is "recorded in a single
all-encompassing bedside document."

**Evidence (chart documentation, lab results, imaging):** Evidence of care
is recorded separately from the care process. The bedside document "will
stand as an indicator of the care a patient is likely to be provided" and
"ultimately as a single unified legal record of the care the patient has
received."

**Review (variance analysis, peer review):** "Variances" — deviations from
the expected pathway — are recorded and analyzed. "The combined variances
for a sufficiently large population of patients are then analysed to identify
important or systematic features, which can be used to improve the next
iteration of the pathway." This is explicit review separate from execution.

Source: Clinical pathway, Wikipedia; Zander, Bower & Etheredge (1987),
Nursing case management: blueprints for transformation, New England Medical
Center.

### 2.2 Legal Profession: Pleading → Discovery → Trial → Verdict

The legal process explicitly separates:

- **Intent:** The complaint/pleading defines the scope of the dispute.
- **Capability/Identity:** Bar admission, jurisdictional licensing, and
  specialization (criminal, civil, corporate) determine who can represent.
- **Process/Phase:** Civil procedure defines mandatory phases: pleading,
  discovery, pre-trial, trial, appeal. Each phase has distinct rules of
  evidence and procedure.
- **Evidence:** Rules of evidence (relevance, hearsay, authentication) govern
  what counts as admissible proof. Evidence provenance matters: direct
  testimony, documentary evidence, expert opinion have different weights.
- **Review:** The verdict (jury or judge) is an independent determination
  separate from the advocacy process. Appeals provide a further review layer.

Source: Professional conduct, Wikipedia; CCBE Charter of core principles of
the European legal profession.

**Inference:** Legal governance is perhaps the most explicit example of
dimension separation. The *adversarial system* exists precisely because
evidence, advocacy (process), and judgment (review) must be kept separate to
produce legitimate outcomes.

### 2.3 Construction Trades: Permit → Build → Inspect → Occupancy

As documented in Section 1.3, construction governance separates:

- **Intent:** Architectural plans and specifications.
- **Capability/Identity:** Licensed trades, registered professional engineers,
  bonded contractors.
- **Process/Phase:** Permit → foundation → framing → rough-in → finish →
  final inspection → certificate of occupancy.
- **Evidence:** Inspection reports, material certifications, engineering
  calculations, as-built drawings.
- **Review:** Independent building inspectors (government or approved
  inspectors), separate from the builder. Snagging/punch list before final
  payment.

**Conditional variation:** The *degree* of separation varies by project
complexity. A residential renovation may have fewer mandatory inspection
points than a commercial high-rise. FIDIC offers different contract books
for different project types. This supports the operator's hypothesis that
the dimensions are *conditional* — they exist in all cases but their
specificity varies by work type.

Source: Building code, Wikipedia; FIDIC Rainbow Suite.

### 2.4 Are These Separations Conditional or Universal?

**Citation:** The dimensions appear universal across regulated professions,
but their *instantiation* is conditional:

| Domain | Intent | Capability | Process | Evidence | Review |
|---|---|---|---|---|---|
| Medicine | Diagnosis/treatment plan | License, specialty | Care pathway stages | Chart, labs, imaging | Variance analysis, peer review |
| Law | Pleading/complaint | Bar admission, jurisdiction | Procedure phases | Admissible evidence | Verdict, appeal |
| Construction | Plans/specs | Trade license, PE stamp | Permit→build→inspect | Inspection reports, certs | Independent inspector, snagging |
| Audit | Engagement letter | CPA/license, independence | Plan→test→report | Working papers, confirmations | Partner review, peer review |

**Inference:** The five-axis separation recurs across all surveyed domains.
What varies is:
- The *granularity* of phase gates (construction has more mandatory
  inspections than a hobby project)
- The *independence requirement* for review (building inspectors must not
  be the builder; auditors must be independent of the client)
- The *formality* of evidence (medical charts are legal documents; open-source
  commit messages are not)

---

## 3. Evidence in Non-Programming Governance

### 3.1 What Counts as Evidence of Completion?

Across domains, evidence of completion is explicitly separated from the
process used and the identity of who did it:

**Audit evidence (ISA 500 / PCAOB AS 1105):** "Audit evidence is the primary
support for an auditor's opinion." It must be *sufficient* (enough) and
*appropriate* (relevant and reliable). The standard explicitly separates:

- **Source:** External evidence (from third parties) is more reliable than
  internal evidence (from the client). Direct knowledge (auditor's own
  observation) is most reliable.
- **Procedure type:** Inspection, observation, inquiry, confirmation,
  recalculation, reperformance, analytical procedures — each produces
  different evidence with different reliability.
- **Timing:** Evidence gathered at different audit stages serves different
  purposes (planning, control testing, substantive testing, conclusion).

Source: Audit evidence, Wikipedia; PCAOB AS 1105: Audit Evidence;
Yoon, Hoogduin & Zhang (2015), "Big Data as Complementary Audit Evidence",
Accounting Horizons, 29(2):431–438.

**Construction evidence:** Practical completion certificates, inspection
reports, material test results, and as-built drawings are evidence of
completion. They are produced by *different parties* than the builder
(inspector, testing lab, engineer) and are *about* the work, not *the work
itself*.

**Medical evidence:** Lab results, imaging, vital signs, and clinical notes
are evidence of patient status and care delivered. They are recorded in the
medical record (evidence artifact) separately from the care process.

### 3.2 Evidence Provenance

**Citation:** Audit evidence standards explicitly define a provenance
hierarchy:

1. **Direct knowledge** (auditor's own observation) — highest reliability
2. **External independent** (third-party confirmation) — high reliability
3. **External non-independent** (client-provided external documents) — moderate
4. **Internal with strong controls** — moderate
5. **Internal with weak controls** — low reliability

Source: Audit evidence, Wikipedia; PCAOB AS 1105.

This provenance hierarchy maps directly to the concept of "evidence source
identity, observation time, freshness" that the operator asks about. Audit
standards require the auditor to consider:
- *Who* produced the evidence (source identity)
- *When* it was obtained (observation time)
- *Whether* it has been altered since production (freshness/integrity)

**Construction inspection** follows a similar provenance model: the inspector
must be independent of the builder, must observe the work *in person* at
defined stages, and must issue a report that becomes a permanent record.

**Medical chart review** requires that entries be signed, dated, and
attributed to a specific provider. Entries cannot be altered after the fact
without an amendment process that preserves the original.

**Inference:** Evidence provenance — source identity, observation time,
freshness — is a recognized and formalized concept in audit, construction,
and medical governance. It is *not* conflated with the process that produced
the work or the identity of the worker. It is a separate dimension with its
own quality criteria.

### 3.3 Evidence Is Not Conflated with Process or Identity

**Citation:** In every surveyed domain, evidence of completion is kept
separate from:

- **The process used:** A building inspection report does not describe *how*
  the builder built the wall. It describes *whether* the wall meets code.
- **The identity of who did it:** An audit confirmation from a bank verifies
  the account balance regardless of which clerk recorded the transaction.
- **The phase it was produced in:** Medical lab results are evidence of
  patient status at a point in time, independent of which care pathway stage
  ordered them.

**Inference:** The conflation `evidence===phase===route===capability===identity`
that the operator identifies as a monolithic design pattern does not appear
in any of the surveyed non-programming governance domains. Evidence, process,
identity, and review are consistently treated as separate dimensions.

---

## 4. Hobby/Community Governance

### 4.1 Open-Source Contributor Agreements

Contributor License Agreements (CLAs) separate governed-work dimensions in
open-source projects:

**Intent/Scope:** The CLA defines what rights are granted — typically an
irrevocable license to use, modify, and distribute the contribution. The
project's license (MIT, GPL, Apache) defines the scope of downstream use.

**Capability/Identity:** Contributors must sign the CLA before their
contributions are accepted. Some projects require identity verification
(e.g., Developer Certificate of Origin, signed commits). The Fedora Project
replaced its CLA with a Contributor Agreement that does not assign copyright
but still requires identity.

**Evidence:** The contribution itself (code, documentation) is the evidence.
Git commit history provides provenance: who contributed, when, and under what
agreement.

**Review:** Pull request review, CI/CD checks, and maintainer approval are
explicit review gates separate from the contribution process.

**Conditional variation:** The KDE project uses the FSFE Fiduciary Licence
Agreement, which adds a *conditional* dimension: if the FSFE violates Free
Software principles, "all granted rights and licences shall automatically
return to the Beneficiary." This is a conditional obligation triggered by
governance failure.

Source: Contributor License Agreement, Wikipedia; Project Harmony
(harmonyagreements.org); KDE Fiduciary Licence Agreement.

### 4.2 Limitations of Hobby Governance Evidence

**Could not verify:** There is limited formal research on governance
structures in hobby communities (makerspaces, volunteer organizations,
amateur sports). The open-source CLA model is the strongest available
evidence for community governance, but it is still a *legal* instrument
applied to a community context.

**Inference:** Hobby/community governance appears to separate dimensions
less formally than regulated professions, but the separation still exists:
- Makerspace rules separate *who can use equipment* (capability/safety
  training) from *what they can make* (intent/scope) from *how the space
  is governed* (review/board).
- Volunteer organizations separate *role assignment* (identity) from *task
  execution* (process) from *outcome evaluation* (evidence/review).

The separation is less formalized and less conditional on work type, but
the dimensions are still recognizable.

---

## 5. Quality Management / ISO Standards

### 5.1 ISO 9001:2015 Structure

ISO 9001:2015 follows the Plan-Do-Check-Act (PDCA) cycle and is organized
into 10 sections:

1. Scope
2. Normative references
3. Terms and definitions
4. **Context of the organization** — internal/external issues, interested
   parties
5. **Leadership** — commitment, policy, roles
6. **Planning** — risks, opportunities, objectives
7. **Support** — resources, competence, awareness, communication, documented
   information
8. **Operation** — planning, requirements, design, external provision,
   production, release, nonconforming outputs
9. **Performance evaluation** — monitoring, measurement, analysis, internal
   audit, management review
10. **Continual improvement** — nonconformity, corrective action

Source: ISO 9001:2015; ISO 9000 family, Wikipedia.

### 5.2 Seven Quality Management Principles

The ISO 9000 series is based on seven principles that map to the operator's
proposed axes:

| QMP | Principle | Maps to |
|---|---|---|
| QMP 1 | Customer focus | Intent (what the customer needs) |
| QMP 2 | Leadership | Capability/governance |
| QMP 3 | Engagement of people | Capability/identity |
| QMP 4 | Process approach | Process/phase |
| QMP 5 | Improvement | Review/feedback |
| QMP 6 | Evidence-based decision making | Evidence/context |
| QMP 7 | Relationship management | Context/external providers |

Source: Quality Management Principles (ISO, 2015), ISBN 978-92-67-10650-2.

### 5.3 Does ISO 9001 Prescribe a Fixed Lifecycle?

**Citation:** No. ISO 9001:2015 is explicitly *not* prescriptive about
processes. "The standard no longer specifies that the organization shall
issue and maintain documented procedures." Instead, it requires the
organization to determine what documented information it needs.

The 2015 revision introduced "risk-based thinking" and requires organizations
to "assess risks and opportunities" (section 6.1) and "determine internal
and external issues relevant to its purpose and strategic direction"
(section 4.1). This is a *conditional* approach: the organization determines
which processes need which controls based on risk.

**Inference:** ISO 9001 separates the dimensions (context, leadership,
planning, support, operation, evaluation, improvement) as *structural
sections* but does not prescribe a fixed lifecycle. The organization
determines its own processes within this structure. This supports the
operator's hypothesis that the dimensions are conditional — they exist as
a framework, but their instantiation varies by organization and work type.

### 5.4 CMMI: Practice Areas by Maturity Level

CMMI organizes governance into practice areas (PAs) grouped by maturity
level:

- **Level 2 (Managed):** Requirements Management, Project Planning, Project
  Monitoring and Control, Supplier Agreement Management, Measurement and
  Analysis, Process and Product Quality Assurance, Configuration Management
- **Level 3 (Defined):** Organizational Process Definition, Organizational
  Process Focus, Organizational Training, Integrated Project Management,
  Risk Management, Decision Analysis and Resolution
- **Level 4 (Quantitatively Managed):** Organizational Process Performance,
  Quantitative Project Management
- **Level 5 (Optimizing):** Causal Analysis and Resolution, Organizational
  Performance Management

Source: CMMI, Wikipedia; CMMI Institute (2023), CMMI V3.0.

**Key observation:** CMMI separates *what* practices must be implemented
(practice areas) from *how mature* the implementation is (maturity levels)
from *how it is evaluated* (appraisal). The appraisal method (CAM) is
independent of the practice areas. Organizations cannot be "certified" —
they undergo appraisal, which may result in a maturity level rating.

**Inference:** CMMI separates intent (practice areas), capability (maturity
level), evidence (appraisal artifacts), and review (authorized lead
appraisers). The dimensions are conditional on the organization's chosen
improvement path — the continuous representation allows focusing on specific
practice areas, while the staged representation follows a fixed sequence.

### 5.5 Industry-Specific ISO Interpretations

ISO 9001 is explicitly generic, and industry-specific interpretations add
*domain-specific controls* without changing the structural separation:

- **AS9100** (aerospace): adds configuration management, risk management
- **IATF 16949** (automotive): adds FMEA, APQP, production part approval
- **ISO 13485** (medical devices): adds design controls, sterilization,
  traceability
- **TL 9000** (telecom): adds standardized measurements, benchmarking
- **ISO/IEC 90003** (software): adds software-specific quality processes

Source: ISO 9000 family, Wikipedia.

**Inference:** The existence of industry-specific overlays confirms that
the base framework is domain-neutral and admits domain extensions. This is
directly relevant to whether a general work-contract abstraction can be
domain-neutral.

---

## 6. Recurring Patterns

### Pattern 1: Five-Axis Separation Recurs Across All Surveyed Domains

Every domain surveyed — contract theory, construction, medicine, law, audit,
open-source, ISO 9001, CMMI — separates work governance into at least five
dimensions:

1. **Intent/Scope** — what must be delivered or achieved
2. **Capability/Identity** — who is qualified to do it
3. **Process/Phase** — how the work is sequenced or executed
4. **Evidence** — what proves the work was done correctly
5. **Review/Acceptance** — who independently determines if obligations are met

Citations: Contract theory (Hart & Holmström, 2016); FIDIC Rainbow Suite;
Clinical pathways (Kinsman et al., 2010); ISA 500; ISO 9001:2015; CMMI V3.0.

### Pattern 2: Evidence Is Separated from Process and Identity

In every domain, evidence of completion is a distinct artifact from the
process that produced the work and the identity of the worker. Audit evidence
standards (ISA 500) formalize this most explicitly with a provenance
hierarchy. Construction inspection, medical chart review, and legal evidence
rules all maintain this separation.

Citations: PCAOB AS 1105; Building code inspection requirements; Clinical
pathway bedside documentation.

### Pattern 3: Dimensions Are Conditional, Not Fixed

The *specificity* and *formality* of each dimension varies by work type:

- A residential renovation has fewer inspection gates than a commercial
  high-rise (FIDIC book selection).
- A routine medical visit follows a shorter pathway than a surgical procedure
  (clinical pathway selection criteria).
- An ISO 9001-certified organization determines its own documented procedures
  based on risk assessment (ISO 9001:2015, section 6.1).
- A small open-source project may use a simple DCO instead of a full CLA.

Citations: FIDIC Rainbow Suite; Kinsman et al. (2010); ISO 9001:2015;
Contributor License Agreement, Wikipedia.

### Pattern 4: Review Independence Is a Universal Requirement

Across all domains, the reviewer must be independent of the executor:

- Building inspectors cannot be the builder.
- Auditors must be independent of the client (ISA ethics requirements).
- Legal verdicts are rendered by judge/jury, not the advocates.
- Medical peer review is conducted by colleagues not involved in the case.
- CMMI appraisals are conducted by authorized lead appraisers external to
  the project team.
- Open-source PR review is conducted by maintainers, not the contributor.

Citations: Building code, Wikipedia; ISA ethics; CMMI appraisal method (CAM);
Contributor License Agreement, Wikipedia.

### Pattern 5: Incomplete Contracts Require Default Rules

Hart & Moore (1988) established that complete contracts are impossible —
parties cannot foresee all contingencies. The law provides default rules to
fill gaps. This maps to the need for *governance defaults* when a work
contract does not specify every dimension:

- Construction: building codes provide minimum standards when the contract
  is silent.
- Medicine: standard of care provides a default when the clinical pathway
  does not cover a specific situation.
- Open-source: the project license provides default terms when the CLA does
  not address a specific use.

Citations: Hart & Moore (1988); Building code, Wikipedia; Clinical pathway
variance handling.

### Pattern 6: Evidence Provenance Hierarchies Are Formalized

Audit evidence standards define explicit provenance hierarchies (direct >
external independent > external non-independent > internal with controls >
internal without controls). Construction inspection requires in-person
observation at defined stages. Medical records require signed, dated,
attributed entries.

This is the strongest evidence that "evidence" is not a monolithic concept
but has internal structure: source, time, method, and integrity are
sub-dimensions.

Citations: PCAOB AS 1105; Yoon, Hoogduin & Zhang (2015); Building code
inspection requirements; Medical record documentation standards.

### Pattern 7: Capability Is Separated from Specific Work Assignments

Professional licensing (medical, legal, engineering, trades) establishes
capability *independent* of any specific contract or assignment. The license
is a standing credential that qualifies the holder for a *class* of work,
not a specific task. This is distinct from the contract, which assigns
specific work.

Citations: Professional conduct, Wikipedia; Building code qualification
requirements; Spence (1973) job-market signalling.

### Pattern 8: Domain-Specific Controls Are Layered on Top of Base Frameworks

Industry-specific ISO interpretations (AS9100, IATF 16949, ISO 13485,
TL 9000) add domain-specific controls without changing the base framework's
structural separation. This pattern — domain-neutral base + domain-specific
overlay — recurs across quality management, construction (FIDIC books),
and professional regulation (specialty boards within medical licensing).

Citations: ISO 9000 family, Wikipedia; FIDIC Rainbow Suite.

---

## 7. Domain-Specific Controls Not Present in Programming

The following controls exist in non-programming domains but have no direct
equivalent in software development. A domain-neutral work-contract
abstraction must either accommodate these as extensions or explicitly
exclude them:

### 7.1 Physical Safety and Life-Safety Gates

- **Building permits** require proof that the design meets life-safety codes
  (fire, structural, egress) before work begins.
- **Medical procedures** require informed consent, anesthesia clearance, and
  surgical timeouts.
- **Trade licensing** (electricians, plumbers) exists because faulty work can
  kill people.

Programming has no equivalent physical-safety gate. The closest analog is
security review for code that handles sensitive data, but this is about
information safety, not physical safety.

### 7.2 Physical Inspection and In-Person Verification

- **Construction inspection** requires a qualified inspector to physically
  visit the site at defined stages.
- **Medical examination** requires physical presence (or telemedicine
  equivalent) for diagnosis.
- **Audit observation** requires the auditor to watch a process being
  performed.

Programming verification is inherently digital and remote. There is no
equivalent of "must be physically present to verify."

### 7.3 Retention and Escrow

- **Construction retention** withholds a percentage of payment (typically
  5–10%) as security against defects until the defects liability period
  expires.
- **Escrow** holds funds or assets until conditions are met.

Programming has no standard retention mechanism. The closest analog is
holding back payment until acceptance testing passes, but this is a
commercial arrangement, not a governance mechanism.

### 7.4 Custody and Chain of Custody

- **Audit evidence** requires chain-of-custody documentation for physical
  evidence.
- **Medical specimens** require chain-of-custody tracking from collection
  to analysis.
- **Legal evidence** requires chain-of-custody to be admissible.

Programming has version control (git) which provides a form of custody
tracking, but it is not formally recognized as chain-of-custody in the
legal or audit sense.

### 7.5 Sign-Off Authority and Professional Stamps

- **Professional Engineer (PE) stamp** is legally required for structural,
  mechanical, and electrical designs in most jurisdictions. The PE assumes
  personal liability.
- **Medical sign-off** — attending physician must sign orders, discharge
  summaries, and death certificates.
- **Audit partner sign-off** — the engagement partner personally signs the
  audit opinion.

Programming has code review approval and merge authority, but no equivalent
of a legally binding professional stamp with personal liability.

### 7.6 Mandatory Waiting Periods and Cooling-Off

- **Building permits** have mandatory review periods before approval.
- **Medical procedures** may require waiting periods (e.g., 24-hour waiting
  period for certain surgeries).
- **Legal contracts** may have statutory cooling-off periods.

Programming has no equivalent mandatory waiting period. CI/CD pipelines can
run in minutes.

### 7.7 Insurance and Bonding

- **Construction bonds** (bid bonds, performance bonds, payment bonds) are
  required for most public-sector construction.
- **Professional indemnity insurance** is required for architects, engineers,
  lawyers, and doctors.
- **Audit firms** carry professional liability insurance.

Programming has no standard insurance or bonding requirement. The closest
analog is warranty provisions in commercial software licenses.

---

## 8. Verdict: Is the Operator's Hypothesis Supported?

### The Hypothesis

The operator hypothesizes that the conflation
`evidence===phase===route===capability===identity` is a monolithic design
pattern that limits work governance to programming, and that oficios
(trades), profesiones (professions), hobbies, and general labor contracts
separate these same dimensions.

### Verdict: **Partially Supported — Strong Convergence, Not Exact Match**

**Supported:**

1. **The five-axis separation recurs across all surveyed domains.** Contract
   theory, construction, medicine, law, audit, open-source governance,
   ISO 9001, and CMMI all separate intent, capability, process, evidence,
   and review as distinct dimensions. This is not a coincidence — it
   appears to be a structural requirement for governed work of any type.

2. **The conflation the operator identifies does not appear in non-programming
   domains.** No surveyed domain conflates evidence with phase, route with
   capability, or identity with review. Evidence is consistently treated as
   a separate artifact with its own provenance and quality criteria.

3. **The dimensions are conditional, not fixed.** Every surveyed domain
   varies the specificity and formality of each dimension based on work type,
   risk, and complexity. FIDIC offers different books for different project
   types. ISO 9001 requires risk-based determination of controls. Clinical
   pathways vary by condition and setting.

4. **Evidence provenance is a recognized concept.** Audit standards (ISA 500)
   formalize evidence provenance hierarchies. Construction inspection
   requires independent observation. Medical records require attribution.
   This supports the operator's intuition that "evidence" has internal
   structure beyond "was it produced."

**Not fully supported / requires further investigation:**

5. **The exact axis count may differ.** The operator proposes five axes
   (intent, context/evidence, process/phase, capability/identity, review).
   The evidence supports at least five, but some domains suggest additional
   axes:
   - **Temporal context** (base date in FIDIC, observation time in audit)
     may be a sixth axis.
   - **Risk/conditional triggers** (ISO 9001 risk-based thinking, FIDIC
     conditional obligations) may be a seventh.
   - **Domain-specific controls** (safety, custody, insurance) are clearly
     extensions, not base axes.

6. **Hobby governance evidence is thin.** The open-source CLA model is the
   strongest available evidence, but it is a legal instrument applied to a
   community context. Informal hobby governance (makerspaces, volunteer
   groups) lacks formal research.

7. **"Route" as a distinct axis is not clearly supported.** The operator's
   original conflation includes "route" (which provider/model/tool executes
   the work). In non-programming domains, the closest analog is "which
   subcontractor" or "which specialist," but this is typically subsumed
   under capability/identity rather than being a separate axis. The
   concept of "route" may be programming-specific.

---

## 9. What Could Not Be Verified

1. **Hobby/community governance theory:** No formal academic research was
   found on governance structures in informal hobby communities (makerspaces,
   volunteer organizations, amateur sports leagues). The open-source CLA
   model is the strongest available proxy, but it is a legal instrument.

2. **Exact axis count:** The evidence supports *at least* five axes but does
   not definitively establish that five is the correct number. Some domains
   suggest six or seven. The operator's five-axis model is a reasonable
   starting point but may need refinement.

3. **"Route" as a general concept:** The concept of "route" (which execution
   path, provider, or model handles the work) does not have a clear analog
   in non-programming governance. It may be a programming-specific dimension
   that does not generalize.

4. **Conditional obligation triggers:** While ISO 9001 and FIDIC both use
   conditional triggers (risk-based controls, contract-book selection), the
   specific mechanisms for *determining* which conditions apply are not
   standardized across domains. Each domain has its own risk-assessment
   methodology.

5. **Cross-domain work-contract standards:** No single standard or framework
   was found that explicitly defines a domain-neutral work-contract model
   spanning programming, trades, professions, and hobbies. ISO 9001 comes
   closest but is a quality management standard, not a work-contract
   specification.

---

## 10. Open Questions for Architecture Review

1. **Axis count and naming:** Should the model use exactly five axes, or
   should temporal context and risk/conditional triggers be promoted to
   first-class axes? The evidence supports both interpretations.

2. **Domain extension mechanism:** How should domain-specific controls
   (safety gates, physical inspection, retention, custody, professional
   stamps, insurance) be admitted? The ISO 9001 overlay pattern (base
   framework + domain-specific interpretation) is the strongest precedent.

3. **"Route" generalization:** Is "route" a programming-specific concept
   that should be subsumed under capability/identity, or is it a general
   concept (which subcontractor, which specialist, which tool) that
   deserves its own axis?

4. **Evidence provenance model:** Should the evidence model adopt the audit
   provenance hierarchy (direct > external independent > external
   non-independent > internal with controls > internal without controls)
   as a base, or should it define its own provenance criteria?

5. **Conditional obligation determination:** How does the system determine
   which conditions apply to a given work item? ISO 9001 uses risk
   assessment; FIDIC uses project-type selection; clinical pathways use
   diagnosis. What is the Kiln equivalent?

6. **Review independence enforcement:** How does the system enforce that the
   reviewer is independent of the executor? In construction, this is a
   legal requirement. In programming, code review by a different person is
   a best practice but not legally mandated. What level of independence
   should Kiln require?

7. **Incomplete contract handling:** When a work contract does not specify
   every dimension, what are the defaults? Hart & Moore (1988) established
   that incomplete contracts require default rules. What are Kiln's default
   rules for unspecified dimensions?

---

## Appendix A: Source Index

| # | Source | Type | URL / Citation |
|---|---|---|---|
| 1 | Contract theory | Wikipedia survey | https://en.wikipedia.org/wiki/Contract_theory |
| 2 | Construction contract | Wikipedia survey | https://en.wikipedia.org/wiki/Construction_contract |
| 3 | FIDIC | Wikipedia survey | https://en.wikipedia.org/wiki/International_Federation_of_Consulting_Engineers |
| 4 | Building code | Wikipedia survey | https://en.wikipedia.org/wiki/Building_code |
| 5 | ISO 9000 family | Wikipedia survey | https://en.wikipedia.org/wiki/ISO_9000_family |
| 6 | CMMI | Wikipedia survey | https://en.wikipedia.org/wiki/Capability_Maturity_Model_Integration |
| 7 | Audit evidence | Wikipedia survey | https://en.wikipedia.org/wiki/Audit_evidence |
| 8 | Clinical pathway | Wikipedia survey | https://en.wikipedia.org/wiki/Clinical_pathway |
| 9 | Professional conduct | Wikipedia survey | https://en.wikipedia.org/wiki/Professional_conduct |
| 10 | Contributor License Agreement | Wikipedia survey | https://en.wikipedia.org/wiki/Contributor_License_Agreement |
| 11 | Hart & Moore (1988) | Academic paper | "Incomplete Contracts and Renegotiation", Econometrica, 56(4):755–785 |
| 12 | Shavell (1979) | Academic paper | "Risk sharing and incentives in the principal and agent relationship", Bell Journal of Economics, 10(1):55–73 |
| 13 | Spence (1973) | Academic paper | "Job Market Signaling", Quarterly Journal of Economics, 87(3):355–374 |
| 14 | Grossman & Hart (1983) | Academic paper | "An analysis of the principal-agent problem", Econometrica, 51(1):7–46 |
| 15 | Kinsman et al. (2010) | Academic paper | "What is a clinical pathway?", BMC Medicine, 8:31 |
| 16 | Yoon, Hoogduin & Zhang (2015) | Academic paper | "Big Data as Complementary Audit Evidence", Accounting Horizons, 29(2):431–438 |
| 17 | PCAOB AS 1105 | Professional standard | Public Company Accounting Oversight Board, Audit Evidence |
| 18 | ISO 9001:2015 | International standard | International Organization for Standardization |
| 19 | CMMI V3.0 (2023) | Professional standard | CMMI Institute / ISACA |
| 20 | FIDIC Rainbow Suite (1999, 2017) | Contract standard | International Federation of Consulting Engineers |
| 21 | Bunni (2013) | Book | The FIDIC Forms of Contract, Wiley, ISBN 978-1-118-65865-9 |
| 22 | Zander, Bower & Etheredge (1987) | Book | Nursing case management: blueprints for transformation, New England Medical Center |
| 23 | Quality Management Principles (2015) | ISO publication | ISBN 978-92-67-10650-2 |

## Appendix B: Mapping Operator's Axes to Domain Evidence

| Operator's Axis | Contract Theory | Construction | Medicine | Law | Audit | ISO 9001 | CMMI |
|---|---|---|---|---|---|---|---|
| Intent | Output function y(e) | Works/specs | Diagnosis/treatment plan | Pleading/complaint | Engagement letter | Context (Sec 4), Planning (Sec 6) | Practice areas |
| Context/Evidence | Observable/verifiable output | Inspection reports, certs | Chart, labs, imaging | Admissible evidence | Working papers, confirmations | Evidence-based decisions (QMP 6) | Appraisal artifacts |
| Process/Phase | Agent effort e (hidden) | Permit→build→inspect→occupy | Care pathway stages | Procedure phases | Plan→test→report | Operation (Sec 8), PDCA | Maturity levels |
| Capability/Identity | Agent type (adverse selection) | Trade license, PE stamp | License, specialty | Bar admission, jurisdiction | CPA, independence | Competence (Sec 7.2) | Organizational training (PA) |
| Review | Enforcement/default rules | Independent inspector, snagging | Variance analysis, peer review | Verdict, appeal | Partner review, peer review | Performance evaluation (Sec 9) | Authorized lead appraiser (CAM) |
