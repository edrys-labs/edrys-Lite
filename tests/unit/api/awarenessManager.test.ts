import { describe, test, expect, vi } from 'vitest';
import { RoomAwarenessManager } from '../../../src/api/awarenessManager';

class FakeAwareness {
  private states = new Map<number, any>();
  private listeners = new Map<string, Function[]>();
  private local = 1;

  setState(clientId: number, state: any) {
    this.states.set(clientId, state);
  }

  getStates() {
    return this.states;
  }

  getLocalState() {
    return this.states.get(this.local) || null;
  }

  setLocalState(state: any) {
    this.states.set(this.local, state);
  }

  on(event: string, listener: Function) {
    const arr = this.listeners.get(event) || [];
    arr.push(listener);
    this.listeners.set(event, arr);
  }

  off(event: string, listener: Function) {
    const arr = this.listeners.get(event) || [];
    this.listeners.set(
      event,
      arr.filter((l) => l !== listener)
    );
  }

  emit(event: string, changes: any, origin: any = null) {
    for (const l of this.listeners.get(event) || []) l(changes, origin);
  }

  listenerCount(event: string) {
    return (this.listeners.get(event) || []).length;
  }
}

describe('RoomAwarenessManager', () => {
  test('getStates filters to only the requested room', () => {
    const base = new FakeAwareness();
    base.setState(1, { _room: 'roomA', user: 'a' });
    base.setState(2, { _room: 'roomB', user: 'b' });
    base.setState(3, { _room: 'roomA', user: 'c' });

    const manager = new RoomAwarenessManager(base);
    const scoped = manager.getAwareness('roomA');

    const states = scoped.getStates();
    expect(states.size).toBe(2);
    expect(states.get(1)?.user).toBe('a');
    expect(states.get(3)?.user).toBe('c');
    expect(states.has(2)).toBe(false);
  });

  test('setLocalStateField tags the state with the room and preserves other fields', () => {
    const base = new FakeAwareness();
    const manager = new RoomAwarenessManager(base);
    const scoped = manager.getAwareness('roomA');

    scoped.setLocalStateField('user', { name: 'alice' });
    scoped.setLocalStateField('selection', { anchor: 0 });

    const local = base.getLocalState();
    expect(local).toEqual({
      _room: 'roomA',
      user: { name: 'alice' },
      selection: { anchor: 0 },
    });
  });

  test('on() filters added/updated to clients in room, leaves removed unfiltered', () => {
    const base = new FakeAwareness();
    base.setState(1, { _room: 'roomA' });
    base.setState(2, { _room: 'roomB' });

    const manager = new RoomAwarenessManager(base);
    const scoped = manager.getAwareness('roomA');

    const listener = vi.fn();
    scoped.on('change', listener);

    base.emit(
      'change',
      { added: [1, 2], updated: [], removed: [1, 2] },
      'origin'
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      { added: [1], updated: [], removed: [1, 2] },
      'origin'
    );
  });

  test('off() removes the correct wrapped listener without affecting others', () => {
    const base = new FakeAwareness();
    base.setState(1, { _room: 'roomA' });

    const manager = new RoomAwarenessManager(base);
    const scoped = manager.getAwareness('roomA');

    const listenerA = vi.fn();
    const listenerB = vi.fn();
    scoped.on('change', listenerA);
    scoped.on('change', listenerB);
    expect(base.listenerCount('change')).toBe(2);

    scoped.off('change', listenerA);
    expect(base.listenerCount('change')).toBe(1);

    base.emit('change', { added: [1], updated: [], removed: [] });
    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  test('two rooms scoped from the same base awareness stay isolated', () => {
    const base = new FakeAwareness();
    base.setState(1, { _room: 'roomA', user: 'a' });
    base.setState(2, { _room: 'roomB', user: 'b' });

    const manager = new RoomAwarenessManager(base);
    const scopedA = manager.getAwareness('roomA');
    const scopedB = manager.getAwareness('roomB');

    expect(scopedA.getStates().size).toBe(1);
    expect(scopedB.getStates().size).toBe(1);
    expect(scopedA.getStates().get(1)?.user).toBe('a');
    expect(scopedB.getStates().get(2)?.user).toBe('b');
  });
});
