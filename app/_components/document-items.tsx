import { formatMoney, formatQuantity, plainDecimal } from "@/lib/format";
import { DataTable } from "./ui";

type DisplayLine = {
  id: string; productName: string; sku: string; description: string | null; quantity: string;
  unit: string; unitPrice: string; discountAmount: string; taxAmount: string; taxRate: string; lineTotal: string;
};
/** Display stored snapshots and amounts verbatim through the existing exact-decimal formatters. */
export function DocumentItems({ items, currency }: { items: readonly DisplayLine[]; currency: string }) {
  const money = (amount: string) => formatMoney(amount, currency);
  return <section className="min-w-0">
    <h2 className="mb-3 text-sm font-semibold">Items <span className="ml-1 text-xs font-normal text-muted">({items.length})</span>
    </h2>
    <DataTable label="Document items">
      <table className="w-full text-left">
        <thead>
          <tr>{["#", "Item", "Quantity", "Unit", "Unit price", "Discount", "Tax", "Line total"].map((label, index) => <th key={label} scope="col" className={`px-4 ${[2, 4, 5, 6, 7].includes(index) ? "text-right" : ""}`}>{label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">{items.map((item, index) => <tr key={item.id} className="align-top">
          <td className="px-4 text-xs text-muted">{index + 1}</td>
          <td className="min-w-44 px-4">
            <p className="font-medium">{item.productName}</p>
            <p className="mt-1 font-mono text-[11px] text-muted">{item.sku}</p>{item.description && <p className="mt-1 max-w-md whitespace-pre-line break-words text-xs text-muted">{item.description}</p>}</td>
          <td className="px-4 text-right tabular-nums">{formatQuantity(item.quantity)}</td>
          <td className="px-4 text-muted">{item.unit}</td>
          <td className="px-4 text-right whitespace-nowrap tabular-nums">{money(item.unitPrice)}</td>
          <td className="px-4 text-right whitespace-nowrap tabular-nums">{money(item.discountAmount)}</td>
          <td className="px-4 text-right whitespace-nowrap tabular-nums">{money(item.taxAmount)}<span className="block text-[11px] text-muted">{plainDecimal(item.taxRate)}%</span>
          </td>
          <td className="px-4 text-right font-semibold whitespace-nowrap tabular-nums">{money(item.lineTotal)}</td>
        </tr>)}</tbody>
      </table>
    </DataTable>
  </section>;
}
