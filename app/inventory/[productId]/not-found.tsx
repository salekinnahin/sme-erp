import Link from "next/link";
import { TEXT_LINK } from "@/app/_components/styles";

// Shown for malformed IDs, unknown IDs, other organizations' products and
// products that are not stock-tracked (services or non-inventory products
// without stock history) alike, so the page never reveals whether a product
// exists elsewhere.
export default function ProductStockNotFound() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
      <h1 className="text-lg font-semibold">Product stock not found</h1>
      <p className="mt-2 text-sm text-zinc-600">
        This product isn&apos;t tracked in inventory, doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link href="/inventory" className={`mt-4 inline-block ${TEXT_LINK}`}>
        Back to inventory
      </Link>
    </div>
  );
}
