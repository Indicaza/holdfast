import { useEffect, useState } from 'react'

// The floor on show. Choosing an encounter turns to the floor its pin is on;
// the player can turn it by hand, and that choice stands until then.
export function useJournalFloor(map, selectedKey = '') {
  const pinFloor = map?.pins.find((pin) => pin.bossKey === selectedKey)?.floorId
  const [floorId, setFloorId] = useState(pinFloor || map?.floors[0]?.floorId)
  useEffect(() => {
    if (pinFloor) setFloorId(pinFloor)
  }, [pinFloor])
  return [map?.floors.some((floor) => floor.floorId === floorId) ? floorId : map?.floors[0]?.floorId, setFloorId]
}
