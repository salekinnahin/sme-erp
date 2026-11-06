import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ requireTenant: vi.fn(), createGoodsReceipt: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/tenancy/context", () => ({ requireTenant: mock.requireTenant }));
vi.mock("@/lib/goods-receipts/goods-receipts", () => ({ createGoodsReceipt: mock.createGoodsReceipt }));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  unstable_rethrow: () => {},
}));
import { recordGoodsReceiptAction } from "@/app/goods-receipts/actions";
import { RECEIVING_STALE_MESSAGE } from "./messages";

const PO = "aaaaaaaa-0000-4000-8000-000000000001";
const A = "bbbbbbbb-0000-4000-8000-000000000002";
const B = "cccccccc-0000-4000-8000-000000000003";
const C = "dddddddd-0000-4000-8000-000000000004";
const GR = "eeeeeeee-0000-4000-8000-000000000005";
const tenant = { organization: { id: "session-org" }, role: "employee", user: { id: "u" } };

function form(items: unknown, receivedDate = "2026-11-07") {
  const data = new FormData();
  data.set("receivedDate", receivedDate);
  data.set("notes", "  Second shipment ");
  data.set("items", JSON.stringify(items));
  for (const key of ["organization_id", "purchase_order_id", "status", "goods_receipt_number", "created_by", "product_id"]) data.set(key, "FORGED");
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.requireTenant.mockResolvedValue(tenant);
  mock.createGoodsReceipt.mockResolvedValue({ ok: true, goodsReceiptId: GR });
});

describe("recordGoodsReceiptAction", () => {
  it("sends only positive lines (blank/zero omitted) with the session tenant, then redirects to the receipt", async () => {
    const items = [
      { purchaseOrderItemId: A, receivedQuantity: "30", productId: "FORGED", product_name: "FORGED" },
      { purchaseOrderItemId: B, receivedQuantity: "0" },
      { purchaseOrderItemId: C, receivedQuantity: "20.500" },
    ];
    await expect(recordGoodsReceiptAction(PO, {}, form(items))).rejects.toThrow(`redirect:/goods-receipts/${GR}?recorded=1`);
    expect(mock.createGoodsReceipt).toHaveBeenCalledWith(tenant, {
      purchaseOrderId: PO, receivedDate: "2026-11-07", notes: "  Second shipment ",
      items: [{ purchaseOrderItemId: A, receivedQuantity: "30" }, { purchaseOrderItemId: C, receivedQuantity: "20.500" }],
    });
    expect(mock.revalidate).toHaveBeenCalledWith("/goods-receipts");
    expect(mock.revalidate).toHaveBeenCalledWith(`/purchase-orders/${PO}`);
  });
  it("requires at least one positive quantity without calling the database", async () => {
    const state = await recordGoodsReceiptAction(PO, {}, form([{ purchaseOrderItemId: A, receivedQuantity: "" }, { purchaseOrderItemId: B, receivedQuantity: "0.000" }]));
    expect(state.fieldErrors?.items).toBe("Enter a quantity to receive for at least one line.");
    expect(mock.createGoodsReceipt).not.toHaveBeenCalled();
    expect(mock.requireTenant).not.toHaveBeenCalled();
  });
  it("returns inline line errors for malformed quantities", async () => {
    const state = await recordGoodsReceiptAction(PO, {}, form([{ purchaseOrderItemId: A, receivedQuantity: "1.0001" }]));
    expect(state.lineErrors).toEqual({ [A]: "Enter a quantity with at most 3 decimal places." });
    expect(mock.createGoodsReceipt).not.toHaveBeenCalled();
  });
  it("requires a valid received date", async () => {
    const state = await recordGoodsReceiptAction(PO, {}, form([{ purchaseOrderItemId: A, receivedQuantity: "1" }], ""));
    expect(state.fieldErrors?.receivedDate).toBe("Enter the received date.");
    expect(mock.createGoodsReceipt).not.toHaveBeenCalled();
  });
  it("maps a received date before the order date to the date field", async () => {
    mock.createGoodsReceipt.mockResolvedValue({ ok: false, reason: "invalid_date" });
    const state = await recordGoodsReceiptAction(PO, {}, form([{ purchaseOrderItemId: A, receivedQuantity: "1" }], "2020-01-01"));
    expect(state.fieldErrors?.receivedDate).toMatch(/on or after the order date/);
    expect(mock.revalidate).not.toHaveBeenCalled();
  });
  it.each(["over_receiving", "fully_received", "conflict", "not_receivable"])("refreshes the PO pages on stale %s", async (reason) => {
    mock.createGoodsReceipt.mockResolvedValue({ ok: false, reason });
    const state = await recordGoodsReceiptAction(PO, {}, form([{ purchaseOrderItemId: A, receivedQuantity: "1" }]));
    expect(state.stale).toBe(true);
    if (reason !== "not_receivable") expect(state.error).toBe(RECEIVING_STALE_MESSAGE);
    expect(mock.revalidate).toHaveBeenCalledWith(`/purchase-orders/${PO}/receive`);
    expect(mock.revalidate).toHaveBeenCalledWith(`/purchase-orders/${PO}`);
  });
  it("rejects unreadable payloads and malformed purchase order IDs before any read", async () => {
    const data = form([]);
    data.set("items", "not json");
    expect((await recordGoodsReceiptAction(PO, {}, data)).error).toMatch(/could not be read/);
    expect((await recordGoodsReceiptAction("not-a-uuid", {}, form([{ purchaseOrderItemId: A, receivedQuantity: "1" }]))).error).toMatch(/could not be found/);
    expect(mock.createGoodsReceipt).not.toHaveBeenCalled();
    expect(mock.revalidate).not.toHaveBeenCalled();
  });
  it("returns a safe message when the session cannot be loaded", async () => {
    mock.requireTenant.mockRejectedValue(new Error("db down: private details"));
    const state = await recordGoodsReceiptAction(PO, {}, form([{ purchaseOrderItemId: A, receivedQuantity: "1" }]));
    expect(state.error).toBe("Could not record the goods receipt. Please try again.");
  });
  it("never mentions stock in any outcome", async () => {
    for (const reason of ["forbidden", "service", "failed", "conflict"]) {
      mock.createGoodsReceipt.mockResolvedValue({ ok: false, reason });
      const state = await recordGoodsReceiptAction(PO, {}, form([{ purchaseOrderItemId: A, receivedQuantity: "1" }]));
      expect(JSON.stringify(state)).not.toMatch(/stock|inventory/i);
    }
  });
});
