"use client";

import { useEffect, useState } from "react";
import { formatSyncTs, type CacheStatusInfo } from "@/components/SyncStatusDrawer";

export function NavSyncTimestamp() {
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  useEffect(() => {
    function onStatus(e: Event) {
      const detail = (e as CustomEvent<CacheStatusInfo>).detail;
      if (detail?.last_synced_at) {
        setLastSynced(detail.last_synced_at);
      }
    }
    window.addEventListener("soldouts:sync-status", onStatus);
    return () => window.removeEventListener("soldouts:sync-status", onStatus);
  }, []);

  return (
    <span className="text-caption shrink-0">
      Last synced: {formatSyncTs(lastSynced)}
    </span>
  );
}
