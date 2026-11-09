import en from "../locales/en.yaml";
import de from "../locales/de.yaml";
import uk from "../locales/uk.yaml";
import ar from "../locales/ar.yaml";
import es from "../locales/es.yaml";

export const MAX_ROOM_LABEL_LENGTH = 40;

export type RoomLabelProblem = "tooLong" | "characters" | "reserved" | "taken";

const locales: any[] = [en, de, uk, ar, es];
const sideMenus = locales.map((messages) => messages.classroom.sideMenu);
// a module's room list also takes these, so a room can't be named after them
const roleEntries = locales.flatMap(({ settings }) => {
  const { teacherOnly, stationOnly } = settings.modules.module.showIn;
  return [teacherOnly.toLowerCase(), stationOnly.toLowerCase()];
});
const words = (key: "lobby" | "station" | "room"): string[] =>
  sideMenus.map((menu) => menu[key].toLowerCase());

const normalized = (label: string) => label.trim().toLowerCase();

// Labels are seen in every language, so all of them count. "Room 3" is
// reserved even while the class has fewer rooms, as it can be added later.
function isReserved(name: string): boolean {
  if (words("lobby").includes(name) || roleEntries.includes(name)) return true;
  if (words("station").some((word) => name === word || name.startsWith(word + " "))) return true;
  return words("room").some((word) => new RegExp(`^${word}\\s+\\d+$`).test(name));
}

/** The label the class gave this room, if any. */
export function roomLabel(roomNames: Record<string, string> | undefined, room: string): string | undefined {
  const label = roomNames?.[room];
  return typeof label === "string" && label.trim() ? label.trim() : undefined;
}

/** The label's first character for a tile, whole even when it is an emoji. */
export function firstLetter(label: string): string {
  return Array.from(label)[0]?.toUpperCase() ?? "";
}

/** A module's room list for reading: each room it names by its label, if it has one. */
export function showInWithLabels(showIn: string, roomNames: Record<string, string> = {}): string {
  return (showIn || "*")
    .split(",")
    .map((entry) => {
      const name = entry.trim();
      const room = Object.keys(roomNames).find((key) => normalized(key) === normalized(name));
      return (room && roomLabel(roomNames, room)) || name;
    })
    .join(", ");
}

/** Whether `name` is one of a module's room entries: whole names, `*` as a wildcard. */
export function showInMatches(entries: string[], name: string): boolean {
  return entries.some((entry) => {
    const pattern = entry
      .toLowerCase()
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${pattern}$`).test(name.toLowerCase());
  });
}

/** Names of the modules that are in `room` only through `oldLabel` and so leave it with `newLabel`. */
export function modulesLeavingRoom(
  modules: { name?: string; showIn?: string | string[]; showInCustom?: string }[] = [],
  room: string,
  oldLabel: string | undefined,
  newLabel: string
): string[] {
  if (!oldLabel) return [];
  const leaving = modules.filter((module) => {
    const raw = module.showInCustom ? module.showInCustom.split(",") : module.showIn ?? [];
    const entries = (Array.isArray(raw) ? raw : [raw]).map((entry) => entry.trim());
    return (
      showInMatches(entries, oldLabel) &&
      !showInMatches(entries, room) &&
      !(newLabel.trim() && showInMatches(entries, newLabel.trim()))
    );
  });
  return [...new Set(leaving.map((module) => module.name ?? ""))].filter(Boolean);
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

/** Why `name` can't name a station, or null if it can. Being in use is checked against the live class. */
export function stationNameProblem(name: string): "tooLong" | "characters" | null {
  if (name.trim().length > MAX_ROOM_LABEL_LENGTH) return "tooLong";
  // `,` and `*` have a meaning in a module's room list
  return /[,*]/.test(name) ? "characters" : null;
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
