import en from "../locales/en.yaml";
import de from "../locales/de.yaml";
import uk from "../locales/uk.yaml";
import ar from "../locales/ar.yaml";
import es from "../locales/es.yaml";

export const MAX_ROOM_LABEL_LENGTH = 40;

export type RoomLabelProblem = "tooLong" | "characters" | "reserved" | "taken";

const sideMenus = [en, de, uk, ar, es].map((messages: any) => messages.classroom.sideMenu);
const words = (key: "lobby" | "station" | "room"): string[] =>
  sideMenus.map((menu) => menu[key].toLowerCase());

const normalized = (label: string) => label.trim().toLowerCase();

// Labels are seen in every language, so all of them count. "Room 3" is
// reserved even while the class has fewer rooms, as it can be added later.
function isReserved(name: string): boolean {
  if (words("lobby").includes(name)) return true;
  if (words("station").some((word) => name === word || name.startsWith(word + " "))) return true;
  return words("room").some((word) => new RegExp(`^${word}\\s+\\d+$`).test(name));
}

/** Why `label` can't name `room`, or null if it can. An empty label clears the name. */
export function roomLabelProblem(
  label: string,
  room: string,
  roomNames: Record<string, string> = {}
): RoomLabelProblem | null {
  const name = normalized(label);
  if (!name || name === normalized(room)) return null;
  if (label.trim().length > MAX_ROOM_LABEL_LENGTH) return "tooLong";
  // `,` and `*` have a meaning in a module's room list
  if (/[,*]/.test(name)) return "characters";
  if (isReserved(name)) return "reserved";
  const taken = Object.entries(roomNames).some(
    ([other, otherLabel]) => other !== room && normalized(String(otherLabel)) === name
  );
  return taken ? "taken" : null;
}

/** A copy of `meta` with the room's label set, or removed when empty or its own name. */
export function withRoomLabel(meta: any, room: string, label: string): any {
  const { roomNames = {}, ...rest } = meta ?? {};
  const names = { ...roomNames };
  const trimmed = label.trim();

  if (trimmed && normalized(trimmed) !== normalized(room)) names[room] = trimmed;
  else delete names[room];

  return Object.keys(names).length ? { ...rest, roomNames: names } : rest;
}
