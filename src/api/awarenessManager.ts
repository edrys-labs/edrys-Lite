export class RoomAwarenessManager {
  // Caller's listener -> the wrapped one registered, so off() removes it.
  private wrapped = new WeakMap<Function, Function>()

  constructor(private baseAwareness: any) {}

  getAwareness(room: string) {
    const self = this
    const target = this.baseAwareness

    return new Proxy(target, {
      get: (target, prop) => {
        if (prop === 'getStates') {
          return () =>
            new Map(
              Array.from(
                target.getStates().entries() as IterableIterator<[number, any]>
              ).filter(([, state]) => state?._room === room)
            )
        }

        if (prop === 'setLocalStateField') {
          return (field: string, value: any) => {
            const current = target.getLocalState() || {}
            target.setLocalState({ ...current, _room: room, [field]: value })
          }
        }

        if (prop === 'on') {
          return (event: string, listener: Function) => {
            const inRoom = (clientId: number) =>
              target.getStates().get(clientId)?._room === room
            const wrapped = (changes: any, origin: any) => {
              listener(
                {
                  added: (changes.added || []).filter(inRoom),
                  updated: (changes.updated || []).filter(inRoom),
                  // Unfiltered: state is already gone, and consumers re-derive
                  // from the room-scoped getStates().
                  removed: changes.removed || [],
                },
                origin
              )
            }
            self.wrapped.set(listener, wrapped)
            target.on(event, wrapped)
          }
        }

        if (prop === 'off') {
          return (event: string, listener: Function) => {
            const w = self.wrapped.get(listener)
            if (w) {
              target.off(event, w)
              self.wrapped.delete(listener)
            }
          }
        }

        const value = target[prop]
        // Bind to the real Awareness: raw methods leave `this` as the proxy,
        // so internal calls re-enter these traps.
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
}
