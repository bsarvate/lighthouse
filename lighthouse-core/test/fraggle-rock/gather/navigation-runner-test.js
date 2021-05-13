/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

const {createMockDriver, mockDriverSubmodules} = require('./mock-driver.js');
const mocks = mockDriverSubmodules();
const runner = require('../../../fraggle-rock/gather/navigation-runner.js');
const {initializeConfig} = require('../../../fraggle-rock/config/config.js');
const {defaultNavigationConfig} = require('../../../config/constants.js');
const LighthouseError = require('../../../lib/lh-error.js');
const DevtoolsLogGatherer = require('../../../gather/gatherers/devtools-log.js');
const toDevtoolsLog = require('../../network-records-to-devtools-log.js');

/** @typedef {{meta: LH.Gatherer.GathererMeta<'Accessibility'>, getArtifact: jest.Mock<any, any>, startInstrumentation:jest.Mock<any, any>, stopInstrumentation: jest.Mock<any, any>, startSensitiveInstrumentation:jest.Mock<any, any>, stopSensitiveInstrumentation: jest.Mock<any, any>}} MockGatherer */

describe('NavigationRunner', () => {
  let requestedUrl = '';
  /** @type {ReturnType<typeof createMockDriver>} */
  let mockDriver;
  /** @type {import('../../../fraggle-rock/gather/driver.js')} */
  let driver;
  /** @type {LH.Config.FRConfig} */
  let config;
  /** @type {LH.Config.NavigationDefn} */
  let navigation;
  /** @type {Map<string, LH.ArbitraryEqualityMap>} */
  let computedCache;

  /** @return {LH.Config.FRGathererDefn} */
  function createGathererDefn() {
    return {
      instance: {
        name: 'Accessibility',
        meta: {supportedModes: []},
        startInstrumentation: jest.fn(),
        stopInstrumentation: jest.fn(),
        startSensitiveInstrumentation: jest.fn(),
        stopSensitiveInstrumentation: jest.fn(),
        getArtifact: jest.fn(),
      },
    };
  }

  /** @return {{navigation: LH.Config.NavigationDefn, gatherers: {timespan: MockGatherer, snapshot: MockGatherer, navigation: MockGatherer}}} */
  function createNavigation() {
    const timespanGatherer = createGathererDefn();
    timespanGatherer.instance.meta.supportedModes = ['timespan', 'navigation'];
    timespanGatherer.instance.getArtifact = jest.fn().mockResolvedValue({type: 'timespan'});
    const snapshotGatherer = createGathererDefn();
    snapshotGatherer.instance.meta.supportedModes = ['snapshot', 'navigation'];
    snapshotGatherer.instance.getArtifact = jest.fn().mockResolvedValue({type: 'snapshot'});
    const navigationGatherer = createGathererDefn();
    navigationGatherer.instance.meta.supportedModes = ['navigation'];
    navigationGatherer.instance.getArtifact = jest.fn().mockResolvedValue({type: 'navigation'});

    const navigation = {
      ...defaultNavigationConfig,
      artifacts: [
        {id: 'Timespan', gatherer: timespanGatherer},
        {id: 'Snapshot', gatherer: snapshotGatherer},
        {id: 'Navigation', gatherer: navigationGatherer},
      ],
    };

    return {
      navigation,
      gatherers: {
        timespan: /** @type {any} */ (timespanGatherer.instance),
        snapshot: /** @type {any} */ (snapshotGatherer.instance),
        navigation: /** @type {any} */ (navigationGatherer.instance),
      },
    };
  }

  beforeEach(() => {
    requestedUrl = 'http://example.com';
    config = initializeConfig(undefined, {gatherMode: 'navigation'}).config;
    navigation = createNavigation().navigation;
    computedCache = new Map();

    mockDriver = createMockDriver();
    driver = mockDriver.asDriver();

    mocks.reset();
  });

  describe('_setup', () => {
    beforeEach(() => {
      mockDriver._session.sendCommand.mockResponse('Browser.getVersion', {
        product: 'Chrome/88.0',
        userAgent: 'Chrome',
      });
    });

    it('should connect the driver', async () => {
      await runner._setup({driver, config, requestedUrl});
      expect(mockDriver.connect).toHaveBeenCalled();
    });

    it('should navigate to the blank page', async () => {
      await runner._setup({driver, config, requestedUrl});
      expect(mocks.navigationMock.gotoURL).toHaveBeenCalledTimes(1);
      expect(mocks.navigationMock.gotoURL).toHaveBeenCalledWith(
        expect.anything(),
        'about:blank',
        expect.anything()
      );
    });

    it('should collect base artifacts', async () => {
      const {baseArtifacts} = await runner._setup({driver, config, requestedUrl});
      expect(baseArtifacts).toMatchObject({HostUserAgent: 'Chrome', URL: {requestedUrl}});
    });

    it('should prepare the target for navigation', async () => {
      await runner._setup({driver, config, requestedUrl});
      expect(mocks.prepareMock.prepareTargetForNavigationMode).toHaveBeenCalledTimes(1);
    });

    it('should prepare the target for navigation *after* base artifact collection', async () => {
      mockDriver._session.sendCommand.mockReset();
      mockDriver._session.sendCommand.mockRejectedValue(new Error('Not available'));
      const setupPromise = runner._setup({driver, config, requestedUrl});
      await expect(setupPromise).rejects.toThrowError(/Not available/);
      expect(mocks.prepareMock.prepareTargetForNavigationMode).not.toHaveBeenCalled();
    });
  });

  describe('_navigations', () => {
    const run = () => runner._navigations({driver, config, requestedUrl, computedCache});

    it('should throw if no navigations available', async () => {
      config = {...config, navigations: null};
      await expect(run()).rejects.toBeTruthy();
    });

    it('should navigate as many times as there are navigations', async () => {
      config = initializeConfig(
        {
          ...config,
          navigations: [{id: 'default'}, {id: 'second'}, {id: 'third'}, {id: 'fourth'}],
        },
        {gatherMode: 'navigation'}
      ).config;

      await run();
      const navigations = mocks.navigationMock.gotoURL.mock.calls;
      const pageNavigations = navigations.filter(call => call[1] === requestedUrl);
      expect(pageNavigations).toHaveLength(4);
    });

    it('should merge artifacts between navigations', async () => {
      config = initializeConfig(
        {
          ...config,
          navigations: [
            {id: 'default', artifacts: ['FontSize']},
            {id: 'second', artifacts: ['ConsoleMessages']},
          ],
        },
        {gatherMode: 'navigation'}
      ).config;

      // Both gatherers will error in these test conditions, but artifact errors
      // will be merged into single `artifacts` object.
      const {artifacts} = await run();
      const artifactIds = Object.keys(artifacts);
      expect(artifactIds).toContain('FontSize');
      expect(artifactIds).toContain('ConsoleMessages');
    });
  });

  describe('_navigation', () => {
    /** @param {LH.Config.NavigationDefn} navigation */
    const run = navigation =>
      runner._navigation({driver, config, navigation, requestedUrl, computedCache});

    it('completes an end-to-end navigation', async () => {
      const {artifacts} = await run(navigation);
      const artifactIds = Object.keys(artifacts);
      expect(artifactIds).toContain('Timespan');
      expect(artifactIds).toContain('Snapshot');

      expect(mocks.navigationMock.gotoURL).toHaveBeenCalled();
    });

    it('collects timespan, snapshot, and navigation artifacts', async () => {
      const {artifacts} = await run(navigation);
      expect(artifacts).toEqual({
        Navigation: {type: 'navigation'},
        Timespan: {type: 'timespan'},
        Snapshot: {type: 'snapshot'},
      });
    });

    it('supports dependencies between phases', async () => {
      const {navigation, gatherers} = createNavigation();
      navigation.artifacts[1].dependencies = {Accessibility: {id: 'Timespan'}};
      navigation.artifacts[2].dependencies = {Accessibility: {id: 'Timespan'}};

      const {artifacts} = await run(navigation);
      expect(artifacts).toEqual({
        Navigation: {type: 'navigation'},
        Timespan: {type: 'timespan'},
        Snapshot: {type: 'snapshot'},
      });

      expect(gatherers.navigation.getArtifact).toHaveBeenCalled();
      const navigationArgs = gatherers.navigation.getArtifact.mock.calls[0];
      expect(navigationArgs[0].dependencies).toEqual({Accessibility: {type: 'timespan'}});

      expect(gatherers.snapshot.getArtifact).toHaveBeenCalled();
      const snapshotArgs = gatherers.snapshot.getArtifact.mock.calls[0];
      expect(snapshotArgs[0].dependencies).toEqual({Accessibility: {type: 'timespan'}});
    });

    it('passes through an error in dependencies', async () => {
      const {navigation} = createNavigation();
      const err = new Error('Error in dependency chain');
      navigation.artifacts[0].gatherer.instance.startInstrumentation = jest
        .fn()
        .mockRejectedValue(err);
      navigation.artifacts[1].dependencies = {Accessibility: {id: 'Timespan'}};
      navigation.artifacts[2].dependencies = {Accessibility: {id: 'Timespan'}};

      const {artifacts} = await run(navigation);

      expect(artifacts).toEqual({
        Navigation: expect.any(Error),
        Timespan: err,
        Snapshot: expect.any(Error),
      });
    });

    it('passes through an error in startSensitiveInstrumentation', async () => {
      const {navigation, gatherers} = createNavigation();
      const err = new Error('Error in startSensitiveInstrumentation');
      gatherers.navigation.startSensitiveInstrumentation.mockRejectedValue(err);

      const {artifacts} = await run(navigation);

      expect(artifacts).toEqual({
        Navigation: err,
        Timespan: {type: 'timespan'},
        Snapshot: {type: 'snapshot'},
      });
    });

    it('passes through an error in startInstrumentation', async () => {
      const {navigation, gatherers} = createNavigation();
      const err = new Error('Error in startInstrumentation');
      gatherers.timespan.startInstrumentation.mockRejectedValue(err);

      const {artifacts} = await run(navigation);

      expect(artifacts).toEqual({
        Navigation: {type: 'navigation'},
        Timespan: err,
        Snapshot: {type: 'snapshot'},
      });
    });

    it('returns navigate errors', async () => {
      const {navigation} = createNavigation();
      const noFcp = new LighthouseError(LighthouseError.errors.NO_FCP);

      mocks.navigationMock.gotoURL.mockImplementation(
        /** @param {*} context @param {string} url */
        (context, url) => {
          if (url.includes('blank')) return {finalUrl: 'about:blank', warnings: []};
          throw noFcp;
        }
      );

      const {artifacts, pageLoadError} = await run(navigation);
      expect(pageLoadError).toBe(noFcp);
      expect(artifacts).toEqual({});
    });

    it('finds page load errors in network records when available', async () => {
      const {navigation, gatherers} = createNavigation();
      mocks.navigationMock.gotoURL.mockResolvedValue({finalUrl: requestedUrl, warnings: []});
      const devtoolsLog = toDevtoolsLog([{url: requestedUrl, failed: true}]);
      gatherers.timespan.meta.symbol = DevtoolsLogGatherer.symbol;
      gatherers.timespan.getArtifact = jest.fn().mockResolvedValue(devtoolsLog);

      const {artifacts, pageLoadError} = await run(navigation);
      expect(pageLoadError).toBeInstanceOf(LighthouseError);
      expect(artifacts).toEqual({});
    });

    it('cleans up throttling before getArtifact', async () => {
      const {navigation, gatherers} = createNavigation();
      gatherers.navigation.getArtifact = jest.fn().mockImplementation(() => {
        expect(mocks.emulationMock.clearThrottling).toHaveBeenCalled();
      });

      await run(navigation);
      expect(mocks.emulationMock.clearThrottling).toHaveBeenCalledTimes(1);
    });
  });

  describe('_setupNavigation', () => {
    it('should setup the page on the blankPage', async () => {
      navigation.blankPage = 'data:text/html;...';
      await runner._setupNavigation({driver, navigation, requestedUrl, config, computedCache});
      expect(mocks.navigationMock.gotoURL).toHaveBeenCalledWith(
        expect.anything(),
        'data:text/html;...',
        expect.anything()
      );
    });

    it('should prepare target for navigation', async () => {
      await runner._setupNavigation({driver, navigation, requestedUrl, config, computedCache});
      expect(mocks.prepareMock.prepareTargetForIndividualNavigation).toHaveBeenCalled();
    });

    it('should return the warnings from preparation', async () => {
      const warnings = ['Warning A', 'Warning B'];
      mocks.prepareMock.prepareTargetForIndividualNavigation.mockResolvedValue({warnings});
      const result = await runner._setupNavigation({
        driver,
        navigation,
        requestedUrl,
        config,
        computedCache,
      });
      expect(result).toEqual({warnings});
    });
  });

  describe('_navigate', () => {
    const run = () => runner._navigate({driver, navigation, requestedUrl, config, computedCache});

    it('should navigate the page', async () => {
      await run();
      expect(mocks.navigationMock.gotoURL).toHaveBeenCalledWith(
        expect.anything(),
        requestedUrl,
        expect.anything()
      );
    });

    it('should return navigate results', async () => {
      const finalUrl = 'https://lighthouse.example.com/nested/page';
      const warnings = ['Warning A', 'Warning B'];
      mocks.navigationMock.gotoURL.mockResolvedValue({finalUrl, warnings});
      const result = await run();
      expect(result).toEqual({finalUrl, warnings, navigationError: undefined});
    });

    it('should catch navigation errors', async () => {
      const navigationError = new LighthouseError(LighthouseError.errors.PAGE_HUNG);
      mocks.navigationMock.gotoURL.mockRejectedValue(navigationError);
      const result = await run();
      expect(result).toEqual({finalUrl: requestedUrl, navigationError, warnings: []});
    });

    it('should throw regular errors', async () => {
      mocks.navigationMock.gotoURL.mockRejectedValue(new Error('Other fatal error'));
      await expect(run()).rejects.toThrowError('Other fatal error');
    });
  });
});
