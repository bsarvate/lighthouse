/**
 * @license Copyright 2018 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

const fs = require('fs');
const i18n = require('../lib/i18n/i18n.js');
const mockCommands = require('./gather/mock-commands.js');
const {default: {toBeCloseTo}} = require('expect/build/matchers.js');

expect.extend({
  toBeDisplayString(received, expected) {
    const actual = i18n.getFormatted(received, 'en-US');
    const pass = expected instanceof RegExp ?
      expected.test(actual) :
      actual === expected;

    const message = () =>
      [
        `${this.utils.matcherHint('.toBeDisplayString')}\n`,
        `Expected object to be a display string matching:`,
        `  ${this.utils.printExpected(expected)}`,
        `Received:`,
        `  ${this.utils.printReceived(actual)}`,
      ].join('\n');

    return {actual, message, pass};
  },

  // Expose toBeCloseTo() so it can be used as an asymmetric matcher.
  toBeApproximately(...args) {
    // If called asymmetrically, a fake matcher `this` object needs to be passed
    // in (see https://github.com/facebook/jest/issues/8295). There's no effect
    // because it's only used for the printing of full failures, which isn't
    // done for asymmetric matchers anyways.
    const thisObj = (this && this.utils) ? this :
        {isNot: false, promise: ''};
    // @ts-expect-error
    return toBeCloseTo.call(thisObj, ...args);
  },
  /**
    * Asserts that an inspectable promise created by makePromiseInspectable is currently resolved or rejected.
    * This is useful for situations where we want to test that we are actually waiting for a particular event.
    *
    * @param {ReturnType<typeof makePromiseInspectable>} received
    * @param {string} failureMessage
    */
  toBeDone(received, failureMessage) {
    const pass = received.isDone();

    const message = () =>
      [
        `${this.utils.matcherHint('.toBeDone')}\n`,
        `Expected promise to be resolved: ${this.utils.printExpected(failureMessage)}`,
        `  ${this.utils.printReceived(received.getDebugValues())}`,
      ].join('\n');

    return {message, pass};
  },
});

/**
 * Some tests use the result of a LHR processed by our proto serialization.
 * Proto is an annoying dependency to setup, so we allows tests that use it
 * to be skipped when run locally. This makes external contributions simpler.
 *
 * Along with the sample LHR, this function returns jest `it` and `describe`
 * functions that will skip if the sample LHR could not be loaded.
 */
function getProtoRoundTrip() {
  let sampleResultsRoundtripStr;
  let describeIfProtoExists;
  let itIfProtoExists;
  try {
    sampleResultsRoundtripStr =
      fs.readFileSync(__dirname + '/../../.tmp/sample_v2_round_trip.json', 'utf-8');
    describeIfProtoExists = describe;
    itIfProtoExists = it;
  } catch (err) {
    if (process.env.GITHUB_ACTIONS) {
      throw new Error('sample_v2_round_trip must be generated for CI proto test');
    }
    // Otherwise no proto roundtrip for tests, so skip them.
    // This is fine for running the tests locally.

    itIfProtoExists = it.skip;
    describeIfProtoExists = describe.skip;
  }

  return {
    itIfProtoExists,
    describeIfProtoExists,
    sampleResultsRoundtripStr,
  };
}

/**
 * @param {string} name
 * @return {{map: LH.Artifacts.RawSourceMap, content: string}}
 */
function loadSourceMapFixture(name) {
  const dir = `${__dirname}/fixtures/source-maps`;
  const mapJson = fs.readFileSync(`${dir}/${name}.js.map`, 'utf-8');
  const content = fs.readFileSync(`${dir}/${name}.js`, 'utf-8');
  return {
    map: JSON.parse(mapJson),
    content,
  };
}

/**
 * @param {string} name
 * @return {{map: LH.Artifacts.RawSourceMap, content: string, usage: LH.Crdp.Profiler.ScriptCoverage}}
 */
