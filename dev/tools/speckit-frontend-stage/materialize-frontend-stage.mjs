#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname, relative, join } from "node:path";

const HELP = `Usage: node materialize-frontend-stage.mjs [options]

Options:
  --project <slug>         Project slug (required unless SPECKIT_PROJECT is set)
  --design-root <path>     Design context root (required unless SPECKIT_DESIGN_ROOT is set)
  --stage-root <path>      Frontend staging root (required unless SPECKIT_FRONTEND_STAGE_ROOT is set)
  --template <name>        Template name (default: vite-react)
  --package-manager <name> Package manager (default: pnpm)
  --force                  Overwrite all generated source files
  --force-fixtures         Overwrite existing GraphQL fixture JSON files
  --help                   Print this usage
`;

function resolveOptions() {
  const { values } = parseArgs({
    options: {
      project:          { type: "string" },
      "design-root":    { type: "string" },
      "stage-root":     { type: "string" },
      template:         { type: "string", default: "vite-react" },
      "package-manager":{ type: "string", default: "pnpm" },
      force:            { type: "boolean", default: false },
      "force-fixtures": { type: "boolean", default: false },
      help:             { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const project = values.project || process.env.SPECKIT_PROJECT;
  if (!project) {
    console.error("Error: --project is required (or set SPECKIT_PROJECT)");
    console.error(HELP);
    process.exit(1);
  }

  const designRoot = values["design-root"] || process.env.SPECKIT_DESIGN_ROOT || `/workspace/design-context/${project}`;
  const stageRoot  = values["stage-root"]  || process.env.SPECKIT_FRONTEND_STAGE_ROOT  || `/workspace/frontend-staging/${project}`;

  return {
    project,
    designRoot,
    stageRoot,
    template: values.template,
    packageManager: values["package-manager"],
    force: values.force,
    forceFixtures: values["force-fixtures"] || values.force,
  };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function writeIfMissing(path, content, force) {
  if (!force && existsSync(path)) {
    console.log(`preserved ${path}`);
    return false;
  }
  ensureDir(dirname(path));
  writeFileSync(path, content);
  console.log(`wrote ${path}`);
  return true;
}

function writeFixture(path, content, forceFixtures) {
  if (!forceFixtures && existsSync(path)) {
    console.log(`preserved ${path}`);
    return false;
  }
  ensureDir(dirname(path));
  writeFileSync(path, content);
  console.log(`wrote ${path}`);
  return true;
}

function copyIfMissing(src, dest, force) {
  if (!existsSync(src)) return false;
  if (!force && existsSync(dest)) {
    console.log(`preserved ${dest}`);
    return false;
  }
  ensureDir(dirname(dest));
  copyFileSync(src, dest);
  console.log(`wrote ${dest}`);
  return true;
}

function toPascalCase(str) {
  return str
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function normalizeRoutePath(path) {
  if (!path) return null;
  let p = path.startsWith("/") ? path : `/${path}`;
  p = p.replace(/\/+/g, "/");
  return p || "/";
}

function buildScreenRoutes(sourceMap, routeMap) {
  const routeByScreenId = {};
  if (Array.isArray(routeMap)) {
    for (const r of routeMap) {
      if (r.screenId) routeByScreenId[r.screenId] = r.implementationRoute;
    }
  }

  const screens = Array.isArray(sourceMap) ? sourceMap : (sourceMap?.screens || []);
  return screens.map(screen => {
    const sid = screen.id || screen.screenId;
    const sname = screen.name || screen.screenName || sid;
    const mappedRoute = routeByScreenId[sid];
    const path = normalizeRoutePath(mappedRoute || `/${sid}`);
    return { screenId: sid, name: sname, path };
  });
}

function buildFixtureObjects(sourceMap, dataMappings) {
  const dmByScreen = {};
  if (Array.isArray(dataMappings)) {
    for (const dm of dataMappings) {
      if (dm.screenId) dmByScreen[dm.screenId] = dm;
    }
  } else if (dataMappings?.screenId) {
    dmByScreen[dataMappings.screenId] = dataMappings;
  }

  const screens = Array.isArray(sourceMap) ? sourceMap : (sourceMap?.screens || []);
  return screens.map(screen => {
    const sid = screen.id || screen.screenId;
    const sname = screen.name || screen.screenName || sid;
    const dm = dmByScreen[sid] || {};

    const suggestedOpName = dm.suggestedOperationName || `${toPascalCase(sid)}Query`;

    const fixtureContent = JSON.stringify({
      data: {
        __screen: {
          id: sid,
          name: sname,
          state: "default",
          source: "speckit-static-fixture",
        },
      },
    }, null, 2);

    const operationContent = `query ${suggestedOpName} {\n  __screen {\n    id\n    name\n    state\n  }\n}\n`;

    return { screenId: sid, screenName: sname, suggestedOpName, fixtureContent, operationContent };
  });
}

function generatePackageJson(project, template) {
  const slug = project.replace(/[^a-zA-Z0-9-]/g, "-");
  return JSON.stringify({
    name: `speckit-frontend-stage-${slug}`,
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: {
      dev: "vite --host 0.0.0.0",
      build: "tsc -b && vite build",
      test: 'echo "No frontend tests configured yet"',
      preview: "vite preview --host 0.0.0.0",
    },
    dependencies: {
      "@vitejs/plugin-react": "latest",
      vite: "latest",
      typescript: "latest",
      react: "latest",
      "react-dom": "latest",
    },
    devDependencies: {
      "@types/react": "latest",
      "@types/react-dom": "latest",
    },
  }, null, 2) + "\n";
}

function generateIndexHtml(project) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${project} - Frontend Staging</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function generateTsconfigJson() {
  return JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      skipLibCheck: true,
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      isolatedModules: true,
      noEmit: true,
      jsx: "react-jsx",
      strict: true,
      noUnusedLocals: false,
      noUnusedParameters: false,
      noFallthroughCasesInSwitch: true,
    },
    include: ["src"],
  }, null, 2) + "\n";
}

function generateViteConfig() {
  return `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
  },
});
`;
}

function generateMainTsx() {
  return `import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
}

function generateAppTsx() {
  return `import { generatedRoutes } from "./routes/generatedRoutes";

export function App() {
  const path = window.location.pathname.replace(/\\/$/, "") || "/";
  const route =
    generatedRoutes.find(function(entry) { return entry.path === path; }) ||
    generatedRoutes[0];

  return route.element;
}
`;
}

function generateRoutesTsx(routes) {
  const entries = routes.map(r =>
    `  {\n    screenId: ${JSON.stringify(r.screenId)},\n    name: ${JSON.stringify(r.name)},\n    path: ${JSON.stringify(r.path)},\n    element: <DesignScreenShell screenId=${JSON.stringify(r.screenId)} screenName=${JSON.stringify(r.name)} />\n  }`
  ).join(",\n");

  return `import { DesignScreenShell } from "../components/DesignScreenShell";

export const generatedRoutes = [
${entries}
] as const;
`;
}

function generateDesignScreenShell() {
  return `import { useEffect, useState } from "react";
import { executeMockGraphql } from "../mocks/graphql/mockGraphqlClient";
import type { MockScreenId } from "../mocks/graphql/screenFixtureMap";

interface Props {
  screenId: MockScreenId;
  screenName: string;
}

export function DesignScreenShell({ screenId, screenName }: Props) {
  const [data, setData] = useState<unknown>(null);

  useEffect(function() {
    executeMockGraphql(screenId).then(setData);
  }, [screenId]);

  return (
    <main data-screen-id={screenId}>
      <h1>{screenName}</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}
`;
}

function generateTypesTs() {
  return `export interface MockGraphqlResponse<TData = unknown> {
  data: TData;
  errors?: Array<{
    message: string;
    path?: Array<string | number>;
    extensions?: Record<string, unknown>;
  }>;
}

export interface MockScreenMetadata {
  id: string;
  name: string;
  state: string;
  source: "speckit-static-fixture";
}
`;
}

function generateScreenFixtureMap(fixtures) {
  const entries = fixtures.map(f =>
    `  ${JSON.stringify(f.screenId)}: function() { return import("./fixtures/${f.screenId}.query.json"); }`
  ).join(",\n");

  return `export const screenFixtureMap = {
${entries}
} as const;

export type MockScreenId = keyof typeof screenFixtureMap;
`;
}

function generateMockGraphqlClient() {
  return `import { screenFixtureMap, type MockScreenId } from "./screenFixtureMap";
import type { MockGraphqlResponse } from "./types";

export async function loadMockGraphqlFixture(
  screenId: MockScreenId
): Promise<MockGraphqlResponse> {
  const fixture = await screenFixtureMap[screenId]();
  return fixture.default ?? fixture;
}

export async function executeMockGraphql(
  screenId: MockScreenId
): Promise<MockGraphqlResponse> {
  return loadMockGraphqlFixture(screenId);
}
`;
}

function generateStageReadme(project, warnings) {
  const warningItems = warnings.length > 0
    ? warnings.map(w => `- ${w}`).join("\n")
    : "_All design references were copied._";

  return `# Frontend Staging: ${project}

This is a temporary frontend implementation generated from the design context.

The real frontend repository is not known yet. This staging app is intended to be copied into the real frontend repo later.

## Canonical Design Context

\`../design-context/${project}\`

## Static GraphQL Fixtures

Fixtures live in:

\`src/mocks/graphql/fixtures\`

Use one fixture per screen/state.

## Design References

${warningItems}

## Development

\`\`\`bash
./bin/oe speckit:frontend-stage ${project} install
./bin/oe speckit:frontend-stage ${project} start
\`\`\`

## Visual Comparison

After implementing routes and UI, update:

\`workspace/design-context/${project}/visual-regression/fixtures/route-map.json\`

Then run:

\`\`\`bash
./bin/oe speckit:visual ${project} compare --frontend-url http://node-runner:5173
\`\`\`

## Copy to Real Frontend Repo

When the final frontend repo exists:

\`\`\`bash
./bin/oe speckit:frontend-stage ${project} copy-to <frontend-repo>
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = resolveOptions();
  const { project, designRoot, stageRoot, force, forceFixtures } = opts;

  console.log(`Materializing frontend stage for: ${project}`);
  console.log(`  Design root: ${designRoot}`);
  console.log(`  Stage root:  ${stageRoot}`);

  // Required inputs
  const sourceMapPath = `${designRoot}/visual-regression/fixtures/source-map.json`;
  const dataMappingsPath = `${designRoot}/design-processing/data-mappings.json`;

  const sourceMap = readJson(sourceMapPath);
  const dataMappings = readJson(dataMappingsPath);

  if (!sourceMap) {
    console.error(`\nRequired design-context artifacts are missing.`);
    console.error(`\nRun:`);
    console.error(`./bin/oe speckit:visual ${project} all`);
    console.error(`\nThen run:`);
    console.error(`/speckit.open-design.process --project ${project}`);
    console.error(`\nThen rerun:`);
    console.error(`./bin/oe speckit:frontend-stage ${project} create`);
    process.exit(1);
  }

  if (!dataMappings) {
    console.error(`\nRequired design-context artifacts are missing.`);
    console.error(`\nRun:`);
    console.error(`./bin/oe speckit:visual ${project} all`);
    console.error(`\nThen run:`);
    console.error(`/speckit.open-design.process --project ${project}`);
    console.error(`\nThen rerun:`);
    console.error(`./bin/oe speckit:frontend-stage ${project} create`);
    process.exit(1);
  }

  // Recommended inputs
  const warnings = [];
  function readRecommended(path, label) {
    const fullPath = `${designRoot}/${path}`;
    const content = readText(fullPath);
    if (!content) {
      warnings.push(`Missing ${label} (${fullPath}) — continuing without it`);
    }
    return content;
  }

  const designIr = readRecommended("design-processing/design-ir.json", "design-ir.json");
  const designTokens = readRecommended("design-processing/design-tokens.json", "design-tokens.json");
  const componentContracts = readRecommended("design-processing/component-contracts.md", "component-contracts.md");
  const pageStructures = readRecommended("design-processing/page-structures.md", "page-structures.md");
  const brief = readRecommended("design-processing/frontend-implementation-brief.md", "frontend-implementation-brief.md");
  const routeMap = readJson(`${designRoot}/visual-regression/fixtures/route-map.json`);

  if (!routeMap) {
    warnings.push(`Missing route-map.json — routes will use /<screen-id> paths`);
  }

  const routes = buildScreenRoutes(sourceMap, routeMap);
  const fixtures = buildFixtureObjects(sourceMap, dataMappings);

  if (fixtures.length === 0) {
    console.error("Error: source-map.json contains no screens. Nothing to generate.");
    process.exit(1);
  }

  // -------------------------------------------------------------------
  // Stage root config files
  // -------------------------------------------------------------------
  ensureDir(stageRoot);

  const pkgJson = generatePackageJson(project, opts.template);
  writeIfMissing(`${stageRoot}/package.json`, pkgJson, force);

  const indexHtml = generateIndexHtml(project);
  writeIfMissing(`${stageRoot}/index.html`, indexHtml, force);

  const tsconfig = generateTsconfigJson();
  writeIfMissing(`${stageRoot}/tsconfig.json`, tsconfig, force);

  const viteConfig = generateViteConfig();
  writeIfMissing(`${stageRoot}/vite.config.ts`, viteConfig, force);

  // -------------------------------------------------------------------
  // src/
  // -------------------------------------------------------------------
  const srcDir = `${stageRoot}/src`;

  writeIfMissing(`${srcDir}/main.tsx`, generateMainTsx(), force);
  writeIfMissing(`${srcDir}/App.tsx`, generateAppTsx(), force);

  // -------------------------------------------------------------------
  // src/components/
  // -------------------------------------------------------------------
  writeIfMissing(`${srcDir}/components/DesignScreenShell.tsx`, generateDesignScreenShell(), force);

  // -------------------------------------------------------------------
  // src/routes/
  // -------------------------------------------------------------------
  writeIfMissing(`${srcDir}/routes/generatedRoutes.tsx`, generateRoutesTsx(routes), force);

  // -------------------------------------------------------------------
  // src/mocks/graphql/
  // -------------------------------------------------------------------
  const gqlDir = `${srcDir}/mocks/graphql`;

  writeIfMissing(`${gqlDir}/types.ts`, generateTypesTs(), force);
  writeIfMissing(`${gqlDir}/screenFixtureMap.ts`, generateScreenFixtureMap(fixtures), force);
  writeIfMissing(`${gqlDir}/mockGraphqlClient.ts`, generateMockGraphqlClient(), force);

  // Fixtures & operations
  for (const f of fixtures) {
    writeFixture(
      `${gqlDir}/fixtures/${f.screenId}.query.json`,
      f.fixtureContent + "\n",
      forceFixtures
    );
    writeIfMissing(
      `${gqlDir}/operations/${f.screenId}.graphql`,
      f.operationContent,
      force
    );
  }

  // -------------------------------------------------------------------
  // src/design/ — copied design references
  // -------------------------------------------------------------------
  const designSrcDir = `${srcDir}/design`;

  copyIfMissing(
    `${designRoot}/design-processing/design-ir.json`,
    `${designSrcDir}/design-ir.json`,
    force
  );
  copyIfMissing(
    `${designRoot}/visual-regression/fixtures/source-map.json`,
    `${designSrcDir}/source-map.json`,
    force
  );
  copyIfMissing(
    `${designRoot}/visual-regression/fixtures/route-map.json`,
    `${designSrcDir}/route-map.json`,
    force
  );
  copyIfMissing(
    `${designRoot}/design-processing/design-tokens.json`,
    `${designSrcDir}/design-tokens.json`,
    force
  );
  copyIfMissing(
    `${designRoot}/design-processing/frontend-implementation-brief.md`,
    `${designSrcDir}/frontend-implementation-brief.md`,
    force
  );

  // -------------------------------------------------------------------
  // README
  // -------------------------------------------------------------------
  const readmeContent = generateStageReadme(project, warnings);
  writeIfMissing(`${stageRoot}/README.md`, readmeContent, force);

  // -------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------
  console.log(`\nGenerated ${fixtures.length} screen(s) with static GraphQL fixtures.`);

  if (warnings.length > 0) {
    console.log(`\nWarnings:`);
    for (const w of warnings) {
      console.log(`  - ${w}`);
    }
  }

  console.log(`\nDone. Next:`);
  console.log(`  ./bin/oe speckit:frontend-stage ${project} install`);
  console.log(`  ./bin/oe speckit:frontend-stage ${project} start`);
}

main();
