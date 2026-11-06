import Link from "next/link";
import { TEXT_LINK } from "@/app/_components/styles";

// Shown for unknown IDs, malformed IDs and other organizations' purchase
// orders alike (also on the edit and print pages), so the page never reveals
// whether a purchase order exists elsewhere.
export default function PurchaseOrderNotFound() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
      <h1 className="text-lg font-semibold">Purchase order not found</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        This purchase order doesn&apos;t exist or you don&apos;t have access to it.
      </p>
      <Link href="/purchase-orders" className={`mt-4 inline-block ${TEXT_LINK}`}>
        Back to purchase orders
      </Link>
    </div>
  );
}
