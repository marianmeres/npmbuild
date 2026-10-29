# @marianmeres/npmbuild — Agent Guide

## Quick Reference

- **What**: build tool that turns a Deno-style TypeScript source tree (`.ts` import
  specifiers, versions in `deno.json`) into an npm-publishable ESM package: copies
  `src/`, rewrites `.ts` → `.js` specifiers, generates `tsconfig.json` + `package.json`,
  runs `npx tsc`, passes non-TS assets through. One source file, zero runtime
  dependencies.
- **Stack**: TypeScript (erasable-only), Node LTS (`.node-version`), pnpm, `node:test`,
  Biome.
- **Install**: `pnpm install` | **Test**: `pnpm test` | **Check all**: `pnpm run ci` |
  **Build**: `pnpm run build`
- **Distribution**: one source, two registries. npm gets `dist/` (ESM + `.d.ts`); JSR
  (`jsr.json`) gets `src/` as is, for the Deno consumers (most `@marianmeres/*`
  `scripts/build-npm.ts`), who run the `node:*` code through Deno's Node compatibility.

## Project Structure

```
src/npm-build.ts            # Everything: npmBuild, versionizeDeps, rewriteTsImports + internal helpers
tests/npm-build.test.ts     # Unit: rewriteTsImports, versionizeDeps
tests/npm-build.e2e.test.ts # Real builds of fixture projects (tsc included), then imports the output
tests/_build.ts             # Child-process fixture: runs npmBuild(JSON argv) in its cwd
example/                    # Manual example (`cd example && node build.ts`; needs network)
jsr.json                    # JSR name / exports / include; no version (set at publish)
dist/                       # `tsc -p tsconfig.build.json` output; gitignored; all npm gets (+ API.md, AGENTS.md)
tmp/                        # Scratch + e2e fixtures (tmp/e2e-*), gitignored
```

## Critical Conventions

1. **Runtime policy.** Node at the keyboard and in production, npm as the registry. No
   `Deno.*`, `Bun.*`, `jsr:` or `npm:` specifiers, no `@std/*` (on npm it would force
   consumers onto the JSR registry). `node:*` imported explicitly
   (`import process from "node:process"`). Deno is a _consumer_ runtime here (JSR), not a
   dev runtime: `pnpm run test:deno` runs the e2e suite with the build on Deno before a
   JSR publish. Nothing is built or tested for Bun.
2. **Behaviour parity with the Deno-era 1.x.** The internal helpers replace `@std`
   one-for-one; keep their semantics:
   - `deepMerge` = `@std/collections` default: objects merge, **arrays concatenate**,
     other values (incl. `undefined`) replace.
   - `copy` = `cp(..., { recursive, force, verbatimSymlinks: true })`. Without
     `verbatimSymlinks`, a relative symlink in `srcDir` would point back into the source
     tree and the import rewrite would edit the user's source (an e2e test guards this).
   - `listFiles` = `walk(..., { includeDirs: false })`: symlinks listed, not followed.
   - `emptyDir` keeps the directory itself.
   - Commands spawn with stdin closed (`Deno.Command#output()` did the same), so `npx`
     never prompts.
3. **No `chdir`.** Every command gets `cwd: outDir`; relative option paths resolve
   against the process cwd.
4. **Erasable TypeScript.** No `enum`, `namespace`, constructor parameter properties;
   `import type` for types; explicit `.ts` import extensions. Node strips types and never
   checks them: `pnpm run typecheck` is the only type gate. Every export keeps an
   explicit type (JSR slow-types check).
5. **Formatting**: Biome (tabs, 4 wide, 90 cols, double quotes; manifests 2 spaces).
   `pnpm run format` before committing.

## Public API

Exports from `src/npm-build.ts` (full reference: [API.md](API.md)):

| Export                    | Kind      | Purpose                                                          |
| ------------------------- | --------- | ---------------------------------------------------------------- |
| `npmBuild(options)`       | Function  | Runs the build; returns `NpmBuildResult`                         |
| `versionizeDeps(deps, d)` | Function  | `["pg"]` + `deno.json` imports → `["pg@^8"]`                     |
| `rewriteTsImports(src)`   | Function  | `.ts` → `.js` in `from` / side-effect / dynamic import forms     |
| `TS_IMPORT_REWRITE_REGEX` | Const     | The regex behind `rewriteTsImports`                              |
| `NpmBuildOptions`         | Interface | `name`, `version` required; everything else defaulted            |
| `NpmBuildResult`          | Interface | `{ outDir, entryPoints, packageJson }` (packageJson pre-install) |

