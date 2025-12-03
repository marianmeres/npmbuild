export { greet, farewell } from "./utils/greetings.ts";
export { add, multiply } from "./utils/math.ts";
export type { Person } from "./types.ts";

export function hello(name: string): string {
	return `Hello, ${name}!`;
}
