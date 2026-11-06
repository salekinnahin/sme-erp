"use client";

import { FormSection } from "@/app/_components/ui";
import Link from "next/link";
import { useActionState } from "react";
import { Alert, Field, SubmitButton, TextArea } from "@/app/auth/_components/ui";
import {
  CUSTOMER_LIMITS as L,
  type CustomerRawInput,
} from "@/lib/customers/validation";
import type { CustomerFormState } from "../actions";

/**
 * Create / edit form. The Server Action validates everything again; this
 * component only collects input. The submit button is disabled while the
 * action runs, which also blocks implicit (Enter key) resubmission.
 *
 * Text fields have no HTML maxLength: the browser counts UTF-16 code units,
 * which would block valid input such as a 200-emoji name. Lengths are checked
 * on the server in code points. Phone keeps maxLength because it only allows
 * ASCII characters.
 */
export function CustomerForm({
  action,
  initialValues,
  submitLabel,
  pendingText,
  cancelHref,
}: {
  action: (state: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  initialValues?: CustomerRawInput;
  submitLabel: string;
  pendingText: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState<CustomerFormState, FormData>(
    action,
    {},
  );
  const fe = state.fieldErrors ?? {};
  // After a failed submit, React resets the form to these defaults, so echo
  // the submitted values back.
  const v = state.values ?? initialValues;

  return (
    <form action={formAction} noValidate className="space-y-4">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      <FormSection title="Contact information">
      <Field
        label="Customer name"
        name="name"
        defaultValue={v?.name}
        error={fe.name}
      />
      <Field
        label="Company name"
        name="companyName"
        autoComplete="organization"
        required={false}
        defaultValue={v?.companyName}
        error={fe.companyName}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Phone"
          name="phone"
          type="tel"
          maxLength={L.phone}
          required={false}
          defaultValue={v?.phone}
          error={fe.phone}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          required={false}
          defaultValue={v?.email}
          error={fe.email}
        />
      </div>
      </FormSection>
      <FormSection title="Address and business details">
      <TextArea
        label="Address"
        name="address"
        required={false}
        defaultValue={v?.address}
        error={fe.address}
      />
      <Field
        label="Tax / VAT number"
        name="taxNumber"
        required={false}
        defaultValue={v?.taxNumber}
        error={fe.taxNumber}
      />
      <TextArea
        label="Notes"
        name="notes"
        rows={4}
        required={false}
        defaultValue={v?.notes}
        error={fe.notes}
      />
      </FormSection>
      <div className="form-actions">
        <Link
          href={cancelHref}
          className="ui-button ui-button-secondary"
        >
          Cancel
        </Link>
        <div className="sm:w-48">
          <SubmitButton pendingText={pendingText}>{submitLabel}</SubmitButton>
        </div>
      </div>
    </form>
  );
}
