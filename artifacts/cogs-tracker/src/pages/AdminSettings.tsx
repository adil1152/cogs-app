import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSmtpSettings,
  useUpdateSmtpSettings,
  useTestSmtpSettings,
  getGetSmtpSettingsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { AppLayout, PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Mail, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useGetSmtpSettings();

  const [provider, setProvider] = useState<"smtp" | "graph">("smtp");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [graphTenantId, setGraphTenantId] = useState("");
  const [graphClientId, setGraphClientId] = useState("");
  const [graphClientSecret, setGraphClientSecret] = useState("");
  const [graphSenderEmail, setGraphSenderEmail] = useState("");
  const [testTo, setTestTo] = useState("");

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.provider === "graph" ? "graph" : "smtp");
    setHost(settings.host ?? "");
    setPort(String(settings.port ?? 587));
    setSecure(Boolean(settings.secure));
    setUsername(settings.username ?? "");
    setFromEmail(settings.fromEmail ?? "");
    setFromName(settings.fromName ?? "");
    setGraphTenantId(settings.graphTenantId ?? "");
    setGraphClientId(settings.graphClientId ?? "");
    setGraphSenderEmail(settings.graphSenderEmail ?? "");
  }, [settings]);

  useEffect(() => {
    if (user?.email && !testTo) setTestTo(user.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  const save = useUpdateSmtpSettings({
    mutation: {
      onSuccess: () => {
        toast({ title: "Email settings saved" });
        setPassword("");
        setGraphClientSecret("");
        queryClient.invalidateQueries({ queryKey: getGetSmtpSettingsQueryKey() });
      },
      onError: (err: any) =>
        toast({
          title: "Could not save settings",
          description: err?.message,
          variant: "destructive",
        }),
    },
  });

  const test = useTestSmtpSettings({
    mutation: {
      onSuccess: () =>
        toast({
          title: "Test email sent",
          description: `Check the inbox of ${testTo.trim()}.`,
        }),
      onError: (err: any) =>
        toast({
          title: "Test email failed",
          description: err?.message,
          variant: "destructive",
        }),
    },
  });

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (provider === "smtp") {
      const portNum = Number(port);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        toast({ title: "Invalid port", description: "Enter a port between 1 and 65535.", variant: "destructive" });
        return;
      }
      save.mutate({
        data: {
          provider: "smtp",
          host: host.trim(),
          port: portNum,
          secure,
          username: username.trim() || null,
          password: password.length > 0 ? password : null,
          fromEmail: fromEmail.trim(),
          fromName: fromName.trim() || null,
        },
      });
    } else {
      save.mutate({
        data: {
          provider: "graph",
          graphTenantId: graphTenantId.trim(),
          graphClientId: graphClientId.trim(),
          graphClientSecret: graphClientSecret.length > 0 ? graphClientSecret : null,
          graphSenderEmail: graphSenderEmail.trim(),
        },
      });
    }
  }

  if (user?.role !== "admin") {
    return (
      <AppLayout>
        <div className="p-8 text-sm text-muted-foreground">Admins only.</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Settings"
        subtitle="Configure how the app sends email (password reset links)."
      />
      <div className="px-8 py-6 grid gap-6 max-w-2xl">
        <Card className="hover:shadow-md transition-all duration-300 border-border/50">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" />
                  Outgoing email
                </CardTitle>
                <CardDescription className="mt-1">
                  Choose how emails are sent: a classic SMTP mail server, or the
                  Microsoft 365 API (works with a work/school Microsoft account).
                </CardDescription>
              </div>
              {!isLoading && (
                <Badge variant={settings?.configured ? "default" : "secondary"} data-testid="badge-smtp-status">
                  {settings?.configured ? "Configured" : "Not configured"}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <form onSubmit={onSave} className="space-y-4" data-testid="form-smtp">
                <Tabs value={provider} onValueChange={(v) => setProvider(v as "smtp" | "graph")}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="smtp" data-testid="tab-provider-smtp">
                      SMTP server
                    </TabsTrigger>
                    <TabsTrigger value="graph" data-testid="tab-provider-graph">
                      Microsoft 365 API
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {provider === "smtp" ? (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5 col-span-2">
                        <Label htmlFor="smtp-host">SMTP host</Label>
                        <Input
                          id="smtp-host"
                          required
                          value={host}
                          onChange={(e) => setHost(e.target.value)}
                          placeholder="smtp.example.com"
                          data-testid="input-smtp-host"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="smtp-port">Port</Label>
                        <Input
                          id="smtp-port"
                          required
                          inputMode="numeric"
                          value={port}
                          onChange={(e) => setPort(e.target.value)}
                          placeholder="587"
                          data-testid="input-smtp-port"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2.5">
                      <div>
                        <Label htmlFor="smtp-secure" className="cursor-pointer">
                          Use SSL/TLS
                        </Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          On for port 465. Off for port 587 (STARTTLS is used automatically).
                        </p>
                      </div>
                      <Switch
                        id="smtp-secure"
                        checked={secure}
                        onCheckedChange={setSecure}
                        data-testid="switch-smtp-secure"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="smtp-user">
                          Username <span className="text-muted-foreground text-xs">(optional)</span>
                        </Label>
                        <Input
                          id="smtp-user"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="mailer@example.com"
                          autoComplete="off"
                          data-testid="input-smtp-username"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="smtp-pass">
                          Password{" "}
                          <span className="text-muted-foreground text-xs">
                            {settings?.hasPassword ? "(saved — leave blank to keep)" : "(optional)"}
                          </span>
                        </Label>
                        <PasswordInput
                          id="smtp-pass"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={settings?.hasPassword ? "••••••••" : ""}
                          autoComplete="new-password"
                          data-testid="input-smtp-password"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="smtp-from">Sender email</Label>
                        <Input
                          id="smtp-from"
                          type="email"
                          required
                          value={fromEmail}
                          onChange={(e) => setFromEmail(e.target.value)}
                          placeholder="no-reply@example.com"
                          data-testid="input-smtp-from-email"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="smtp-from-name">
                          Sender name <span className="text-muted-foreground text-xs">(optional)</span>
                        </Label>
                        <Input
                          id="smtp-from-name"
                          value={fromName}
                          onChange={(e) => setFromName(e.target.value)}
                          placeholder="COGS Tracker"
                          data-testid="input-smtp-from-name"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Requires a Microsoft 365 work/school account. In the Microsoft
                      Entra admin center, register an app, grant it the{" "}
                      <span className="font-mono">Mail.Send</span> application
                      permission (with admin consent), create a client secret, and
                      paste the three values below.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="graph-tenant">Tenant ID</Label>
                        <Input
                          id="graph-tenant"
                          required
                          value={graphTenantId}
                          onChange={(e) => setGraphTenantId(e.target.value)}
                          placeholder="00000000-0000-0000-0000-000000000000"
                          autoComplete="off"
                          data-testid="input-graph-tenant-id"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="graph-client">Client ID</Label>
                        <Input
                          id="graph-client"
                          required
                          value={graphClientId}
                          onChange={(e) => setGraphClientId(e.target.value)}
                          placeholder="00000000-0000-0000-0000-000000000000"
                          autoComplete="off"
                          data-testid="input-graph-client-id"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="graph-secret">
                          Client secret{" "}
                          <span className="text-muted-foreground text-xs">
                            {settings?.hasGraphClientSecret ? "(saved — leave blank to keep)" : ""}
                          </span>
                        </Label>
                        <PasswordInput
                          id="graph-secret"
                          required={!settings?.hasGraphClientSecret}
                          value={graphClientSecret}
                          onChange={(e) => setGraphClientSecret(e.target.value)}
                          placeholder={settings?.hasGraphClientSecret ? "••••••••" : ""}
                          autoComplete="new-password"
                          data-testid="input-graph-client-secret"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="graph-sender">Sender mailbox</Label>
                        <Input
                          id="graph-sender"
                          type="email"
                          required
                          value={graphSenderEmail}
                          onChange={(e) => setGraphSenderEmail(e.target.value)}
                          placeholder="no-reply@yourcompany.com"
                          data-testid="input-graph-sender-email"
                        />
                      </div>
                    </div>
                  </>
                )}

                <div className="flex justify-end">
                  <Button type="submit" disabled={save.isPending} data-testid="button-save-smtp">
                    {save.isPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
                    ) : (
                      "Save settings"
                    )}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-all duration-300 border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
              <Send className="h-4 w-4 text-primary" />
              Send a test email
            </CardTitle>
            <CardDescription>
              Save your settings first, then send a test to make sure everything works.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                test.mutate({ data: { to: testTo.trim() } });
              }}
              data-testid="form-smtp-test"
            >
              <Input
                type="email"
                required
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="you@company.com"
                data-testid="input-smtp-test-to"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={test.isPending || !settings?.configured}
                data-testid="button-send-test-email"
              >
                {test.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</>
                ) : (
                  "Send test"
                )}
              </Button>
            </form>
            {!settings?.configured && !isLoading && (
              <p className="text-xs text-muted-foreground mt-2">
                Save your email settings to enable the test button.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
