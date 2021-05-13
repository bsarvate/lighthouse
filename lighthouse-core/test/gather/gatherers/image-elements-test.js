/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

const ImageElements = require('../../../gather/gatherers/image-elements.js');
const NetworkRecorder = require('../../../lib/network-recorder.js');
const NetworkRequest = require('../../../lib/network-request.js');
const {createMockContext, createMockDriver} = require('../../fraggle-rock/gather/mock-driver.js');

const devtoolsLog = /** @type {LH.DevtoolsLog} */ (require('../../fixtures/traces/lcp-m78.devtools.log.json')); // eslint-disable-line max-len
const networkRecords = NetworkRecorder.recordsFromLogs(devtoolsLog);

jest.useFakeTimers();

/**
 * @param {Partial<LH.Artifacts.NetworkRequest>=} partial
 * @return {LH.Artifacts.NetworkRequest}
 */
function mockRequest(partial = {}) {
  const request = new NetworkRequest();
  return Object.assign(request, partial);
}

/** @type {LH.Artifacts.ImageElement} */
const mockEl = {
  src: 'https://www.paulirish.com/avatar150.jpg',
  srcset: '',
  displayedWidth: 200,
  displayedHeight: 200,
  clientRect: {
    top: 50,
    bottom: 250,
    left: 50,
    right: 250,
  },
  attributeWidth: '',
  attributeHeight: '',
  cssWidth: undefined,
  cssHeight: undefined,
  _privateCssSizing: undefined,
  cssComputedPosition: 'absolute',
  isCss: false,
  isPicture: false,
  isInShadowDOM: false,
  cssComputedObjectFit: '',
  cssComputedImageRendering: '',
  node: {
    lhId: '__nodeid__',
    devtoolsNodePath: '1,HTML,1,BODY,1,DIV,1,IMG',
    selector: 'body > img',
    nodeLabel: 'img',
    snippet: '<img src="https://www.paulirish.com/avatar150.jpg">',
    boundingRect: {
      top: 50,
      bottom: 250,
      left: 50,
      right: 250,
      width: 200,
      height: 200,
    },
  },
};

function mockImageElements() {
  const gatherer = new ImageElements();
  jest.spyOn(gatherer, '_getArtifact');
  jest.spyOn(gatherer, 'collectExtraDetails');
  jest.spyOn(gatherer, 'indexNetworkRecords');
  jest.spyOn(gatherer, 'fetchSourceRules');
  jest.spyOn(gatherer, 'fetchElementWithSizeInformation');
  return gatherer;
}

describe('.indexNetworkRecords', () => {
  it('maps image urls to network records', () => {
    const gatherer = mockImageElements();
    const networkRecords = [
      mockRequest({
        mimeType: 'image/png',
        url: 'https://example.com/img.png',
        finished: true,
        statusCode: 200,
      }),
      mockRequest({
        mimeType: 'application/octect-stream',
        url: 'https://example.com/img.webp',
        finished: true,
        statusCode: 200,
      }),
      mockRequest({
        mimeType: 'application/octect-stream',
        url: 'https://example.com/img.avif',
        finished: true,
        statusCode: 200,
      }),
    ];

    const index = gatherer.indexNetworkRecords(networkRecords);

    expect(index).toMatchObject({
      'https://example.com/img.avif': {
        finished: true,
        mimeType: 'application/octect-stream',
        statusCode: 200,
        url: 'https://example.com/img.avif',
      },
      'https://example.com/img.png': {
        finished: true,
        mimeType: 'image/png',
        statusCode: 200,
        url: 'https://example.com/img.png',
      },
      'https://example.com/img.webp': {
        finished: true,
        mimeType: 'application/octect-stream',
        statusCode: 200,
        url: 'https://example.com/img.webp',
      },
    });
  });

  it('ignores bad status codes', () => {
    const gatherer = mockImageElements();
    const networkRecords = [
      mockRequest({
        mimeType: 'image/png',
        url: 'https://example.com/img.png',
        finished: true,
        statusCode: 200,
      }),
      mockRequest({
        mimeType: 'application/octect-stream',
        url: 'https://example.com/img.webp',
        finished: false,
      }),
      mockRequest({
        mimeType: 'application/octect-stream',
        url: 'https://example.com/img.avif',
        finished: true,
        statusCode: 404,
      }),
    ];

    const index = gatherer.indexNetworkRecords(networkRecords);

    expect(index).toMatchObject({
      'https://example.com/img.png': {
        finished: true,
        mimeType: 'image/png',
        statusCode: 200,
        url: 'https://example.com/img.png',
      },
    });
  });
});

