/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

const {
  createMockOnFn,
  createMockOnceFn,
  createMockSendCommandFn,
} = require('../../gather/mock-commands.js');

/**
 * @fileoverview Mock fraggle rock driver for testing.
 */

/** @typedef {import('../../../fraggle-rock/gather/driver.js')} Driver */
/** @typedef {import('../../../gather/driver/execution-context.js')} ExecutionContext */

function createMockSession() {
  return {
    sendCommand: createMockSendCommandFn({useSessionId: false}),
    setNextProtocolTimeout: jest.fn(),
    once: createMockOnceFn(),
    on: createMockOnFn(),
    off: jest.fn(),
    addProtocolMessageListener: createMockOnFn(),
    removeProtocolMessageListener: jest.fn(),

    /** @return {LH.Gatherer.FRProtocolSession} */
    asSession() {
      // @ts-expect-error - We'll rely on the tests passing to know this matches.
      return this;
    },
  };
}

/**
 * @param {LH.Gatherer.FRGathererInstance<LH.Gatherer.DependencyKey>['meta']} meta
 */
function createMockGathererInstance(meta) {
  return {
    meta,
    startInstrumentation: jest.fn(),
    stopInstrumentation: jest.fn(),
    startSensitiveInstrumentation: jest.fn(),
    stopSensitiveInstrumentation: jest.fn(),
    getArtifact: jest.fn(),

    /** @return {LH.Gatherer.FRGathererInstance} */
    asGatherer() {
      // @ts-expect-error - We'll rely on the tests passing to know this matches.
      return this;
    },
  };
}

function createMockPage() {
  return {
    url: jest.fn().mockReturnValue('https://example.com'),
    goto: jest.fn(),
    target: () => ({createCDPSession: () => createMockSession()}),

    /** @return {import('puppeteer').Page} */
    asPage() {
      // @ts-expect-error - We'll rely on the tests passing to know this matches.
      return this;
    },
  };
}

function createMockExecutionContext() {
  return {
    evaluate: jest.fn(),
    evaluateAsync: jest.fn(),
    evaluateOnNewDocument: jest.fn(),
    cacheNativesOnNewDocument: jest.fn(),

    /** @return {ExecutionContext} */
    asExecutionContext() {
      // @ts-expect-error - We'll rely on the tests passing to know this matches.
      return this;
    },
  };
}

function createMockDriver() {
  const page = createMockPage();
  const session = createMockSession();
  const context = createMockExecutionContext();

  return {
    _page: page,
    _executionContext: context,
    _session: session,
    url: () => page.url(),
    defaultSession: session,
    connect: jest.fn(),
    executionContext: context.asExecutionContext(),

    /** @return {Driver} */
    asDriver() {
      // @ts-expect-error - We'll rely on the tests passing to know this matches.
      return this;
    },
  };
}

/** @param {() => jest.Mock} runProvider */
function mockRunnerModule(runProvider) {
  const runnerModule = {getGathererList: () => []};
  Object.defineProperty(runnerModule, 'run', {
    get: runProvider,
  });
  return runnerModule;
}

/** @param {() => Driver} driverProvider */
function mockDriverModule(driverProvider) {
  // This must be a regular function becaues Driver is always invoked as a constructor.
  // Arrow functions cannot be invoked with `new`.
  return function() {
    return driverProvider();
  };
}

function mockDriverSubmodules() {
  const navigationMock = {gotoURL: jest.fn(),
  };
  const prepareMock = {
    prepareTargetForNavigationMode: jest.fn(),
    prepareTargetForIndividualNavigation: jest.fn(),
  };
  const storageMock = {clearDataForOrigin: jest.fn()};
  const emulationMock = {clearThrottling: jest.fn()};

  function reset() {
    navigationMock.gotoURL = jest.fn().mockResolvedValue({finalUrl: 'https://example.com', warnings: [], timedOut: false});
    prepareMock.prepareTargetForNavigationMode = jest.fn().mockResolvedValue({warnings: []});
    prepareMock.prepareTargetForIndividualNavigation = jest.fn().mockResolvedValue({warnings: []});
    storageMock.clearDataForOrigin = jest.fn();
    emulationMock.clearThrottling = jest.fn();
  }

  /**
   * @param {Record<string, (...args: any[]) => any>} target
   * @param {string} name
   */
  const get = (target, name) => {
    /** @param {any[]} args */
    return (...args) => target[name](...args);
  };
  jest.mock('../../../gather/driver/navigation.js', () => new Proxy(navigationMock, {get}));
  jest.mock('../../../gather/driver/prepare.js', () => new Proxy(prepareMock, {get}));
  jest.mock('../../../gather/driver/storage.js', () => new Proxy(storageMock, {get}));
  jest.mock('../../../lib/emulation.js', () => new Proxy(emulationMock, {get}));

  return {
    navigationMock,
    prepareMock,
    storageMock,
    emulationMock,
    reset,
  };
}

module.exports = {
  mockRunnerModule,
  mockDriverModule,
  mockDriverSubmodules,
  createMockDriver,
  createMockPage,
  createMockSession,
  createMockGathererInstance,
};
