"use client";

import { useFormStatus } from "react-dom";

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-border bg-white p-7 shadow-sm sm:p-9">
        <p className="text-xs font-bold tracking-widest text-primary">
          SME ERP
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {subtitle}
          </p>
        )}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  defaultValue,
  error,
  minLength,
  maxLength,
  required = true,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  error?: string;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
}) {
  const errorId = `${name}-error`;
  return (
    <div>
      <FieldLabel name={name} label={label} required={required} />
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        minLength={minLength}
        maxLength={maxLength}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={INPUT_CLASS}
      />
      <FieldError id={errorId} error={error} />
    </div>
  );
}

export function TextArea({
  label,
  name,
  defaultValue,
  error,
  maxLength,
  rows = 3,
  required = true,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  error?: string;
  maxLength?: number;
  rows?: number;
  required?: boolean;
}) {
  const errorId = `${name}-error`;
  return (
    <div>
      <FieldLabel name={name} label={label} required={required} />
      <textarea
        id={name}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        maxLength={maxLength}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={INPUT_CLASS}
      />
      <FieldError id={errorId} error={error} />
    </div>
  );
}

export function Select({
  label,
  name,
  options,
  defaultValue,
  error,
}: {
  label: string;
  name: string;
  options: string[];
  defaultValue?: string;
  error?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <div>
      <FieldLabel name={name} label={label} required />
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={INPUT_CLASS}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <FieldError id={errorId} error={error} />
    </div>
  );
}

const INPUT_CLASS = "ui-input mt-1";

function FieldLabel({
  name,
  label,
  required,
}: {
  name: string;
  label: string;
  required: boolean;
}) {
  return (
    <label
      htmlFor={name}
      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
    >
      {label}
      {!required && (
        <span className="font-normal text-zinc-500"> (optional)</span>
      )}
    </label>
  );
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} className="mt-1 text-sm text-red-600">
      {error}
    </p>
  );
}

export function SubmitButton({
  children,
  pendingText,
}: {
  children: React.ReactNode;
  pendingText: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="ui-button ui-button-primary w-full"
    >
      {pending ? pendingText : children}
    </button>
  );
}

export function Alert({
  kind,
  children,
}: {
  kind: "error" | "success" | "info";
  children: React.ReactNode;
}) {
  const styles = {
    error:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
    success:
      "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300",
    info: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
  }[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`rounded-md border px-3 py-2 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}
