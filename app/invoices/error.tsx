"use client";

import { TenantLoadError } from "@/app/_components/tenant-load-error";

export default function Error(props: { error: unknown; retry: () => void }) {
  return (
    <TenantLoadError
      {...props}
      message="Something went wrong while loading invoices. Please try again."
    />
  );
}
