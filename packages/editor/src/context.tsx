import React, { createContext, useContext } from "react";
import { useStore, type StoreApi } from "zustand";
import type { MindmapStoreState } from "@mindmap/core";

export const MindmapStoreContext = createContext<StoreApi<MindmapStoreState> | null>(null);

export function useMindmapStoreApi(): StoreApi<MindmapStoreState> {
  const store = useContext(MindmapStoreContext);
  if (!store) throw new Error("useMindmapStoreApi must be used inside MindmapEditor");
  return store;
}

export function useMindmapStore<T>(selector: (state: MindmapStoreState) => T): T {
  const store = useMindmapStoreApi();
  return useStore(store, selector);
}
