# Acceptance matrix

Use separate synthetic accounts and two groups. Reset fixtures after the run.

| Role | Own group | Other group | Administrative settings |
|---|---:|---:|---:|
| Operator | own profile only | denied | denied |
| Supervisor with group | allowed | denied | denied unless explicitly granted |
| Supervisor without group | denied | denied | denied |
| Manager | allowed by role matrix | allowed by role matrix | levels allowed |
| Administrator | allowed | allowed | allowed |

Required write checks: password and username revoke every session; duplicate mission
completion does not duplicate a reward; order refund is idempotent; invalid or
zero-match XLSX changes no database rows; repeated XLSX checksum is a no-op.
