export type { Person } from "./types.ts";
export { farewell, greet } from "./utils/greetings.ts";
export { add, multiply } from "./utils/math.ts";

export function hello(name: string): string {
	return `Hello, ${name}!`;
}