describe('.collectExtraDetails', () => {
  let gatherer = mockImageElements();
  let driver = createMockDriver().asDriver();

  beforeEach(() => {
    driver = createMockDriver().asDriver();
    gatherer = mockImageElements();
    gatherer.fetchSourceRules = jest.fn();
    gatherer.fetchElementWithSizeInformation = jest.fn();
  });

  it('respects the overall time budget for source rules', async () => {
    const elements = [
      {...mockEl, isInShadowDOM: false, isCss: false},
      {...mockEl, isInShadowDOM: false, isCss: false},
      {...mockEl, isInShadowDOM: false, isCss: false},
    ];
    gatherer.fetchSourceRules = jest.fn().mockImplementation(async () => {
      jest.advanceTimersByTime(6000);
    });

    await gatherer.collectExtraDetails(driver, elements, {});

    expect(gatherer.fetchSourceRules).toHaveBeenCalledTimes(1);
  });

  it('fetch source rules to determine sizing for non-shadow DOM/non-CSS images', async () => {
    const elements = [
      {...mockEl, isInShadowDOM: false, isCss: false},
      {...mockEl, isInShadowDOM: true, isCss: false},
      {...mockEl, isInShadowDOM: false, isCss: true},
    ];

    await gatherer.collectExtraDetails(driver, elements, {});

    expect(gatherer.fetchSourceRules).toHaveBeenCalledTimes(1);
  });

  it('fetch multiple source rules to determine sizing for non-shadow DOM/non-CSS images', async () => {
    const elements = [
      {...mockEl, isInShadowDOM: false, isCss: false},
      {...mockEl, isInShadowDOM: false, isCss: false},
    ];

    await gatherer.collectExtraDetails(driver, elements, {});

    expect(gatherer.fetchSourceRules).toHaveBeenCalledTimes(2);
  });

  it('fetch size information for image with picture', async () => {
    const elements = [
      {...mockEl, src: 'https://example.com/a.png', isPicture: false, isCss: true, srcset: 'src'},
      {...mockEl, src: 'https://example.com/b.png', isPicture: true, isCss: false, srcset: 'src'},
      {...mockEl, src: 'https://example.com/c.png', isPicture: false, isCss: true},
      {...mockEl, src: 'https://example.com/d.png', isPicture: false, isCss: false},
      {...mockEl, src: 'https://example.com/e.png', isPicture: false, isCss: true, srcset: 'src'},
    ];
    const indexedNetworkRecords = {
      'https://example.com/a.png': mockRequest(),
      'https://example.com/b.png': mockRequest(),
      'https://example.com/c.png': mockRequest(),
      'https://example.com/d.png': mockRequest(),
    };

    await gatherer.collectExtraDetails(driver, elements, indexedNetworkRecords);

    expect(gatherer.fetchElementWithSizeInformation).toHaveBeenCalledTimes(3);
  });
});

describe('FR compat', () => {
  it('uses loadData in legacy mode', async () => {
    const gatherer = new ImageElements();
    const mockContext = createMockContext();
    mockContext.driver.defaultSession.sendCommand
      .mockResponse('DOM.enable')
      .mockResponse('CSS.enable')
      .mockResponse('DOM.getDocument')
      .mockResponse('DOM.pushNodeByPathToFrontend', {nodeId: 1})
      .mockResponse('CSS.getMatchedStylesForNode', {attributesStyle: {cssProperties: [
        {name: 'width', value: '200px'},
        {name: 'height', value: '200px'},
      ]}})
      .mockResponse('CSS.disable')
      .mockResponse('DOM.disable');
    mockContext.driver._executionContext.evaluate.mockReturnValue([mockEl]);

    const artifact = await gatherer.afterPass(mockContext.asLegacyContext(), {
      devtoolsLog,
      networkRecords,
    });

    expect(artifact).toEqual([{
      ...mockEl,
      cssWidth: '200px',
      cssHeight: '200px',
      _privateCssSizing: {
        width: '200px',
        height: '200px',
        aspectRatio: null,
      },
    }]);
  });

  it('uses dependencies in legacy mode', async () => {
    const gatherer = new ImageElements();
    const mockContext = createMockContext();
    mockContext.driver.defaultSession.sendCommand
      .mockResponse('DOM.enable')
      .mockResponse('CSS.enable')
      .mockResponse('DOM.getDocument')
      .mockResponse('DOM.pushNodeByPathToFrontend', {nodeId: 1})
      .mockResponse('CSS.getMatchedStylesForNode', {attributesStyle: {cssProperties: [
        {name: 'width', value: '200px'},
        {name: 'height', value: '200px'},
      ]}})
      .mockResponse('CSS.disable')
      .mockResponse('DOM.disable');
    mockContext.driver._executionContext.evaluate.mockReturnValue([mockEl]);

    const artifact = await gatherer.getArtifact({
      ...mockContext.asContext(),
      dependencies: {DevtoolsLog: devtoolsLog},
    });

    expect(artifact).toEqual([{
      ...mockEl,
      cssWidth: '200px',
      cssHeight: '200px',
      _privateCssSizing: {
        width: '200px',
        height: '200px',
        aspectRatio: null,
      },
    }]);
  });
});
