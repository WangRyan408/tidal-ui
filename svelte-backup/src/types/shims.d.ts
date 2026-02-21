declare module 'svelte/store' {
	type Unsubscriber = () => void;
	type Subscriber<T> = (value: T) => void;

	interface Readable<T> {
		subscribe(run: Subscriber<T>): Unsubscriber;
	}

	interface Writable<T> extends Readable<T> {
		set(value: T): void;
		update(updater: (value: T) => T): void;
	}

	export function writable<T>(value: T): Writable<T>;
	export function derived<S, T>(stores: Readable<S>, fn: (value: S) => T): Readable<T>;
	export function derived<T>(stores: any, fn: (value: any) => T): Readable<T>;
	export function get<T>(store: Readable<T>): T;
}

declare module '$app/environment' {
	export const browser: boolean;
}

declare module '$lib/*';
declare module '$env/*';
