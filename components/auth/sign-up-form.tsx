"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { signUp, type AuthActionState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Creating account…" : "Create account"}
    </Button>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-destructive">{messages[0]}</p>;
}

export function SignUpForm() {
  const [state, action] = useActionState<AuthActionState | null, FormData>(
    signUp,
    null,
  );

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create an account
        </h1>
        <p className="text-sm text-muted-foreground">
          Get started for free — no credit card required
        </p>
      </div>

      {/* Global error */}
      {state?.error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3">
          <p className="text-sm text-destructive">{state.error}</p>
        </div>
      )}

      {/* Form */}
      <form action={action} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            name="fullName"
            type="text"
            placeholder="Jane Smith"
            autoComplete="name"
            autoFocus
            className={cn(state?.fieldErrors?.fullName && "border-destructive")}
          />
          <FieldError messages={state?.fieldErrors?.fullName} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            className={cn(state?.fieldErrors?.email && "border-destructive")}
          />
          <FieldError messages={state?.fieldErrors?.email} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete="new-password"
            className={cn(state?.fieldErrors?.password && "border-destructive")}
          />
          <FieldError messages={state?.fieldErrors?.password} />
          <p className="text-xs text-muted-foreground">
            Must be at least 8 characters
          </p>
        </div>

        <SubmitButton />
      </form>

      {/* Switch to sign-in */}
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
