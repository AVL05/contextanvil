# External ranking evaluation

Labels sha256 a8205f3bb53eef6b2d96a957e43a5cd0a6d2b672d65399831e0d27c530ce69af (frozen). Node v24.22.2 on win32-x64. 36 tasks over 4 repositories.
Labels: 109, of which 102 are files ContextAnvil can rank; 3 tasks have no rankable label.

## Aggregate (macro-average over tasks)

| Engine | Label set | Tasks | P@1 | MRR | R-precision | R@3 | R@5 | R@8 | Pack recall | Pack bytes | Scan ms (median) | Compile ms (median) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| v0.1.0 (v0.1.0) | rankable | 33 | 0.24 | 0.36 | 0.17 | 0.18 | 0.26 | 0.33 | 0.32 | 9050 | 399 | 2404.9 |
| v0.1.0 (v0.1.0) | all | 36 | 0.22 | 0.34 | 0.15 | 0.17 | 0.23 | 0.29 | 0.28 | 9050 | 399 | 2404.9 |
| v0.1.1 (v0.1.1) | rankable | 33 | 0.33 | 0.43 | 0.21 | 0.24 | 0.28 | 0.44 | 0.43 | 9295 | 142.4 | 371.2 |
| v0.1.1 (v0.1.1) | all | 36 | 0.31 | 0.40 | 0.19 | 0.20 | 0.23 | 0.38 | 0.38 | 9295 | 142.4 | 371.2 |

## Per repository (rankable labels)

| Repo | Engine | Tasks | P@1 | MRR | R-precision | R@5 |
|---|---|---|---|---|---|---|
| portfolio | v0.1.0 | 12 | 0.33 | 0.52 | 0.24 | 0.40 |
| portfolio | v0.1.1 | 12 | 0.50 | 0.61 | 0.34 | 0.42 |
| alexgallery | v0.1.0 | 12 | 0.17 | 0.28 | 0.09 | 0.15 |
| alexgallery | v0.1.1 | 12 | 0.25 | 0.34 | 0.10 | 0.09 |
| lumaflow-studio | v0.1.0 | 7 | 0.00 | 0.06 | 0.03 | 0.03 |
| lumaflow-studio | v0.1.1 | 7 | 0.00 | 0.12 | 0.00 | 0.14 |
| premium-frontend-showcase | v0.1.0 | 2 | 1.00 | 1.00 | 0.67 | 0.83 |
| premium-frontend-showcase | v0.1.1 | 2 | 1.00 | 1.00 | 0.83 | 1.00 |

## Every task (rankable labels; "rank" is the position of each relevant file, miss = not in the top 50)

