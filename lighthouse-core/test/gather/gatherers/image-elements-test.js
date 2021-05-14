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
const {
  createMockContext,
  createMockDriver,
  createMockSession,
} = require('../../fraggle-rock/gather/mock-driver.js');

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

/**
 * @param {Partial<LH.Artifacts.ImageElement>=} partial
 * @return {LH.Artifacts.ImageElement}
 */
function mockElement(partial = {}) {
  return {
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
    naturalWidth: undefined,
    naturalHeight: undefined,
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
      selector: 'body > div > img',
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
    ...partial,
  };
}

function makeImageElements() {
  const gatherer = new ImageElements();
  jest.spyOn(gatherer, '_getArtifact');
  jest.spyOn(gatherer, 'collectExtraDetails');
  jest.spyOn(gatherer, 'indexNetworkRecords');
  jest.spyOn(gatherer, 'fetchSourceRules');
  jest.spyOn(gatherer, 'fetchElementWithSizeInformation');
  return gatherer;
}

describe('.fetchElementsWithSizingInformation', () => {
  let gatherer = makeImageElements();
  let driver = createMockDriver();
  beforeEach(() => {
    gatherer = makeImageElements();
    driver = createMockDriver();
  });

  it('uses natural dimensions from cache if possible', async () => {
    const element = mockElement();
    gatherer._naturalSizeCache.set(element.src, {
      naturalWidth: 200,
      naturalHeight: 200,
    });

    await gatherer.fetchElementWithSizeInformation(driver.asDriver(), element);

    expect(driver._executionContext.evaluate).not.toHaveBeenCalled();
    expect(element).toEqual(mockElement({
      naturalWidth: 200,
      naturalHeight: 200,
    }));
  });

  it('evaluates natural dimensions if not in cache', async () => {
    const element = mockElement();
    driver._executionContext.evaluate.mockReturnValue({
      naturalWidth: 200,
      naturalHeight: 200,
    });

    await gatherer.fetchElementWithSizeInformation(driver.asDriver(), element);

    expect(gatherer._naturalSizeCache.get(element.src)).toEqual({
      naturalWidth: 200,
      naturalHeight: 200,
    });
    expect(element).toEqual(mockElement({
      naturalWidth: 200,
      naturalHeight: 200,
    }));
  });

  it('handles error when calculating natural dimensions', async () => {
    const element = mockElement();
    driver._executionContext.evaluate.mockRejectedValue(new Error());

    const returnPromise = gatherer.fetchElementWithSizeInformation(driver.asDriver(), element);

    await expect(returnPromise).resolves.not.toThrow();
    expect(element).toEqual(mockElement()); // Element unchanged
  });
});

describe('.fetchSourceRules', () => {
  let gatherer = makeImageElements();
  let session = createMockSession();

  beforeEach(() => {
    gatherer = makeImageElements();
    session = createMockSession();
  });

  it('handles no node found error', async () => {
    session.sendCommand.mockImplementationOnce(() => {
      throw Error('No node found');
    });

    const returnPromise = gatherer.fetchSourceRules(
      session.asSession(),
      '1,HTML,1,BODY,1,IMG',
      mockElement()
    );
    await expect(returnPromise).resolves.not.toThrow();
  });

  it('gets sizes from inline style', async () => {
    session.sendCommand
      .mockResponse('DOM.pushNodeByPathToFrontend', {nodeId: 1})
      .mockResponse('CSS.getMatchedStylesForNode', {inlineStyle: {cssProperties: [
        {name: 'width', value: '200px'},
        {name: 'height', value: '200px'},
        {name: 'aspect-ratio', value: '1 / 1'},
      ]}});

    const element = mockElement();
    await gatherer.fetchSourceRules(session.asSession(), element.node.devtoolsNodePath, element);

    expect(element).toEqual(mockElement({
      cssWidth: '200px',
      cssHeight: '200px',
      _privateCssSizing: {
        width: '200px',
        height: '200px',
        aspectRatio: '1 / 1',
      },
    }));
  });

  it('gets sizes from attributes', async () => {
    session.sendCommand
      .mockResponse('DOM.pushNodeByPathToFrontend', {nodeId: 1})
      .mockResponse('CSS.getMatchedStylesForNode', {attributesStyle: {cssProperties: [
        {name: 'width', value: '200px'},
        {name: 'height', value: '200px'},
      ]}});

    const element = mockElement();
    await gatherer.fetchSourceRules(session.asSession(), element.node.devtoolsNodePath, element);

    expect(element).toEqual(mockElement({
      cssWidth: '200px',
      cssHeight: '200px',
      _privateCssSizing: {
        width: '200px',
        height: '200px',
        aspectRatio: null,
      },
    }));
  });

  it('gets sizes from matching CSS rules', async () => {
    session.sendCommand
      .mockResponse('DOM.pushNodeByPathToFrontend', {nodeId: 1})
      .mockResponse('CSS.getMatchedStylesForNode', {matchedCSSRules: [
        {
          rule: {
            selectorList: {selectors: [{text: 'img'}]},
            style: {cssProperties: [
              {name: 'width', value: '200px'},
              {name: 'height', value: '200px'},
            ]},
          },
          matchingSelectors: [0],
        },
        {
          rule: {
            selectorList: {selectors: [{text: '.classy'}]},
            style: {cssProperties: [
              {name: 'aspect-ratio', value: '1 / 1'},
            ]},
          },
          matchingSelectors: [0],
        },
      ]});

    const element = mockElement();
    await gatherer.fetchSourceRules(session.asSession(), element.node.devtoolsNodePath, element);

    expect(element).toEqual(mockElement({
      cssWidth: '200px',
      cssHeight: '200px',
      _privateCssSizing: {
        width: '200px',
        height: '200px',
        aspectRatio: '1 / 1',
      },
    }));
  });
});

