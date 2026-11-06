"use client";

import { useState } from "react";

/**
 * Organization logo on a printed document, inside a fixed box so the
 * header never shifts while it loads. A plain <img> (not next/image): the
 * source is a short-lived signed Storage URL, which the image optimizer
 * would need remote patterns for and could not cache usefully, and a direct
 * image prints most reliably. If the image cannot load, the box disappears
 * and the text-only letterhead remains.
 */
export function DocumentLogo({ src, organizationName }: { src: string; organizationName: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="flex h-16 w-40 shrink-0 items-center" data-testid="document-logo">
      {/* eslint-disable-next-line @next/next/no-img-element -- see component comment */}
      <img
        src={src}
        alt={`${organizationName} logo`}
        className="max-h-full max-w-full object-contain object-left"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
