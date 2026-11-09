# ContextAnvil benchmark: after: Phase 1.1 (v0.1.1) (engine v0.1.1)

Node v24.22.2 on win32-x64, 16 CPUs (12th Gen Intel(R) Core(TM) i7-12650H). Timing runs per measurement: 7.

## Ranking quality (macro-average over tasks)

| Set | Tasks | P@1 | P@3 | R@3 | R@5 | R@8 | MRR | R-prec | Pack recall |
|---|---|---|---|---|---|---|---|---|---|
| synthetic / dev | 13 | 0.92 | 0.56 | 0.72 | 0.86 | 0.90 | 0.96 | 0.72 | 0.90 |
| synthetic / holdout | 13 | 0.77 | 0.54 | 0.73 | 0.86 | 0.89 | 0.87 | 0.69 | 0.89 |
| synthetic / all | 26 | 0.85 | 0.55 | 0.72 | 0.86 | 0.89 | 0.92 | 0.70 | 0.89 |
| real / dev | 4 | 1.00 | 0.58 | 0.75 | 0.88 | 1.00 | 1.00 | 0.63 | 1.00 |
| real / holdout | 4 | 0.50 | 0.25 | 0.33 | 0.42 | 0.75 | 0.59 | 0.21 | 0.75 |
| real / all | 8 | 0.75 | 0.42 | 0.54 | 0.65 | 0.88 | 0.79 | 0.42 | 0.88 |

Pack recall = share of relevant files that appear in the default-budget (3000 estimated tokens) pack.

## Per dataset (all tasks)

| Dataset | Kind | Files | Tasks | P@1 | R@3 | MRR | R-prec | Pack bytes (mean) | Repo text bytes |
|---|---|---|---|---|---|---|---|---|---|
| shop-next | synthetic | 43 | 10 | 0.90 | 0.62 | 0.95 | 0.62 | 5246 | 14507 |
| orders-laravel | synthetic | 37 | 8 | 0.75 | 0.65 | 0.85 | 0.65 | 5383 | 8946 |
| plugin-cli | synthetic | 31 | 8 | 0.88 | 0.94 | 0.94 | 0.88 | 4207 | 7520 |
| contextanvil-0.1.0 | real | 57 | 8 | 0.75 | 0.54 | 0.79 | 0.42 | 9022 | 256550 |

## Per task (dev split only; holdout rows are hidden unless --show-holdout)

| Task | Split | R-prec | Ranks of relevant files | Top 3 returned |
|---|---|---|---|---|
| sn-nav-hamburger | dev | 1.00 | components/NavMenu.tsx:1 components/Header.tsx:3 components/NavMenu.test.tsx:2 | components/NavMenu.tsx, components/NavMenu.test.tsx, components/Header.tsx |
| sn-cart-rounding | dev | 1.00 | cart/totals.ts:1 cart/totals.test.ts:2 | cart/totals.ts, cart/totals.test.ts, components/CartSummary.tsx |
| sn-session-expiry | dev | 0.50 | auth/session.ts:1 auth/session.test.ts:4 | auth/session.ts, hooks/useSession.ts, login/route.ts |
| sn-password-strength | dev | 0.50 | components/LoginForm.tsx:1 auth/password.ts:4 | components/LoginForm.tsx, login/route.ts, login/page.tsx |
| sn-checkout-tests | dev | 0.67 | e2e/checkout.spec.ts:1 components/CheckoutForm.tsx:2 checkout/route.ts:5 | e2e/checkout.spec.ts, components/CheckoutForm.tsx, checkout/page.tsx |
| ol-discount | dev | 0.50 | Services/PricingService.php:1 Models/Order.php:2 Requests/StoreOrderRequest.php:8 Unit/PricingServiceTest.php:miss | Services/PricingService.php, Models/Order.php, Commands/PruneAbandonedOrders.php |
| ol-admin-delete | dev | 0.67 | Policies/OrderPolicy.php:1 Middleware/EnsureUserIsAdmin.php:3 Controllers/OrderController.php:6 | Policies/OrderPolicy.php, Models/User.php, Middleware/EnsureUserIsAdmin.php |
| ol-pagination | dev | 0.50 | Controllers/OrderController.php:2 orders/index.blade.php:4 | emails/order-confirmation.blade.php, Controllers/OrderController.php, Mail/OrderConfirmationMail.php |
| ol-qty-validation | dev | 0.50 | Requests/StoreOrderRequest.php:1 Services/InventoryService.php:20 | Requests/StoreOrderRequest.php, migrations/2024_02_01_000000_create_orders_table.php, Controllers/OrderController.php |
| pc-todo-rule | dev | 1.00 | rules/index.js:2 docs/rules.md:1 | docs/rules.md, rules/index.js, rules/require-license-header.js |
| pc-sarif | dev | 0.50 | src/cli.js:1 report/json.js:miss | src/cli.js, README.md |
| pc-ignore | dev | 1.00 | fs/ignore.js:1 fs/walk.js:2 | fs/ignore.js, fs/walk.js, src/engine.js |
| pc-maxlines-default | dev | 1.00 | config/schema.js:2 rules/max-lines.js:1 | rules/max-lines.js, config/schema.js, docs/rules.md |
| rs-vue | dev | 0.50 | detectors/node.js:1 test/detectors.test.js:4 | detectors/node.js, src/scanner.js, test/scanner-safety.test.js |
| rs-jwt | dev | 0.50 | core/secrets.js:1 test/secrets.test.js:8 | core/secrets.js, src/index.js, src/doctor.js |
| rs-license | dev | 0.50 | src/doctor.js:1 test/doctor.test.js:3 | src/doctor.js, src/index.js, test/doctor.test.js |
| rs-quiet | dev | 1.00 | cli/index.js:1 cli/help.js:2 test/cli.test.js:3 | cli/index.js, cli/help.js, test/cli.test.js |

## Performance (this machine only)

| Dataset | Files | Scan ms (median, warm) | Compile ms (median) | Cold process scan ms (1 run) | Cold process peak RSS MB |
|---|---|---|---|---|---|
| shop-next | 43 | 15.6 | 16 | 27.4 | 50 |
| orders-laravel | 37 | 20.2 | 15.2 | 30.7 | 49.4 |
| plugin-cli | 31 | 9.3 | 10.4 | 20.2 | 49.5 |
| contextanvil-0.1.0 | 57 | 11.2 | 23.1 | 24.9 | 50.9 |

### Synthetic scale (generated repositories, median of 3 fresh processes after 1 warm-up)

| Files | Scan ms | Compile ms | Doctor ms | Peak RSS MB |
|---|---|---|---|---|
| 502 | 43 | 251 | 3 | 56 |
| 2002 | 78 | 1043 | 3 | 73 |
| 5002 | 119 | 2313 | 3 | 98 |

### Local real repositories (private; anonymised; timing only)

| Repo | Files | Scan ms | Compile ms | Peak RSS MB |
|---|---|---|---|---|
| local-1 | 357 | 50 | 110 | 66 |
| local-2 | 695 | 88 | 267 | 72 |

## Determinism

Each dataset was scanned, compiled and diagnosed in two separate processes: all outputs were byte-identical.
