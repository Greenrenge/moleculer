/*
 * moleculer
 * Copyright (c) 2019 MoleculerJS (https://github.com/moleculerjs/moleculer)
 * MIT Licensed
 */

"use strict";

const { AsyncLocalStorage } = require("async_hooks");

class AsyncStorage {
	constructor(broker) {
		this.broker = broker;

		this.asyncLocalStorage = new AsyncLocalStorage();
		this.store = new Map();
	}

	enable() {
		// AsyncLocalStorage does not need explicit enabling.
		// Once created, it is ready for use with enterWith()/run()/getStore().
		// Call disable() to clear the store and stop context propagation.
	}

	disable() {
		this.asyncLocalStorage.disable();
	}

	stop() {
		this.asyncLocalStorage.disable();
		this.store.clear();
	}

	getAsyncId() {
		// AsyncLocalStorage does not expose async IDs.
		// Returns 0 for backward compatibility.
		return 0;
	}

	setSessionData(data) {
		this.asyncLocalStorage.enterWith(data);
	}

	getSessionData() {
		return this.asyncLocalStorage.getStore() || null;
	}

	/**
	 * Run a function within the context of the given data.
	 * The data will be available via `getSessionData()` within the
	 * callback and all async operations it initiates.
	 *
	 * @param {any} data
	 * @param {Function} fn
	 * @returns {any} The return value of `fn`
	 */
	run(data, fn) {
		return this.asyncLocalStorage.run(data, fn);
	}

	// Kept for backward compatibility; no-ops with AsyncLocalStorage
	// as context propagation is handled automatically.
	_init() {}
	_destroy() {}
}

module.exports = AsyncStorage;