function loadSourceMapAndUsageFixture(name) {
  const dir = `${__dirname}/fixtures/source-maps`;
  const usagePath = `${dir}/${name}.usage.json`;
  const usageJson = fs.readFileSync(usagePath, 'utf-8');

  // Usage is exported from DevTools, which simplifies the real format of the
  // usage protocol.
  /** @type {{url: string, ranges: Array<{start: number, end: number, count: number}>}} */
  const exportedUsage = JSON.parse(usageJson);
  const usage = {
    scriptId: 'FakeId', // Not used.
    url: exportedUsage.url,
    functions: [
      {
        functionName: 'FakeFunctionName', // Not used.
        isBlockCoverage: false, // Not used.
        ranges: exportedUsage.ranges.map((range, i) => {
          return {
            startOffset: range.start,
            endOffset: range.end,
            count: i % 2 === 0 ? 0 : 1,
          };
        }),
      },
    ],
  };

  return {
    ...loadSourceMapFixture(name),
    usage,
  };
}

/**
 * @template {unknown[]} TParams
 * @template TReturn
 * @param {(...args: TParams) => TReturn} fn
 */
function makeParamsOptional(fn) {
  return /** @type {(...args: RecursivePartial<TParams>) => TReturn} */ (fn);
}

/**
 * Transparently augments the promise with inspectable functions to query its state.
 *
 * @template T
 * @param {Promise<T>} promise
 */
function makePromiseInspectable(promise) {
  let isResolved = false;
  let isRejected = false;
  /** @type {T=} */
  let resolvedValue = undefined;
  /** @type {any=} */
  let rejectionError = undefined;
  const inspectablePromise = promise.then(value => {
    isResolved = true;
    resolvedValue = value;
    return value;
  }).catch(err => {
    isRejected = true;
    rejectionError = err;
    throw err;
  });

  return Object.assign(inspectablePromise, {
    isDone() {
      return isResolved || isRejected;
    },
    isResolved() {
      return isResolved;
    },
    isRejected() {
      return isRejected;
    },
    getDebugValues() {
      return {resolvedValue, rejectionError};
    },
  });
}
function createDecomposedPromise() {
  /** @type {Function} */
  let resolve;
  /** @type {Function} */
  let reject;
  const promise = new Promise((r1, r2) => {
    resolve = r1;
    reject = r2;
  });
  // @ts-expect-error: Ignore 'unused' error.
  return {promise, resolve, reject};
}

/**
 * In some functions we have lots of promise follow ups that get queued by protocol messages.
 * This is a convenience method to easily advance all timers and flush all the queued microtasks.
 */
async function flushAllTimersAndMicrotasks(ms = 1000) {
  for (let i = 0; i < ms; i++) {
    jest.advanceTimersByTime(1);
    await Promise.resolve();
  }
}

/**
 * Mocks gatherers for BaseArtifacts that tests for components using GatherRunner
 * shouldn't concern themselves about.
 */
function makeMocksForGatherRunner() {
  jest.mock('../gather/driver/environment.js', () => ({
    getBenchmarkIndex: () => Promise.resolve(150),
    getBrowserVersion: async () => ({userAgent: 'Chrome', milestone: 80}),
    getEnvironmentWarnings: () => [],
  }));
  jest.mock('../gather/gatherers/stacks.js', () => ({collectStacks: () => Promise.resolve([])}));
  jest.mock('../gather/gatherers/installability-errors.js', () => ({
    getInstallabilityErrors: async () => ({errors: []}),
  }));
  jest.mock('../gather/gatherers/web-app-manifest.js', () => ({
    getWebAppManifest: async () => null,
  }));
  jest.mock('../lib/emulation.js', () => ({
    emulate: jest.fn(),
    throttle: jest.fn(),
    clearThrottling: jest.fn(),
  }));
  jest.mock('../gather/driver/prepare.js', () => ({
    prepareTargetForNavigationMode: jest.fn(),
    prepareTargetForIndividualNavigation: jest.fn().mockResolvedValue({warnings: []}),
  }));
  jest.mock('../gather/driver/storage.js', () => ({
    clearDataForOrigin: jest.fn(),
    cleanBrowserCaches: jest.fn(),
    getImportantStorageWarning: jest.fn(),
  }));
  jest.mock('../gather/driver/navigation.js', () => ({
    gotoURL: jest.fn().mockResolvedValue({
      finalUrl: 'http://example.com',
      warnings: [],
    }),
  }));
}

module.exports = {
  getProtoRoundTrip,
  loadSourceMapFixture,
  loadSourceMapAndUsageFixture,
  makeParamsOptional,
  makePromiseInspectable,
  createDecomposedPromise,
  flushAllTimersAndMicrotasks,
  makeMocksForGatherRunner,
  ...mockCommands,
};
