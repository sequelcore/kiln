# Frontend render fixture

Repair `src/OrderQueue.jsx` and change only that file.

The rendered workflow must provide:

- an `h1` named **Order queue**;
- a table named **Pending orders** with semantic column headers;
- a native button named **Review order A-104** that works with keyboard activation;
- a modal dialog named **Review order A-104**;
- initial dialog focus on **Confirm review**;
- a trapped Tab cycle between the dialog actions while it is open;
- Escape dismissal; and
- focus restoration to the review trigger after dismissal.

Use native semantics where possible. The page and open-dialog state must have no automated WCAG A/AA violations under the verifier's fixed axe-core ruleset.
