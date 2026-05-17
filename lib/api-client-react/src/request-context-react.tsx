import React, { createContext, useContext, useMemo } from "react";
import { setRequestContext } from "./request-context";

const RequestContext = createContext<{ accessReason?: string | null }>({ accessReason: null });

export function RequestContextProvider({ accessReason, children }: { accessReason?: string | null; children: React.ReactNode }) {
  const value = useMemo(() => ({ accessReason: accessReason ?? null }), [accessReason]);
  setRequestContext(value);
  return <RequestContext.Provider value={value}>{children}</RequestContext.Provider>;
}

export function useRequestContext() {
  return useContext(RequestContext);
}
