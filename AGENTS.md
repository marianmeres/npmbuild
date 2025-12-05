# AGENTS.md - @marianmeres/npmbuild

> Machine-readable context document for AI agents and LLMs working with this codebase.

## Package Identity

| Field | Value |
|-------|-------|
| Name | `@marianmeres/npmbuild` |
| Version | `1.6.1` |
| Runtime | Deno |
| License | MIT |
| Author | Marian Meres |
| Registry | JSR (jsr:@marianmeres/npmbuild) |

## Purpose

A Deno TypeScript build tool that converts Deno projects into npm-publishable packages. It handles:
- Import path rewriting (`.ts` → `.js`)
- TypeScript compilation with declaration file generation
- package.json generation
- npm dependency installation
- File structure transformation

## File Structure

```
@marianmeres/npmbuild/
├── npm-build.ts          # Main source - single export file
├── deno.json             # Deno configuration
├── deno.lock             # Dependency lock
├── README.md             # User documentation
├── LICENSE               # MIT license
├── AGENTS.md             # This file
└── example/              # Working example
    ├── build.ts          # Example build script
    └── src/              # Example source files
```

## Main Export

### Function Signature

```typescript
export async function npmBuild(options: NpmBuildOptions): Promise<void>
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
  sourceFiles?: string[];              // specific files to include
  rootFiles?: string[];                // default: ["LICENSE", "README.md", "API.md", "AGENTS.md"]
  dependencies?: string[];             // npm dependencies to install
  tsconfig?: Record<string, unknown>;  // TypeScript compiler overrides
}
```

## Build Pipeline

```
1. Validate options & set defaults
2. Empty output directory
3. Copy source files (srcDir → outDir/src)
4. Copy root files (LICENSE, README.md, etc.)
5. Rewrite imports (.ts → .js in all TS files)
6. Generate tsconfig.json
7. Generate package.json
8. Install npm dependencies (if specified)
9. Run tsc compiler
10. Cleanup (remove src/, tsconfig.json)
```

## Import Rewriting

The tool rewrites TypeScript imports for npm compatibility:

| Before | After |
|--------|-------|
| `from './module.ts'` | `from './module.js'` |
| `import('./module.ts')` | `import('./module.js')` |

Regex pattern:
```regex
/from\s+(['"])([^'"]+)\.ts(['"]);?|import\s*\(\s*(['"])([^'"]+)\.ts(['"]),?\s*\)/g
```

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
  }
}
```

## Generated package.json

```json
{
  "name": "<options.name>",
  "version": "<options.version>",
  "type": "module",
  "main": "dist/mod.js",
  "types": "dist/mod.d.ts",
  "exports": {
    ".": {
      "types": "./dist/mod.d.ts",
      "import": "./dist/mod.js"
    }
  },
  "author": "<options.author>",
  "license": "<options.license>",
  "dependencies": {},
  "repository": {
    "type": "git",
    "url": "git+https://github.com/<repository>.git"
  },
  "bugs": {
    "url": "https://github.com/<repository>/issues"
  }
}
```

## Dependencies

### Deno Standard Library

| Import | Version | Purpose |
|--------|---------|---------|
| `@std/assert` | ^1.0.16 | Testing utilities |
| `@std/fs` | ^1.0.20 | File system operations (emptyDir, walkSync) |
| `@std/path` | ^1.1.3 | Path utilities (join) |

### External CLI Requirements

- `npm` - Package manager (for dependency installation)
- `tsc` - TypeScript compiler (global or project-local)

## Usage Example

```typescript
import { npmBuild } from "jsr:@marianmeres/npmbuild";

await npmBuild({
  name: "@example/my-package",
  version: "1.0.0",
  repository: "example/my-package",
  dependencies: ["lodash"],
});
```

## Output Structure

After build, `.npm-dist/` contains:

```
.npm-dist/
├── package.json
├── LICENSE
├── README.md
└── dist/
    ├── mod.js
    ├── mod.d.ts
    └── [compiled files...]
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

- Missing root files: Warning logged, build continues
- npm install failure: Error thrown with output
- tsc failure: Error thrown with output
- Working directory: Restored on failure

## Key Implementation Details

1. **Single file architecture**: All logic in `npm-build.ts`
2. **No test files**: Tool is tested via example directory
3. **Async/await**: All operations are async
4. **Console styling**: Uses CSS-like console styling for output
5. **Graceful degradation**: Missing optional files don't fail build

## Common Modification Points

| Task | Location |
|------|----------|
| Change default options | `npm-build.ts` - destructuring defaults |
| Add new root files | `npm-build.ts` - `rootFiles` default array |
| Modify tsconfig | `npm-build.ts` - `tsconfig` object literal |
| Change package.json template | `npm-build.ts` - `packageJson` object literal |
| Adjust import regex | `npm-build.ts` - regex in file processing loop |

## Version History

| Version | Notable Changes |
|---------|-----------------|
| 1.6.1 | Current release |
| 1.6.0 | Added agents support |
| 1.5.0 | Feature additions |
| 1.4.0 | Improved error output |

## Publishing Workflow

```bash
# 1. Build npm package
deno run -A build.ts

# 2. Publish to npm
cd .npm-dist && npm publish
```

## Constraints & Limitations

- Entry point must be `src/mod.ts` (compiles to `dist/mod.js`)
- Only handles TypeScript source files
- Requires `npm` and `tsc` in PATH
- No bundling (outputs individual files)
- No tree-shaking or minification
