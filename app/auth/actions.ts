"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { friendlyAuthError } from "@/lib/auth/errors";

export type FormState = {
  error?: string;
  success?: string;
  fieldErrors?: Partial<Record<string, string>>;
  values?: Record<string, string>;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signUp(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const fullName = field(formData, "fullName").trim();
  const email = field(formData, "email").trim().toLowerCase();
  const password = field(formData, "password");
  const confirmPassword = field(formData, "confirmPassword");
  const values = { fullName, email }; // never echo passwords back

  const fieldErrors: FormState["fieldErrors"] = {};
  if (!fullName) fieldErrors.fullName = "Full name is required.";
  if (!email) fieldErrors.email = "Email is required.";
  else if (!EMAIL_RE.test(email))
    fieldErrors.email = "Please enter a valid email address.";
  if (!password) fieldErrors.password = "Password is required.";
  else if (password.length < MIN_PASSWORD)
    fieldErrors.password = `Password must be at least ${MIN_PASSWORD} characters.`;
  if (confirmPassword !== password)
    fieldErrors.confirmPassword = "Passwords do not match.";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  const origin = (await headers()).get("origin");
  const supabase = await createClient();

  let sessionActive = false;
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        ...(origin && { emailRedirectTo: `${origin}/auth/confirm` }),
      },
    });

    if (error) return { error: friendlyAuthError(error), values };

    // With email confirmation on, Supabase hides existing accounts by
    // returning a user with no identities instead of an error.
    if (data.user && data.user.identities?.length === 0) {
      return {
        error:
          "An account with this email already exists. Try signing in instead.",
        values,
      };
    }

    sessionActive = Boolean(data.session);
  } catch (err) {
    return { error: friendlyAuthError(err), values };
  }

  if (sessionActive) {
    revalidatePath("/", "layout");
    redirect("/dashboard");
  }

  return {
    success: `We've sent a confirmation link to ${email}. Open it to activate your account, then sign in.`,
  };
}

export async function signIn(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = field(formData, "email").trim().toLowerCase();
  const password = field(formData, "password");
  const values = { email };

  const fieldErrors: FormState["fieldErrors"] = {};
  if (!email) fieldErrors.email = "Email is required.";
  else if (!EMAIL_RE.test(email))
    fieldErrors.email = "Please enter a valid email address.";
  if (!password) fieldErrors.password = "Password is required.";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  const supabase = await createClient();
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return { error: friendlyAuthError(error), values };
  } catch (err) {
    return { error: friendlyAuthError(err), values };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  // Revokes the refresh token server-side and clears the auth cookies.
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth/login");
}
