import { describe, expect, test } from 'vitest';
import { MAX_ROOM_LABEL_LENGTH, roomLabelProblem, withRoomLabel } from '../../../src/ts/RoomNames';

describe('roomLabelProblem', () => {
  test('accepts a free name, an empty one and the room\'s own name', () => {
    expect(roomLabelProblem('Group B', 'Room 2')).toBeNull();
    expect(roomLabelProblem('   ', 'Room 2')).toBeNull();
    expect(roomLabelProblem('room 2', 'Room 2')).toBeNull();
  });

  test.each(['Lobby', 'lobby', 'Station', 'Station A', 'Room 3', 'Raum 3', 'Sala 3', 'Кімната 3'])(
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
