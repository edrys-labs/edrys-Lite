export class RoomAwarenessManager {
  constructor(private baseAwareness: any) {}

  getAwareness(room: string) {
    const roomAwareness = new Proxy(this.baseAwareness, {
      get: (target, prop) => {
        if (prop === 'getStates') {
          return () => {
            const allStates = target.getStates()
            return new Map(
              Array.from(
                allStates.entries() as IterableIterator<[string, any]>
              ).filter(([clientId, state]) => state._room === room)
            )
          }
        }
        if (prop === 'setLocalStateField') {
          return (field: string, value: any) => {
            const currentState = target.getLocalState() || {}
            target.setLocalState({
              ...currentState,
              _room: room,
              [field]: value,
            })
          }
        }

        if (prop === 'on') {
          return (event: string, listener: Function) => {
            target.on(event, (changes: any, origin: any) => {
              // Filter changes to include only those relevant to the room
              const filteredChanges = {
                added: changes.added.filter((clientId: string) => {
                  const state = target.getStates().get(clientId)
                  return state && state._room === room
                }),
                updated: changes.updated.filter((clientId: string) => {
                  const state = target.getStates().get(clientId)
                  return state && state._room === room
                }),
                removed: changes.removed.filter((clientId: string) => {
                  // We might not have the state anymore, so we need to track room assignments separately
                  return true // Simplification for this example
                }),
              }
              listener(filteredChanges, origin)
            })
          }
        }
        return target[prop]
      },
    })

    return roomAwareness
  }
}
