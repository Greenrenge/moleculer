import ServiceBroker = require("./service-broker");
import { AsyncLocalStorage } from "async_hooks";

declare class AsyncStorage {
	broker: ServiceBroker;
	asyncLocalStorage: AsyncLocalStorage<any>;
	store: Map<string, any>;

	constructor(broker: ServiceBroker);

	enable(): void;
	disable(): void;
	stop(): void;
	getAsyncId(): number;
	setSessionData(data: any): void;
	getSessionData(): any | null;
	run<R>(data: any, fn: () => R): R;
}
export = AsyncStorage;
