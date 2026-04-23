import { describe, expect, it } from 'vitest';
import { UNBOUND_FILE_KEY } from '../../../../src/main/constants.js';
import { createDiscoveryTools } from '../../../../src/main/tools/discovery.js';
import { createFailingFigmaAPI, createTestToolDeps } from '../../../helpers/mock-connector.js';

function makeDeps(overrides: Record<string, any> = {}) {
  return createTestToolDeps({ fileKey: 'current-file', ...overrides });
}

function findTool(deps: any, name: string): any {
  const tool = createDiscoveryTools(deps).find((t: any) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

describe('REST tools — surface registration', () => {
  it('registers figma_whoami, figma_get_file_versions, figma_get_dev_resources', () => {
    const deps = makeDeps();
    const names = createDiscoveryTools(deps).map((t: any) => t.name);
    expect(names).toContain('figma_whoami');
    expect(names).toContain('figma_get_file_versions');
    expect(names).toContain('figma_get_dev_resources');
  });
});

describe('REST tools — figma_whoami', () => {
  it('does not require a connected fileKey (UNBOUND slot)', async () => {
    const deps = makeDeps({ fileKey: UNBOUND_FILE_KEY });
    deps.figmaAPI.getMe.mockResolvedValue({ id: 'u1', handle: 'solo' });
    const tool = findTool(deps, 'figma_whoami');
    const res = await tool.execute('c1', {}, undefined, undefined, undefined);
    const parsed = JSON.parse((res.content[0] as any).text);
    expect(parsed.handle).toBe('solo');
    expect(deps.figmaAPI.getMe).toHaveBeenCalledOnce();
  });

  it('returns authenticated user identity', async () => {
    const deps = makeDeps();
    deps.figmaAPI.getMe.mockResolvedValue({
      id: 'U-42',
      handle: 'alice',
      img_url: 'https://img/u42.png',
      email: 'ignored@x',
    });
    const tool = findTool(deps, 'figma_whoami');

    const res = await tool.execute('c1', {}, undefined, undefined, undefined);
    const text = (res.content[0] as any).text;
    const parsed = JSON.parse(text);

    expect(parsed).toEqual({ id: 'U-42', handle: 'alice', img_url: 'https://img/u42.png' });
    // Strip email (PII) — not forwarded to agent.
    expect(parsed.email).toBeUndefined();
    expect(deps.figmaAPI.getMe).toHaveBeenCalledOnce();
  });

  it('surfaces REST errors (401) unchanged', async () => {
    const deps = makeDeps({ figmaAPI: createFailingFigmaAPI(401, 'Invalid token') });
    const tool = findTool(deps, 'figma_whoami');
    await expect(tool.execute('c1', {}, undefined, undefined, undefined)).rejects.toMatchObject({
      status: 401,
      message: 'Invalid token',
    });
  });
});

describe('REST tools — figma_get_file_versions', () => {
  it('uses connected fileKey when param omitted', async () => {
    const deps = makeDeps({ fileKey: 'connected-abc' });
    deps.figmaAPI.getFileVersions.mockResolvedValue({
      versions: [{ id: 'v1', created_at: 't', label: null, description: null, user: { id: 'u', handle: 'h' } }],
    });
    const tool = findTool(deps, 'figma_get_file_versions');

    await tool.execute('c1', {}, undefined, undefined, undefined);

    expect(deps.figmaAPI.getFileVersions).toHaveBeenCalledWith('connected-abc', {
      page_size: undefined,
      before: undefined,
      after: undefined,
    });
  });

  it('prefers explicit fileKey over connected default', async () => {
    const deps = makeDeps({ fileKey: 'connected-abc' });
    const tool = findTool(deps, 'figma_get_file_versions');

    await tool.execute('c1', { fileKey: 'override-xyz', pageSize: 10 }, undefined, undefined, undefined);

    expect(deps.figmaAPI.getFileVersions).toHaveBeenCalledWith('override-xyz', {
      page_size: 10,
      before: undefined,
      after: undefined,
    });
  });

  it('forwards before/after pagination', async () => {
    const deps = makeDeps({ fileKey: 'abc' });
    const tool = findTool(deps, 'figma_get_file_versions');

    await tool.execute('c1', { before: 100, after: 50 }, undefined, undefined, undefined);

    expect(deps.figmaAPI.getFileVersions).toHaveBeenCalledWith('abc', {
      page_size: undefined,
      before: 100,
      after: 50,
    });
  });

  it('returns an error payload when no file is connected and no fileKey provided', async () => {
    const deps = makeDeps({ fileKey: UNBOUND_FILE_KEY });
    const tool = findTool(deps, 'figma_get_file_versions');

    const res = await tool.execute('c1', {}, undefined, undefined, undefined);
    const parsed = JSON.parse((res.content[0] as any).text);

    expect(parsed.error).toMatch(/no file is currently connected/i);
    expect(deps.figmaAPI.getFileVersions).not.toHaveBeenCalled();
  });

  it('surfaces REST 429 unchanged', async () => {
    const deps = makeDeps({ figmaAPI: createFailingFigmaAPI(429, 'Too many requests'), fileKey: 'abc' });
    const tool = findTool(deps, 'figma_get_file_versions');
    await expect(tool.execute('c1', {}, undefined, undefined, undefined)).rejects.toMatchObject({ status: 429 });
  });
});

describe('REST tools — figma_get_dev_resources', () => {
  it('uses connected fileKey when param omitted', async () => {
    const deps = makeDeps({ fileKey: 'connected-abc' });
    const tool = findTool(deps, 'figma_get_dev_resources');

    await tool.execute('c1', {}, undefined, undefined, undefined);

    expect(deps.figmaAPI.getDevResources).toHaveBeenCalledWith('connected-abc', undefined);
  });

  it('forwards empty nodeIds array verbatim (lock current behavior)', async () => {
    const deps = makeDeps({ fileKey: 'abc' });
    const tool = findTool(deps, 'figma_get_dev_resources');

    await tool.execute('c1', { nodeIds: [] }, undefined, undefined, undefined);

    expect(deps.figmaAPI.getDevResources).toHaveBeenCalledWith('abc', []);
  });

  it('forwards nodeIds filter', async () => {
    const deps = makeDeps({ fileKey: 'abc' });
    const tool = findTool(deps, 'figma_get_dev_resources');

    await tool.execute('c1', { nodeIds: ['1:2', '3:4'] }, undefined, undefined, undefined);

    expect(deps.figmaAPI.getDevResources).toHaveBeenCalledWith('abc', ['1:2', '3:4']);
  });

  it('returns an error payload when no file is connected and no fileKey provided', async () => {
    const deps = makeDeps({ fileKey: UNBOUND_FILE_KEY });
    const tool = findTool(deps, 'figma_get_dev_resources');

    const res = await tool.execute('c1', {}, undefined, undefined, undefined);
    const parsed = JSON.parse((res.content[0] as any).text);

    expect(parsed.error).toMatch(/no file is currently connected/i);
    expect(deps.figmaAPI.getDevResources).not.toHaveBeenCalled();
  });

  it('surfaces REST 500 unchanged', async () => {
    const deps = makeDeps({ figmaAPI: createFailingFigmaAPI(500), fileKey: 'abc' });
    const tool = findTool(deps, 'figma_get_dev_resources');
    await expect(tool.execute('c1', {}, undefined, undefined, undefined)).rejects.toMatchObject({ status: 500 });
  });
});
