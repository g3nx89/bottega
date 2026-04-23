import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  registerSecret: vi.fn(),
  unregisterSecret: vi.fn(),
}));

import { HttpError } from '../../../src/figma/errors.js';
import {
  extractFigmaUrlInfo,
  extractFileKey,
  FigmaAPI,
  formatComponentData,
  formatVariables,
  withTimeout,
} from '../../../src/figma/figma-api.js';
import { captureRejection, mockResponse, setupFetchMock } from '../../helpers/mock-response.js';

describe('extractFileKey', () => {
  it('should extract key from /design/ URL', () => {
    expect(extractFileKey('https://www.figma.com/design/abc123XYZ/My-Cool-File')).toBe('abc123XYZ');
  });

  it('should extract key from /file/ URL', () => {
    expect(extractFileKey('https://www.figma.com/file/def456/Another-File')).toBe('def456');
  });

  it('should return null for invalid URL', () => {
    expect(extractFileKey('not-a-url')).toBeNull();
  });

  it('should return null for URL with no matching path', () => {
    expect(extractFileKey('https://www.figma.com/community/plugin/12345')).toBeNull();
  });
});

describe('extractFigmaUrlInfo', () => {
  it('should extract fileKey and branchId from branch path', () => {
    const result = extractFigmaUrlInfo('https://www.figma.com/design/abc123/branch/branchXYZ/My-File');
    expect(result).toEqual({ fileKey: 'abc123', branchId: 'branchXYZ', nodeId: undefined });
  });

  it('should convert node-id dashes to colons', () => {
    const result = extractFigmaUrlInfo('https://www.figma.com/design/abc123/My-File?node-id=1-23');
    expect(result).toEqual({ fileKey: 'abc123', branchId: undefined, nodeId: '1:23' });
  });

  it('should extract branch-id from query param', () => {
    const result = extractFigmaUrlInfo('https://www.figma.com/design/abc123/My-File?branch-id=br99');
    expect(result).toEqual({ fileKey: 'abc123', branchId: 'br99', nodeId: undefined });
  });

  it('should extract branch path with node-id query param', () => {
    const result = extractFigmaUrlInfo('https://www.figma.com/file/abc123/branch/brXYZ/My-File?node-id=10-5');
    expect(result).toEqual({ fileKey: 'abc123', branchId: 'brXYZ', nodeId: '10:5' });
  });

  it('should return null for non-Figma URL', () => {
    expect(extractFigmaUrlInfo('https://example.com/some/path')).toBeNull();
  });

  it('should return null for malformed URL', () => {
    expect(extractFigmaUrlInfo('definitely not a url')).toBeNull();
  });
});

describe('formatVariables', () => {
  it('should handle empty data', () => {
    const result = formatVariables({ variables: {}, variableCollections: {} });
    expect(result.collections).toEqual([]);
    expect(result.variables).toEqual([]);
    expect(result.summary).toEqual({
      totalCollections: 0,
      totalVariables: 0,
      variablesByType: {},
    });
  });

  it('should map a single collection with variables', () => {
    const result = formatVariables({
      variableCollections: {
        'col:1': {
          name: 'Colors',
          key: 'k1',
          modes: [{ modeId: 'm1', name: 'Default' }],
          variableIds: ['var:1'],
        },
      },
      variables: {
        'var:1': {
          name: 'primary',
          key: 'vk1',
          resolvedType: 'COLOR',
          valuesByMode: { m1: { r: 1, g: 0, b: 0, a: 1 } },
          variableCollectionId: 'col:1',
          scopes: ['ALL_SCOPES'],
          description: 'Primary color',
        },
      },
    });

    expect(result.collections).toHaveLength(1);
    expect(result.collections[0].name).toBe('Colors');
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe('primary');
    expect(result.summary.totalCollections).toBe(1);
    expect(result.summary.totalVariables).toBe(1);
    expect(result.summary.variablesByType).toEqual({ COLOR: 1 });
  });

  it('should not crash on missing/null fields', () => {
    expect(() => formatVariables({})).not.toThrow();
    expect(() => formatVariables({ variables: null, variableCollections: null })).not.toThrow();
  });
});