describe('.indexNetworkRecords', () => {
  it('maps image urls to network records', () => {
    const gatherer = makeImageElements();
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

    expect(index).toEqual({
      'https://example.com/img.avif': mockRequest({
        finished: true,
        mimeType: 'application/octect-stream',
        statusCode: 200,
        url: 'https://example.com/img.avif',
      }),
      'https://example.com/img.png': mockRequest({
        finished: true,
        mimeType: 'image/png',
        statusCode: 200,
        url: 'https://example.com/img.png',
      }),
      'https://example.com/img.webp': mockRequest({
        finished: true,
        mimeType: 'application/octect-stream',
        statusCode: 200,
        url: 'https://example.com/img.webp',
      }),
    });
  });

  it('ignores bad status codes', () => {
    const gatherer = makeImageElements();
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

    expect(index).toEqual({
      'https://example.com/img.png': mockRequest({
        finished: true,
        mimeType: 'image/png',
        statusCode: 200,
        url: 'https://example.com/img.png',
      }),
    });
  });
});

describe('.collectExtraDetails', () => {
  let gatherer = makeImageElements();
  let driver = createMockDriver().asDriver();

  beforeEach(() => {
    driver = createMockDriver().asDriver();
    gatherer = makeImageElements();
    gatherer.fetchSourceRules = jest.fn();
    gatherer.fetchElementWithSizeInformation = jest.fn();
  });

  it('respects the overall time budget for source rules', async () => {
    const elements = [
      mockElement({isInShadowDOM: false, isCss: false}),
      mockElement({isInShadowDOM: false, isCss: false}),
      mockElement({isInShadowDOM: false, isCss: false}),
    ];
    gatherer.fetchSourceRules = jest.fn().mockImplementation(async () => {
      jest.advanceTimersByTime(6000);
    });

    await gatherer.collectExtraDetails(driver, elements, {});

    expect(gatherer.fetchSourceRules).toHaveBeenCalledTimes(1);
  });

  it('fetch source rules to determine sizing for non-shadow DOM/non-CSS images', async () => {
    const elements = [
      mockElement({isInShadowDOM: false, isCss: false}),
      mockElement({isInShadowDOM: true, isCss: false}),
      mockElement({isInShadowDOM: false, isCss: true}),
    ];

    await gatherer.collectExtraDetails(driver, elements, {});

    expect(gatherer.fetchSourceRules).toHaveBeenCalledTimes(1);
  });

  it('fetch multiple source rules for non-shadow DOM/non-CSS images', async () => {
    const elements = [
      mockElement({isInShadowDOM: false, isCss: false}),
      mockElement({isInShadowDOM: false, isCss: false}),
    ];

    await gatherer.collectExtraDetails(driver, elements, {});

    expect(gatherer.fetchSourceRules).toHaveBeenCalledTimes(2);
  });

  it('fetch size information for image with picture', async () => {
    const elements = [
      mockElement({src: 'https://example.com/a.png', isPicture: false, isCss: true, srcset: 'src'}),
      mockElement({src: 'https://example.com/b.png', isPicture: true, isCss: false, srcset: 'src'}),
      mockElement({src: 'https://example.com/c.png', isPicture: false, isCss: true}),
      mockElement({src: 'https://example.com/d.png', isPicture: false, isCss: false}),
      mockElement({src: 'https://example.com/e.png', isPicture: false, isCss: true, srcset: 'src'}),
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
    mockContext.driver._executionContext.evaluate.mockReturnValue([mockElement()]);

    const artifact = await gatherer.afterPass(mockContext.asLegacyContext(), {
      devtoolsLog,
      networkRecords,
    });

    expect(artifact).toEqual([
      mockElement({
        mimeType: 'image/jpeg',
        cssWidth: '200px',
        cssHeight: '200px',
        _privateCssSizing: {
          width: '200px',
          height: '200px',
          aspectRatio: null,
        },
      }),
    ]);
  });

  it('uses dependencies in FR', async () => {
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
    mockContext.driver._executionContext.evaluate.mockReturnValue([mockElement()]);

    const artifact = await gatherer.getArtifact({
      ...mockContext.asContext(),
      dependencies: {DevtoolsLog: devtoolsLog},
    });

    expect(artifact).toEqual([
      mockElement({
        mimeType: 'image/jpeg',
        cssWidth: '200px',
        cssHeight: '200px',
        _privateCssSizing: {
          width: '200px',
          height: '200px',
          aspectRatio: null,
        },
      }),
    ]);
  });
});
