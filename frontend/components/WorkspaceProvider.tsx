"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiGet } from "@/lib/client";
import { isWorkspace, type Workspace, type ConsoleIdentity } from "@/lib/workspace";

interface WorkspaceContextValue {
  identity: ConsoleIdentity;
  workspace: Workspace | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
}
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ identity, children }: { identity: ConsoleIdentity; children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    setWorkspace(null);
    apiGet<Workspace>("v1/workspace").then((data) => {
      if (!isWorkspace(data)) throw new Error("Invalid workspace response");
      if (current) setWorkspace(data);
    }).catch((err: unknown) => { if (current) setError(err); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [revision]);
  return <WorkspaceContext.Provider value={{ identity, workspace, loading, error, reload }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("WorkspaceProvider is required");
  return context;
}