## Build Pipeline

```
1. Validate name, version, non-empty entryPoints (throws before touching the disk)
2. emptyDir(outDir)
3. Copy srcDir → outDir/src (walk, dotfiles skipped unless includeHidden; or sourceFiles)
4. Copy rootFiles (files or dirs); ENOENT → warning, not listed in package.json "files"
5. Rewrite imports in outDir/src/**/*.{ts,tsx,mts,cts}
6. Write tsconfig.json (defaults below, deep-merged with `tsconfig`)
7. Write package.json (exports from entryPoints, files = dist + copied rootFiles,
   deep-merged with packageJsonOverrides; repository/bugs from `repository`)
8. npm install <dependencies>      (string[] form only)
9. npm install --no-save <peers>   (string[] form only)
10. npx jsr add <jsrDependencies>
11. npx tsc -p tsconfig.json       (failure → Error with exit code; output captured if quiet)
12. Copy non-TS files outDir/src → outDir/dist
13. rm outDir/tsconfig.json and outDir/src
```

Generated `tsconfig.json` defaults: `target`/`module` `esnext`, `moduleResolution`
`bundler`, `strict: false`, `declaration: true`, `skipLibCheck: true`,
`forceConsistentCasingInFileNames: true`, `rootDir: "src"`, `outDir: "dist"`,
`include: ["src/**/*"]`.

`versionizeDeps`: a dep counts as versioned when `dep.lastIndexOf("@") > 0`; the version
is what follows the last `@` of a `jsr:` / `npm:` imports value; anything else passes
through unchanged. Path form reads with `readFileSync` (cwd-relative).

Console output: ANSI colours unless `NO_COLOR` is set (non-empty); `quiet` silences it.

## Testing

- `tests/npm-build.e2e.test.ts` builds fixtures in `tmp/e2e-*` (removed after the run).
  They must live inside the repo: `npx tsc` walks up from `outDir` to find
  `node_modules/.bin/tsc`, i.e. this repo's TypeScript; from the OS temp dir it would use
  a global `tsc` or download one.
- The build runs in a child process (`tests/_build.ts`, options as JSON argv) —
  `BUILD_RUNTIME=deno` swaps Node for `deno run -A --no-lock`. JSON cannot carry
  `undefined`, so that case runs in process.
- Record-form dependencies only: the suite needs no network.

## Before Making Changes

- [ ] Keep the parity rules above (they are what Deno consumers on `^1` rely on).
- [ ] Add or extend a test; run `pnpm run ci`, and `pnpm run test:deno` when touching
  file or process handling.
- [ ] Public surface or behaviour changed? Update [API.md](API.md) and the README
  "Notable Changes" in the same commit.

## Commands

| Task                   | Command                                                     |
| ---------------------- | ----------------------------------------------------------- |
| Install                | `pnpm install`                                              |
| Tests (unit + e2e)     | `pnpm test`                                                 |
| e2e with build on Deno | `pnpm run test:deno`                                        |
| Type check             | `pnpm run typecheck`                                        |
| Lint + format check    | `pnpm run lint`                                             |
| Format                 | `pnpm run format`                                           |
| Everything CI runs     | `pnpm run ci`                                               |
| Build `dist/`          | `pnpm run build`                                            |
| Release + publish      | `pnpm run rp` (patch) / `pnpm run rpm` (minor) — human only |

Release is a human action: `pnpm run release` bumps `package.json` (the manifest of
record), commits, tags and pushes; `publish:all` then runs `pnpm publish` (`ci` + `build`
via `prepublishOnly`) and `publish:jsr` (`test:deno`, then
`deno publish --no-check --set-version "$npm_package_version"`). `--no-check` because
Deno would type-check against this repo's Node `tsconfig.json` (no `console` without
`dom`/Deno libs); `pnpm run typecheck` is the type gate. `jsr.json` carries no version.

## Constraints

- `npm` / `npx` must be on `PATH`; entry points must exist as `src/{name}.ts`.
- No bundling, minification or CommonJS; ESM only.
- Regex import rewriting also touches `.ts` specifier strings in comments / string
  literals (accepted trade-off).

## Documentation Index

| Doc                    | Audience | Contents                                        |
| ---------------------- | -------- | ----------------------------------------------- |
| [README.md](README.md) | Human    | Overview, usage, recipes, notable changes       |
| [API.md](API.md)       | Human    | Full reference: options, merging, deps, results |
| [AGENTS.md](AGENTS.md) | Agent    | This file                                       |
| [CLAUDE.md](CLAUDE.md) | Agent    | Pointer to this file                            |
