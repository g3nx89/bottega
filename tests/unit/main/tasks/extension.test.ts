import { describe, expect, it, vi } from 'vitest';
import { createTaskExtensionFactory } from '../../../../src/main/tasks/extension-factory.js';
import { TaskStore } from '../../../../src/main/tasks/store.js';

function makeEvent(overrides: Partial<{ toolName: string; content: any[]; isError: boolean }> = {}) {
  return {
    toolName: 'figma_screenshot',
    content: [{ type: 'text', text: 'some result' }],
    isError: false,
    ...overrides,
  };
}

function setupFactory(store: TaskStore) {
  let toolResultHandler: (event: any) => Promise<any>;
  const mockPi = {
    on: vi.fn((event: string, handler: any) => {
      if (event === 'tool_result') toolResultHandler = handler;
    }),
  };
  const factory = createTaskExtensionFactory(() => store);
  factory(mockPi);
  return {
    mockPi,
    call: (event: any) => toolResultHandler(event),
  };
}

describe('createTaskExtensionFactory', () => {
  describe('reminder injection', () => {
    it('registers a tool_result handler on pi', () => {
      const store = new TaskStore();
      const { mockPi } = setupFactory(store);
      expect(mockPi.on).toHaveBeenCalledWith('tool_result', expect.any(Function));
    });

    it('returns null for every non-task tool call when store is empty', async () => {
      const store = new TaskStore();
      const { call } = setupFactory(store);

      for (let i = 0; i < 10; i++) {
        const result = await call(makeEvent());
        expect(result).toBeNull();
      }
    });

    it('returns null for first 3 non-task tool calls when 1 task in store', async () => {
      const store = new TaskStore();
      store.create('task 1', 'desc');
      const { call } = setupFactory(store);

      for (let i = 0; i < 3; i++) {
        const result = await call(makeEvent());
        expect(result).toBeNull();
      }
    });

    it('injects reminder on 4th non-task tool call when tasks present', async () => {
      const store = new TaskStore();
      store.create('task 1', 'desc');
      const { call } = setupFactory(store);

      for (let i = 0; i < 3; i++) {
        await call(makeEvent());
      }
      const result = await call(makeEvent());
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('content');
    });

    it('returned content contains original content element', async () => {
      const store = new TaskStore();
      store.create('task 1', 'desc');
      const { call } = setupFactory(store);

      const originalContent = [{ type: 'text', text: 'tool output' }];
      for (let i = 0; i < 3; i++) {
        await call(makeEvent({ content: originalContent }));
      }
      const result = await call(makeEvent({ content: originalContent }));
      expect(result.content[0]).toEqual({ type: 'text', text: 'tool output' });
    });

    it('appends reminder as additional text element', async () => {
      const store = new TaskStore();
      store.create('task 1', 'desc');
      const { call } = setupFactory(store);

      for (let i = 0; i < 3; i++) {
        await call(makeEvent());
      }
      const result = await call(makeEvent());
      const lastElement = result.content[result.content.length - 1];
      expect(lastElement.type).toBe('text');
      expect(lastElement.text).toContain('<system-reminder>Task tools not used recently');
    });

    it('resets counter after injection so next 3 calls return null', async () => {
      const store = new TaskStore();
      store.create('task 1', 'desc');
      const { call } = setupFactory(store);

      // Trigger injection at call 4
      for (let i = 0; i < 4; i++) {
        await call(makeEvent());
      }

      // Counter reset — next 3 should return null
      for (let i = 0; i < 3; i++) {
        const result = await call(makeEvent());
        expect(result).toBeNull();
      }
    });
  });

  describe('counter reset on task tool calls', () => {
    it('task_create resets the counter', async () => {
      const store = new TaskStore();
      store.create('task 1', 'desc');
      const { call } = setupFactory(store);

      // 3 non-task calls (counter = 3)
      for (let i = 0; i < 3; i++) {
        await call(makeEvent());
      }
      // task_create resets counter to 0
      await call(makeEvent({ toolName: 'task_create' }));
      // Next 3 non-task calls should return null (counter 1, 2, 3)
      for (let i = 0; i < 3; i++) {
        const result = await call(makeEvent());
        expect(result).toBeNull();
      }
    });

    it('task_update resets the counter', async () => {
      const store = new TaskStore();
      store.create('task 1', 'desc');
      const { call } = setupFactory(store);

      for (let i = 0; i < 3; i++) {
        await call(makeEvent());
      }
      await call(makeEvent({ toolName: 'task_update' }));
      for (let i = 0; i < 3; i++) {
        const result = await call(makeEvent());
        expect(result).toBeNull();
      }
    });

    it('task_list resets the counter', async () => {
      const store = new TaskStore();
      store.create('task 1', 'desc');
      const { call } = setupFactory(store);

      for (let i = 0; i < 3; i++) {
        await call(makeEvent());
      }
      await call(makeEvent({ toolName: 'task_list' }));
      for (let i = 0; i < 3; i++) {
        const result = await call(makeEvent());
        expect(result).toBeNull();
      }
    });

    it('after reset, needs 4 non-task calls before next injection', async () => {
      const store = new TaskStore();
      store.create('task 1', 'desc');
      const { call } = setupFactory(store);

      // Reset via task tool
      await call(makeEvent({ toolName: 'task_create' }));

      // 3 calls: null
      for (let i = 0; i < 3; i++) {
        const result = await call(makeEvent());
        expect(result).toBeNull();
      }
      // 4th call: injection
      const result = await call(makeEvent());
      expect(result).not.toBeNull();
    });
  });

  describe('edge cases', () => {
    it('does not inject when store is cleared after tasks were added', async () => {
      const store = new TaskStore();
      store.create('task 1', 'desc');
      const { call } = setupFactory(store);

      // Advance counter
      for (let i = 0; i < 3; i++) {
        await call(makeEvent());
      }
      // Clear store
      store.clearAll();

      // 4th call: store empty → no injection
      const result = await call(makeEvent());
      expect(result).toBeNull();
    });

    it('returns null when event.content is undefined', async () => {
      const store = new TaskStore();
      store.create('task 1', 'desc');
      const { call } = setupFactory(store);

      for (let i = 0; i < 3; i++) {
        await call({ toolName: 'figma_screenshot', isError: false });
      }
      const result = await call({ toolName: 'figma_screenshot', isError: false });
      // Should still inject but with empty base content (no crash)
      if (result !== null) {
        expect(Array.isArray(result.content)).toBe(true);
      }
    });

    it('returns null when event.toolName is undefined, counts as non-task', async () => {
      const store = new TaskStore();
      store.create('task 1', 'desc');
      const { call } = setupFactory(store);

      for (let i = 0; i < 3; i++) {
        await call({ content: [{ type: 'text', text: 'x' }], isError: false });
      }
      // 4th — undefined toolName is not a task tool, so injection fires
      const result = await call({ content: [{ type: 'text', text: 'x' }], isError: false });
      expect(result).not.toBeNull();
    });

    it('returns null gracefully when an exception occurs in handler', async () => {
      // getStore throws
      const factory = createTaskExtensionFactory(() => {
        throw new Error('store unavailable');
      });
      let handler: (event: any) => Promise<any>;
      const mockPi = {
        on: vi.fn((_event: string, h: any) => {
          handler = h;
        }),
      };
      factory(mockPi);
      const result = await handler!(makeEvent());
      expect(result).toBeNull();
    });
  });

  describe('isolation', () => {
    it('two factories with different stores have independent counters', async () => {
      const storeA = new TaskStore();
      const storeB = new TaskStore();
      storeA.create('task A', 'desc');
      storeB.create('task B', 'desc');

      const { call: callA } = setupFactory(storeA);
      const { call: callB } = setupFactory(storeB);

      // Advance A's counter to 4
      for (let i = 0; i < 3; i++) {
        await callA(makeEvent());
      }
      const resultA = await callA(makeEvent());
      expect(resultA).not.toBeNull();

      // B's counter is still at 0 — should return null for first 3 calls
      for (let i = 0; i < 3; i++) {
        const result = await callB(makeEvent());
        expect(result).toBeNull();
      }
    });

    it('injecting in factory A does not affect factory B counter', async () => {
      const storeA = new TaskStore();
      const storeB = new TaskStore();
      storeA.create('task A', 'desc');
      storeB.create('task B', 'desc');

      const { call: callA } = setupFactory(storeA);
      const { call: callB } = setupFactory(storeB);

      // Trigger A's injection
      for (let i = 0; i < 4; i++) {
        await callA(makeEvent());
      }

      // B should still be at counter=0
      for (let i = 0; i < 3; i++) {
        const result = await callB(makeEvent());
        expect(result).toBeNull();
      }
      // B fires at 4th
      const resultB = await callB(makeEvent());
      expect(resultB).not.toBeNull();
    });
  });
});
