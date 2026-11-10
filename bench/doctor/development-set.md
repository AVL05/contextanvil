# Doctor hardening development set

Use these existing synthetic fixtures and temporary-tree tests as development
inputs. Their baseline versions are at the engine commit recorded in
[corpus.json](corpus.json). They may be expanded and used repeatedly during
hardening. The 11 public repositories in the frozen panel are excluded from
this development set.

| Development input | Cases to exercise |
| --- | --- |
| `test/fixtures/next-app` | Conflicting managers, genuinely missing script, and genuinely missing path |
| `test/fixtures/node-lib` | Missing reference, Node entry points, and lifecycle advisory |
| `test/fixtures/laravel-app` | Healthy Composer and framework structure |
| `test/fixtures/broken` | Malformed manifests and partial scan results |
| `test/doctor.test.js` temporary repositories | Benign prohibitions and generated paths, valid scripts, duplicate and sparse guides |
| `test/security.test.js` temporary repositories | Heuristic true and benign examples, hidden text, content redaction and path safety |

Add focused development regressions here or in the owning test suite while
implementing corrections. Establish a new, independently reviewed real-world
holdout before tuning. Do not select that holdout from these fixtures or the
disclosed baseline.
