# Backend Skill Scout - 2026

Status: Accepted catalog-maintenance evidence
Observed: 2026-07-22, America/Hermosillo

## Question

Which backend skills should Sequel retain, update, consolidate, retire, or add
for modern Java, Spring, PostgreSQL, HTTP API, security, testing, and operational
work without turning version snapshots or popular repository conventions into
durable doctrine?

This research informs the operator skill catalog. It does not replace
repository evidence, executable stack configuration, or the future Stack
Governance Plane.

## Local Baseline

The pre-scout user-global catalog contained four overlapping backend skills:

- `sequel-spring` owned Spring, Java, JPA, transactions, Docker, observability,
  platform versions, security testing, and architecture;
- `sequel-postgres` owned PostgreSQL features, schema, queries, migrations,
  Testcontainers, and database-version targets;
- `test-generator` repeated Spring, PostgreSQL, security, API, and observability
  doctrine inside a test-writing skill;
- `code-reviewer` repeated the same platform and architecture rules while also
  duplicating the findings-first behavior of `code-review-findings`.

The overlap made updates expensive and allowed exact version claims to drift in
multiple Markdown owners.

## Official Platform Snapshot

The following facts were current when this scout was captured. They are
research evidence, not permanent skill constants:

| Area | Observed evidence | Catalog consequence |
| --- | --- | --- |
| Java | JDK 26 was current; JDK 25 remained the Sequel LTS baseline. | Express LTS posture in skills; resolve exact runtime through repo/stack evidence. |
| Spring Boot | 4.1.0 was stable, supported Java through 26, and accepted Gradle 8.14+ or 9.x. | Keep modern Boot 4 procedures, but remove exact patch authority from skills. |
| Spring Security | 7.1.0 was the latest stable documentation line. | Avoid freezing Security 7.0 details; verify the managed Spring line. |
| Spring Modulith | 2.1 documentation covered executable module verification and focused module tests. | Recommend it conditionally where adopted, never as decorative architecture. |
| Gradle | 9.6.1 was current and recommended. | Use the wrapper and compatibility evidence; do not pin `9.x` prose as authority. |
| PostgreSQL | 18 was current and supported; 19 remained beta. | Keep current-major capability guidance but require an explicit major-upgrade slice. |
| Observability | Boot used Micrometer Observation and provided supported OpenTelemetry/OTLP integration. | Keep observability inside runtime practice and prohibit high-cardinality labels. |

Primary sources:

- https://openjdk.org/projects/jdk/
- https://docs.spring.io/spring-boot/reference/
- https://docs.spring.io/spring-boot/system-requirements.html
- https://docs.spring.io/spring-security/reference/
- https://docs.spring.io/spring-modulith/reference/
- https://docs.gradle.org/current/release-notes.html
- https://www.postgresql.org/docs/current/index.html
- https://docs.spring.io/spring-boot/reference/actuator/observability.html
- https://testcontainers.com/guides/

## External Skill Survey

GitHub stars were captured only as adoption/visibility signals. They were not
used as quality or compatibility proof.

| Repository | Stars observed | Relevant material | Decision |
| --- | ---: | --- | --- |
| `github/awesome-copilot` | 36,940 | `java-springboot`, `spring-boot-testing`, PostgreSQL review/optimization, JUnit, security review | Use as research input. Do not admit verbatim: generic Spring rules, Maven/JaCoCo examples, fixed coverage targets, and overlap with Sequel capabilities. |
| `Jeffallan/claude-skills` | 10,688 | Spring engineer, Java architect, API, PostgreSQL, database, security, testing | Reject for this catalog: broad multi-domain prompts and Spring Boot 3/Security 6 assumptions conflict with the target line. |
| `jdubois/dr-jskill` | 316 | Full Spring project generation with scripts/templates and frontend options | Reject as baseline: explicitly experimental, generator-oriented, approximately 100 packaged files, and broader than Sequel backend work. |
| `rrezartprebreza/spring-boot-skills` | 175 | Focused Boot 4 API, Problem Details, transactions, JPA, testing, OAuth2, Flyway, observability skills | Use selected migration details as research. Do not admit verbatim: universal envelopes, UUIDs, Lombok, pagination, architecture, and provider conventions override repo/domain evidence. |

Repository sources:

- https://github.com/github/awesome-copilot
- https://github.com/Jeffallan/claude-skills
- https://github.com/jdubois/dr-jskill
- https://github.com/rrezartprebreza/spring-boot-skills

## Accepted Capability Model

| Capability | Decision | Responsibility |
| --- | --- | --- |
| `backend` | Add | Single router and evidence-first workflow for all Sequel backend work. |
| `sequel-spring` | Rewrite | Spring/Java application architecture, persistence adapters, transactions, runtime, Gradle, Docker, and observability. |
| `sequel-postgres` | Rewrite | PostgreSQL modeling, SQL, concurrency, migrations, query evidence, and operations. |
| `backend-api-contracts` | Add | HTTP semantics, RFC 9457 errors, OpenAPI, pagination, compatibility, and versioning. |
| `backend-security` | Add | Authentication, authorization, Vigil, tenant isolation, browser/token boundaries, abuse controls, and negative tests. |
| `backend-testing` | Add | Domain, module, slice, contract, PostgreSQL/Testcontainers, migration, security, and regression tests. |
| `test-generator` | Retire | Replaced by `backend-testing`; its generic name and duplicated platform doctrine were unnecessary. |
| `code-reviewer` | Retire | Review mechanics belong to `code-review-findings`; backend knowledge comes from the relevant specialist skills. |

## Design Decisions

- Skills hold durable decision procedures, invariants, and verification paths.
- Exact framework, runtime, plugin, driver, and image versions belong in
  executable stack profiles, manifests, wrappers, lockfiles, and migration
  records.
- No external skill is admitted solely because its repository is popular.
- No universal response envelope, identifier type, persistence technology,
  coverage percentage, reactive architecture, or microservice default is part
  of the Sequel baseline.
- A modular monolith is the default posture; service extraction requires real
  deployment, scaling, ownership, or isolation evidence.
- API, security, data, and testing remain separate capabilities so a narrow
  task does not load the entire backend doctrine.

## Verification Record

- External candidate skills were downloaded to isolated staging and inspected
  before any catalog mutation.
- New and rewritten skills use progressive disclosure and local references.
- Retired skills are preserved in the dated operator backup.
- Each admitted skill must pass frontmatter validation, Markdown-link checks,
  cross-harness projection, and drift status verification.

