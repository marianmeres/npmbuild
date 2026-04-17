import { assertEquals } from "@std/assert";
import { rewriteTsImports } from "./npm-build.ts";

Deno.test("rewriteTsImports: static named import", () => {
	assertEquals(
		rewriteTsImports(`import { foo } from "./foo.ts";`),
		`import { foo } from "./foo.js";`,
	);
});

Deno.test("rewriteTsImports: static default import", () => {
	assertEquals(
		rewriteTsImports(`import foo from "./foo.ts";`),
		`import foo from "./foo.js";`,
	);
});

Deno.test("rewriteTsImports: namespace import", () => {
	assertEquals(
		rewriteTsImports(`import * as foo from "./foo.ts";`),
		`import * as foo from "./foo.js";`,
	);
});

Deno.test("rewriteTsImports: type-only import", () => {
	assertEquals(
		rewriteTsImports(`import type { Foo } from "./types.ts";`),
		`import type { Foo } from "./types.js";`,
	);
});

Deno.test("rewriteTsImports: side-effect import — the bug fix", () => {
	assertEquals(
		rewriteTsImports(`import "./polyfills.ts";`),
		`import "./polyfills.js";`,
	);
});

Deno.test("rewriteTsImports: side-effect import without semicolon", () => {
	assertEquals(
		rewriteTsImports(`import "./polyfills.ts"\n`),
		`import "./polyfills.js"\n`,
	);
});

Deno.test("rewriteTsImports: dynamic import", () => {
	assertEquals(
		rewriteTsImports(`await import("./module.ts");`),
		`await import("./module.js");`,
	);
});

Deno.test("rewriteTsImports: dynamic import with surrounding whitespace preserved", () => {
	assertEquals(
		rewriteTsImports(`await import(  "./module.ts"  );`),
		`await import(  "./module.js"  );`,
	);
});

Deno.test("rewriteTsImports: export named from", () => {
	assertEquals(
		rewriteTsImports(`export { foo } from "./bar.ts";`),
		`export { foo } from "./bar.js";`,
	);
});

Deno.test("rewriteTsImports: export star from", () => {
	assertEquals(
		rewriteTsImports(`export * from "./bar.ts";`),
		`export * from "./bar.js";`,
	);
});

Deno.test("rewriteTsImports: single quotes preserved", () => {
	assertEquals(
		rewriteTsImports(`import { foo } from './foo.ts';`),
		`import { foo } from './foo.js';`,
	);
});

Deno.test("rewriteTsImports: does not touch non-ts specifiers", () => {
	const src = `import { foo } from "./foo.js";\nimport "./style.css";\n`;
	assertEquals(rewriteTsImports(src), src);
});

Deno.test("rewriteTsImports: rewrites multiple imports in one file", () => {
	const input = [
		`import { a } from "./a.ts";`,
		`import "./side.ts";`,
		`export { b } from "./b.ts";`,
		`const mod = await import("./c.ts");`,
	].join("\n");
	const expected = [
		`import { a } from "./a.js";`,
		`import "./side.js";`,
		`export { b } from "./b.js";`,
		`const mod = await import("./c.js");`,
	].join("\n");
	assertEquals(rewriteTsImports(input), expected);
});

Deno.test("rewriteTsImports: nested relative paths preserved", () => {
	assertEquals(
		rewriteTsImports(`import { x } from "../../deep/nested/file.ts";`),
		`import { x } from "../../deep/nested/file.js";`,
	);
});
