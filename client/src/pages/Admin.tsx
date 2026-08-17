import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  LockKeyhole,
  Network,
  RefreshCw,
  Save,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type EditableProfile = {
  serverAddress: string;
  port: string;
  wsPath: string;
  tlsEnabled: boolean;
};

function copyValue(value: string, label: string) {
  navigator.clipboard.writeText(value)
    .then(() => toast.success(`${label} copied to clipboard`))
    .catch(() => toast.error(`Could not copy ${label.toLowerCase()}`));
}

function CopyField({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.035] p-3 ${className}`}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() => copyValue(value, label)}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <code className="block break-all font-mono text-xs leading-5 text-slate-200">{value}</code>
    </div>
  );
}

function Metric({ icon: Icon, label, value, hint }: { icon: typeof Activity; label: string; value: string; hint: string }) {
  return (
    <article className="gateway-panel relative overflow-hidden p-5">
      <div className="absolute -right-5 -top-5 h-24 w-24 rounded-full bg-cyan-400/[0.06] blur-2xl" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</p>
          <p className="mt-3 text-xl font-semibold tracking-tight text-slate-100">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{hint}</p>
        </div>
        <span className="rounded-xl border border-cyan-300/10 bg-cyan-300/[0.07] p-2.5 text-cyan-300">
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </article>
  );
}

function AdminLoading() {
  return (
    <div className="min-h-screen bg-[#080d16] p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <Skeleton className="h-12 w-64 bg-white/10" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32 bg-white/10" />
          <Skeleton className="h-32 bg-white/10" />
          <Skeleton className="h-32 bg-white/10" />
        </div>
        <Skeleton className="h-96 bg-white/10" />
      </div>
    </div>
  );
}

function SignInRequired() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#080d16] p-6 text-slate-100">
      <div className="gateway-panel w-full max-w-md p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-300">
          <LockKeyhole className="h-5 w-5" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Restricted control surface</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">Authenticate with the configured owner account to access gateway settings.</p>
        <Button onClick={() => startLogin()} className="mt-7 w-full bg-cyan-300 font-semibold text-slate-950 hover:bg-cyan-200">
          Continue with Manus
        </Button>
      </div>
    </div>
  );
}

function Forbidden() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#080d16] p-6 text-slate-100">
      <div className="gateway-panel w-full max-w-md p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-amber-300/20 bg-amber-300/10 text-amber-300">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Owner access required</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">This control surface is limited to the project owner. Your signed-in account has not been granted access.</p>
      </div>
    </div>
  );
}

function AdminContent() {
  const utils = trpc.useUtils();
  const { data: profile, isLoading, error } = trpc.vless.get.useQuery(undefined, { retry: false });
  const [form, setForm] = useState<EditableProfile>({ serverAddress: "", port: "443", wsPath: "/vless", tlsEnabled: true });

  useEffect(() => {
    document.title = "Gateway Control";
  }, []);

  useEffect(() => {
    if (!profile) return;
    setForm({
      serverAddress: profile.serverAddress,
      port: String(profile.port),
      wsPath: profile.wsPath,
      tlsEnabled: profile.tlsEnabled,
    });
  }, [profile]);

  const refreshProfile = () => utils.vless.get.invalidate();
  const updateMutation = trpc.vless.update.useMutation({
    onSuccess: () => {
      toast.success("Gateway settings saved");
      refreshProfile();
    },
    onError: error => toast.error(error.message || "Could not save the gateway settings"),
  });
  const regenerateUuid = trpc.vless.regenerateUuid.useMutation({
    onSuccess: () => {
      toast.success("Client UUID regenerated");
      refreshProfile();
    },
    onError: error => toast.error(error.message || "Could not regenerate the UUID"),
  });
  const regenerateToken = trpc.vless.regenerateToken.useMutation({
    onSuccess: () => {
      toast.success("Subscription token regenerated");
      refreshProfile();
    },
    onError: error => toast.error(error.message || "Could not regenerate the token"),
  });

  const subscriptionUrl = useMemo(
    () => profile ? `${window.location.origin}${profile.subscriptionPath}` : "",
    [profile],
  );

  const submitProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast.error("Enter a listener port between 1 and 65535");
      return;
    }
    updateMutation.mutate({ ...form, port });
  };

  if (isLoading) return <AdminLoading />;
  if (error || !profile) {
    return (
      <div className="p-4 sm:p-8">
        <Alert variant="destructive" className="border-red-500/20 bg-red-500/10 text-red-100">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Configuration is unavailable</AlertTitle>
          <AlertDescription>{error?.message || "The gateway profile could not be loaded."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="gateway-shell min-h-full">
      <div className="mx-auto max-w-6xl space-y-6 px-1 py-2 sm:px-4 sm:py-5">
        <header className="flex flex-col gap-5 border-b border-white/[0.08] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-cyan-300">
              <ServerCog className="h-4 w-4" />
              <span className="text-[11px] font-bold uppercase tracking-[0.18em]">Nginx gateway</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-slate-50">Connection control</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">A single owner-managed VLESS profile, with import details and rotation controls kept in one audited surface.</p>
          </div>
          <Badge className="w-fit border border-emerald-300/15 bg-emerald-300/[0.08] px-3 py-1.5 font-medium text-emerald-300 hover:bg-emerald-300/[0.08]">
            <Activity className="mr-1.5 h-3.5 w-3.5" /> Profile synchronized
          </Badge>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <Metric icon={Network} label="Transport" value="VLESS / WebSocket" hint="Encrypted client transport" />
          <Metric icon={ShieldCheck} label="Security" value={profile.tlsEnabled ? "TLS enabled" : "TLS disabled"} hint={profile.tlsEnabled ? "Client URI uses TLS" : "Use only behind protected transport"} />
          <Metric icon={Link2} label="Subscription" value="Tokenized feed" hint="Public endpoint, unguessable token" />
        </section>

        <Alert className="border-amber-300/15 bg-amber-300/[0.055] text-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-300" />
          <AlertTitle className="font-semibold text-amber-100">Listener deployment required</AlertTitle>
          <AlertDescription className="text-amber-100/70">This dashboard manages the profile and subscription feed. The configured server address must point to a separately deployed, publicly reachable Xray listener.</AlertDescription>
        </Alert>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(350px,0.8fr)]">
          <section className="gateway-panel p-5 sm:p-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="gateway-eyebrow">Gateway profile</p>
                <h2 className="mt-2 text-lg font-semibold text-slate-50">Listener parameters</h2>
                <p className="mt-1 text-sm text-slate-500">Changes are persisted immediately for new subscription imports.</p>
              </div>
              <span className="flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-400">
                <Check className="h-3.5 w-3.5 text-emerald-300" /> Stored in database
              </span>
            </div>
            <Separator className="my-6 bg-white/[0.08]" />
            <form className="space-y-5" onSubmit={submitProfile}>
              <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_140px]">
                <div className="space-y-2">
                  <Label htmlFor="serverAddress" className="text-xs font-medium text-slate-300">Server address</Label>
                  <Input id="serverAddress" value={form.serverAddress} onChange={event => setForm(current => ({ ...current, serverAddress: event.target.value }))} placeholder="gateway.example.com" className="gateway-input" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="port" className="text-xs font-medium text-slate-300">Port</Label>
                  <Input id="port" value={form.port} onChange={event => setForm(current => ({ ...current, port: event.target.value }))} inputMode="numeric" className="gateway-input" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wsPath" className="text-xs font-medium text-slate-300">WebSocket path</Label>
                <Input id="wsPath" value={form.wsPath} onChange={event => setForm(current => ({ ...current, wsPath: event.target.value }))} placeholder="/vless" className="gateway-input font-mono" />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.025] px-4 py-3.5">
                <div>
                  <Label htmlFor="tlsEnabled" className="text-sm font-medium text-slate-200">TLS transport</Label>
                  <p className="mt-1 text-xs text-slate-500">Advertise TLS in the generated VLESS URI.</p>
                </div>
                <Switch id="tlsEnabled" checked={form.tlsEnabled} onCheckedChange={tlsEnabled => setForm(current => ({ ...current, tlsEnabled }))} />
              </div>
              <div className="flex justify-end pt-1">
                <Button type="submit" disabled={updateMutation.isPending} className="bg-cyan-300 font-semibold text-slate-950 hover:bg-cyan-200">
                  {updateMutation.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save settings
                </Button>
              </div>
            </form>
          </section>

          <section className="gateway-panel p-5 sm:p-7">
            <p className="gateway-eyebrow">Client import</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-50">Ready-to-import access</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Use the client URI directly, or import the subscription feed to receive the current profile.</p>
            <div className="mt-6 space-y-3">
              <CopyField label="VLESS URI" value={profile.vlessUri} />
              <CopyField label="Subscription feed" value={subscriptionUrl} />
              <CopyField label="Public route" value={profile.subscriptionPath} />
            </div>
            <Button variant="outline" onClick={() => window.open(profile.subscriptionPath, "_blank", "noopener,noreferrer")} className="mt-4 w-full border-white/10 bg-white/[0.035] text-slate-200 hover:bg-white/[0.08] hover:text-white">
              <ExternalLink className="mr-2 h-4 w-4" /> Open subscription response
            </Button>
          </section>
        </div>

        <section className="gateway-panel overflow-hidden">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div>
              <p className="gateway-eyebrow">Credential lifecycle</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-50">Rotate access material</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Rotating the UUID invalidates existing client credentials. Rotating the subscription token invalidates the old public route.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="border-white/10 bg-white/[0.035] text-slate-200 hover:bg-white/[0.08] hover:text-white"><KeyRound className="mr-2 h-4 w-4" /> Rotate UUID</Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="border-white/10 bg-[#111a29] text-slate-100">
                  <AlertDialogHeader><AlertDialogTitle>Rotate client UUID?</AlertDialogTitle><AlertDialogDescription className="text-slate-400">All existing VLESS client imports using this UUID will stop working after the live configuration updates.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel className="border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] hover:text-white">Cancel</AlertDialogCancel><AlertDialogAction onClick={() => regenerateUuid.mutate()} className="bg-cyan-300 text-slate-950 hover:bg-cyan-200">Rotate UUID</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="border-white/10 bg-white/[0.035] text-slate-200 hover:bg-white/[0.08] hover:text-white"><RefreshCw className="mr-2 h-4 w-4" /> Rotate feed token</Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="border-white/10 bg-[#111a29] text-slate-100">
                  <AlertDialogHeader><AlertDialogTitle>Rotate the subscription token?</AlertDialogTitle><AlertDialogDescription className="text-slate-400">The previous public subscription URL will no longer return a configuration. Client URI credentials are not changed.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel className="border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] hover:text-white">Cancel</AlertDialogCancel><AlertDialogAction onClick={() => regenerateToken.mutate()} className="bg-cyan-300 text-slate-950 hover:bg-cyan-200">Rotate token</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function Admin() {
  const { user, loading } = useAuth();
  if (loading) return <AdminLoading />;
  if (!user) return <SignInRequired />;
  if (user.role !== "admin") return <Forbidden />;

  return <DashboardLayout><AdminContent /></DashboardLayout>;
}
