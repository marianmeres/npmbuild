import { emptyDir, walkSync } from "@std/fs";
import { join } from "@std/path";

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
	/** Root files to copy to package (default: ["LICENSE", "README.md"]) */
	rootFiles?: string[];
	/** npm dependencies to install (default: none) */
	dependencies?: string[];
	/** Additional tsconfig compilerOptions overrides */
	tsconfig?: Record<string, unknown>;
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
		rootFiles = ["LICENSE", "README.md", "llm.txt", "CLAUDE.md", "API.md"],
		dependencies = [],
		tsconfig: tsconfigOverrides = {},
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

	// copy root files (skip missing)
	for (const file of rootFiles) {
		try {
			Deno.copyFileSync(file, join(outDir, file));
		} catch (e) {
			if (e instanceof Deno.errors.NotFound) {
				console.warn(
					"%c    --> %c%s%c not found, skipping",
					"color: orange",
					"color: yellow",
					file,
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
	const tsconfigJson = {
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
			...tsconfigOverrides,
		},
	};
	Deno.writeTextFileSync(
		join(outDir, "tsconfig.json"),
		JSON.stringify(tsconfigJson, null, "\t")
	);

	// create package.json
	const packageJson: Record<string, unknown> = {
		name,
		version,
		type: "module",
		main: "dist/mod.js",
		types: "dist/mod.d.ts",
		author,
		license,
		dependencies: {},
	};

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
