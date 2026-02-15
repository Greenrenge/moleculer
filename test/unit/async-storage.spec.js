"use strict";

const { AsyncLocalStorage } = require("async_hooks");
const AsyncStorage = require("../../src/async-storage");

describe("Test 'AsyncStorage' class", () => {
	const broker = {};

	describe("Test constructor", () => {
		it("should set broker & asyncLocalStorage & store", () => {
			const storage = new AsyncStorage(broker);

			expect(storage.broker).toBe(broker);
			expect(storage.asyncLocalStorage).toBeInstanceOf(AsyncLocalStorage);
			expect(storage.store).toBeInstanceOf(Map);
			expect(storage.store.size).toEqual(0);
		});
	});

	describe("Test 'enable' function", () => {
		it("should not throw (no-op for backward compatibility)", () => {
			const storage = new AsyncStorage(broker);
			expect(() => storage.enable()).not.toThrow();
		});
	});

	describe("Test 'disable' function", () => {
		it("should call asyncLocalStorage.disable", () => {
			const storage = new AsyncStorage(broker);
			jest.spyOn(storage.asyncLocalStorage, "disable");
			storage.disable();
			expect(storage.asyncLocalStorage.disable).toBeCalledTimes(1);
		});
	});

	describe("Test 'stop' function", () => {
		it("should call asyncLocalStorage.disable and store.clear", () => {
			const storage = new AsyncStorage(broker);
			jest.spyOn(storage.asyncLocalStorage, "disable");
			jest.spyOn(storage.store, "clear");
			storage.stop();
			expect(storage.asyncLocalStorage.disable).toBeCalledTimes(1);
			expect(storage.store.clear).toBeCalledTimes(1);
		});
	});

	describe("Test 'getAsyncId' method", () => {
		it("should return 0 (AsyncLocalStorage does not expose async IDs)", () => {
			const storage = new AsyncStorage(broker);
			const res = storage.getAsyncId();
			expect(res).toBe(0);
		});
	});

	describe("Test 'setSessionData' method", () => {
		it("should call asyncLocalStorage.enterWith", () => {
			const storage = new AsyncStorage(broker);
			jest.spyOn(storage.asyncLocalStorage, "enterWith");
			storage.setSessionData("dataMock");
			expect(storage.asyncLocalStorage.enterWith).toBeCalledTimes(1);
			expect(storage.asyncLocalStorage.enterWith).toBeCalledWith("dataMock");
		});
	});

	describe("Test 'getSessionData' method", () => {
		it("should return data set by setSessionData", () => {
			const storage = new AsyncStorage(broker);
			const context = { a: 5 };
			storage.setSessionData(context);
			const result = storage.getSessionData();
			expect(result).toBe(context);
		});

		it("should return null when no data has been set", () => {
			const storage = new AsyncStorage(broker);
			const res = storage.getSessionData();
			expect(res).toBeNull();
		});
	});

	describe("Test '_init' function (no-op)", () => {
		it("should not throw", () => {
			const storage = new AsyncStorage(broker);
			expect(() => storage._init("asyncId", "NOT_TIMERWRAP", "triggerAsyncId")).not.toThrow();
		});
	});

	describe("Test '_destroy' function (no-op)", () => {
		it("should not throw", () => {
			const storage = new AsyncStorage(broker);
			expect(() => storage._destroy("asyncId")).not.toThrow();
		});
	});

	describe("Test async context propagation", () => {
		it("should propagate context through async operations", async () => {
			const storage = new AsyncStorage(broker);
			const context = { requestId: "test-123" };

			await new Promise(resolve => {
				storage.setSessionData(context);
				setTimeout(() => {
					const result = storage.getSessionData();
					expect(result).toBe(context);
					resolve();
				}, 10);
			});
		});

		it("should propagate context through promise chains", async () => {
			const storage = new AsyncStorage(broker);
			const context = { requestId: "promise-456" };

			storage.setSessionData(context);

			const result = await Promise.resolve().then(() => {
				return storage.getSessionData();
			});

			expect(result).toBe(context);
		});
	});
});
