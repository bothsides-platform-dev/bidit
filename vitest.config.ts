import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Step 14 — Vitest workspace projects.
//
// Two projects share resolve/plugins/setup but pick the right environment per
// test surface. `pnpm test` runs both; `pnpm test --project=unit-node` (or
// `unit-jsdom`) scopes to one for faster local iteration.
//
//   - unit-node    : DB/server/integrations/auth/api routes — `environment: node`
//                    (heavy postgres-js / pglite / fs work that fights jsdom)
//   - unit-jsdom   : React component + hook surface — `environment: jsdom`
//
// `app/api/files/__tests__/*` files self-declare `@vitest-environment node` via
// pragma. Leaving the pragma harmless after the project split — defense in
// depth if someone later moves the file or the include pattern drifts.
//
// We deliberately do NOT set `plugins`/`resolve` at the root: without
// `extends: true` on each project, root entries are inert. Each project
// declares its own (identical) config — explicit > spooky inheritance.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "."),
            // next-auth's ESM build does `import ... from "next/server"`
            // (no extension). Next's package.json has no `exports` map, so
            // once next-auth is routed through Vite's resolver below, it
            // still needs an explicit file to land on.
            "next/server": "next/server.js",
          },
        },
        test: {
          name: "unit-node",
          // Force next-auth through Vite's transform/resolve pipeline
          // instead of being externalized to Node's native ESM resolver,
          // which can't resolve the extensionless "next/server" bare
          // specifier the alias above maps.
          server: {
            deps: {
              inline: [/next-auth/, /@auth\/core/],
            },
          },
          environment: "node",
          globals: true,
          // pglite (WASM compile + migrations + queries) is CPU-heavy; under
          // the parallel pool both setup hooks and test bodies can exceed the
          // 10s/5s defaults. Give them room — they pass in <1s uncontended.
          hookTimeout: 30_000,
          testTimeout: 30_000,
          setupFiles: ["./vitest.setup.ts"],
          include: [
            "lib/server/**/*.{test,spec}.{ts,tsx}",
            "lib/integrations/**/*.{test,spec}.{ts,tsx}",
            "lib/auth/**/*.{test,spec}.{ts,tsx}",
            "lib/observability/**/*.{test,spec}.{ts,tsx}",
            "lib/utils/**/*.{test,spec}.{ts,tsx}",
            "lib/types/**/*.{test,spec}.{ts,tsx}",
            "lib/validation/**/*.{test,spec}.{ts,tsx}",
            "lib/quote/**/*.{test,spec}.{ts,tsx}",
            "lib/rfp/**/*.{test,spec}.{ts,tsx}",
            "lib/onboarding/**/*.{test,spec}.{ts,tsx}",
            "lib/db/**/*.{test,spec}.{ts,tsx}",
            "lib/env/**/*.{test,spec}.{ts,tsx}",
            "lib/realtime/**/*.{test,spec}.{ts,tsx}",
            "lib/landing/**/*.{test,spec}.{ts,tsx}",
            "lib/seo/**/*.{test,spec}.{ts,tsx}",
            "lib/features/**/*.{test,spec}.{ts,tsx}",
            "lib/brand/**/*.{test,spec}.{ts,tsx}",
            "lib/design/**/*.{test,spec}.{ts,tsx}",
            "lib/signing/**/*.{test,spec}.{ts,tsx}",
            "lib/contract-doc/**/*.{test,spec}.{ts,tsx}",
            "lib/contract-archive/**/*.{test,spec}.{ts,tsx}",
            "lib/shell/**/*.{test,spec}.{ts,tsx}",
            "lib/a11y/**/*.{test,spec}.{ts,tsx}",
            "scripts/**/*.{test,spec}.{ts,tsx}",
            "deploy/**/*.{test,spec}.{ts,tsx}",
            "app/api/**/*.{test,spec}.{ts,tsx}",
            "app/admin/**/*.{test,spec}.{ts,tsx}",
          ],
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "."),
            // next-auth's ESM build does `import ... from "next/server"`
            // (no extension). Next's package.json has no `exports` map, so
            // once next-auth is routed through Vite's resolver below, it
            // still needs an explicit file to land on.
            "next/server": "next/server.js",
          },
        },
        test: {
          name: "unit-jsdom",
          // Force next-auth through Vite's transform/resolve pipeline
          // instead of being externalized to Node's native ESM resolver,
          // which can't resolve the extensionless "next/server" bare
          // specifier the alias above maps.
          server: {
            deps: {
              inline: [/next-auth/, /@auth\/core/],
            },
          },
          environment: "jsdom",
          globals: true,
          setupFiles: ["./vitest.setup.ts"],
          include: [
            "components/**/*.{test,spec}.{ts,tsx}",
            "app/__tests__/**/*.{test,spec}.{ts,tsx}",
            "app/\\(app\\)/**/*.{test,spec}.{ts,tsx}",
            "app/\\(public\\)/**/*.{test,spec}.{ts,tsx}",
            "app/pg-landing/**/*.{test,spec}.{ts,tsx}",
            "lib/hooks/**/*.{test,spec}.{ts,tsx}",
            "lib/stores/**/*.{test,spec}.{ts,tsx}",
            "lib/attachments/**/*.{test,spec}.{ts,tsx}",
            "lib/nav/**/*.{test,spec}.{ts,tsx}",
            "lib/__tests__/**/*.{test,spec}.{ts,tsx}",
            "lib/theme/**/*.{test,spec}.{ts,tsx}",
            "lib/attribution/**/*.{test,spec}.{ts,tsx}",
            // lib/chat/** 은 클라이언트 쪽 대화 상태(read-state client·열린 스레드
            // 레지스트리)를 담는다. 여기 없으면 그 디렉터리의 테스트가 **조용히
            // 스킵된다** — include 는 디렉터리 열거식이다.
            "lib/chat/**/*.{test,spec}.{ts,tsx}",
          ],
        },
      },
    ],
  },
});