| Task | Repo | v0.1.0 R-prec | v0.1.0 ranks | v0.1.1 R-prec | v0.1.1 ranks |
|---|---|---|------|---
| stop reduced-motion pause cancelling viewer playback and settle hero p | portfolio | 0.25 | hero.tsx:2 project-showcase.tsx:10 frontend-redesign.spec.ts:22 m2-selected-work.spec.ts:25 | 0.50 | hero.tsx:1 project-showcase.tsx:4 frontend-redesign.spec.ts:13 m2-selected-work.spec.ts:12 |
| record production deployment and public validation | portfolio | 0.00 | RELEASE_2_1.md:11 | 0.00 | RELEASE_2_1.md:16 |
| refine skills and profile copy | portfolio | 0.40 | skills.tsx:1 en.json:7 es.json:37 page-content.ts:31 home-refinement.test.mjs:5 | 0.40 | skills.tsx:1 en.json:6 es.json:34 page-content.ts:13 home-refinement.test.mjs:4 |
| sync cursor with pointer preferences | portfolio | 0.50 | custom-cursor.tsx:1 ui-quality.test.mjs:38 | 0.50 | custom-cursor.tsx:1 ui-quality.test.mjs:25 |
| patch Next.js to 16.3.4 and sharp to 0.35.4 | portfolio | 0.00 | package.json:4 | 0.00 | package.json:3 |
| remove obsolete files and update favicon | portfolio | 0.14 | design.json:miss settings.json:miss CLAUDE.md:miss README.md:1 RAW_VIVES_PROMOTION_COPY.md:miss portfolio.spec.ts:miss ui-quality.test.mjs:miss | 0.14 | design.json:miss settings.json:miss CLAUDE.md:miss README.md:1 RAW_VIVES_PROMOTION_COPY.md:miss portfolio.spec.ts:miss ui-quality.test.mjs:miss |
| restore direct section anchors | portfolio | 0.00 | navigation.tsx:16 | 0.00 | navigation.tsx:8 |
| add mobile archive swipe | portfolio | 0.00 | photography.tsx:2 | 1.00 | photography.tsx:1 |
| normalize theme colors for Three.js | portfolio | 1.00 | hero-webgl.tsx:1 | 1.00 | hero-webgl.tsx:1 |
| document raw.vives integration | portfolio | 0.00 | README.md:miss | 0.00 | README.md:miss |
| add raw.vives case study | portfolio | 0.20 | photography.tsx:6 projects.tsx:3 language-context.tsx:miss en.json:7 es.json:21 | 0.20 | photography.tsx:6 projects.tsx:3 language-context.tsx:miss en.json:7 es.json:14 |
| restore web3forms browser submission | portfolio | 0.33 | route.ts:2 contact.tsx:miss next.config.mjs:miss | 0.33 | route.ts:2 contact.tsx:miss next.config.mjs:miss |
| show the title and label from the first paint | alexgallery | 0.00 | use-hero-motion.ts:miss photo-motion.ts:miss | 0.00 | use-hero-motion.ts:miss photo-motion.ts:miss |
| prepare RAW.VIVES cinematic Premium redesign and reset legacy design s | alexgallery | 0.14 | dependabot.yml:miss design.json:37 AGENTS.md:miss DESIGN.md:38 PRODUCT.md:miss README.md:miss RAW_VIVES_DESIGN_SYSTEM.md:1 | 0.14 | dependabot.yml:miss design.json:19 AGENTS.md:48 DESIGN.md:9 PRODUCT.md:40 README.md:41 RAW_VIVES_DESIGN_SYSTEM.md:1 |
| add El oficio en las manos | alexgallery | 0.13 | gallery-data.ts:2 images-data.json:miss content.ts:miss archive-system.test.ts:miss hero-system.test.ts:miss home-narrative.test.ts:miss photo-detail-system.test.ts:miss photo-series-system.test.ts:miss | 0.25 | gallery-data.ts:2 images-data.json:miss content.ts:miss archive-system.test.ts:miss hero-system.test.ts:miss home-narrative.test.ts:10 photo-detail-system.test.ts:1 photo-series-system.test.ts:miss |
| isolate content during intro | alexgallery | 0.25 | intro-overlay.tsx:1 intro-skip-button.tsx:9 smoke.spec.ts:20 intro-system.test.ts:19 | 0.25 | intro-overlay.tsx:2 intro-skip-button.tsx:10 smoke.spec.ts:19 intro-system.test.ts:23 |
| consolidate repository instructions | alexgallery | 0.00 | AGENTS.md:3 CLAUDE.md:4 | 0.00 | AGENTS.md:7 CLAUDE.md:8 |
| harden production experience | alexgallery | 0.00 | archive-page.tsx:miss hero-frames-scene.tsx:miss photo-frame-preview.tsx:miss use-archive-state.ts:miss archive-system.test.ts:miss | 0.00 | archive-page.tsx:miss hero-frames-scene.tsx:miss photo-frame-preview.tsx:miss use-archive-state.ts:miss archive-system.test.ts:miss |
| final qa and cleanup | alexgallery | 0.43 | layout.tsx:miss metadata.tsx:miss optimized-image.tsx:miss RAW_VIVES_ARCHITECTURE.md:3 RAW_VIVES_ARCHIVE_SYSTEM.md:4 RAW_VIVES_DESIGN_SYSTEM.md:44 RAW_VIVES_GRAPHICS_SYSTEM.md:6 | 0.29 | layout.tsx:miss metadata.tsx:miss optimized-image.tsx:miss RAW_VIVES_ARCHITECTURE.md:4 RAW_VIVES_ARCHIVE_SYSTEM.md:12 RAW_VIVES_DESIGN_SYSTEM.md:44 RAW_VIVES_GRAPHICS_SYSTEM.md:6 |
| add adaptive 3d quality | alexgallery | 0.00 | hero-frames-scene.tsx:miss | 0.00 | hero-frames-scene.tsx:miss |
| unify motion system | alexgallery | 0.00 | archive-item.tsx:miss archive-preview.tsx:miss photo-detail-navigation.tsx:miss photo-detail-related.tsx:miss series-essay.tsx:miss series-index-page.tsx:miss | 0.00 | archive-item.tsx:miss archive-preview.tsx:miss photo-detail-navigation.tsx:miss photo-detail-related.tsx:miss series-essay.tsx:miss series-index-page.tsx:miss |
| prepare optimized photo frame asset | alexgallery | 0.00 | layout.tsx:miss | 0.00 | layout.tsx:miss |
| update Instagram and simplify gallery copy | alexgallery | 0.14 | layout.tsx:10 contact.tsx:35 footer.tsx:6 photo-detail-header.tsx:13 en.json:14 es.json:15 config.ts:miss | 0.29 | layout.tsx:4 contact.tsx:38 footer.tsx:1 photo-detail-header.tsx:8 en.json:16 es.json:17 config.ts:miss |
| record cloudflare pages project endpoint | alexgallery | 0.00 | RAW_VIVES_DEPLOYMENT.md:16 | 0.00 | RAW_VIVES_DEPLOYMENT.md:8 |
| record local E2E result and its baseline comparison | lumaflow-studio | 0.00 | 2026-11-06-consolidation-release-assessment.md:50 | 0.00 | 2026-11-06-consolidation-release-assessment.md:45 |
| drop SEO sections duplicated by the branch merge | lumaflow-studio | 0.00 | api.md:29 architecture.md:30 roadmap.md:21 | 0.00 | api.md:9 architecture.md:10 roadmap.md:6 |
| give cold-start page suites a 15 s budget | lumaflow-studio | 0.00 | vite.config.js:miss | 0.00 | vite.config.js:miss |
| resolve frontend nginx config path | lumaflow-studio | - | (no rankable label) | - | (no rankable label) |
| simplify access screens | lumaflow-studio | 0.00 | AuthShell.jsx:miss LoginPage.jsx:miss RegisterPage.jsx:miss | 0.00 | AuthShell.jsx:miss LoginPage.jsx:miss RegisterPage.jsx:miss |
| use ephemeral cache on free hosting | lumaflow-studio | 0.00 | render.yaml:7 | 0.00 | render.yaml:6 |
| use PHP 8.4 in production image | lumaflow-studio | - | (no rankable label) | - | (no rankable label) |
| mejoras de productividad y estetica tras auditoria de UI | lumaflow-studio | 0.20 | Button.jsx:5 chartTheme.js:miss PresetSlider.jsx:miss DashboardPage.jsx:miss PhotosPage.jsx:miss | 0.00 | Button.jsx:7 chartTheme.js:miss PresetSlider.jsx:miss DashboardPage.jsx:14 PhotosPage.jsx:16 |
| use backend url fallback | lumaflow-studio | 0.00 | client.js:miss | 0.00 | client.js:3 |
| mark the tools in your setup with a small square instead of a side bar | premium-frontend-showcase | - | (no rankable label) | - | (no rankable label) |
| third art-direction pass on craft, gates and titles | premium-frontend-showcase | 0.33 | DESIGN.md:7 Experience.jsx:1 page.jsx:5 | 0.67 | DESIGN.md:5 Experience.jsx:2 page.jsx:1 |
| preserve revealed content without JavaScript | premium-frontend-showcase | 1.00 | page.jsx:1 | 1.00 | page.jsx:1 |
