# Security Specification — Al-Furqaan Membership System (V2.0)

## 1. Data Invariants
1. **Verified Identity Mandate**: Every read/write requires `request.auth != null && request.auth.token.email_verified == true`.
2. **5-Tier RBAC Model (`owner` > `admin` > `cashier` > `viewer` > `member`)**:
   - **Owner Bootstrap**: Verified `markazalfurqan36@gmail.com` bootstraps as `owner`.
   - **Self-Registration Prevention of Escalation**: Self-created `/users/{uid}` profiles (except verified bootstrap owner) MUST be `role == 'member'` and `status == 'active'`.
   - **Cashier Separation of Duties**: Cashiers can record `pending`/`confirmed` payments, attach evidence, and issue receipts, but cannot delete payments or modify member roles/security settings.
   - **Viewer / Auditor Read-Only**: Viewers/Auditors can read period closures, audit logs, and non-PII center summary metrics, without modifying records or exporting confidential individual debt lists improperly.
   - **Member Isolation (`T-12`)**: Regular `member` users can ONLY read their own linked `/members`, `/commitment_history`, `/status_history`, `/contributions`, `/payment_evidence`, and non-PII `/center_stats`.
3. **No Financial History Erasure (`PAY-05`)**: `/contributions/{id}` enforces `allow delete: if false`. Erroneous entries must be cancelled (`status == 'cancelled'`) with a recorded reason and actor.
4. **Immutable Commitment & Status History**: `/members/{id}/commitment_history` and `/members/{id}/status_history` are append-only (`allow update, delete: if false`) so historical months are never rewritten.
5. **No Zero/Negative Commitments or Payments**: All `monthlyCommitment` and `amount` fields strictly enforce `> 0` and currency `ETB`.
6. **Audit Trail Immutability**: `/audit_logs` is append-only (`allow update, delete: if false`).
