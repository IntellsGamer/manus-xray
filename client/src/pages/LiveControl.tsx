import DashboardLayout from "@/components/DashboardLayout";
import { LiveSessionsPanel, type ClientProtocol, type LiveSessionGroup } from "@/components/LiveSessionsPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

function LiveControlLoading() {
  return <div className="protocol-shell min-h-full"><div className="mx-auto max-w-6xl space-y-5 py-2 sm:py-5"><div className="space-y-3"><Skeleton className="h-3 w-28" /><Skeleton className="h-9 w-52" /><Skeleton className="h-4 w-96 max-w-full" /></div><section className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]"><div className="protocol-panel p-6"><Skeleton className="h-5 w-44" /><Skeleton className="mt-3 h-4 w-full" /><Skeleton className="mt-8 h-20 w-full" /></div><div className="protocol-panel p-6"><Skeleton className="h-5 w-36" /><Skeleton className="mt-3 h-4 w-full" /><Skeleton className="mt-8 h-40 w-full" /></div></section></div></div>;
}

function useLiveSessionGroups(initialGroups: LiveSessionGroup[] | undefined) {
  const [groups, setGroups] = useState<LiveSessionGroup[]>(initialGroups || []);
  const [connected, setConnected] = useState(false);
  const receivedStreamEvent = useRef(false);

  useEffect(() => {
    if (!receivedStreamEvent.current) setGroups(initialGroups || []);
  }, [initialGroups]);

  useEffect(() => {
    const source = new EventSource("/api/live-sessions/events");
    const onSessions = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as LiveSessionGroup[];
        receivedStreamEvent.current = true;
        setGroups(payload);
        setConnected(true);
      } catch {
        setConnected(false);
      }
    };
    source.addEventListener("sessions", onSessions);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, []);

  return { groups, connected };
}

export function LiveControlContent() {
  const utils = trpc.useUtils();
  const { data: clients, isLoading: loadingClients } = trpc.vless.clients.useQuery(undefined, { retry: false });
  const { data: initialGroups, isLoading: loadingGroups } = trpc.vless.liveSessionGroups.useQuery(undefined, { retry: false, refetchOnWindowFocus: false, staleTime: Infinity });
  const { groups, connected } = useLiveSessionGroups(initialGroups);
  const disconnectGroup = trpc.vless.disconnectLiveSessionGroup.useMutation({
    onSuccess: result => toast.success(`Disconnect requested for ${result.requested} tunnel${result.requested === 1 ? "" : "s"}`),
    onError: error => toast.error(error.message),
  });
  const updatePolicy = trpc.vless.updateClientPolicy.useMutation({
    onSuccess: () => { toast.success("Client protocol policy saved"); utils.vless.clients.invalidate(); },
    onError: error => toast.error(error.message),
  });

  if (loadingClients || loadingGroups || !clients) return <LiveControlLoading />;
  return <LiveSessionsPanel clients={clients} groups={groups} streamConnected={connected} pending={disconnectGroup.isPending || updatePolicy.isPending} onDisconnectGroup={group => disconnectGroup.mutate({ clientId: group.clientId, protocol: group.protocol, sourceGroup: group.sourceGroup })} onSaveAllowedProtocols={(clientId, allowedProtocols) => {
    const client = clients.find(item => item.id === clientId);
    if (!client) return;
    updatePolicy.mutate({ id: client.id, trafficLimitBytes: client.trafficLimitBytes, dayLimit: client.dayLimit, speedLimitMbps: client.speedLimitMbps, connectionLimit: client.connectionLimit, allowedProtocols: allowedProtocols as ClientProtocol[] });
  }} />;
}

export default function LiveControl() {
  return <DashboardLayout><LiveControlContent /></DashboardLayout>;
}
