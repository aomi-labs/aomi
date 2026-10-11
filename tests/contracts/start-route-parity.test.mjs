import assert from "node:assert/strict";
import test from "node:test";
import {
  compareRoutes,
  nextMethods,
  nextRoutes,
  migrationApps,
  migrationBase,
  remainingMigrationBase,
  publicPath,
  startRoutes,
} from "../../scripts/check-start-route-parity.mjs";

test("route inventory includes destructured, renamed and reexported HTTP methods", () => {
  assert.deepEqual(
    nextMethods(`
    export const { GET, PATCH: PATCH_ALIAS, DELETE, OPTIONS } = routes.account;
    export { PATCH_ALIAS as PATCH, localPost as POST };
    export async function PUT() {}
    const HEAD = () => {}; // private declarations must not count
  `),
    ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"],
  );
});

test("each host keeps its immutable migration baseline and real Next root", () => {
  assert.equal(migrationApps.portal.base, migrationBase);
  assert.equal(migrationApps.build.base, migrationBase);
  assert.equal(migrationApps.landing.base, remainingMigrationBase);
  assert.equal(migrationApps.telegram.base, remainingMigrationBase);
  assert.equal(migrationApps.landing.nextRoot, "app");
  assert.equal(migrationApps.telegram.nextRoot, "src/app");
});

test("Landing inventory includes TSX handlers and metadata but excludes private template subtrees", () => {
  const inventory = nextRoutes(
    "landing",
    [
      "apps/landing/app/(marketing)/agents/page.tsx",
      "apps/landing/app/_marketing/products/widget/page.tsx",
      "apps/landing/app/(marketing)/_templates/internal/route.ts",
      "apps/landing/app/api/og/route.tsx",
      "apps/landing/app/api/proxy/route.ts",
      "apps/landing/app/robots.ts",
      "apps/landing/app/sitemap.ts",
      "apps/landing/src/app/irrelevant/page.tsx",
    ],
    (path) => {
      assert.ok(!path.includes("_marketing") && !path.includes("_templates"));
      return path.endsWith("route.tsx")
        ? "export async function GET() { return <div />; }"
        : "export const GET = proxy, POST = proxy, PUT = proxy, PATCH = proxy, DELETE = proxy;";
    },
  );
  assert.deepEqual(
    inventory.map(({ path, methods }) => ({ path, methods })),
    [
      { path: "/agents", methods: undefined },
      { path: "/api/og", methods: ["GET"] },
      {
        path: "/api/proxy",
        methods: ["DELETE", "GET", "PATCH", "POST", "PUT"],
      },
      { path: "/robots.txt", methods: ["GET"] },
      { path: "/sitemap.xml", methods: ["GET"] },
    ],
  );
});

test("Telegram inventory preserves its page and launch POST without Landing's root convention", () => {
  const inventory = nextRoutes(
    "telegram",
    [
      "apps/telegram/src/app/page.tsx",
      "apps/telegram/src/app/api/telegram/launch/route.ts",
      "apps/telegram/app/page.tsx",
    ],
    () => "export async function POST() {}",
  );
  assert.deepEqual(
    inventory.map(({ path, methods }) => ({ path, methods })),
    [
      { path: "/", methods: undefined },
      { path: "/api/telegram/launch", methods: ["POST"] },
    ],
  );
});

test("framework layout groups and renamed parameters preserve public paths", () => {
  assert.equal(
    publicPath("/(control-plane)/projects/[projectId]"),
    publicPath("/_control/projects/$id/"),
  );
  assert.equal(
    publicPath("/v1/account/apps/[[...path]]"),
    publicPath("/v1/account/apps/$"),
  );
  assert.equal(publicPath("/api/[...slug]"), "/api/*");
  assert.equal(publicPath("/openapi.json"), "/openapi.json");
});

test("missing methods and dropped pages fail route parity", () => {
  const candidate = startRoutes(`
    export const Route = createFileRoute('/v1/account')({
      server: { handlers: { GET: ({ request }) => account.GET(request) } }
    });
  `);
  const failures = compareRoutes(
    [
      { path: "/v1/account", methods: ["GET", "PATCH"] },
      { path: "/oauth/consent" },
    ],
    candidate,
  );
  assert.equal(failures.length, 2);
  assert.match(failures[0], /expected GET,PATCH/);
  assert.match(failures[1], /missing page/);
});

test("opaque handlers and duplicate HTTP routes cannot pass the inventory", () => {
  assert.throws(
    () =>
      startRoutes(`createFileRoute('/api/auth/$')({ server: { handlers } })`),
    /must declare/,
  );
  assert.throws(
    () =>
      startRoutes(`createFileRoute(path)({ server: { handlers: { GET } } })`),
    /literal paths/,
  );
  assert.match(
    compareRoutes(
      [{ path: "/api", methods: ["GET"] }],
      [
        { path: "/api", methods: ["GET"] },
        { path: "/api", methods: ["GET"] },
      ],
    )[0],
    /duplicate/,
  );
});

test("layout shells cannot conceal a missing index page", () => {
  const shells = startRoutes(
    `
    createFileRoute('/_control')({ component: () => <Shell><Outlet /></Shell> });
    createFileRoute('/_control/settings')({ component: () => <Settings><Outlet /></Settings> });
  `,
    "routes.tsx",
  );
  const pages = [{ path: "/" }, { path: "/settings" }];
  assert.equal(compareRoutes(pages, shells).length, 2);
  const indexes = startRoutes(
    `
    createFileRoute('/_control/')({ component: Home });
    createFileRoute('/_control/settings/')({ component: SettingsPage });
  `,
    "routes.tsx",
  );
  assert.deepEqual(compareRoutes(pages, indexes), []);
});
