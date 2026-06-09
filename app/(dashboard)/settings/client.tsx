"use client";

import { useEffect, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { cn } from "@/lib/utils";
import { updateDisplayName } from "@/lib/users/actions";
import { clearVault } from "@/lib/vault/actions";
import { deleteAccount } from "@/lib/account/actions";

interface Props {
  email: string;
  fullName: string;
}

export function SettingsClient({ email, fullName }: Props) {
  return (
    <>
      <ProfileSection email={email} fullName={fullName} />
      <AppearanceSection />
      <DangerSection />
    </>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────────

function ProfileSection({ email, fullName }: Props) {
  const [name, setName] = useState(fullName);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = name.trim() !== fullName.trim();

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateDisplayName(name);
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your account details.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={email} readOnly disabled className="font-mono" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="displayName">Display name</Label>
          <Input
            id="displayName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={!dirty || pending}>
            {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save changes
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Appearance ────────────────────────────────────────────────────────────────

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Choose how the interface looks.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="inline-flex rounded-lg border border-border p-1 gap-1">
          {THEMES.map(({ value, label, icon: Icon }) => {
            const active = mounted && theme === value;
            return (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Danger zone ───────────────────────────────────────────────────────────────

function DangerSection() {
  const [clearing, startClear] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClear() {
    setError(null);
    startClear(async () => {
      const res = await clearVault();
      if (!res.ok) setError(res.error);
    });
  }

  function handleDelete() {
    setError(null);
    startDelete(async () => {
      // On success this redirects and never returns; only errors come back.
      const res = await deleteAccount();
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>These actions are permanent and cannot be undone.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium">Clear vault</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Permanently delete every file in your vault.
            </p>
          </div>
          <ConfirmDialog
            trigger={
              <Button variant="outline" disabled={clearing}>
                {clearing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Clear vault
              </Button>
            }
            title="Clear your vault?"
            description="This permanently deletes all files in your vault. This cannot be undone."
            confirmLabel="Clear vault"
            onConfirm={handleClear}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-destructive/40 p-4">
          <div>
            <p className="text-sm font-medium">Delete account</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Permanently delete your account, vault, and all data.
            </p>
          </div>
          <ConfirmDialog
            trigger={
              <Button variant="destructive" disabled={deleting}>
                {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Delete account
              </Button>
            }
            title="Delete your account?"
            description="This permanently deletes your account, your vault, and all associated data. This cannot be undone."
            confirmLabel="Delete account"
            onConfirm={handleDelete}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
