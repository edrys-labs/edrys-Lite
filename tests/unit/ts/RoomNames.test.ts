import { describe, expect, test } from 'vitest';
import { MAX_ROOM_LABEL_LENGTH, modulesLeavingRoom, roomLabelProblem, showInWithLabels, withRoomLabel } from '../../../src/ts/RoomNames';

describe('roomLabelProblem', () => {
  test('accepts a free name, an empty one and the room\'s own name', () => {
    expect(roomLabelProblem('Group B', 'Room 2')).toBeNull();
    expect(roomLabelProblem('   ', 'Room 2')).toBeNull();
    expect(roomLabelProblem('room 2', 'Room 2')).toBeNull();
  });

  test.each(['Lobby', 'lobby', 'Station', 'Station A', 'Room 3', 'Raum 3', 'Sala 3', 'Кімната 3', 'teacher-only', 'nur Station'])(
    'reserves %s',
    (label) => expect(roomLabelProblem(label, 'Room 2')).toBe('reserved')
  );

  test('does not reserve names that only start with a room word', () => {
    expect(roomLabelProblem('Room for groups', 'Room 2')).toBeNull();
    expect(roomLabelProblem('Stationery', 'Room 2')).toBeNull();
  });

  test('rejects the characters a module room list gives a meaning', () => {
    expect(roomLabelProblem('A, B', 'Room 2')).toBe('characters');
    expect(roomLabelProblem('A*', 'Room 2')).toBe('characters');
  });

  test('rejects a label over the limit, counted without outer spaces', () => {
    const longest = 'x'.repeat(MAX_ROOM_LABEL_LENGTH);
    expect(roomLabelProblem(`  ${longest}  `, 'Room 2')).toBeNull();
    expect(roomLabelProblem(longest + 'x', 'Room 2')).toBe('tooLong');
  });

  test('needs labels to be unique, ignoring case but not the room itself', () => {
    const names = { 'Room 1': 'Group A', 'Room 2': 'Group B' };
    expect(roomLabelProblem(' group a ', 'Room 2', names)).toBe('taken');
    expect(roomLabelProblem('group b', 'Room 2', names)).toBeNull();
  });
});

describe('showInWithLabels', () => {
  const names = { 'Room 1': 'sim' };

  test('replaces rooms that have a label, whatever their case', () => {
    expect(showInWithLabels('Room 1', names)).toBe('sim');
    expect(showInWithLabels('lobby, room 1, teacher-only', names)).toBe('lobby, sim, teacher-only');
  });

  test('leaves other entries as written and shows * for none', () => {
    expect(showInWithLabels('Room 2, Group*', names)).toBe('Room 2, Group*');
    expect(showInWithLabels('', names)).toBe('*');
    expect(showInWithLabels('Room 1')).toBe('Room 1');
  });
});

describe('modulesLeavingRoom', () => {
  const leaving = (showInCustom: string, newLabel = 'Other') =>
    modulesLeavingRoom([{ name: 'M', showInCustom }], 'Room 2', 'Group B', newLabel);

  test('finds a module listing the old label, by name or wildcard', () => {
    expect(leaving('Group B')).toEqual(['M']);
    expect(leaving('lobby, group*')).toEqual(['M']);
    expect(leaving('Group B', '')).toEqual(['M']);
  });

  test('ignores modules that stay in the room', () => {
    expect(leaving('Room 2, Group B')).toEqual([]);
    expect(leaving('*')).toEqual([]);
    expect(leaving('Room 1')).toEqual([]);
    expect(leaving('Group*', 'Group C')).toEqual([]);
  });

  test('has nothing to warn about for a room without a label', () => {
    expect(modulesLeavingRoom([{ name: 'M', showInCustom: 'x' }], 'Room 2', undefined, 'y')).toEqual([]);
  });

  test('reads a module\'s own showIn and names each module once', () => {
    const modules = [{ name: 'M', showIn: ['Group B'] }, { name: 'M', showInCustom: 'Group B' }];
    expect(modulesLeavingRoom(modules, 'Room 2', 'Group B', 'Other')).toEqual(['M']);
  });
});

describe('withRoomLabel', () => {
  test('sets a trimmed label and keeps the rest of meta and the input intact', () => {
    const meta = { defaultNumberOfRooms: 2, roomNames: { 'Room 1': 'A' } };
    expect(withRoomLabel(meta, 'Room 2', ' B ')).toEqual({
      defaultNumberOfRooms: 2,
      roomNames: { 'Room 1': 'A', 'Room 2': 'B' },
    });
    expect(meta.roomNames).toEqual({ 'Room 1': 'A' });
  });

  test('clears on an empty label or the room\'s own name, and drops an empty map', () => {
    const meta = { defaultNumberOfRooms: 2, roomNames: { 'Room 1': 'A' } };
    expect(withRoomLabel(meta, 'Room 1', '')).toEqual({ defaultNumberOfRooms: 2 });
    expect(withRoomLabel(meta, 'Room 1', 'room 1')).toEqual({ defaultNumberOfRooms: 2 });
  });
});
