# ContextAnvil benchmark: baseline: v0.1.0 as delivered (before Phase 1.1) (engine v0.1.0)

Node v24.22.2 on win32-x64, 16 CPUs (12th Gen Intel(R) Core(TM) i7-12650H). Timing runs per measurement: 7.

## Ranking quality (macro-average over tasks)

| Set | Tasks | P@1 | P@3 | R@3 | R@5 | R@8 | MRR | R-prec | Pack recall |
|---|---|---|---|---|---|---|---|---|---|
| synthetic / dev | 13 | 0.69 | 0.51 | 0.69 | 0.79 | 0.85 | 0.83 | 0.61 | 0.85 |
| synthetic / holdout | 13 | 0.61 | 0.46 | 0.63 | 0.77 | 0.86 | 0.75 | 0.51 | 0.86 |
| synthetic / all | 26 | 0.65 | 0.49 | 0.66 | 0.78 | 0.85 | 0.79 | 0.56 | 0.85 |
| real / dev | 4 | 0.25 | 0.42 | 0.50 | 0.63 | 0.75 | 0.56 | 0.50 | 0.75 |
| real / holdout | 4 | 0.25 | 0.25 | 0.29 | 0.38 | 0.67 | 0.50 | 0.29 | 0.67 |
| real / all | 8 | 0.25 | 0.33 | 0.40 | 0.50 | 0.71 | 0.53 | 0.40 | 0.71 |

Pack recall = share of relevant files that appear in the default-budget (3000 estimated tokens) pack.

## Per dataset (all tasks)

| Dataset | Kind | Files | Tasks | P@1 | R@3 | MRR | R-prec | Pack bytes (mean) | Repo text bytes |
|---|---|---|---|---|---|---|---|---|---|
| shop-next | synthetic | 43 | 10 | 0.70 | 0.58 | 0.81 | 0.48 | 4979 | 14507 |
| orders-laravel | synthetic | 37 | 8 | 0.38 | 0.57 | 0.63 | 0.45 | 4323 | 8946 |
| plugin-cli | synthetic | 31 | 8 | 0.88 | 0.83 | 0.94 | 0.77 | 3840 | 7520 |
| contextanvil-0.1.0 | real | 57 | 8 | 0.25 | 0.40 | 0.53 | 0.40 | 8375 | 256550 |

## Per task (dev split only; holdout rows are hidden unless --show-holdout)

| Task | Split | R-prec | Ranks of relevant files | Top 3 returned |
|---|---|---|---|---|
| sn-nav-hamburger | dev | 0.67 | components/NavMenu.tsx:1 components/Header.tsx:4 components/NavMenu.test.tsx:2 | components/NavMenu.tsx, components/NavMenu.test.tsx, app/layout.tsx |
| sn-cart-rounding | dev | 0.50 | cart/totals.ts:1 cart/totals.test.ts:3 | cart/totals.ts, cart/page.tsx, cart/totals.test.ts |
| sn-session-expiry | dev | 0.50 | auth/session.ts:2 auth/session.test.ts:6 | hooks/useSession.ts, auth/session.ts, lib/db.ts |
| sn-password-strength | dev | 0.50 | components/LoginForm.tsx:1 auth/password.ts:3 | components/LoginForm.tsx, components/CheckoutForm.tsx, auth/password.ts |
| sn-checkout-tests | dev | 0.67 | e2e/checkout.spec.ts:3 components/CheckoutForm.tsx:1 checkout/route.ts:5 | components/CheckoutForm.tsx, checkout/page.tsx, e2e/checkout.spec.ts |
| ol-discount | dev | 0.25 | Services/PricingService.php:13 Models/Order.php:6 Requests/StoreOrderRequest.php:3 Unit/PricingServiceTest.php:miss | Commands/PruneAbandonedOrders.php, Controllers/OrderController.php, Requests/StoreOrderRequest.php |
| ol-admin-delete | dev | 0.33 | Policies/OrderPolicy.php:2 Middleware/EnsureUserIsAdmin.php:5 Controllers/OrderController.php:4 | Models/User.php, Policies/OrderPolicy.php, Commands/PruneAbandonedOrders.php |
| ol-pagination | dev | 0.50 | Controllers/OrderController.php:2 orders/index.blade.php:15 | Commands/PruneAbandonedOrders.php, Controllers/OrderController.php, Requests/StoreOrderRequest.php |
| ol-qty-validation | dev | 0.50 | Requests/StoreOrderRequest.php:1 Services/InventoryService.php:19 | Requests/StoreOrderRequest.php, Models/OrderItem.php, Commands/PruneAbandonedOrders.php |
| pc-todo-rule | dev | 1.00 | rules/index.js:2 docs/rules.md:1 | docs/rules.md, rules/index.js, rules/require-license-header.js |
| pc-sarif | dev | 0.50 | src/cli.js:1 report/json.js:miss | src/cli.js, README.md |
| pc-ignore | dev | 1.00 | fs/ignore.js:1 fs/walk.js:2 | fs/ignore.js, fs/walk.js, config/schema.js |
| pc-maxlines-default | dev | 1.00 | config/schema.js:2 rules/max-lines.js:1 | rules/max-lines.js, config/schema.js, docs/rules.md |
| rs-vue | dev | 0.00 | detectors/node.js:4 test/detectors.test.js:25 | src/scanner.js, test/scanner-safety.test.js, cli/index.js |
| rs-jwt | dev | 0.50 | core/secrets.js:2 test/secrets.test.js:18 | src/index.js, core/secrets.js, compiler/budget.js |
| rs-license | dev | 0.50 | src/doctor.js:2 test/doctor.test.js:7 | src/index.js, src/doctor.js, core/reader.js |
| rs-quiet | dev | 1.00 | cli/index.js:1 cli/help.js:3 test/cli.test.js:2 | cli/index.js, test/cli.test.js, cli/help.js |

## Performance (this machine only)

| Dataset | Files | Scan ms (median, warm) | Compile ms (median) | Cold process scan ms (1 run) | Cold process peak RSS MB |
|---|---|---|---|---|---|
| shop-next | 43 | 11.9 | 10.6 | 24.2 | 49 |
| orders-laravel | 37 | 11.9 | 7.8 | 24.2 | 48.4 |
| plugin-cli | 31 | 6.4 | 6.4 | 17.8 | 47.7 |
| contextanvil-0.1.0 | 57 | 8.9 | 16.5 | 19.2 | 51.7 |

### Synthetic scale (generated repositories, median of 3 fresh processes after 1 warm-up)

| Files | Scan ms | Compile ms | Doctor ms | Peak RSS MB |
|---|---|---|---|---|
| 502 | 35 | 175 | 2 | 51 |
| 2002 | 62 | 588 | 2 | 64 |
| 5002 | 127 | 696 | 2 | 70 |

### Local real repositories (private; anonymised; timing only)

| Repo | Files | Scan ms | Compile ms | Peak RSS MB |
|---|---|---|---|---|
| local-1 | 357 | 45 | 91 | 67 |
| local-2 | 695 | 78 | 193 | 72 |

## Determinism

Each dataset was scanned, compiled and diagnosed in two separate processes: all outputs were byte-identical.
