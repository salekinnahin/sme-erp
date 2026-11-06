"use client";
import { TenantLoadError } from "@/app/_components/tenant-load-error";
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <TenantLoadError error={error} retry={retry} />;
}
