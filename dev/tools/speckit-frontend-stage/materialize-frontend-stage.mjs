#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { execSync } from "node:child_process";
import yaml from "js-yaml";

const HELP = `Usage: node materialize-frontend-stage.mjs [options]

Options:
  --project <slug>              Project slug (required unless SPECKIT_PROJECT is set)
  --design-root <path>          Design context root (required unless SPECKIT_DESIGN_ROOT is set)
  --stage-root <path>           Frontend staging root (required unless SPECKIT_FRONTEND_STAGE_ROOT is set)

  --blueprint <id>              Blueprint ID to use (default: frontend/ui-apollo)
  --blueprint-ref <ref>         Override blueprint default_ref
  --blueprint-catalog <path>    Path to .opencode/blueprints.yaml
  --force-blueprint             Delete and re-materialize the blueprint base (does not imply --force-fixtures)

  --fallback-template <name>    Explicitly allow synthetic fallback app generation (e.g., vite-react)
  --no-blueprint                Disable blueprint materialization; requires --fallback-template

  --patch-blueprint-app         Modify blueprint App.tsx to wire generated design routes
  --patch-apollo-client         Patch Apollo client to use static fixtures when VITE_USE_STATIC_GRAPHQL_FIXTURES=true

  --force                       Overwrite generated overlay files only (not blueprint base files)
  --force-fixtures              Overwrite generated static GraphQL fixture JSON files
  --help                        Print this usage
`;

