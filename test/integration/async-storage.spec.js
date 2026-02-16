const AsyncStorage = require("../../src/async-storage");

describe("Test Async Storage class", () => {
	it("should set broker & create store", () => {
		const broker = {};
		const storage = new AsyncStorage(broker);

		expect(storage.broker).toBe(broker);
		expect(storage.store).toBeInstanceOf(Map);
	});

	it("should store context for async thread", () => {
		const broker = {};
		const storage = new AsyncStorage(broker);

		const context = { a: 5 };

		// Set session data before starting the promise chain.
		// With AsyncLocalStorage, enterWith() propagates through async
		// operations created after it's called.
		storage.setSessionData(context);
		return Promise.resolve()
			.then(() => {
				expect(storage.getSessionData()).toBe(context);
			})
			.then(() => {
				expect(storage.getSessionData()).toBe(context);
			});
	});

	it("should store context using run pattern", () => {
		const broker = {};
		const storage = new AsyncStorage(broker);

		const context = { b: 10 };

		return storage.run(context, () => {
			return Promise.resolve()
				.then(() => {
					expect(storage.getSessionData()).toBe(context);
				})
				.then(() => {
					expect(storage.getSessionData()).toBe(context);
				});
		});
	});
});
