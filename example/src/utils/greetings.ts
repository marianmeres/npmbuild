import type { Person } from "../types.ts";

export function greet(person: Person): string {
	return `Hello, ${person.name}! You are ${person.age} years old.`;
}

export function farewell(name: string): string {
	return `Goodbye, ${name}!`;
}