function resolveOptions() {
  const { values } = parseArgs({
    options: {
      project:                { type: "string" },
      "design-root":          { type: "string" },
      "stage-root":           { type: "string" },
      blueprint:              { type: "string" },
      "blueprint-ref":        { type: "string" },
      "blueprint-catalog":    { type: "string" },
      "force-blueprint":      { type: "boolean", default: false },
      "fallback-template":    { type: "string" },
      "no-blueprint":         { type: "boolean", default: false },
      "patch-blueprint-app":  { type: "boolean", default: false },
      "patch-apollo-client":  { type: "boolean", default: false },
      force:                  { type: "boolean", default: false },
      "force-fixtures":       { type: "boolean", default: false },
      "promote-repo":         { type: "string" },
      help:                   { type: "boolean", default: false },
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

  const fallbackTemplate = values["fallback-template"];
  const noBlueprint = values["no-blueprint"];
  const isFallback = Boolean(noBlueprint || fallbackTemplate);

  if (noBlueprint && !fallbackTemplate) {
    console.error("Error: --no-blueprint requires --fallback-template <name>");
    console.error(HELP);
    process.exit(1);
  }

  const blueprintId = values.blueprint || (isFallback ? null : "frontend/ui-apollo");

  return {
    project,
    designRoot,
    stageRoot,
    blueprintId,
    blueprintRef: values["blueprint-ref"] || null,
    blueprintCatalogPath: values["blueprint-catalog"] || null,
    forceBlueprint: values["force-blueprint"],
    fallbackTemplate,
    noBlueprint,
    isFallback,
    patchBlueprintApp: values["patch-blueprint-app"],
    patchApolloClient: values["patch-apollo-client"],
    force: values.force,
    forceFixtures: values["force-fixtures"] || values.force,
    promoteRepo: values["promote-repo"] || null,
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
    console.log(`  preserved ${path}`);
    return false;
  }
  ensureDir(dirname(path));
  writeFileSync(path, content);
  console.log(`  wrote ${path}`);
  return true;
}

function writeFixture(path, content, forceFixtures) {
  if (!forceFixtures && existsSync(path)) {
    console.log(`  preserved ${path}`);
    return false;
  }
  ensureDir(dirname(path));
  writeFileSync(path, content);
  console.log(`  wrote ${path}`);
  return true;
}

function copyIfMissing(src, dest, force) {
  if (!existsSync(src)) return false;
  if (!force && existsSync(dest)) {
    console.log(`  preserved ${dest}`);
    return false;
  }
  ensureDir(dirname(dest));
  copyFileSync(src, dest);
  console.log(`  wrote ${dest}`);
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

function normalizeGitHubUrl(url) {
  if (!url) return null;
  let u = url.trim();
  if (!u.endsWith(".git")) {
    u = u.replace(/\/$/, "") + ".git";
  }
  if (!u.startsWith("https://github.com/")) {
    return null;
  }
  return u;
}

function resolveCatalogPath(opts) {
  if (opts.blueprintCatalogPath) {
    if (existsSync(opts.blueprintCatalogPath)) return opts.blueprintCatalogPath;
    console.error(`Error: blueprint catalog not found at --blueprint-catalog path: ${opts.blueprintCatalogPath}`);
    return null;
  }
  const candidates = [
    "/opencode-catalog/.opencode/blueprints.yaml",
    "/workspace/.opencode/blueprints.yaml",
    join(process.cwd(), ".opencode/blueprints.yaml"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function loadBlueprintCatalog(path) {
  const content = readText(path);
  if (!content) return null;
  try {
    return yaml.load(content);
  } catch (e) {
    console.error(`Error parsing blueprint catalog ${path}: ${e.message}`);
    return null;
  }
}

function resolveBlueprint(catalog, blueprintId) {
  if (!catalog || !catalog.blueprints) return null;
  const parts = blueprintId.split("/");
  if (parts.length !== 2) {
    console.error(`Error: blueprint ID must be in namespace/name format (e.g., frontend/ui-apollo)`);
    return null;
  }
  const [namespace, name] = parts;
  const ns = catalog.blueprints[namespace];
  if (!ns) {
    console.error(`Blueprint namespace not found: ${namespace}`);
    listAvailableBlueprints(catalog, namespace);
    return null;
  }
  const bp = ns[name];
  if (!bp) {
    console.error(`Blueprint not found: ${blueprintId}`);
    listAvailableBlueprints(catalog, namespace);
    return null;
  }
  return bp;
}

function listAvailableBlueprints(catalog, namespace) {
  if (!catalog || !catalog.blueprints) return;
  if (namespace && catalog.blueprints[namespace]) {
    console.error(`\nAvailable ${namespace} blueprints:`);
    for (const key of Object.keys(catalog.blueprints[namespace])) {
      console.error(`  - ${namespace}/${key}`);
    }
  } else {
    console.error(`\nAvailable blueprints:`);
    for (const ns of Object.keys(catalog.blueprints)) {
      for (const key of Object.keys(catalog.blueprints[ns])) {
        console.error(`  - ${ns}/${key}`);
      }
    }
  }
}

function resolveBlueprintRepository(blueprint) {
  if (blueprint.repository_url) {
    return normalizeGitHubUrl(blueprint.repository_url);
  }
  if (blueprint.repository) {
    return `https://github.com/${blueprint.repository}.git`;
  }
  return null;
}

function checkGitAvailable() {
  try {
    execSync("git --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function materializeBlueprintBase({ stageRoot, repoUrl, ref }) {
  ensureDir(dirname(stageRoot));

  try {
    execSync(`git clone --depth 1 --branch "${ref}" "${repoUrl}" "${stageRoot}"`, {
      stdio: "pipe",
      timeout: 120000,
    });
    console.log("  git clone succeeded with --branch");
  } catch (e) {
    console.error(`  git clone --branch failed: ${e.stderr ? e.stderr.toString().trim() : e.message}`);
    console.log("  retrying: clone default branch then checkout ref...");
    try {
      if (existsSync(stageRoot)) {
        rmSync(stageRoot, { recursive: true, force: true });
      }
      execSync(`git clone --depth 1 "${repoUrl}" "${stageRoot}"`, {
        stdio: "pipe",
        timeout: 120000,
      });
      execSync(`git -C "${stageRoot}" checkout "${ref}"`, {
        stdio: "pipe",
        timeout: 60000,
      });
      console.log("  clone + checkout succeeded");
    } catch (e2) {
      console.error(`  clone retry also failed: ${e2.stderr ? e2.stderr.toString().trim() : e2.message}`);
      return false;
    }
  }

  const gitDir = join(stageRoot, ".git");
  if (existsSync(gitDir)) {
    rmSync(gitDir, { recursive: true, force: true });
    console.log("  removed .git from staging");
  }

  return true;
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

function generateDesignRoutesTsx(routes) {
  const entries = routes.map(r =>
    `  {\n    screenId: ${JSON.stringify(r.screenId)},\n    name: ${JSON.stringify(r.name)},\n    path: ${JSON.stringify(r.path)},\n    element: <DesignScreenShell screenId=${JSON.stringify(r.screenId)} screenName=${JSON.stringify(r.name)} />\n  }`
  ).join(",\n");

  return `import { DesignScreenShell } from "../components/DesignScreenShell";

export const generatedDesignRoutes = [
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

function generateReadmeSpeckit(opts) {
  const { project, blueprint, ref, repoUrl, repoName } = opts;
  return `# Speckit Frontend Staging Overlay

This staging app was materialized from the workbench frontend blueprint and overlaid with Open Design artifacts.

## Blueprint

- Blueprint: \`${blueprint || "frontend/ui-apollo"}\`
- Repository: \`${repoName || "reytech-dev/ui-apollo-blueprint"}\`
- Ref: \`${ref || "v1.2.0"}\`

## Design Context

Canonical design context:

\`workspace/design-context/${project}\`

## Static GraphQL Fixtures

Generated fixtures:

\`src/mocks/graphql/fixtures/\`

## Design Routes

Generated design route overlay:

\`src/routes/generatedDesignRoutes.tsx\`

By default, this file is not wired into the blueprint app automatically.

To preview generated design screens, wire the route list into the app shell or run create with an explicit patch flag once supported.

## Visual Comparison

After routes are wired and \`route-map.json\` is updated:

\`\`\`bash
./bin/oe speckit:visual ${project} compare --frontend-url http://node-runner:5173
\`\`\`

## Copy to Final Frontend Repo

When the final frontend repo exists:

\`\`\`bash
./bin/oe speckit:frontend-stage ${project} copy-to <frontend-repo>
\`\`\`
`;
}

function writeFrontendStageMetadata(opts) {
  const {
    project, stageRoot, designRoot, mode, blueprint, blueprintRef, blueprintRepoUrl,
    blueprintRepoName, blueprintRefType, fallbackTemplate,
    fixturesCount, operationsCount, routesCount, designRefs, warnings,
  } = opts;

  const meta = {
    version: 1,
    project,
    stageRoot,
    designRoot,
    generatedAt: new Date().toISOString(),
    mode,
    overlay: {
      fixtures: fixturesCount || 0,
      operations: operationsCount || 0,
      routes: routesCount || 0,
      designReferences: designRefs || [],
    },
    warnings: warnings || [],
  };

  if (mode === "blueprint" && blueprint) {
    meta.blueprint = {
      id: blueprint,
      repository: blueprintRepoName,
      repositoryUrl: blueprintRepoUrl,
      ref: blueprintRef,
      refType: blueprintRefType || "tag",
    };
  }

  if (mode === "fallback-template" && fallbackTemplate) {
    meta.fallbackTemplate = fallbackTemplate;
  }

  const path = join(stageRoot, ".speckit/frontend-stage.json");
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(meta, null, 2) + "\n");
  console.log(`  wrote ${path}`);
}

function applyBlueprintOverlays(opts) {
  const { stageRoot, designRoot, force, forceFixtures, routes, fixtures } = opts;
  const srcDir = join(stageRoot, "src");
  const gqlDir = join(srcDir, "mocks", "graphql");
  const designSrcDir = join(srcDir, "design");

  let fixturesWritten = 0;
  let fixturesPreserved = 0;
  let operationsWritten = 0;
  let operationsPreserved = 0;
  let mockHelpersWritten = 0;
  let mockHelpersPreserved = 0;
  let routesWritten = 0;
  let routesPreserved = 0;
  let designRefsCopied = 0;
  let designRefsMissing = 0;
  const designRefsArr = [];
  const overlayWarnings = [];

  for (const f of fixtures) {
    const wrote = writeFixture(
      join(gqlDir, "fixtures", `${f.screenId}.query.json`),
      f.fixtureContent + "\n",
      forceFixtures
    );
    if (wrote) fixturesWritten++;
    else fixturesPreserved++;
  }

  for (const f of fixtures) {
    const wrote = writeIfMissing(
      join(gqlDir, "operations", `${f.screenId}.graphql`),
      f.operationContent,
      force
    );
    if (wrote) operationsWritten++;
    else operationsPreserved++;
  }

  const typesWrote = writeIfMissing(join(gqlDir, "types.ts"), generateTypesTs(), force);
  if (typesWrote) mockHelpersWritten++; else mockHelpersPreserved++;

  const fixtureMapWrote = writeIfMissing(join(gqlDir, "screenFixtureMap.ts"), generateScreenFixtureMap(fixtures), force);
  if (fixtureMapWrote) mockHelpersWritten++; else mockHelpersPreserved++;

  const clientWrote = writeIfMissing(join(gqlDir, "mockGraphqlClient.ts"), generateMockGraphqlClient(), force);
  if (clientWrote) mockHelpersWritten++; else mockHelpersPreserved++;

  const routesWrote = writeIfMissing(join(srcDir, "routes", "generatedDesignRoutes.tsx"), generateDesignRoutesTsx(routes), force);
  if (routesWrote) routesWritten++; else routesPreserved++;

  const shellWrote = writeIfMissing(join(srcDir, "components", "DesignScreenShell.tsx"), generateDesignScreenShell(), force);
  if (shellWrote) mockHelpersWritten++; else mockHelpersPreserved++;

  const designRefs = [
    { src: join(designRoot, "design-processing", "design-ir.json"), dest: join(designSrcDir, "design-ir.json"), label: "design-ir.json" },
    { src: join(designRoot, "visual-regression", "fixtures", "source-map.json"), dest: join(designSrcDir, "source-map.json"), label: "source-map.json" },
    { src: join(designRoot, "visual-regression", "fixtures", "route-map.json"), dest: join(designSrcDir, "route-map.json"), label: "route-map.json" },
    { src: join(designRoot, "design-processing", "design-tokens.json"), dest: join(designSrcDir, "design-tokens.json"), label: "design-tokens.json" },
    { src: join(designRoot, "design-processing", "frontend-implementation-brief.md"), dest: join(designSrcDir, "frontend-implementation-brief.md"), label: "frontend-implementation-brief.md" },
  ];

  for (const ref of designRefs) {
    const copied = copyIfMissing(ref.src, ref.dest, force);
    if (copied) {
      designRefsCopied++;
      designRefsArr.push(ref.label);
    } else if (!existsSync(ref.src)) {
      designRefsMissing++;
      overlayWarnings.push(`Missing ${ref.label} (${ref.src})`);
    } else {
      designRefsCopied++;
      designRefsArr.push(ref.label);
    }
  }

  return {
    fixturesWritten, fixturesPreserved,
    operationsWritten, operationsPreserved,
    mockHelpersWritten, mockHelpersPreserved,
    routesWritten, routesPreserved,
    designRefsCopied, designRefsMissing, designRefsArr,
    overlayWarnings,
  };
}

function runPromoteMode(opts) {
  const { project, stageRoot, promoteRepo, force } = opts;

  const metaPath = join(stageRoot, ".speckit/frontend-stage.json");
  const meta = readJson(metaPath);
  if (!meta) {
    console.error("Not a valid frontend staging app (missing .speckit/frontend-stage.json)");
    process.exit(1);
  }

  const bp = meta.blueprint || {};
  const blueprintKey = bp.id || "frontend/ui-apollo";
  const repository = bp.repository || null;
  const repositoryUrl = bp.repositoryUrl || null;
  const ref = bp.ref || null;
  const refType = bp.refType || "tag";

  const dest = `/workspace/frontend/${promoteRepo}`;
  const provPath = join(dest, ".blueprint-provenance.yml");

  let copied = false;
  if (existsSync(dest)) {
    if (existsSync(provPath)) {
      console.log(`  Target exists — skipping copy (provenance present): ${dest}`);
    } else if (!force) {
      console.error("Target exists with unmanaged files. Use --force to overwrite.");
      process.exit(1);
    } else {
      ensureDir(dest);
      execSync(`rsync -a --exclude node_modules --exclude dist --exclude .git "${stageRoot}"/ "${dest}"/`, { stdio: "pipe" });
      copied = true;
    }
  } else {
    ensureDir(dest);
    execSync(`rsync -a --exclude node_modules --exclude dist --exclude .git "${stageRoot}"/ "${dest}"/`, { stdio: "pipe" });
    copied = true;
  }
  if (copied) {
    console.log(`  Copied staging to ${dest}`);
  }

  const provenance = {
    schema_version: "1.0",
    blueprint: {
      repository,
      repository_url: repositoryUrl,
      ref,
      ref_type: refType,
      blueprint_key: blueprintKey,
    },
    materialized: {
      at: new Date().toISOString(),
      by: "speckit.frontend-stage.promote",
      mode: "promote",
    },
    project: {
      id: promoteRepo,
      area: "frontend",
      path: `workspace/frontend/${promoteRepo}`,
      command_project_template: "{project}-ui",
    },
    parameters: {
      project: project,
      source: "speckit-frontend-stage",
    },
  };
  writeFileSync(provPath, yaml.dump(provenance));
  console.log(`  wrote ${provPath}`);

  const workspaceYmlPath = "/workspace/.opencode/workspace.yml";
  const projectEntry = {
    id: promoteRepo,
    area: "frontend",
    path: `workspace/frontend/${promoteRepo}`,
    blueprint: blueprintKey,
    repository_source: repository,
    repository_url: repositoryUrl,
    ref,
    ref_type: refType,
    runner: "node-runner",
    validation: [
      `./dev/scripts/wrapper.sh frontend:install ${promoteRepo}`,
      `./dev/scripts/wrapper.sh frontend:test ${promoteRepo}`,
      `./dev/scripts/wrapper.sh frontend:build ${promoteRepo}`,
    ],
    status: "materialized",
  };

  if (!existsSync(workspaceYmlPath)) {
    const doc = {
      schema_version: "1.0",
      workspace: {
        root: "workspace",
        status: "partial",
      },
      projects: [projectEntry],
    };
    ensureDir(dirname(workspaceYmlPath));
    writeFileSync(workspaceYmlPath, yaml.dump(doc));
    console.log(`  wrote ${workspaceYmlPath}`);
  } else {
    const doc = yaml.load(readText(workspaceYmlPath)) || {};
    if (!Array.isArray(doc.projects)) doc.projects = [];
    const exists = doc.projects.some(p => p && p.id === promoteRepo);
    if (exists) {
      console.log("Already registered in workspace.yml");
    } else {
      doc.projects.push(projectEntry);
      writeFileSync(workspaceYmlPath, yaml.dump(doc));
      console.log(`  updated ${workspaceYmlPath}`);
    }
  }

  console.log(`\nPromoted frontend staging to workspace/frontend/${promoteRepo}`);
  console.log(`Registered in .opencode/workspace.yml`);
}

function runFallbackMode(opts) {
  const { project, designRoot, stageRoot, force, forceFixtures } = opts;

  console.error("Warning: using fallback synthetic frontend template.");
  console.error("This app may not match the final frontend blueprint.");
  console.error("Prefer blueprint mode with --blueprint frontend/ui-apollo.");

  console.log(`\nMaterializing synthetic frontend stage for: ${project}`);
  console.log(`  Design root: ${designRoot}`);
  console.log(`  Stage root:  ${stageRoot}`);

  const sourceMapPath = join(designRoot, "visual-regression", "fixtures", "source-map.json");
  const dataMappingsPath = join(designRoot, "design-processing", "data-mappings.json");

  const sourceMap = readJson(sourceMapPath);
  const dataMappings = readJson(dataMappingsPath);

  if (!sourceMap || !dataMappings) {
    console.error(`\nRequired design-context artifacts are missing.`);
    console.error(`\nRun:`);
    console.error(`./bin/oe speckit:visual ${project} all`);
    console.error(`\nThen run:`);
    console.error(`/speckit.open-design.process --project ${project}`);
    console.error(`\nThen rerun:`);
    console.error(`./bin/oe speckit:frontend-stage ${project} create`);
    process.exit(1);
  }

  const warnings = [];
  function readRecommended(path, label) {
    const fullPath = join(designRoot, path);
    const content = readText(fullPath);
    if (!content) {
      warnings.push(`Missing ${label} (${fullPath}) — continuing without it`);
    }
    return content;
  }

  readRecommended("design-processing/design-ir.json", "design-ir.json");
  readRecommended("design-processing/design-tokens.json", "design-tokens.json");
  readRecommended("design-processing/component-contracts.md", "component-contracts.md");
  readRecommended("design-processing/page-structures.md", "page-structures.md");
  readRecommended("design-processing/frontend-implementation-brief.md", "frontend-implementation-brief.md");
  const routeMap = readJson(join(designRoot, "visual-regression", "fixtures", "route-map.json"));

  if (!routeMap) {
    warnings.push("Missing route-map.json — routes will use /<screen-id> paths");
  }

  const routes = buildScreenRoutes(sourceMap, routeMap);
  const fixtures = buildFixtureObjects(sourceMap, dataMappings);

  if (fixtures.length === 0) {
    console.error("Error: source-map.json contains no screens.");
    process.exit(1);
  }

  ensureDir(stageRoot);

  const pkgJson = JSON.stringify({
    name: `speckit-frontend-stage-${project.replace(/[^a-zA-Z0-9-]/g, "-")}`,
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

  writeIfMissing(join(stageRoot, "package.json"), pkgJson, force);
  writeIfMissing(join(stageRoot, "index.html"), `<!DOCTYPE html>
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
`, force);

  writeIfMissing(join(stageRoot, "tsconfig.json"), JSON.stringify({
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
  }, null, 2) + "\n", force);

  writeIfMissing(join(stageRoot, "vite.config.ts"), `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
  },
});
`, force);

  const srcDir = join(stageRoot, "src");
  writeIfMissing(join(srcDir, "main.tsx"), `import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`, force);

  writeIfMissing(join(srcDir, "App.tsx"), `import { generatedRoutes } from "./routes/generatedRoutes";

export function App() {
  const path = window.location.pathname.replace(/\\/$/, "") || "/";
  const route =
    generatedRoutes.find(function(entry) { return entry.path === path; }) ||
    generatedRoutes[0];

  return route.element;
}
`, force);

  const generatedRoutes = routes.map(r =>
    `  {\n    screenId: ${JSON.stringify(r.screenId)},\n    name: ${JSON.stringify(r.name)},\n    path: ${JSON.stringify(r.path)},\n    element: <DesignScreenShell screenId=${JSON.stringify(r.screenId)} screenName=${JSON.stringify(r.name)} />\n  }`
  ).join(",\n");

  writeIfMissing(join(srcDir, "routes", "generatedRoutes.tsx"), `import { DesignScreenShell } from "../components/DesignScreenShell";

export const generatedRoutes = [
${generatedRoutes}
] as const;
`, force);

  writeIfMissing(join(srcDir, "components", "DesignScreenShell.tsx"), generateDesignScreenShell(), force);

  const gqlDir = join(srcDir, "mocks", "graphql");
  writeIfMissing(join(gqlDir, "types.ts"), generateTypesTs(), force);
  writeIfMissing(join(gqlDir, "screenFixtureMap.ts"), generateScreenFixtureMap(fixtures), force);
  writeIfMissing(join(gqlDir, "mockGraphqlClient.ts"), generateMockGraphqlClient(), force);

  for (const f of fixtures) {
    writeFixture(join(gqlDir, "fixtures", `${f.screenId}.query.json`), f.fixtureContent + "\n", forceFixtures);
    writeIfMissing(join(gqlDir, "operations", `${f.screenId}.graphql`), f.operationContent, force);
  }

  const designSrcDir = join(srcDir, "design");
  copyIfMissing(join(designRoot, "design-processing", "design-ir.json"), join(designSrcDir, "design-ir.json"), force);
  copyIfMissing(join(designRoot, "visual-regression", "fixtures", "source-map.json"), join(designSrcDir, "source-map.json"), force);
  copyIfMissing(join(designRoot, "visual-regression", "fixtures", "route-map.json"), join(designSrcDir, "route-map.json"), force);
  copyIfMissing(join(designRoot, "design-processing", "design-tokens.json"), join(designSrcDir, "design-tokens.json"), force);
  copyIfMissing(join(designRoot, "design-processing", "frontend-implementation-brief.md"), join(designSrcDir, "frontend-implementation-brief.md"), force);

  const readmeWarnings = warnings.length > 0
    ? warnings.map(w => `- ${w}`).join("\n")
    : "_All design references were copied._";

  writeIfMissing(join(stageRoot, "README.md"), `# Frontend Staging: ${project}

This is a temporary frontend implementation generated from the design context.

The real frontend repository is not known yet. This staging app is intended to be copied into the real frontend repo later.

## Canonical Design Context

\`../design-context/${project}\`

## Static GraphQL Fixtures

Fixtures live in:

\`src/mocks/graphql/fixtures\`

Use one fixture per screen/state.

## Design References

${readmeWarnings}

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
`, force);

  writeFrontendStageMetadata({
    project,
    stageRoot,
    designRoot,
    mode: "fallback-template",
    fallbackTemplate: "vite-react",
    fixturesCount: fixtures.length,
    operationsCount: fixtures.length,
    routesCount: routes.length,
    designRefs: [],
    warnings,
  });

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

function runBlueprintMode(opts) {
  const { project, designRoot, stageRoot, blueprintId, blueprintRef, force, forceFixtures, forceBlueprint, patchBlueprintApp, patchApolloClient } = opts;

  console.log(`Materializing frontend stage from blueprint: ${blueprintId}`);
  console.log(`  Project: ${project}`);
  console.log(`  Design root: ${designRoot}`);
  console.log(`  Stage root: ${stageRoot}`);

  const catalogPath = resolveCatalogPath(opts);
  if (!catalogPath) {
    console.error("Error: blueprint catalog not found.");
    console.error("  Tried: /opencode-catalog/.opencode/blueprints.yaml");
    console.error("  Tried: /workspace/.opencode/blueprints.yaml");
    console.error("  Tried: .opencode/blueprints.yaml (CWD)");
    console.error("  Use --blueprint-catalog <path> to specify a catalog location.");
    process.exit(1);
  }

  const catalog = loadBlueprintCatalog(catalogPath);
  if (!catalog) {
    console.error(`Error: failed to load blueprint catalog from ${catalogPath}`);
    process.exit(1);
  }

  const blueprint = resolveBlueprint(catalog, blueprintId);
  if (!blueprint) {
    process.exit(1);
  }

  const repoUrl = resolveBlueprintRepository(blueprint);
  if (!repoUrl) {
    console.error(`Error: could not resolve repository URL for blueprint ${blueprintId}`);
    process.exit(1);
  }

  const ref = blueprintRef || blueprint.default_ref;
  if (!ref) {
    console.error(`Error: no ref specified for blueprint ${blueprintId}. Use --blueprint-ref or set default_ref in catalog.`);
    process.exit(1);
  }

  console.log(`  Blueprint: ${blueprint.repository}`);
  console.log(`  Repository: ${repoUrl}`);
  console.log(`  Ref: ${ref} (${blueprint.ref_type || "tag"})`);

  if (!checkGitAvailable()) {
    console.error(`\ngit is required to materialize blueprint ${blueprintId}.`);
    console.error("Install git in node-runner or provide a pre-copied blueprint source.");
    process.exit(1);
  }

  const metadataPath = join(stageRoot, ".speckit/frontend-stage.json");
  const needsClone = (() => {
    if (!existsSync(stageRoot)) return true;
    if (forceBlueprint) return true;
    if (existsSync(metadataPath)) return false;
    console.error(`\nStage root exists but is not a blueprint-materialized staging app:`);
    console.error(`  ${stageRoot}`);
    console.error(`\nUse --force-blueprint to delete and re-materialize, or remove the directory manually.`);
    process.exit(1);
  })();

  if (needsClone) {
    if (forceBlueprint && existsSync(stageRoot)) {
      console.log("  --force-blueprint: removing existing stage root...");
      rmSync(stageRoot, { recursive: true, force: true });
    }

    console.log("\n  Cloning blueprint base...");
    const cloned = materializeBlueprintBase({ stageRoot, repoUrl, ref });
    if (!cloned) {
      console.error("Error: failed to clone blueprint repository.");
      process.exit(1);
    }
    console.log("  Blueprint base materialized.\n");
  } else {
    console.log("\n  Blueprint base already materialized (preserving existing files).\n");
  }

  const sourceMapPath = join(designRoot, "visual-regression", "fixtures", "source-map.json");
  const dataMappingsPath = join(designRoot, "design-processing", "data-mappings.json");

  const sourceMap = readJson(sourceMapPath);
  const dataMappings = readJson(dataMappingsPath);

  if (!sourceMap || !dataMappings) {
    console.error(`\nRequired design-context artifacts are missing.`);
    console.error(`\nRun:`);
    console.error(`./bin/oe speckit:visual ${project} all`);
    console.error(`\nThen run:`);
    console.error(`/speckit.open-design.process --project ${project}`);
    console.error(`\nThen rerun:`);
    console.error(`./bin/oe speckit:frontend-stage ${project} create`);
    process.exit(1);
  }

  const routeMap = readJson(join(designRoot, "visual-regression", "fixtures", "route-map.json"));

  const routes = buildScreenRoutes(sourceMap, routeMap);
  const fixtures = buildFixtureObjects(sourceMap, dataMappings);

  if (fixtures.length === 0) {
    console.error("Error: source-map.json contains no screens.");
    process.exit(1);
  }

  console.log("  Applying design overlays...\n");

  const ov = applyBlueprintOverlays({
    stageRoot, designRoot, force, forceFixtures, routes, fixtures,
  });

  const warnings = [...(ov.overlayWarnings || [])];
  if (!routeMap) {
    warnings.push("Missing route-map.json — routes will use /<screen-id> paths");
  }

  writeFrontendStageMetadata({
    project,
    stageRoot,
    designRoot,
    mode: "blueprint",
    blueprint: blueprintId,
    blueprintRef: ref,
    blueprintRepoUrl: repoUrl,
    blueprintRepoName: blueprint.repository,
    blueprintRefType: blueprint.ref_type,
    fixturesCount: ov.fixturesWritten + ov.fixturesPreserved,
    operationsCount: ov.operationsWritten + ov.operationsPreserved,
    routesCount: ov.routesWritten + ov.routesPreserved,
    designRefs: ov.designRefsArr,
    warnings,
  });

  const readmeContent = generateReadmeSpeckit({
    project,
    blueprint: blueprintId,
    ref,
    repoUrl,
    repoName: blueprint.repository,
  });
  writeIfMissing(join(stageRoot, "README.speckit.md"), readmeContent, force);

  if (patchBlueprintApp) {
    console.log("\n  --patch-blueprint-app: checking blueprint App.tsx...");
    const appTsxPath = join(stageRoot, "src", "App.tsx");
    if (!existsSync(appTsxPath)) {
      console.log("    App.tsx not found — skipping patch.");
    } else {
      const original = readText(appTsxPath);
      const importLine = `import { generatedDesignRoutes } from "./routes/generatedDesignRoutes";`;
      if (original.includes(importLine)) {
        console.log("    App.tsx already patched — skipping.");
      } else {
        const backupPath = join(stageRoot, "src", "App.tsx.bak");
        copyFileSync(appTsxPath, backupPath);
        console.log(`    Created backup: ${backupPath}`);
        console.log("    Auto-patching App.tsx is conservative. See README.speckit.md for manual wiring instructions.");
      }
    }
  }

  if (patchApolloClient) {
    console.log("\n  --patch-apollo-client: checking for Apollo client...");
    const apolloFiles = [
      join(stageRoot, "src", "graphql.ts"),
      join(stageRoot, "src", "apollo.ts"),
      join(stageRoot, "src", "graphql", "client.ts"),
      join(stageRoot, "src", "lib", "apollo.ts"),
    ];
    let found = false;
    for (const ap of apolloFiles) {
      if (existsSync(ap)) {
        found = true;
        const original = readText(ap);
        if (original.includes("VITE_USE_STATIC_GRAPHQL_FIXTURES")) {
          console.log(`    ${ap} already patched — skipping.`);
        } else {
          const backupPath = ap + ".bak";
          copyFileSync(ap, backupPath);
          console.log(`    Created backup: ${backupPath}`);
          console.log("    Auto-patching Apollo client is conservative. See README.speckit.md for manual wiring instructions.");
        }
        break;
      }
    }
    if (!found) {
      console.log("    No Apollo client file found — skipping patch.");
    }

    const envLocalPath = join(stageRoot, ".env.local");
    if (!existsSync(envLocalPath)) {
      writeFileSync(envLocalPath, "VITE_USE_STATIC_GRAPHQL_FIXTURES=true\n");
      console.log(`    wrote ${envLocalPath}`);
    }
  }

  console.log(`\n  Overlay summary:`);
  console.log(`    Fixtures:    ${ov.fixturesWritten} written, ${ov.fixturesPreserved} preserved`);
  console.log(`    Operations:  ${ov.operationsWritten} written, ${ov.operationsPreserved} preserved`);
  console.log(`    Mock helpers: ${ov.mockHelpersWritten} written, ${ov.mockHelpersPreserved} preserved`);
  console.log(`    Routes:      ${ov.routesWritten} written, ${ov.routesPreserved} preserved`);
  console.log(`    Design refs: ${ov.designRefsCopied} copied${ov.designRefsMissing > 0 ? `, ${ov.designRefsMissing} missing (warned)` : ""}`);

  if (warnings.length > 0) {
    console.log(`\n  Warnings:`);
    for (const w of warnings) {
      console.log(`    - ${w}`);
    }
  }

  console.log(`\n  Done. Next:`);
  console.log(`    ./bin/oe speckit:frontend-stage ${project} install`);
  console.log(`    ./bin/oe speckit:frontend-stage ${project} start`);
}

function main() {
  const opts = resolveOptions();

  if (opts.promoteRepo) {
    runPromoteMode(opts);
    return;
  }

  if (opts.isFallback) {
    runFallbackMode(opts);
  } else {
    runBlueprintMode(opts);
  }
}

main();
