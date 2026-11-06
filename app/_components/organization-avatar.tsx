"use client";

import { useState } from "react";
import { organizationInitials } from "@/lib/ui/navigation";

export function OrganizationAvatar({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <span className="organization-avatar">{logoUrl && failedUrl !== logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- private short-lived signed URL
    <img src={logoUrl} alt="" onError={() => setFailedUrl(logoUrl)} />
  ) : <span>{organizationInitials(name)}</span>}</span>;
}
