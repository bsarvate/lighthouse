/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

const ImageElements = require('../../../gather/gatherers/image-elements.js');
const NetworkRecorder = require('../../../lib/network-recorder.js');
const {createMockContext} = require('../../fraggle-rock/gather/mock-driver.js');
const {makeParamsOptional} = require('../../test-utils.js');

const devtoolsLog = /** @type {LH.DevtoolsLog} */ (require('../../fixtures/traces/lcp-m78.devtools.log.json')); // eslint-disable-line max-len
const networkRecords = NetworkRecorder.recordsFromLogs(devtoolsLog);

/** @type {LH.Artifacts.ImageElement} */
const imageElement = {
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

jest.useFakeTimers();

function mockImageElements() {
  const gatherer = new ImageElements();
  return {
    ...gatherer,
    _getArtifact: jest.fn(makeParamsOptional(gatherer._getArtifact)),
    collectExtraDetails: jest.fn(makeParamsOptional(gatherer.collectExtraDetails)),
    indexNetworkRecords: jest.fn(makeParamsOptional(gatherer.indexNetworkRecords)),
    fetchSourceRules: jest.fn(makeParamsOptional(gatherer.fetchSourceRules)),
    fetchElementWithSizeInformation: jest.fn(
      makeParamsOptional(gatherer.fetchElementWithSizeInformation)
    ),
  };
}

describe('.indexNetworkRecords', () => {
  it('maps image urls to network records', () => {
    const gatherer = mockImageElements();
    const networkRecords = [
      {
        mimeType: 'image/png',
        url: 'https://example.com/img.png',
        finished: true,
        statusCode: 200,
      },
      {
        mimeType: 'application/octect-stream',
        url: 'https://example.com/img.webp',
        finished: true,
        statusCode: 200,
      },
      {
        mimeType: 'application/octect-stream',
        url: 'https://example.com/img.avif',
        finished: true,
        statusCode: 200,
      },
    ];

    const index = gatherer.indexNetworkRecords(networkRecords);

    expect(index).toEqual({
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
      {
        mimeType: 'image/png',
        url: 'https://example.com/img.png',
        finished: true,
        statusCode: 200,
      },
      {
        mimeType: 'application/octect-stream',
        url: 'https://example.com/img.webp',
        finished: false,
      },
      {
        mimeType: 'application/octect-stream',
        url: 'https://example.com/img.avif',
        finished: true,
        statusCode: 404,
      },
    ];

    const index = gatherer.indexNetworkRecords(networkRecords);

    expect(index).toEqual({
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

  beforeEach(() => {
    gatherer = mockImageElements();
    gatherer.fetchSourceRules.mockImplementation();
    gatherer.fetchElementWithSizeInformation.mockImplementation();
  });

  it('respects the overall time budget for source rules', async () => {
    const elements = [
      {node: {}, isInShadowDOM: false, isCss: false},
      {node: {}, isInShadowDOM: false, isCss: false},
      {node: {}, isInShadowDOM: false, isCss: false},
    ];
    gatherer.fetchSourceRules.mockImplementation(async () => {
      jest.advanceTimersByTime(6000);
    });

    await gatherer.collectExtraDetails({}, elements, {});

    expect(gatherer.fetchSourceRules).toHaveBeenCalledTimes(1);
  });

  it('fetch source rules to determine sizing for non-shadow DOM/non-CSS images', async () => {
    const elements = [
      {node: {}, isInShadowDOM: false, isCss: false},
      {node: {}, isInShadowDOM: true, isCss: false},
      {node: {}, isInShadowDOM: false, isCss: true},
    ];

    await gatherer.collectExtraDetails({}, elements, {});

    expect(gatherer.fetchSourceRules).toHaveBeenCalledTimes(1);
    expect(gatherer.fetchSourceRules).toHaveBeenCalledWith(undefined, undefined, elements[0]);
  });

  it('fetch multiple source rules to determine sizing for non-shadow DOM/non-CSS images', async () => {
    const elements = [
      {node: {}, isInShadowDOM: false, isCss: false},
      {node: {}, isInShadowDOM: false, isCss: false},
    ];

    await gatherer.collectExtraDetails({}, elements, {});

    expect(gatherer.fetchSourceRules).toHaveBeenCalledTimes(2);
    expect(gatherer.fetchSourceRules).toHaveBeenNthCalledWith(1, undefined, undefined, elements[0]);
    expect(gatherer.fetchSourceRules).toHaveBeenNthCalledWith(2, undefined, undefined, elements[1]);
  });

  it('fetch size information for image with picture', async () => {
    const elements = [
      {node: {}, src: 'https://example.com/a.png', isPicture: false, isCss: true, srcset: 'src'},
      {node: {}, src: 'https://example.com/b.png', isPicture: true, isCss: false, srcset: 'src'},
      {node: {}, src: 'https://example.com/c.png', isPicture: false, isCss: true},
      {node: {}, src: 'https://example.com/d.png', isPicture: false, isCss: false},
      {node: {}, src: 'https://example.com/e.png', isPicture: false, isCss: true, srcset: 'src'},
    ];
    const indexedNetworkRecords = {
      'https://example.com/a.png': {},
      'https://example.com/b.png': {},
      'https://example.com/c.png': {},
      'https://example.com/d.png': {},
    };

    await gatherer.collectExtraDetails({}, elements, indexedNetworkRecords);

    expect(gatherer.fetchElementWithSizeInformation).toHaveBeenCalledTimes(3);
    expect(gatherer.fetchElementWithSizeInformation).toHaveBeenNthCalledWith(1, {}, elements[0]);
    expect(gatherer.fetchElementWithSizeInformation).toHaveBeenNthCalledWith(2, {}, elements[1]);
    expect(gatherer.fetchElementWithSizeInformation).toHaveBeenNthCalledWith(3, {}, elements[2]);
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
    mockContext.driver._executionContext.evaluate.mockReturnValue([imageElement]);

    const artifact = await gatherer.afterPass(mockContext.asLegacyContext(), {
      devtoolsLog,
      networkRecords,
    });

    expect(artifact).toEqual([{
      ...imageElement,
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
    mockContext.driver._executionContext.evaluate.mockReturnValue([imageElement]);

    const artifact = await gatherer.getArtifact({
      ...mockContext.asContext(),
      dependencies: {DevtoolsLog: devtoolsLog},
    });

    expect(artifact).toEqual([{
      ...imageElement,
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
