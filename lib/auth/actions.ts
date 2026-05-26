"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const signInSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

const signUpSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// ─── Action return type ───────────────────────────────────────────────────────

export interface AuthActionState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

// ─── Sign In ──────────────────────────────────────────────────────────────────

export async function signIn(
  _prevState: AuthActionState | null,
  formData: FormData,
): Promise<AuthActionState> {
  const raw = {
    email: formData.get("email"),
    password: formData.get("password"),
  };

  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard");
}

// ─── Sign Up ──────────────────────────────────────────────────────────────────

export async function signUp(
  _prevState: AuthActionState | null,
  formData: FormData,
): Promise<AuthActionState> {
  const raw = {
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  };

  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
    },
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard");
}

// ─── Sign Out ─────────────────────────────────────────────────────────────────

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
