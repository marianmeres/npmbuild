import { deepMerge } from "@std/collections/deep-merge";
import { emptyDir, walkSync } from "@std/fs";
import { join } from "@std/path";

function copyRecursive(src: string, dest: string): void {
	const stat = Deno.statSync(src);
	if (stat.isDirectory) {
		Deno.mkdirSync(dest, { recursive: true });
		for (const entry of Deno.readDirSync(src)) {
			copyRecursive(join(src, entry.name), join(dest, entry.name));
		}
	} else {
		Deno.copyFileSync(src, dest);
	}
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
	/** Source files to copy (default: all files from srcDir) */
	sourceFiles?: string[];
	/** Root files or directories to copy to package (default: ["LICENSE", "README.md", "API.md", "AGENTS.md", "docs"]) */
	rootFiles?: string[];
	/** npm dependencies to install (default: none) */
	dependencies?: string[];
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
}

/**
 * Builds an npm package from Deno TypeScript source.
 *
 * - Copies source files and rewrites .ts imports to .js
 * - Generates tsconfig.json and package.json
 * - Runs tsc to compile
 * - Cleans up intermediate files
 */
export async function npmBuild(options: NpmBuildOptions): Promise<void> {
	const {
		srcDir = "src",
		outDir = ".npm-dist",
		name,
		version,
		author = "Marian Meres",
		license = "MIT",
		repository,
		sourceFiles,
		rootFiles = ["LICENSE", "README.md", "API.md", "AGENTS.md", "docs"],
		dependencies = [],
		jsrDependencies = [],
		tsconfig: tsconfigOverrides = {},
		entryPoints = ["mod"],
		packageJsonOverrides = {},
	} = options;

	const outDirSrc = join(outDir, "src");

	console.log(
		`%cBuilding npm package: %c${name}@${version}`,
		"color: gray",
		"color: cyan; font-weight: bold"
	);
	console.log(
		"%c{ srcDir: %c%s%c, outDir: %c%s%c }",
		"color: gray",
		"color: yellow",
		srcDir,
		"color: gray",
		"color: yellow",
		outDir,
		"color: gray"
	);

	await emptyDir(outDir);

	// copy source files (all files from srcDir by default, or explicit list if provided)
	if (sourceFiles) {
		for (const file of sourceFiles) {
			console.log("%c    --> %s", "color: gray", file);
			Deno.copyFileSync(join(srcDir, file), join(outDirSrc, file));
		}
	} else {
		for (const entry of walkSync(srcDir)) {
			if (entry.isFile) {
				const relativePath = entry.path.slice(srcDir.length + 1);
				console.log(
					"%c    --> %c%s",
					"color: gray",
					"color: green",
					relativePath
				);
				const destPath = join(outDirSrc, relativePath);
				const destDir = destPath.slice(0, destPath.lastIndexOf("/"));
				Deno.mkdirSync(destDir, { recursive: true });
				Deno.copyFileSync(entry.path, destPath);
			}
		}
	}

	// copy root files and directories (skip missing)
	for (const asset of rootFiles) {
		try {
			copyRecursive(asset, join(outDir, asset));
		} catch (e) {
			if (e instanceof Deno.errors.NotFound) {
				console.warn(
					"%c    --> %c%s%c not found, skipping",
					"color: orange",
					"color: yellow",
					asset,
					"color: orange"
				);
			} else {
				throw e;
			}
		}
	}

	// rewrite .ts imports to .js (tsc requires this)
	const TS_TO_JS_REGEX =
		/from\s+(['"])([^'"]+)\.ts(['"]);?|import\s*\(\s*(['"])([^'"]+)\.ts(['"]),?\s*\)/g;

	for (const f of walkSync(outDirSrc)) {
		if (f.isFile && f.path.endsWith(".ts")) {
			const contents = Deno.readTextFileSync(f.path);
			const replaced = contents.replace(
				TS_TO_JS_REGEX,
				(_match, q1, path1, q3, q4, path2, q6) => {
					if (path1) {
						return `from ${q1}${path1}.js${q3}`;
					} else {
						return `import(${q4}${path2}.js${q6})`;
					}
				}
			);
			Deno.writeTextFileSync(f.path, replaced);
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
		tsconfigOverrides
	);
	Deno.writeTextFileSync(
		join(outDir, "tsconfig.json"),
		JSON.stringify(tsconfigJson, null, "\t")
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
	const packageJson: Record<string, unknown> = deepMerge(
		{
			name,
			version,
			type: "module",
			main: `dist/${mainEntry}.js`,
			types: `dist/${mainEntry}.d.ts`,
			exports: exportsMap,
			author,
			license,
			dependencies: {},
		},
		packageJsonOverrides
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

	Deno.writeTextFileSync(
		join(outDir, "package.json"),
		JSON.stringify(packageJson, null, "\t")
	);

	// compile
	const cwd = Deno.cwd();
	Deno.chdir(outDir);
	try {
		// install dependencies if any
		if (dependencies.length > 0) {
			console.log(
				"%c--> Executing: %cnpm install %s",
				"color: gray",
				"color: green",
				dependencies.join(" ")
			);
			const npmResult = new Deno.Command("npm", {
				args: ["install", ...dependencies],
			}).outputSync();
			if (npmResult.code) {
				const decoder = new TextDecoder();
				const stdout = decoder.decode(npmResult.stdout);
				const stderr = decoder.decode(npmResult.stderr);
				throw new Error(
					`npm install failed (exit code ${npmResult.code}):\n${stdout}\n${stderr}`
				);
			}
		}

		// install JSR dependencies if any
		if (jsrDependencies.length > 0) {
			console.log(
				"%c--> Executing: %cnpx jsr add %s",
				"color: gray",
				"color: green",
				jsrDependencies.join(" ")
			);
			const jsrResult = new Deno.Command("npx", {
				args: ["jsr", "add", ...jsrDependencies],
			}).outputSync();
			if (jsrResult.code) {
				const decoder = new TextDecoder();
				const stdout = decoder.decode(jsrResult.stdout);
				const stderr = decoder.decode(jsrResult.stderr);
				throw new Error(
					`npx jsr add failed (exit code ${jsrResult.code}):\n${stdout}\n${stderr}`
				);
			}
		}

		console.log("%c--> Executing: %ctsc", "color: gray", "color: green");
		const tscResult = new Deno.Command("tsc", {
			args: ["-p", "tsconfig.json"],
		}).outputSync();
		if (tscResult.code) {
			const decoder = new TextDecoder();
			const stdout = decoder.decode(tscResult.stdout);
			const stderr = decoder.decode(tscResult.stderr);
			throw new Error(
				`tsc failed (exit code ${tscResult.code}):\n${stdout}\n${stderr}`
			);
		}
	} finally {
		Deno.chdir(cwd);
	}

	// cleanup
	Deno.removeSync(join(outDir, "tsconfig.json"));
	Deno.removeSync(join(outDir, "src"), { recursive: true });

	console.log("%cDone!", "color: green; font-weight: bold");
}
