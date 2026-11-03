"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUp, type FormState } from "../actions";
import { Alert, Field, SubmitButton } from "../_components/ui";

export function SignUpForm() {
  const [state, action] = useActionState<FormState, FormData>(signUp, {});

  if (state.success) {
    return (
      <div className="space-y-4">
        <Alert kind="success">{state.success}</Alert>
        <Link
          href="/auth/login"
          className="block text-center text-sm font-medium text-zinc-900 underline dark:text-zinc-50"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  const fe = state.fieldErrors ?? {};

  return (
    <form action={action} noValidate className="space-y-4">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      <Field
        label="Full name"
        name="fullName"
        autoComplete="name"
        defaultValue={state.values?.fullName}
        error={fe.fullName}
      />
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={state.values?.email}
        error={fe.email}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        error={fe.password}
      />
      <Field
        label="Confirm password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        minLength={8}
        error={fe.confirmPassword}
      />
      <SubmitButton pendingText="Creating account…">Create account</SubmitButton>
      <p className="text-center text-sm text-zinc-500">
        Already have an account?{" "}
        <Link
          href="/auth/login"
          className="font-medium text-zinc-900 underline dark:text-zinc-50"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
