import DashboardLayout from "@/components/DashboardLayout";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { parseCloudflareTraceCountry } from "@/lib/cloudflareTrace";
import { Clock3, Globe2, Laptop, MapPin, Monitor, RefreshCw, ShieldCheck, Smartphone, Tablet, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

function relativeTime(value: Date) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function DeviceIcon({ kind }: { kind: string }) {
  const className = "h-5 w-5";
  if (kind === "mobile") return <Smartphone className={className} />;
  if (kind === "tablet") return <Tablet className={className} />;
  if (kind === "desktop") return <Monitor className={className} />;
  return <Laptop className={className} />;
}

function countryLabel(countryCode: string | null) {
  if (!countryCode) return "Country unavailable";
  try {
    return new Intl.DisplayNames([navigator.language], { type: "region" }).of(countryCode) || countryCode;
  } catch {
    return countryCode;
  }
}

function DevicesLoading() {
  return <div className="protocol-shell min-h-full"><div className="mx-auto max-w-6xl space-y-5 py-2 sm:py-5"><header className="protocol-header"><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-9 w-48" /><Skeleton className="mt-3 h-4 w-96 max-w-full" /></header><section className="grid gap-4 md:grid-cols-2"><Skeleton className="h-52" /><Skeleton className="h-52" /></section></div></div>;
}

export default function Devices() {
  const utils = trpc.useUtils();
  const devicesQuery = trpc.devices.list.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const reportCountry = trpc.devices.reportCountry.useMutation({
    onSuccess: async result => {
      if (result.success) await utils.devices.list.invalidate();
    },
  });
  const remove = trpc.devices.remove.useMutation({
    onSuccess: async (_result, variables) => {
      if (variables.id === devicesQuery.data?.currentDeviceId) {
        try { localStorage.removeItem("nginx-gateway-owner-session"); } catch {}
        utils.auth.me.setData(undefined, null);
        toast.success("This device was removed");
        window.setTimeout(() => window.location.assign("/"), 250);
        return;
      }
      await utils.devices.list.invalidate();
      toast.success("Device removed");
    },
    onError: error => toast.error(error.message),
  });
  const removeAll = trpc.devices.removeAll.useMutation({
    onSuccess: () => {
      try { localStorage.removeItem("nginx-gateway-owner-session"); } catch {}
      utils.auth.me.setData(undefined, null);
      toast.success("All devices removed");
      window.setTimeout(() => window.location.assign("/"), 250);
    },
    onError: error => toast.error(error.message),
  });

  const currentDevice = devicesQuery.data?.devices.find(device => device.id === devicesQuery.data?.currentDeviceId);
  useEffect(() => {
    if (!currentDevice || currentDevice.countryCode || reportCountry.isPending) return;
    let cancelled = false;
    fetch("/cdn-cgi/trace", { cache: "no-store", credentials: "same-origin" })
      .then(response => response.ok ? response.text() : "")
      .then(trace => {
        const countryCode = parseCloudflareTraceCountry(trace);
        if (!cancelled && countryCode) reportCountry.mutate({ countryCode });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [currentDevice?.countryCode, currentDevice?.id, reportCountry]);

  if (devicesQuery.isLoading || !devicesQuery.data) return <DashboardLayout><DevicesLoading /></DashboardLayout>;
  const { devices, currentDeviceId } = devicesQuery.data;

  return <DashboardLayout><div className="protocol-shell min-h-full"><div className="mx-auto max-w-6xl space-y-5 py-2 sm:py-5">
    <header className="protocol-header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="protocol-overline">Owner security</p><h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">Devices</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Authorized browsers observed at the Cloudflare edge. Country, city, and IP are shown only when Cloudflare provides them.</p></div><AlertDialog><AlertDialogTrigger asChild><Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={devices.length === 0 || removeAll.isPending}><Trash2 className="mr-2 h-4 w-4" />Remove all</Button></AlertDialogTrigger><AlertDialogContent className="protocol-dialog"><AlertDialogHeader><AlertDialogTitle>Remove every device?</AlertDialogTitle><AlertDialogDescription>This revokes all listed browser devices, including the current one, and signs this browser out.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => removeAll.mutate()}>Remove all devices</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></header>

    <section className="grid gap-4 sm:grid-cols-3"><div className="protocol-panel p-5"><p className="protocol-overline">Active registry</p><p className="mt-2 text-3xl font-semibold tracking-[-.04em]">{devices.length}</p><p className="mt-1 text-sm text-muted-foreground">authorized device{devices.length === 1 ? "" : "s"}</p></div><div className="protocol-panel p-5"><p className="protocol-overline">Current session</p><p className="mt-2 flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5 text-emerald-500" />{currentDeviceId ? "Recognized" : "Pending"}</p><p className="mt-1 text-sm text-muted-foreground">Bound to the secure device cookie.</p></div><div className="protocol-panel p-5"><p className="protocol-overline">Location source</p><p className="mt-2 flex items-center gap-2 text-lg font-semibold"><Globe2 className="h-5 w-5 text-primary" />Cloudflare edge</p><p className="mt-1 text-sm text-muted-foreground">No third-party geolocation lookup.</p></div></section>

    <section className="space-y-3"><div className="flex items-end justify-between"><div><p className="protocol-overline">Authorized browsers</p><h2 className="mt-1 text-lg font-semibold">Device registry</h2></div><Button size="sm" variant="ghost" onClick={() => devicesQuery.refetch()} disabled={devicesQuery.isFetching}><RefreshCw className={`mr-2 h-3.5 w-3.5 ${devicesQuery.isFetching ? "animate-spin" : ""}`} />Refresh</Button></div>{devices.length === 0 ? <div className="protocol-panel p-10 text-center"><Laptop className="mx-auto h-8 w-8 text-muted-foreground" /><h3 className="mt-4 font-semibold">No authorized devices</h3><p className="mt-2 text-sm text-muted-foreground">The next successful owner session will appear here.</p></div> : <div className="grid gap-4 md:grid-cols-2">{devices.map(device => {
      const isCurrent = device.id === currentDeviceId;
      const location = [device.city, device.region].filter(Boolean).join(", ") || null;
      return <article key={device.id} className={`protocol-panel relative overflow-hidden p-5 ${isCurrent ? "ring-1 ring-primary/35" : ""}`}><div className="flex items-start gap-4"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${isCurrent ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}><DeviceIcon kind={device.deviceKind} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-semibold">{device.deviceName}</h3>{isCurrent && <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">This device</Badge>}</div><p className="mt-1 text-sm text-muted-foreground">{device.browser} · {device.operatingSystem}</p></div></div><div className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span>{location || "City unavailable"}<small className="mt-0.5 block text-xs text-muted-foreground">{device.countryCode || "Country unavailable"}</small></span></div><div className="flex items-start gap-2"><Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="font-mono text-xs leading-5">{device.ipAddress || "IP unavailable"}<small className="mt-0.5 block font-sans text-xs text-muted-foreground">Cloudflare source IP</small></span></div><div className="flex items-start gap-2 sm:col-span-2"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span>Last active {relativeTime(device.lastSeenAt)}<small className="mt-0.5 block text-xs text-muted-foreground">First seen {new Date(device.firstSeenAt).toLocaleString()}</small></span></div></div><div className="mt-5 flex justify-end"><AlertDialog><AlertDialogTrigger asChild><Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={remove.isPending}><Trash2 className="mr-2 h-3.5 w-3.5" />Remove</Button></AlertDialogTrigger><AlertDialogContent className="protocol-dialog"><AlertDialogHeader><AlertDialogTitle>Remove this device?</AlertDialogTitle><AlertDialogDescription>{isCurrent ? "This browser will be signed out immediately." : "This device’s next request will be rejected."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => remove.mutate({ id: device.id })}>Remove device</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></article>;
    })}</div>}</section>
  </div></div></DashboardLayout>;
}
