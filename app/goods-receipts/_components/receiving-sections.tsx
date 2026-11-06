import Link from "next/link";
import { Badge } from "@/app/_components/status-badge";
import { DataTable, EmptyState, SectionCard } from "@/app/_components/ui";
import { TEXT_LINK } from "@/app/_components/styles";
import { formatCalendarDate, formatQuantity } from "@/lib/format";
import type { ReceivingLine } from "@/lib/goods-receipts/calculations";
import type { GoodsReceiptListItem } from "@/lib/goods-receipts/goods-receipts";
import { goodsReceiptListHref } from "@/lib/goods-receipts/list-params";
import { receivedByDisplay, receivingLineState } from "@/lib/goods-receipts/receiving";

/**
 * Purchase order "Receiving" section: ordered / received / remaining per
 * line, straight from get_purchase_order_receiving_summary() (cumulative
 * totals are never calculated in the browser). Services are shown for
 * context only.
 */
export function ReceivingSummary({ lines }: { lines: readonly ReceivingLine[] }) {
  return (
    <SectionCard title="Receiving" description="What was ordered, what has arrived and what is still due.">
      <DataTable label="Receiving summary">
        <table className="receiving-table w-full text-left">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col" className="num">Ordered</th>
              <th scope="col" className="num">Received</th>
              <th scope="col" className="num emphasis">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const state = receivingLineState(line);
              const service = state === "service";
              return (
                <tr key={line.purchase_order_item_id} data-state={state}>
                  <td data-label="Product">
                    <p className="font-medium">{line.product_name}</p>
                    <p className="text-[11px] text-muted">
                      <span className="font-mono">{line.sku}</span> · {line.unit}
                      {service && " · Service, not received"}
                    </p>
                  </td>
                  <td data-label="Ordered" className="num">{formatQuantity(line.ordered_quantity)}</td>
                  <td data-label="Received" className="num">{service ? "—" : formatQuantity(line.received_quantity)}</td>
                  <td data-label="Remaining" className="num emphasis remaining">
                    {service ? "—" : state === "complete" ? <Badge tone="green">Received</Badge> : formatQuantity(line.remaining_quantity)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DataTable>
    </SectionCard>
  );
}

/**
 * Receipt history below the receiving summary: one list_goods_receipts()
 * query, no N+1. "Items" is the number of receipt lines; quantities are not
 * summed because lines can have different units.
 */
export function ReceiptHistory({ items, total, purchaseOrderNumber }: {
  items: readonly GoodsReceiptListItem[];
  total: number;
  purchaseOrderNumber: string;
}) {
  return (
    <SectionCard title="Goods receipts" description="Deliveries recorded against this purchase order.">
      {items.length === 0 ? (
        <EmptyState title="No goods received yet" description="Receipts appear here once goods are recorded." />
      ) : (
        <>
          <DataTable label="Goods receipt history">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th scope="col" className="px-4">GR number</th>
                  <th scope="col" className="px-4">Received date</th>
                  <th scope="col" className="px-4 text-right">Items</th>
                  <th scope="col" className="px-4">Received by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {items.map((receipt) => (
                  <tr key={receipt.id}>
                    <td className="px-4 font-mono font-medium whitespace-nowrap">
                      <Link href={`/goods-receipts/${receipt.id}`}>{receipt.goodsReceiptNumber}</Link>
                    </td>
                    <td className="px-4 whitespace-nowrap">{formatCalendarDate(receipt.receivedDate)}</td>
                    <td className="px-4 text-right tabular-nums">{receipt.itemCount}</td>
                    <td className="px-4">{receivedByDisplay(receipt.receivedByName)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
          {total > items.length && (
            <Link href={goodsReceiptListHref({ search: purchaseOrderNumber, page: 1 })} className={`mt-3 inline-block ${TEXT_LINK}`}>
              View all {total} goods receipts
            </Link>
          )}
        </>
      )}
    </SectionCard>
  );
}