describe('formatComponentData', () => {
  it('should extract standard component fields', () => {
    // Coverage: formatComponentData was completely untested
    const result = formatComponentData({
      id: '1:1',
      name: 'Button',
      type: 'COMPONENT',
      description: 'A button component',
      descriptionMarkdown: '**A button** component',
      componentPropertyDefinitions: { label: { type: 'TEXT', defaultValue: 'Click' } },
      children: [
        { id: '2:1', name: 'Label', type: 'TEXT' },
        { id: '2:2', name: 'Icon', type: 'FRAME' },
      ],
      absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 40 },
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      strokes: [],
      effects: [{ type: 'DROP_SHADOW' }],
    });

    expect(result.id).toBe('1:1');
    expect(result.name).toBe('Button');
    expect(result.type).toBe('COMPONENT');
    expect(result.description).toBe('A button component');
    expect(result.properties).toEqual({ label: { type: 'TEXT', defaultValue: 'Click' } });
    expect(result.children).toHaveLength(2);
    expect(result.children![0]).toEqual({ id: '2:1', name: 'Label', type: 'TEXT' });
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 120, height: 40 });
    expect(result.fills).toHaveLength(1);
    expect(result.effects).toHaveLength(1);
  });

  it('should handle component with no children', () => {
    // Edge case: component without children array
    const result = formatComponentData({
      id: '1:1',
      name: 'Divider',
      type: 'COMPONENT',
    });

    expect(result.id).toBe('1:1');
    expect(result.children).toBeUndefined();
    expect(result.fills).toBeUndefined();
    expect(result.strokes).toBeUndefined();
  });

  it('should handle component with empty children array', () => {
    // Edge case: empty children array
    const result = formatComponentData({
      id: '1:1',
      name: 'Empty',
      type: 'COMPONENT',
      children: [],
    });

    expect(result.children).toEqual([]);
  });
});

describe('withTimeout', () => {
  it('should resolve when promise completes before timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000, 'test');
    expect(result).toBe('ok');
  });

  it('should reject when promise exceeds timeout', async () => {
    vi.useFakeTimers();
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5000));
    const race = withTimeout(slow, 50, 'slowOp');
    vi.advanceTimersByTime(51);
    await expect(race).rejects.toThrow('slowOp timed out after 50ms');
    vi.useRealTimers();
  });
});

function lastCallUrl(mock: ReturnType<typeof vi.fn>): string {
  const [input] = mock.mock.calls[mock.mock.calls.length - 1]!;
  return typeof input === 'string' ? input : String(input);
}

