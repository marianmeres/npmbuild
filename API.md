# API

Full reference for `@marianmeres/npmbuild` public exports.

## Functions

### `npmBuild(options)`

Builds an npm package from a Deno TypeScript source tree:

1. Copies source files and rewrites `.ts` import specifiers to `.js`.
2. Generates `tsconfig.json` and `package.json`.
3. Runs `tsc` via `npx` to compile.
4. Passes non-TypeScript assets through to `dist/`.
5. Optionally installs npm and JSR dependencies into the output directory.
6. Cleans up intermediate files.

**Parameters:**
- `options` ([NpmBuildOptions](#npmbuildoptions)) — build configuration.

**Returns:** `Promise<`[`NpmBuildResult`](#npmbuildresult)`>`

**Example:**

```typescript
import { npmBuild } from "jsr:@marianmeres/npmbuild";

const denoJson = JSON.parse(Deno.readTextFileSync("deno.json"));

const result = await npmBuild({
    name: denoJson.name,
    version: denoJson.version,
    repository: denoJson.name.replace(/^@/, ""),
    dependencies: ["@marianmeres/clog"],
    entryPoints: ["mod", "utils"],
});
```

---

### `versionizeDeps(deps, denoJsonOrPath?)`

Appends versions to bare dependency names by reading the `imports` map from a
`deno.json` file (or a pre-parsed object). Composes with
[`npmBuild`](#npmbuildoptions)'s `dependencies: string[]` form so the build
script doesn't have to hand-sync versions with `deno.json`.

**Parameters:**
- `deps` (`string[]`) — dependency names, with or without a version specifier.
- `denoJsonOrPath` (`string | Record<string, unknown>`, optional) — either a
  path to `deno.json` (resolved against Deno's cwd) or an already-parsed
  `deno.json` object. Pass the object form to avoid a redundant file read when
  you've loaded `deno.json` already. Default: `"../deno.json"`.

**Returns:** `string[]` — dependency specs suitable for
[`NpmBuildOptions.dependencies`](#npmbuildoptions).

**Behavior:**

| Input dep | `deno.json` imports entry | Output |
|-----------|---------------------------|--------|
| `"@marianmeres/clog"` | `"jsr:@marianmeres/clog@^2"` | `"@marianmeres/clog@^2"` |
| `"pg"` | `"npm:pg@^8.11.0"` | `"pg@^8.11.0"` |
| `"@types/pg"` | `"npm:@types/pg@^8"` | `"@types/pg@^8"` |
| `"pg@^4"` (already versioned) | any | `"pg@^4"` (passthrough) |
| `"missing-pkg"` | not present | `"missing-pkg"` (passthrough) |
| any | URL / no `@version` | passthrough |

Detection of "already versioned": `dep.lastIndexOf("@") > 0` (scope `@` at
index 0 is not treated as a version separator).

Errors: missing `deno.json` or invalid JSON propagates from the underlying
`Deno.readTextFileSync` / `JSON.parse` call (path form only).

**Example:**

```typescript
import { npmBuild, versionizeDeps } from "jsr:@marianmeres/npmbuild";

const denoJson = JSON.parse(Deno.readTextFileSync("deno.json"));

await npmBuild({
    name: denoJson.name,
    version: denoJson.version,
    // Pass the already-loaded object to skip a second read/parse.
    // A path string like "../deno.json" also works.
    dependencies: versionizeDeps(
        ["@marianmeres/clog", "pg@^4", "@types/pg"],
        denoJson,
    ),
});
```

---

### `rewriteTsImports(source)`

Rewrites `.ts` specifiers in ES-module `import` / `export` statements to `.js`,
which is what `tsc` requires in its emitted output. Exported primarily for unit
testing; `npmBuild` calls it internally.

**Parameters:**
- `source` (`string`) — TypeScript source text.

**Returns:** `string` — transformed source.

**Handles:**
- `from "./x.ts"` — static `import … from` and `export … from`
- `import "./x.ts"` — bare side-effect imports
- `import("./x.ts")` — dynamic imports (preserves surrounding whitespace)

**Known limitation:** regex-based rewriting will also transform `.ts` specifier
strings inside comments or string literals. Acceptable trade-off for
simplicity.

**Example:**

```typescript
import { rewriteTsImports } from "jsr:@marianmeres/npmbuild";

rewriteTsImports(`import { foo } from "./foo.ts";`);
// → `import { foo } from "./foo.js";`
```

---

## Types

### `NpmBuildOptions`

```typescript
interface NpmBuildOptions {
    name: string;
    version: string;
    srcDir?: string;
    outDir?: string;
    author?: string;
    license?: string;
    repository?: string;
    sourceFiles?: string[];
    rootFiles?: string[];
    dependencies?: string[] | Record<string, string>;
    jsrDependencies?: string[];
    tsconfig?: Record<string, unknown>;
    entryPoints?: string[];
    packageJsonOverrides?: Record<string, unknown>;
    quiet?: boolean;
    includeHidden?: boolean;
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | `string` | **required** | Package name written to `package.json`. |
| `version` | `string` | **required** | Package version written to `package.json`. |
| `srcDir` | `string` | `"src"` | Source directory containing TypeScript files. |
| `outDir` | `string` | `".npm-dist"` | Output directory for the built package. |
| `author` | `string` | `"Marian Meres"` | Package author. |
| `license` | `string` | `"MIT"` | Package license. |
| `repository` | `string` | — | GitHub `user/repo` form. When set, populates `repository` and `bugs` fields in `package.json`. |
| `sourceFiles` | `string[]` | walks `srcDir` | Explicit source files to copy (nested paths supported). |
| `rootFiles` | `string[]` | `["LICENSE", "README.md", "API.md", "AGENTS.md", "CLAUDE.md", "docs"]` | Root files/directories copied to the package. Missing entries are skipped with a warning. Directories are copied recursively. |
| `dependencies` | `string[] \| Record<string, string>` | `[]` | See [Dependency Forms](#dependency-forms). |
| `jsrDependencies` | `string[]` | `[]` | JSR dependencies installed via `npx jsr add`. |
| `tsconfig` | `Record<string, unknown>` | `{}` | Overrides deep-merged into the generated `tsconfig.json`. |
| `entryPoints` | `string[]` | `["mod"]` | Entry names (no extension). Each expects `src/{name}.ts` and produces an `exports` entry (`"./{name}"`, or `"."` for `"mod"`). Must be non-empty. |
| `packageJsonOverrides` | `Record<string, unknown>` | `{}` | Fields deep-merged with the generated `package.json`. Set a field to `undefined` to remove it. |
| `quiet` | `boolean` | `false` | Suppress decorative console output. Auto-enabled when `NO_COLOR` env var is set. |
| `includeHidden` | `boolean` | `false` | Include dotfiles (`.DS_Store`, `.gitkeep`, …) when copying `srcDir`. |

#### Dependency Forms

| Form | Behavior |
|------|----------|
| `string[]` | Runs `npm install <dep>` inside `outDir` during build. The caret range of the installed version is written to `package.json`. Creates `node_modules/`. Overwrites any same-named entry in `packageJsonOverrides.dependencies`. |
| `Record<string, string>` | Declared verbatim in `package.json`. No install is performed; no `node_modules/` is created. Useful for peer deps or precise pins. |

---

### `NpmBuildResult`

```typescript
interface NpmBuildResult {
    outDir: string;
    entryPoints: string[];
    packageJson: Record<string, unknown>;
}
```

| Field | Description |
|-------|-------------|
| `outDir` | Directory containing the built package. |
| `entryPoints` | Entry point names exposed in `package.json` exports. |
| `packageJson` | The generated `package.json` object (pre `npm install`). Useful for post-build steps such as `npm pack --dry-run` to verify the published file list. |

---

## Constants

### `TS_IMPORT_REWRITE_REGEX`

```typescript
const TS_IMPORT_REWRITE_REGEX: RegExp;
```

The regex used by [`rewriteTsImports`](#rewritetsimportssource) to match
`.ts` specifiers in ES-module import/export forms. Exported for unit testing.

```regex
/(from\s+|import\s+|import\s*\(\s*)(['"])([^'"]+)\.ts(['"])/g
```

Each match captures only the prefix + string literal; surrounding syntax
(trailing `;`, `)`, newlines, etc.) is preserved.
