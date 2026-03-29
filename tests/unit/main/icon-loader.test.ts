import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../../src/figma/types.js';

// We need to reset the module cache between tests to clear the icon cache
let loadIconSvg: typeof import('../../../src/main/icon-loader.js').loadIconSvg;
let resolveIcons: typeof import('../../../src/main/icon-loader.js').resolveIcons;

// Mock @iconify/utils
vi.mock('@iconify/utils', () => ({
  iconToSVG: vi.fn((_icon, _size) => ({
    body: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>',
    attributes: { xmlns: 'http://www.w3.org/2000/svg', width: '24', height: '24', viewBox: '0 0 24 24' },
  })),
  iconToHTML: vi.fn(
    (body, attrs) =>
      `<svg ${Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ')}>${body}</svg>`,
  ),
}));

beforeEach(async () => {
  vi.restoreAllMocks();
  // Re-import to get a fresh icon cache each test
  vi.resetModules();
  const mod = await import('../../../src/main/icon-loader.js');
  loadIconSvg = mod.loadIconSvg;
  resolveIcons = mod.resolveIcons;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── loadIconSvg ─────────────────────────────────

describe('loadIconSvg', () => {
  it('should fetch icon from Iconify API and return SVG', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        icons: { home: { body: '<path d="M10 20v-6h4v6"/>', width: 24, height: 24 } },
        width: 24,
        height: 24,
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const svg = await loadIconSvg('mdi:home', 24);
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.iconify.design/mdi.json?icons=home',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('should return cached result on second call', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        icons: { star: { body: '<path d="M12 2l3 7"/>', width: 24, height: 24 } },
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const svg1 = await loadIconSvg('mdi:star', 24);
    const svg2 = await loadIconSvg('mdi:star', 24);

    expect(svg1).toBe(svg2);
    expect(fetch).toHaveBeenCalledTimes(1); // Only one fetch — second was cached
  });

  it('should cache separately for different sizes', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        icons: { star: { body: '<path d="M12 2"/>', width: 24, height: 24 } },
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await loadIconSvg('mdi:star', 16);
    await loadIconSvg('mdi:star', 32);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should throw on invalid icon name (no colon)', async () => {
    await expect(loadIconSvg('invalid-name')).rejects.toThrow('Invalid icon name');
  });

  it('should throw on empty prefix', async () => {
    await expect(loadIconSvg(':home')).rejects.toThrow('Invalid icon name');
  });

  it('should throw when API returns non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(loadIconSvg('mdi:nonexistent')).rejects.toThrow('Failed to fetch icon');
  });

  it('should throw when icon is not found in API response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ icons: {} }),
      }),
    );

    await expect(loadIconSvg('mdi:missing')).rejects.toThrow('not found on Iconify');
  });

  it('should default size to 24 when not specified', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        icons: { home: { body: '<path/>', width: 24, height: 24 } },
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const svg = await loadIconSvg('mdi:home');
    expect(svg).toContain('<svg');
  });
});

// ── resolveIcons ────────────────────────────────

