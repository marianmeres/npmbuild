import { deepMerge } from "@std/collections/deep-merge";
import { copy, emptyDir, ensureDir, walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";

/**
 * Regex matching TypeScript relative-import forms this tool rewrites to `.js`.
 * Each match covers only the prefix + string literal (not any trailing `;` or
 * `)`), so arbitrary surrounding syntax is preserved untouched:
 *
 * - `from "./x.ts"` — static `import … from` and `export … from`
 * - `import "./x.ts"` — bare side-effect imports
 * - `import("./x.ts"` — dynamic imports (handles surrounding whitespace)
 *
 * Exported for unit testing; callers should prefer {@link rewriteTsImports}.
 */
export const TS_IMPORT_REWRITE_REGEX =
	/(from\s+|import\s+|import\s*\(\s*)(['"])([^'"]+)\.ts(['"])/g;

/**
 * Rewrites `.ts` specifiers in ES-module import/export statements to `.js`,
 * which is what `tsc` requires in its emitted output.
 *
 * Does not attempt to parse TypeScript — string matches inside comments or
 * string literals can be rewritten too. In practice this is harmless for
 * comments and rare enough in string content to be an acceptable trade-off
 * for the simplicity of a regex approach.
 */
export function rewriteTsImports(source: string): string {
	return source.replace(
		TS_IMPORT_REWRITE_REGEX,
		(_match, prefix: string, q1: string, path: string, q2: string) =>
			`${prefix}${q1}${path}.js${q2}`,
	);
}

/**
 * Configuration for building an npm package from Deno source
 */
export interface NpmBuildOptions {
	/** Source directory containing TypeScript files (default: "src") */
	srcDir?: string;
	/** Output directory for npm package (default: ".npm-dist") */
	outDir?: string;
	/** Package name (required) */
	name: string;
	/** Package version (required) */
	version: string;
	/** Package author (default: "Marian Meres") */
	author?: string;
	/** Package license (default: "MIT") */
	license?: string;
	/** GitHub repository name, e.g. "marianmeres/name" (optional, for repo/bugs URLs) */
	repository?: string;
	/** Source files to copy (default: all files from srcDir, recursively) */
	sourceFiles?: string[];
	/** Root files or directories to copy to package (default: ["LICENSE", "README.md", "API.md", "AGENTS.md", "CLAUDE.md", "docs"]) */
	rootFiles?: string[];
	/**
	 * npm dependencies. Accepts either:
	 *
	 * - `string[]` — installed via `npm install <dep>` during the build; the
	 *   caret range of the installed version is written into `package.json`.
	 *   Any entry in `packageJsonOverrides.dependencies` with the same name
	 *   is overwritten by the install.
	 * - `Record<string, string>` — declared verbatim in `package.json`; no
	 *   install is performed and no `node_modules` is created in `outDir`.
	 *
	 * Default: `[]` (no dependencies).
	 */
	dependencies?: string[] | Record<string, string>;
	/** JSR dependencies to install via 'npx jsr add' (default: none) */
	jsrDependencies?: string[];
	/** tsconfig overrides (deep merged), e.g. { compilerOptions: { strict: true }, include: [...] } */
	tsconfig?: Record<string, unknown>;
	/** Entry point names without extension (default: ["mod"])
	 *  Each entry expects a corresponding src/{name}.ts file
	 *  and generates exports for "./{name}" (or "." for "mod")
	 */
	entryPoints?: string[];
	/** Arbitrary package.json overrides (deep merged with generated values) */
	packageJsonOverrides?: Record<string, unknown>;
	/** Suppress decorative console output. Also auto-stripped when NO_COLOR env var is set. (default: false) */
	quiet?: boolean;
	/** Include dotfiles (e.g. .DS_Store, .gitkeep) when copying srcDir. (default: false) */
	includeHidden?: boolean;
}

/** Return value of {@link npmBuild}. */
export interface NpmBuildResult {
	/** Directory containing the built package. */
	outDir: string;
	/** Entry point names (without extension) exposed in `package.json` exports. */
	entryPoints: string[];
	/** The generated `package.json` (before `npm install` post-processing). */
	packageJson: Record<string, unknown>;
}

function hasHiddenSegment(relPath: string): boolean {
	for (const segment of relPath.split(/[/\\]/)) {
		if (segment.startsWith(".")) return true;
	}
	return false;
}

/**
 * Builds an npm package from Deno TypeScript source.
 *
 * - Copies source files and rewrites `.ts` imports to `.js`
 * - Generates `tsconfig.json` and `package.json`
 * - Runs `tsc` (via `npx`, picking up a local or global install) to compile
 * - Passes non-TS source assets through to `dist/` so `import … from "./data.json"`
 *   and similar continue to work in the published package
 * - Cleans up intermediate files
 */
export async function npmBuild(options: NpmBuildOptions): Promise<NpmBuildResult> {
	const {
		srcDir = "src",
		outDir = ".npm-dist",
		name,
		version,
		author = "Marian Meres",
		license = "MIT",
		repository,
		sourceFiles,
		rootFiles = [
			"LICENSE",
			"README.md",
			"API.md",
			"AGENTS.md",
			"CLAUDE.md",
			"docs",
		],
		dependencies = [],
		jsrDependencies = [],
		tsconfig: tsconfigOverrides = {},
		entryPoints = ["mod"],
		packageJsonOverrides = {},
		quiet = false,
		includeHidden = false,
	} = options;

	if (!name) throw new Error("npmBuild: `name` is required");
	if (!version) throw new Error("npmBuild: `version` is required");
	if (entryPoints.length === 0) {
		throw new Error("npmBuild: `entryPoints` must not be empty");
	}

	const useColor = !Deno.env.get("NO_COLOR");
	const log = (msg: string, ...styles: string[]): void => {
		if (quiet) return;
		if (useColor) console.log(msg, ...styles);
		else console.log(msg.replace(/%c/g, ""));
	};
	const warn = (msg: string, ...styles: string[]): void => {
		if (quiet) return;
		if (useColor) console.warn(msg, ...styles);
		else console.warn(msg.replace(/%c/g, ""));
	};

	const outDirSrc = join(outDir, "src");
	const outDirDist = join(outDir, "dist");

	log(
		`%cBuilding npm package: %c${name}@${version}`,
		"color: gray",
		"color: cyan; font-weight: bold",
	);
	log(
		`%c{ srcDir: %c${srcDir}%c, outDir: %c${outDir}%c }`,
		"color: gray",
		"color: yellow",
		"color: gray",
		"color: yellow",
		"color: gray",
	);

	await emptyDir(outDir);

	// copy source files (all files from srcDir by default, or explicit list if provided)
	if (sourceFiles) {
		for (const file of sourceFiles) {
			log("%c    --> %s", "color: gray", file);
			const src = join(srcDir, file);
			const dest = join(outDirSrc, file);
			await ensureDir(dirname(dest));
			await copy(src, dest, { overwrite: true });
		}
	} else {
		for await (const entry of walk(srcDir, { includeDirs: false })) {
			const rel = relative(srcDir, entry.path);
			if (!includeHidden && hasHiddenSegment(rel)) continue;
			log("%c    --> %c%s", "color: gray", "color: green", rel);
			const dest = join(outDirSrc, rel);
			await ensureDir(dirname(dest));
			await copy(entry.path, dest, { overwrite: true });
		}
	}

	// copy root files and directories (skip missing)
	const copiedRootFiles: string[] = [];
	for (const asset of rootFiles) {
		try {
			await copy(asset, join(outDir, asset), { overwrite: true });
			copiedRootFiles.push(asset);
		} catch (e) {
			if (e instanceof Deno.errors.NotFound) {
				warn(
					"%c    --> %c%s%c not found, skipping",
					"color: orange",
					"color: yellow",
					asset,
					"color: orange",
				);
			} else {
				throw e;
			}
		}
	}

	// rewrite .ts imports to .js (tsc requires this)
	for await (
		const f of walk(outDirSrc, {
			includeDirs: false,
			exts: [".ts", ".tsx", ".mts", ".cts"],
		})
	) {
		const contents = await Deno.readTextFile(f.path);
		const replaced = rewriteTsImports(contents);
		if (replaced !== contents) {
			await Deno.writeTextFile(f.path, replaced);
		}
	}

	// create tsconfig.json
	const tsconfigJson = deepMerge(
		{
			compilerOptions: {
				target: "esnext",
				module: "esnext",
				strict: false,
				declaration: true,
				forceConsistentCasingInFileNames: true,
				skipLibCheck: true,
				rootDir: "src",
				outDir: "dist",
				moduleResolution: "bundler",
			},
			include: ["src/**/*"],
		},
		tsconfigOverrides,
	);
	await Deno.writeTextFile(
		join(outDir, "tsconfig.json"),
		JSON.stringify(tsconfigJson, null, "\t"),
	);

	// create package.json with dynamic exports from entryPoints
	const exportsMap: Record<string, { types: string; import: string }> = {};
	for (const entry of entryPoints) {
		const key = entry === "mod" ? "." : `./${entry}`;
		exportsMap[key] = {
			types: `./dist/${entry}.d.ts`,
			import: `./dist/${entry}.js`,
		};
	}

	const mainEntry = entryPoints[0];
	const declaredDeps: Record<string, string> = Array.isArray(dependencies)
		? {}
		: { ...dependencies };

	const packageJson: Record<string, unknown> = deepMerge(
		{
			name,
			version,
			type: "module",
			main: `dist/${mainEntry}.js`,
			types: `dist/${mainEntry}.d.ts`,
			exports: exportsMap,
			files: ["dist", ...copiedRootFiles],
			author,
			license,
			dependencies: declaredDeps,
		},
		packageJsonOverrides,
	);

	if (repository) {
		packageJson.repository = {
			type: "git",
			url: `git+https://github.com/${repository}.git`,
		};
		packageJson.bugs = {
			url: `https://github.com/${repository}/issues`,
		};
	}

	await Deno.writeTextFile(
		join(outDir, "package.json"),
		JSON.stringify(packageJson, null, "\t"),
	);

	const runCommand = async (cmd: string, args: string[]): Promise<void> => {
		log(
			`%c--> Executing: %c${cmd} ${args.join(" ")}`,
			"color: gray",
			"color: green",
		);
		const result = await new Deno.Command(cmd, {
			args,
			cwd: outDir,
			stdout: quiet ? "piped" : "inherit",
			stderr: quiet ? "piped" : "inherit",
		}).output();
		if (!result.success) {
			const decoder = new TextDecoder();
			const tail = quiet
				? `\n${decoder.decode(result.stdout)}\n${decoder.decode(result.stderr)}`
				: "";
			throw new Error(
				`\`${cmd} ${args.join(" ")}\` failed (exit code ${result.code})${tail}`,
			);
		}
	};

	// install dependencies if any (string[] form only — Record<string,string> is declared, not installed)
	if (Array.isArray(dependencies) && dependencies.length > 0) {
		await runCommand("npm", ["install", ...dependencies]);
	}

	// install JSR dependencies if any
	if (jsrDependencies.length > 0) {
		await runCommand("npx", ["jsr", "add", ...jsrDependencies]);
	}

	// compile — prefer project-local tsc via npx, fall back to global / auto-install
	await runCommand("npx", ["tsc", "-p", "tsconfig.json"]);

	// pass non-TS assets (e.g. `.json`, `.css`, `.sql`) through to dist/ before
	// the src tree is deleted — tsc does not emit non-TS files and users may
	// import them from their TypeScript sources.
	for await (const entry of walk(outDirSrc, { includeDirs: false })) {
		if (
			entry.path.endsWith(".ts") ||
			entry.path.endsWith(".tsx") ||
			entry.path.endsWith(".mts") ||
			entry.path.endsWith(".cts")
		) continue;
		const rel = relative(outDirSrc, entry.path);
		const dest = join(outDirDist, rel);
		await ensureDir(dirname(dest));
		await copy(entry.path, dest, { overwrite: true });
	}

	// cleanup
	await Deno.remove(join(outDir, "tsconfig.json"));
	await Deno.remove(outDirSrc, { recursive: true });

	log("%cDone!", "color: green; font-weight: bold");

	return { outDir, entryPoints, packageJson };
}
