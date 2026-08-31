"use client";

import { useSyncExternalStore } from "react";

let signalQueueOpen = true;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return signalQueueOpen;
}

export function setSignalQueueOpen(open: boolean) {
  if (signalQueueOpen === open) return;
  signalQueueOpen = open;
  listeners.forEach((listener) => listener());
}

export function useSignalQueueOpen() {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
