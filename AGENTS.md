# AGENTS.md - @marianmeres/npmbuild

> Machine-readable context document for AI agents and LLMs working with this codebase.

## Package Identity

| Field | Value |
|-------|-------|
| Name | `@marianmeres/npmbuild` |
| Version | `1.11.0` (pending bump to `1.12.0` — see "Breaking Changes") |
| Runtime | Deno |
| License | MIT |
| Author | Marian Meres |
| Registry | JSR (jsr:@marianmeres/npmbuild) |

## Purpose

A Deno TypeScript build tool that converts Deno projects into npm-publishable packages. It handles:

- Import path rewriting (`.ts` → `.js`), including side-effect imports
- TypeScript compilation with declaration file generation (via `npx tsc`)
- `package.json` generation with auto `files` field
- Optional npm/JSR dependency installation
- Non-TS asset passthrough (`.json`, `.css`, …) from `src/` to `dist/`

## File Structure

```
@marianmeres/npmbuild/
├── npm-build.ts         # Main source - single export file
├── npm-build.test.ts    # Unit tests for import rewriting
├── deno.json            # Deno configuration
├── deno.lock            # Dependency lock
├── README.md            # User documentation
├── LICENSE              # MIT license
├── AGENTS.md            # This file
└── example/             # Working example
    ├── build.ts         # Example build script
    └── src/             # Example source files
```

## Main Export

### Function Signature

```typescript
export async function npmBuild(options: NpmBuildOptions): Promise<NpmBuildResult>
```

### Options Interface

```typescript
interface NpmBuildOptions {
  // Required
  name: string;                        // npm package name
  version: string;                     // semver version

  // Optional with defaults
  srcDir?: string;                     // default: "src"
  outDir?: string;                     // default: ".npm-dist"
  author?: string;                     // default: "Marian Meres"
  license?: string;                    // default: "MIT"
  repository?: string;                 // GitHub format: "user/repo"
  sourceFiles?: string[];              // explicit list (nested paths OK); defaults to walking srcDir
  rootFiles?: string[];                // default: ["LICENSE", "README.md", "API.md", "AGENTS.md", "CLAUDE.md", "docs"]
  dependencies?: string[] | Record<string, string>;  // see "Dependencies" below
  jsrDependencies?: string[];          // installed via `npx jsr add`
  tsconfig?: Record<string, unknown>;  // tsconfig overrides (deep merged)
  entryPoints?: string[];              // default: ["mod"] — must be non-empty
  packageJsonOverrides?: Record<string, unknown>;    // deep merged with generated package.json
  quiet?: boolean;                     // default: false — suppress decorative output
  includeHidden?: boolean;             // default: false — include dotfiles from srcDir
}
```

### Result Interface

```typescript
interface NpmBuildResult {
  outDir: string;                              // directory containing the built package
  entryPoints: string[];                       // entry point names (without extension)
  packageJson: Record<string, unknown>;        // the generated package.json (pre-install)
}
```

## Build Pipeline

```
1. Validate required options (name, version, entryPoints non-empty)
2. Empty output directory
3. Copy source files (srcDir → outDir/src, skip dotfiles unless includeHidden)
4. Copy root files and directories (LICENSE, README.md, docs/, etc.)
5. Rewrite imports (.ts → .js in all .ts/.tsx/.mts/.cts files)
6. Generate tsconfig.json
7. Generate package.json (with files[] auto-derived from dist + copied rootFiles)
8. Install npm dependencies (if `dependencies` is string[])
9. Install JSR dependencies (if any)
10. Run `npx tsc -p tsconfig.json` (cwd set per-command, no Deno.chdir)
11. Copy non-TS assets from outDir/src → outDir/dist
12. Cleanup (remove src/, tsconfig.json)
13. Return NpmBuildResult
```

## Import Rewriting

Handled via a single regex, exported as `TS_IMPORT_REWRITE_REGEX`. The high-level helper `rewriteTsImports(source: string): string` is also exported for unit testing.

| Before | After |
|--------|-------|
| `from './module.ts'` | `from './module.js'` |
| `import './side-effect.ts'` | `import './side-effect.js'` |
| `export * from './module.ts'` | `export * from './module.js'` |
| `import('./module.ts')` | `import('./module.js')` |

Regex:

```regex
/(from\s+|import\s+|import\s*\(\s*)(['"])([^'"]+)\.ts(['"])/g
```

Each match captures only the prefix + string literal; surrounding syntax (trailing `;`, `)`, newlines, etc.) is preserved untouched.

**Known limitation:** regex-based rewriting will also transform `.ts` specifier strings inside comments or string literals. Acceptable trade-off for the simplicity of the approach.

## Dependencies

Field accepts two shapes:

| Shape | Behavior |
|-------|----------|
| `string[]` | Runs `npm install <dep>` in outDir. Caret range of installed version is pinned in `package.json`. Creates `node_modules/` in outDir. |
| `Record<string, string>` | Declared verbatim in `package.json`. No install performed. No `node_modules/` created. |

Precedence: with `string[]`, `npm install` overwrites any matching dep name set via `packageJsonOverrides.dependencies`.

## Generated TypeScript Config

```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "esnext",
    "strict": false,
    "declaration": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "rootDir": "src",
    "outDir": "dist",
    "moduleResolution": "bundler"
  },
  "include": ["src/**/*"]
}
```

## Generated package.json

Example with `entryPoints: ["mod", "utils"]`:

