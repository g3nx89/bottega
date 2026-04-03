import { beforeEach, describe, expect, it } from 'vitest';
import { createTaskExtensionFactory } from '../../../../src/main/tasks/extension-factory.js';
import { TaskStore } from '../../../../src/main/tasks/store.js';

describe('task extension auto-clear', () => {
  let store: TaskStore;

  beforeEach(() => {
    store = new TaskStore();
  });

  it('clears all completed tasks after 4 non-task turns', () => {
    store.create('Task 1', 'First task');
    store.create('Task 2', 'Second task');
    store.update('1', { status: 'completed' });
    store.update('2', { status: 'completed' });

    const factory = createTaskExtensionFactory(() => store, 'on_list_complete');
    const handlers: any[] = [];
    factory({ on: (_event: string, handler: any) => handlers.push(handler) });

    const fakeEvent = { toolName: 'figma_set_fills', content: [{ type: 'text', text: 'OK' }] };

    // 4 turns with all tasks complete
    for (let i = 0; i < 4; i++) {
      handlers[0](fakeEvent);
    }

    expect(store.size).toBe(0);
  });

  it('does not clear if not all tasks completed', () => {
    store.create('Task 1', 'First task');
    store.create('Task 2', 'Second task');
    store.update('1', { status: 'completed' });
    // Task 2 still pending

    const factory = createTaskExtensionFactory(() => store, 'on_list_complete');
    const handlers: any[] = [];
    factory({ on: (_event: string, handler: any) => handlers.push(handler) });

    const fakeEvent = { toolName: 'figma_set_fills', content: [{ type: 'text', text: 'OK' }] };
    for (let i = 0; i < 5; i++) {
      handlers[0](fakeEvent);
    }

    expect(store.size).toBe(2);
  });

  it('does not clear when autoClear=never', () => {
    store.create('Task 1', 'First task');
    store.update('1', { status: 'completed' });

    const factory = createTaskExtensionFactory(() => store, 'never');
    const handlers: any[] = [];
    factory({ on: (_event: string, handler: any) => handlers.push(handler) });

    const fakeEvent = { toolName: 'figma_set_fills', content: [{ type: 'text', text: 'OK' }] };
    for (let i = 0; i < 10; i++) {
      handlers[0](fakeEvent);
    }

    expect(store.size).toBe(1);
  });

  it('resets counter on task tool usage', () => {
    store.create('Task 1', 'First task');
    store.update('1', { status: 'completed' });

    const factory = createTaskExtensionFactory(() => store, 'on_list_complete');
    const handlers: any[] = [];
    factory({ on: (_event: string, handler: any) => handlers.push(handler) });

    // 3 non-task turns
    for (let i = 0; i < 3; i++) {
      handlers[0]({ toolName: 'figma_set_fills', content: [] });
    }
    // Task tool resets counter
    handlers[0]({ toolName: 'task_list', content: [] });
    // 3 more — should not clear yet (need 4 after reset)
    for (let i = 0; i < 3; i++) {
      handlers[0]({ toolName: 'figma_set_fills', content: [] });
    }

    expect(store.size).toBe(1);
  });

  it('injects task summary in reminder', async () => {
    store.create('Build header', 'Header task');
    store.update('1', { status: 'in_progress' });
    store.create('Build footer', 'Footer task');

    const factory = createTaskExtensionFactory(() => store, 'on_list_complete');
    const handlers: any[] = [];
    factory({ on: (_event: string, handler: any) => handlers.push(handler) });

    let result: any;
    for (let i = 0; i < 4; i++) {
      result = await handlers[0]({ toolName: 'figma_set_fills', content: [{ type: 'text', text: 'OK' }] });
    }

    expect(result).not.toBeNull();
    expect(result.content.some((c: any) => c.text?.includes('Build header'))).toBe(true);
  });
});
