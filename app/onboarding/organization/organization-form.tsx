"use client";

import { useActionState } from "react";
import {
  createOrganizationAction,
  type OnboardingFormState,
} from "./actions";
import { Alert, Field, Select, SubmitButton } from "@/app/auth/_components/ui";
import { LIMITS } from "@/lib/organizations/validation";

export function OrganizationForm({
  currencies,
  timezones,
  defaultCurrency,
  defaultTimezone,
}: {
  currencies: string[];
  timezones: string[];
  defaultCurrency: string;
  defaultTimezone: string;
}) {
  const [state, action] = useActionState<OnboardingFormState, FormData>(
    createOrganizationAction,
    {},
  );
  const fe = state.fieldErrors ?? {};
  const v = state.values;
  const currency = v?.currency || defaultCurrency;
  const timezone = v?.timezone || defaultTimezone;

  return (
    <form action={action} noValidate className="space-y-4">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      <Field
        label="Organization name"
        name="name"
        autoComplete="organization"
        maxLength={LIMITS.name}
        defaultValue={v?.name}
        error={fe.name}
      />
      <Field
        label="Business email"
        name="email"
        type="email"
        autoComplete="email"
        maxLength={LIMITS.email}
        required={false}
        defaultValue={v?.email}
        error={fe.email}
      />
      <Field
        label="Phone"
        name="phone"
        type="tel"
        autoComplete="tel"
        maxLength={LIMITS.phone}
        required={false}
        defaultValue={v?.phone}
        error={fe.phone}
      />
      <Field
        label="Address"
        name="address"
        autoComplete="street-address"
        maxLength={LIMITS.address}
        required={false}
        defaultValue={v?.address}
        error={fe.address}
      />
      {/* key forces a fresh default when the server echoes values back */}
      <Select
        key={`currency-${currency}`}
        label="Currency"
        name="currency"
        options={currencies}
        defaultValue={currency}
        error={fe.currency}
      />
      <Select
        key={`timezone-${timezone}`}
        label="Time zone"
        name="timezone"
        options={timezones}
        defaultValue={timezone}
        error={fe.timezone}
      />
      <Field
        label="Tax / VAT number"
        name="taxNumber"
        maxLength={LIMITS.taxNumber}
        required={false}
        defaultValue={v?.taxNumber}
        error={fe.taxNumber}
      />
      <SubmitButton pendingText="Creating organization…">
        Create organization
      </SubmitButton>
    </form>
  );
}