```json
{
  "name": "<options.name>",
  "version": "<options.version>",
  "type": "module",
  "main": "dist/mod.js",
  "types": "dist/mod.d.ts",
  "exports": {
    ".":       { "types": "./dist/mod.d.ts",   "import": "./dist/mod.js" },
    "./utils": { "types": "./dist/utils.d.ts", "import": "./dist/utils.js" }
  },
  "files": ["dist", "LICENSE", "README.md"],
  "author": "<options.author>",
  "license": "<options.license>",
  "dependencies": {}
}
```

`packageJsonOverrides` is deep-merged with the generated object. To remove an auto-added field, set it to `undefined` in overrides.

## Dependencies (Tooling)

### Deno Standard Library

| Import | Purpose |
|--------|---------|
| `@std/assert` | Test assertions |
| `@std/collections` | `deepMerge` |
| `@std/fs` | `copy`, `emptyDir`, `ensureDir`, `walk` |
| `@std/path` | `dirname`, `join`, `relative` |

### External CLI Requirements

- `npm` — for `npm install` (and as provider of `npx`)
- `npx` — wraps `tsc` invocation; resolves project-local, global, or on-demand TypeScript

## Usage Example

```typescript
import { npmBuild } from "jsr:@marianmeres/npmbuild";

await npmBuild({
  name: "@example/my-package",
  version: "1.0.0",
  repository: "example/my-package",
  dependencies: ["lodash"],
  entryPoints: ["mod", "utils"],
  packageJsonOverrides: {
    keywords: ["typescript", "utility"],
  },
});
```

## Output Structure

After build, `.npm-dist/` contains:

```
.npm-dist/
├── package.json
├── LICENSE
├── README.md
├── docs/                # if rootFiles includes "docs"
│   └── …
├── node_modules/        # only when `dependencies` is string[] (excluded by npm publish)
├── package-lock.json    # only when `dependencies` is string[]
└── dist/
    ├── mod.js
    ├── mod.d.ts
    ├── utils.js         # if entryPoints includes "utils"
    ├── utils.d.ts
    ├── data.json        # non-TS assets passed through from src/
    └── …
```

## Coding Conventions

| Convention | Value |
|------------|-------|
| Indentation | Tabs (width 4) |
| Line width | 90 characters |
| Module format | ESM |
| File encoding | UTF-8 |
| Line endings | LF |

## Error Handling

- Missing root files/directories: warning logged, build continues; missing entries are not added to `files`.
- Missing required options (`name`, `version`) or empty `entryPoints`: throws early with a clear message.
- npm install / jsr add / tsc failure: throws with exit code. Output streams to stdout/stderr in normal mode; captured and included in thrown error when `quiet: true`.
- No `Deno.chdir`: per-command `cwd` option used instead, so concurrent async work in the host process is unaffected.

## Key Implementation Details

1. **Single file architecture**: all logic in `npm-build.ts` (~280 LOC)
2. **Unit tests**: `npm-build.test.ts` covers import-rewrite edge cases
3. **Fully async**: uses `walk`/`copy`/`ensureDir`/`readTextFile`/`writeTextFile` and `Deno.Command(...).output()`
4. **Graceful degradation**: missing optional files/directories don't fail build
5. **Non-TS asset passthrough**: JSON, CSS, SQL, SVG etc. in `src/` are copied to `dist/` after tsc
6. **Dotfile filtering**: dotfiles in `src/` are skipped by default (opt-in via `includeHidden: true`)
7. **Auto `files` field**: `package.json` `files` is derived from `dist` + copied `rootFiles`, limiting what `npm publish` includes
8. **NO_COLOR aware**: strips `%c` console styles when `NO_COLOR` env var is set

## Common Modification Points

| Task | Location |
|------|----------|
| Change default options | `npm-build.ts` — destructuring defaults |
| Add new root files/dirs | `npm-build.ts` — `rootFiles` default array |
| Modify tsconfig | `npm-build.ts` — tsconfig object literal |
| Change package.json template | `npm-build.ts` — packageJson object literal |
| Adjust import regex | `npm-build.ts` — `TS_IMPORT_REWRITE_REGEX` + tests in `npm-build.test.ts` |

## Publishing Workflow

```bash
# 1. Build npm package
deno run -A build.ts

# 2. Publish to npm
cd .npm-dist && npm publish
```

## Constraints & Limitations

- Entry points must exist in `src/` directory (e.g., `src/mod.ts`, `src/utils.ts`)
- Requires `npm` / `npx` in PATH
- No bundling (outputs individual files)
- No tree-shaking or minification
- Regex-based import rewriting may also transform `.ts` specifier strings inside comments or string literals (documented trade-off)

## Breaking Changes (1.12.0)

- Return type changed from `Promise<void>` to `Promise<NpmBuildResult>`. Calls that only `await` the result are unaffected.
- `package.json` now includes a `files` field auto-derived from `dist` + copied `rootFiles`. Override via `packageJsonOverrides.files`.
- Dotfiles in `srcDir` are no longer copied by default; opt-in via `includeHidden: true`.
- `tsc` is now invoked via `npx tsc` (previously plain `tsc`). Transparent if `tsc` was already in PATH.
- Non-TS files inside `srcDir` now pass through to `dist/` (previously silently dropped).
- Empty `entryPoints: []` now throws instead of producing a broken `package.json`.
- Side-effect imports (`import "./x.ts"`) are now correctly rewritten; previously they shipped broken.
- `sourceFiles` entries with nested paths (e.g. `"utils/foo.ts"`) now work (previously crashed with `NotFound`).
