import { Button } from "@/components/ui/button";
import { Copy, FileKey2, QrCode, RefreshCw, ShieldCheck } from "lucide-react";

type GatewaySubscriptionPanelProps = {
  url: string;
  pending: boolean;
  onCopy: () => void;
  onQr: () => void;
  onRotate: () => void;
};

export function GatewaySubscriptionPanel({ url, pending, onCopy, onQr, onRotate }: GatewaySubscriptionPanelProps) {
  return <section className="overflow-hidden rounded-xl border border-primary/20 bg-card shadow-sm"><div className="border-b border-primary/15 bg-primary/5 p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><FileKey2 className="h-5 w-5" /></span><div><p className="protocol-overline text-primary">Gateway subscription</p><h2 className="mt-1 text-lg font-semibold">Import feed control</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">A single feed for VLESS, VMess, and Trojan. Per-client remaining quota and validity are shown on their own subscription pages.</p></div></div></div><div className="p-5 sm:p-6"><div className="rounded-lg border border-border bg-muted/30 p-3"><p className="protocol-overline">Subscription address</p><code className="mt-2 block break-all text-xs leading-5 text-foreground">{url}</code></div><div className="mt-3 grid grid-cols-2 gap-2"><Button variant="outline" onClick={onCopy}><Copy className="mr-2 h-4 w-4" />Copy</Button><Button variant="outline" onClick={onQr}><QrCode className="mr-2 h-4 w-4" />QR code</Button></div><div className="mt-5 grid gap-2 sm:grid-cols-2"><div className="rounded-lg bg-muted/40 p-3"><p className="protocol-overline">Payload</p><p className="mt-1 text-sm font-semibold">3 URI profiles</p><p className="mt-1 text-xs text-muted-foreground">VLESS · VMess · Trojan</p></div><div className="rounded-lg bg-muted/40 p-3"><p className="protocol-overline">SOCKS5</p><p className="mt-1 text-sm font-semibold">Separate JSON import</p><p className="mt-1 text-xs text-muted-foreground">Shown in the protocol workspace</p></div></div><div className="mt-5 flex items-start justify-between gap-3 rounded-lg border border-border bg-background/50 p-3"><div className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><p className="text-xs leading-5 text-muted-foreground">Rotating the token invalidates the old global subscription address immediately.</p></div><Button size="sm" variant="ghost" className="shrink-0" onClick={onRotate} disabled={pending}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Rotate</Button></div></div></section>;
}
