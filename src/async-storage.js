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
		// AsyncLocalStorage is always active; no-op for backward compatibility.
	}

	disable() {
		this.asyncLocalStorage.disable();
	}

	stop() {
		this.asyncLocalStorage.disable();
		this.store.clear();
	}

	getAsyncId() {
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