describe('FigmaAPI REST endpoints — new surface', () => {
  const h = setupFetchMock();
  // Each test body accesses the live mock via `h.fetchMock` — the helper
  // refreshes it in beforeEach so the reference is per-test.

  it('getMe hits /v1/me', async () => {
    h.fetchMock.mockResolvedValue(mockResponse(200, { id: 'u1', handle: 'alice' }));
    await new FigmaAPI('figd_test_token').getMe();
    expect(lastCallUrl(h.fetchMock)).toBe('https://api.figma.com/v1/me');
  });

  it('getFileVersions without opts emits no query string', async () => {
    h.fetchMock.mockResolvedValue(mockResponse(200, { versions: [] }));
    await new FigmaAPI('tok').getFileVersions('fk');
    expect(lastCallUrl(h.fetchMock)).toBe('https://api.figma.com/v1/files/fk/versions');
  });

  it('getFileVersions with all opts emits page_size + before + after', async () => {
    h.fetchMock.mockResolvedValue(mockResponse(200, { versions: [] }));
    await new FigmaAPI('tok').getFileVersions('fk', { page_size: 10, before: 100, after: 50 });
    const url = lastCallUrl(h.fetchMock);
    expect(url).toContain('/v1/files/fk/versions?');
    expect(url).toContain('page_size=10');
    expect(url).toContain('before=100');
    expect(url).toContain('after=50');
  });

  it('getDevResources without nodeIds emits no query string', async () => {
    h.fetchMock.mockResolvedValue(mockResponse(200, { dev_resources: [] }));
    await new FigmaAPI('tok').getDevResources('fk');
    expect(lastCallUrl(h.fetchMock)).toBe('https://api.figma.com/v1/files/fk/dev_resources');
  });

  it('getDevResources with empty nodeIds list emits no query string', async () => {
    h.fetchMock.mockResolvedValue(mockResponse(200, { dev_resources: [] }));
    await new FigmaAPI('tok').getDevResources('fk', []);
    expect(lastCallUrl(h.fetchMock)).toBe('https://api.figma.com/v1/files/fk/dev_resources');
  });

  it('getDevResources forwards node_ids when list is non-empty', async () => {
    h.fetchMock.mockResolvedValue(mockResponse(200, { dev_resources: [] }));
    await new FigmaAPI('tok').getDevResources('fk', ['1:2', '3:4']);
    expect(lastCallUrl(h.fetchMock)).toContain('node_ids=1%3A2%2C3%3A4');
  });
});

describe("FigmaAPI.getNodes — missingNodePolicy: 'throw' truncation", () => {
  const h = setupFetchMock();
  // Each test body accesses the live mock via `h.fetchMock` — the helper
  // refreshes it in beforeEach so the reference is per-test.

  it('lists up to 5 missing nodeIds and appends (+N more)', async () => {
    const ids = ['a:1', 'a:2', 'a:3', 'a:4', 'a:5', 'a:6'];
    const nodes: Record<string, null> = {};
    for (const id of ids) nodes[id] = null;
    h.fetchMock.mockResolvedValue(mockResponse(200, { nodes }));

    const caught = (await captureRejection(
      new FigmaAPI('tok').getNodes('fk', ids, { missingNodePolicy: 'throw' }),
    )) as HttpError;

    expect(caught).toBeInstanceOf(HttpError);
    expect(caught.status).toBe(404);
    expect(caught.message).toContain('a:1, a:2, a:3, a:4, a:5');
    expect(caught.message).toContain('(+1 more)');
    expect(caught.message).not.toContain('a:6,');
  });
});

describe('FigmaAPI — when token is rotated mid-flight (B4 epoch guard)', () => {
  const h = setupFetchMock();
  // Each test body accesses the live mock via `h.fetchMock` — the helper
  // refreshes it in beforeEach so the reference is per-test.

  it('stale in-flight 403s do NOT disable the new token', async () => {
    const api = new FigmaAPI('figd_oldtoken1234567890a');

    // Hold the 3 in-flight requests open while we rotate.
    const deferred: Array<(res: Response) => void> = [];
    h.fetchMock.mockImplementation(() => new Promise<Response>((resolve) => deferred.push(resolve)));

    const p1 = api.getFile('k1').catch((e) => e);
    const p2 = api.getFile('k2').catch((e) => e);
    const p3 = api.getFile('k3').catch((e) => e);

    // Poll with a bounded timeout instead of a microtask-ordering hack —
    // survives future refactors that add pre-fetch `await`s to request().
    await vi.waitFor(() => expect(deferred).toHaveLength(3), { timeout: 1000, interval: 5 });

    // Rotate BEFORE the stale 403s land.
    api.setAccessToken('figd_newtoken1234567890a');

    for (const resolve of deferred) {
      resolve(mockResponse(403, '{"err":"Invalid token"}'));
    }
    await Promise.all([p1, p2, p3]);

    // Post-rotation call must succeed — the breaker must not have tripped.
    h.fetchMock.mockReset();
    h.fetchMock.mockResolvedValueOnce(mockResponse(200, { ok: true }));
    const res = await api.getFile('k-post-rotation');
    expect(res).toEqual({ ok: true });
  });
});
