# @marianmeres/npmbuild

[![JSR](https://jsr.io/badges/@marianmeres/npmbuild)](https://jsr.io/@marianmeres/npmbuild)

A minimal Deno-to-npm build tool for pure TypeScript packages. A lightweight alternative to dnt.

## Installation

```ts
import { npmBuild } from "jsr:@marianmeres/npmbuild";
```

## Usage

Create a build script (e.g., `scripts/npm-build.ts`):

```ts
import { npmBuild } from "jsr:@marianmeres/npmbuild";

const denoJson = JSON.parse(Deno.readTextFileSync("deno.json"));

await npmBuild({
	name: denoJson.name,
	version: denoJson.version,
	repository: denoJson.name.replace(/^@/, ''), // conventional mm usage
});
```

Run:

```bash
deno run -A scripts/npm-build.ts
```

Publish:

```bash
cd .npm-dist && npm publish
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `name` | required | Package name |
| `version` | required | Package version |
| `srcDir` | `"src"` | Source directory containing TypeScript files |
| `outDir` | `".npm-dist"` | Output directory for npm package |
| `author` | `"Marian Meres"` | Package author |
| `license` | `"MIT"` | Package license |
| `repository` | - | GitHub repo (e.g., `"user/repo"`) for package.json URLs |
| `sourceFiles` | all files from srcDir | Source files to copy from srcDir (nested paths supported) |
| `rootFiles` | `["LICENSE", "README.md", "API.md", "AGENTS.md", "CLAUDE.md", "docs"]` | Root files or directories to copy to package (missing entries are skipped, directories are copied recursively) |
| `dependencies` | `[]` | npm dependencies. `string[]` installs via `npm install` and pins to caret range. `Record<string, string>` declares verbatim without installing. |
| `jsrDependencies` | `[]` | JSR dependencies to install via `npx jsr add` during build |
| `tsconfig` | `{}` | tsconfig overrides (deep merged), e.g. `{ compilerOptions: { strict: true } }` |
| `entryPoints` | `["mod"]` | Entry point names (without extension). Each generates exports. Must be non-empty. |
| `packageJsonOverrides` | `{}` | Arbitrary package.json fields (deep merged) |
| `quiet` | `false` | Suppress decorative console output. Auto-stripped when `NO_COLOR` env var is set. |
| `includeHidden` | `false` | Include dotfiles (e.g. `.DS_Store`, `.gitkeep`) when copying `srcDir` |

`npmBuild(...)` returns a `Promise<NpmBuildResult>` with `{ outDir, entryPoints, packageJson }` — useful for post-build steps (e.g. `npm pack --dry-run` to verify the published file list).

## Why not dnt?

Deno's official [dnt](https://github.com/denoland/dnt) is a powerful tool, but it's designed for a different use case. It handles remote dependencies, generates CommonJS alongside ESM, provides shims for `Deno.*` APIs, and runs tests through Node.js.

This package takes the opposite approach: simplicity over features.

- **No `Deno.*` APIs** - The packages I publish to npm are pure TypeScript with no Deno-specific code, so I don't need shims or polyfills.
- **ESM only** - Modern Node.js (14+) supports ESM natively. CommonJS output is unnecessary overhead.
- **Local files only** - I don't use remote imports in code destined for npm. A simple file copy and import rewrite is sufficient.
- **~100 lines of code** - Easy to understand, debug, and modify. No abstraction layers, no magic.

If you need dnt's features, use dnt. If you just want to run `tsc` on some local TypeScript files and produce a publishable npm package, this might be enough.

## Copying Additional Directories

The `rootFiles` option supports both files and directories. Directories are copied recursively:

```ts
await npmBuild({
	name: "@example/my-package",
	version: "1.0.0",
	rootFiles: ["LICENSE", "README.md", "docs", "examples"],
});
```

This will copy the `docs/` and `examples/` directories (with all their contents) to the npm package root. When users install your package, these directories will be available under `node_modules/your-package/docs/`, etc.

## Multiple Entry Points

By default, only `src/mod.ts` is exposed as the package entry point. To expose multiple entry points:

```ts
await npmBuild({
	name: "@example/my-package",
	version: "1.0.0",
	entryPoints: ["mod", "utils", "helpers"],
});
```

This expects `src/mod.ts`, `src/utils.ts`, and `src/helpers.ts` to exist, and generates:

```json
{
	"main": "dist/mod.js",
	"types": "dist/mod.d.ts",
	"exports": {
		".": { "types": "./dist/mod.d.ts", "import": "./dist/mod.js" },
		"./utils": { "types": "./dist/utils.d.ts", "import": "./dist/utils.js" },
		"./helpers": { "types": "./dist/helpers.d.ts", "import": "./dist/helpers.js" }
	}
}
```

Use `packageJsonOverrides` to add additional fields or merge extra exports:

```ts
await npmBuild({
	name: "@example/my-package",
	version: "1.0.0",
	packageJsonOverrides: {
		keywords: ["typescript", "utility"],
		exports: {
			"./package.json": "./package.json"
		}
	}
});
```

## Non-TypeScript Assets

Files in `srcDir` that aren't TypeScript (`.json`, `.css`, `.sql`, `.svg`, etc.) are
passed through to `dist/` after compilation, so imports like

```ts
import data from "./data.json" with { type: "json" };
```

continue to work in the published package. Dotfiles (names starting with `.`) are
excluded by default; opt in with `includeHidden: true`.

## Declaring vs. Installing Dependencies

```ts
// string[] — runs `npm install <dep>` during build; writes caret ranges of
// the installed versions into package.json. Creates node_modules/ in outDir.
dependencies: ["react", "@marianmeres/clog"],

// Record<string, string> — declared verbatim in package.json; no install
// performed, no node_modules/ in outDir. Useful for peer deps or precise pins.
dependencies: { "react": "^18.2.0" },
```

When using the `string[]` form, any dep with the same name set via
`packageJsonOverrides.dependencies` is overwritten by the install.

## Example

```bash
cd example && deno run -A build.ts
```

## Breaking Changes

### 1.12.0

- **`npmBuild` now returns `Promise<NpmBuildResult>` instead of `Promise<void>`.**
  Callers that only `await` the result are unaffected. Callers that explicitly
  annotated the return type as `Promise<void>` need to update.
- **`package.json` now includes a `files` field** auto-derived from `dist` plus
  any `rootFiles` actually copied. npm will only publish files listed here. To
  restore the old "publish everything npm doesn't ignore" behavior, pass
  `packageJsonOverrides: { files: undefined }` — but the new default is usually
  what you want.
- **Dotfiles in `srcDir` are no longer copied by default.** Set
  `includeHidden: true` to restore the old behavior.
- **`tsc` is now invoked via `npx tsc`** (previously a plain `tsc`). If you had
  a global TypeScript install, this is transparent. If `tsc` was not in PATH
  before, the build used to fail — now it picks up a project-local TypeScript
  or auto-installs on demand.
- **Non-TypeScript files inside `srcDir` are now passed through to `dist/`.**
  Previously they were silently dropped. If you relied on that drop behavior,
  move those files out of `srcDir`.
- **Empty `entryPoints: []` now throws** instead of producing a broken
  `package.json` with `main: "dist/undefined.js"`.

### 1.11.0 and earlier

- Import rewriting now handles **side-effect imports** (`import "./x.ts"`).
  Previously only `from "./x.ts"` and `import("./x.ts")` were rewritten,
  producing broken output for any file containing a side-effect `.ts` import.
- `sourceFiles` entries with **nested paths** (e.g. `"utils/foo.ts"`) now work
  correctly; previously they crashed with `NotFound` because the destination
  directory wasn't created.
- Path handling uses `dirname` from `@std/path` instead of `lastIndexOf("/")`,
  so builds work correctly on Windows.