describe('resolveIcons', () => {
  function mockFetchForIcons() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          icons: {
            home: { body: '<path d="M10"/>', width: 24, height: 24 },
            star: { body: '<path d="M12"/>', width: 24, height: 24 },
          },
        }),
      }),
    );
  }

  it('should do nothing for a tree without icons', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const tree: TreeNode = {
      type: 'frame',
      props: {},
      children: [
        { type: 'text', props: {}, children: ['Hello'] },
        { type: 'rectangle', props: { width: 100 }, children: [] },
      ],
    };

    await resolveIcons(tree);

    expect(fetch).not.toHaveBeenCalled();
    expect(tree.children).toHaveLength(2);
  });

  it('should resolve icon nodes into svg nodes', async () => {
    mockFetchForIcons();

    const tree: TreeNode = {
      type: 'frame',
      props: {},
      children: [{ type: 'icon', props: { name: 'mdi:home', size: 24 }, children: [] }],
    };

    await resolveIcons(tree);

    const iconNode = tree.children[0] as TreeNode;
    expect(iconNode.type).toBe('svg');
    expect(iconNode.props.svg).toContain('<svg');
    expect(iconNode.props.w).toBe(24);
    expect(iconNode.props.h).toBe(24);
    expect(iconNode.children).toEqual([]);
  });

  it('should resolve multiple icons in parallel', async () => {
    mockFetchForIcons();

    const tree: TreeNode = {
      type: 'frame',
      props: {},
      children: [
        { type: 'icon', props: { name: 'mdi:home', size: 16 }, children: [] },
        { type: 'text', props: {}, children: ['between'] },
        { type: 'icon', props: { name: 'mdi:star', size: 32 }, children: [] },
      ],
    };

    await resolveIcons(tree);

    expect((tree.children[0] as TreeNode).type).toBe('svg');
    expect((tree.children[0] as TreeNode).props.w).toBe(16);
    expect((tree.children[1] as TreeNode).type).toBe('text'); // unchanged
    expect((tree.children[2] as TreeNode).type).toBe('svg');
    expect((tree.children[2] as TreeNode).props.w).toBe(32);
  });

  it('should resolve deeply nested icon nodes', async () => {
    mockFetchForIcons();

    const tree: TreeNode = {
      type: 'frame',
      props: {},
      children: [
        {
          type: 'frame',
          props: {},
          children: [
            {
              type: 'frame',
              props: {},
              children: [{ type: 'icon', props: { name: 'mdi:home', size: 24 }, children: [] }],
            },
          ],
        },
      ],
    };

    await resolveIcons(tree);

    const deepChild = ((tree.children[0] as TreeNode).children[0] as TreeNode).children[0] as TreeNode;
    expect(deepChild.type).toBe('svg');
  });

  it('should default icon size to 24 when not set', async () => {
    mockFetchForIcons();

    const tree: TreeNode = {
      type: 'frame',
      props: {},
      children: [{ type: 'icon', props: { name: 'mdi:home' }, children: [] }],
    };

    await resolveIcons(tree);

    const iconNode = tree.children[0] as TreeNode;
    expect(iconNode.props.w).toBe(24);
    expect(iconNode.props.h).toBe(24);
  });

  it('should handle Icon (capitalized) type as well', async () => {
    mockFetchForIcons();

    const tree: TreeNode = {
      type: 'frame',
      props: {},
      children: [{ type: 'Icon', props: { name: 'mdi:star', size: 20 }, children: [] } as any],
    };

    await resolveIcons(tree);

    const iconNode = tree.children[0] as TreeNode;
    expect(iconNode.type).toBe('svg');
  });

  // ── Phase 2A: Resilience tests ─────────────────

  it('should handle partial icon failure gracefully (Promise.allSettled)', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              icons: { home: { body: '<path d="M10"/>', width: 24, height: 24 } },
            }),
          });
        }
        // Second icon fetch fails
        return Promise.reject(new Error('Network error'));
      }),
    );

    const tree: TreeNode = {
      type: 'frame',
      props: {},
      children: [
        { type: 'icon', props: { name: 'mdi:home', size: 24 }, children: [] },
        { type: 'icon', props: { name: 'mdi:broken', size: 24 }, children: [] },
      ],
    };

    // Should NOT throw — partial success
    await resolveIcons(tree);

    // First icon resolved
    expect((tree.children[0] as TreeNode).type).toBe('svg');
    // Second icon left unchanged
    expect((tree.children[1] as TreeNode).type).toBe('icon');
  });

  it('should timeout fetch after configured duration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, opts: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            // Simulate a hung request — abort signal will fire
            opts?.signal?.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      ),
    );

    await expect(loadIconSvg('mdi:slow')).rejects.toThrow(/timeout/i);
  }, 15000);

  it('should reject icon names with multiple colons', async () => {
    // Only "prefix:name" format is valid — reject ambiguous multi-colon names
    await expect(loadIconSvg('mdi:light:home')).rejects.toThrow(/Invalid icon name/);
  });

  it('should throw on completely empty string', async () => {
    // Edge case: empty string splits to [''] — both prefix and iconName are empty
    await expect(loadIconSvg('')).rejects.toThrow('Invalid icon name');
  });

  it('should propagate network errors that are not abort errors', async () => {
    // Edge case: general fetch failure (DNS, network down)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await expect(loadIconSvg('mdi:home')).rejects.toThrow('ECONNREFUSED');
  });

  it('should evict oldest cache entry when cache is full (FIFO at 500)', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        icons: { icon: { body: '<path/>', width: 24, height: 24 } },
      }),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    // Fill cache to max (500 entries)
    for (let i = 0; i < 500; i++) {
      await loadIconSvg(`set:icon`, i); // different sizes = different cache keys
    }

    // One more should evict the oldest
    await loadIconSvg('set:icon', 999);

    // Fetching the first size again should require a new fetch (was evicted)
    const callsBefore = (fetch as any).mock.calls.length;
    await loadIconSvg('set:icon', 0);
    expect((fetch as any).mock.calls.length).toBe(callsBefore + 1);
  });
});
