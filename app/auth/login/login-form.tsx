"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, type FormState } from "../actions";
import { Alert, Field, SubmitButton } from "../_components/ui";

export function LoginForm({ notice }: { notice?: React.ReactNode }) {
  const [state, action] = useActionState<FormState, FormData>(signIn, {});
  const fe = state.fieldErrors ?? {};

  return (
    <form action={action} noValidate className="space-y-4">
      {state.error ? <Alert kind="error">{state.error}</Alert> : notice}
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={state.values?.email}
        error={fe.email}
      />
      <div>
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          error={fe.password}
        />
        <div className="mt-1 text-right">
          <Link
            href="/auth/forgot-password"
            className="text-sm text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-50"
          >
            Forgot password?
          </Link>
        </div>
      </div>
      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
      <p className="text-center text-sm text-zinc-500">
        Don&apos;t have an account?{" "}
        <Link
          href="/auth/sign-up"
          className="font-medium text-zinc-900 underline dark:text-zinc-50"
        >
          Sign up
        </Link>
      </p>
    </form>
  );
}
