import { beforeEach, expect, it, vi } from "vitest";
const { rpc, maybeSingle, eq, from } = vi.hoisted(() => ({ rpc: vi.fn(), maybeSingle: vi.fn(), eq: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => {
  const builder = { select: () => builder, eq: (...args: unknown[]) => { eq(...args); return builder; }, maybeSingle };
  from.mockReturnValue(builder);
  return { rpc, from };
} }));
import { createGoodsReceipt, getGoodsReceipt, getPurchaseOrderReceivingSummary } from "./goods-receipts";
const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const PO = "bbbbbbbb-0000-4000-8000-000000000002";
const LINE = "cccccccc-0000-4000-8000-000000000003";
const tenant = { organization: { id: ORG, name: "Org", currency: "BDT", timezone: "Asia/Dhaka" }, role: "employee" as const };
const raw = { purchaseOrderId: PO, receivedDate: "2026-11-06", notes: null, items: [{ purchaseOrderItemId: LINE, receivedQuantity: "40" }] };
const summary = [{ purchase_order_item_id: LINE, product_type: "inventory", remaining_quantity: "60.000" }];
beforeEach(() => { vi.clearAllMocks(); maybeSingle.mockResolvedValue({ data: { status: "ordered" }, error: null }); rpc.mockResolvedValueOnce({ data: summary, error: null }).mockResolvedValue({ data: "receipt", error: null }); });
it("uses session tenant for the pre-check and allowlisted RPC-only writes", async () => {
  expect(await createGoodsReceipt(tenant, { ...raw, organization_id: "forged" })).toEqual({ ok: true, goodsReceiptId: "receipt" });
  expect(eq).toHaveBeenCalledWith("organization_id", ORG);
  expect(from).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenLastCalledWith("create_goods_receipt", { p_purchase_order_id: PO, p_received_date: raw.receivedDate, p_notes: null, p_items: [{ purchase_order_item_id: LINE, received_quantity: "40" }] });
});
it("rejects invalid payload before connecting", async () => {
  expect(await createGoodsReceipt(tenant, { ...raw, receivedDate: "bad" })).toEqual({ ok: false, reason: "invalid_date" });
  expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
});
it("rejects another tenant's or missing PO before reading lines", async () => {
  maybeSingle.mockResolvedValue({ data: null, error: null });
  expect(await createGoodsReceipt(tenant, raw)).toEqual({ ok: false, reason: "not_found" });
  expect(rpc).not.toHaveBeenCalled();
});
it("rejects ineligible status", async () => {
  maybeSingle.mockResolvedValue({ data: { status: "received" }, error: null });
  expect(await createGoodsReceipt(tenant, raw)).toEqual({ ok: false, reason: "not_receivable" });
  expect(rpc).not.toHaveBeenCalled();
});
it.each([["service", "60", "service"], [null, "60", "unknown_product_type"], ["inventory", "0", "fully_received"], ["inventory", "39.999", "over_receiving"]])("prechecks %s/%s", async (product_type, remaining_quantity, reason) => {
  rpc.mockReset().mockResolvedValue({ data: [{ ...summary[0], product_type, remaining_quantity }], error: null });
  expect(await createGoodsReceipt(tenant, raw)).toEqual({ ok: false, reason });
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("maps stale concurrent database rejection after successful prechecks", async () => {
  rpc.mockReset().mockResolvedValueOnce({ data: summary, error: null }).mockResolvedValueOnce({ data: null, error: { code: "GR003", message: "private details" } });
  expect(await createGoodsReceipt(tenant, raw)).toEqual({ ok: false, reason: "over_receiving" });
});
it("returns safe unexpected errors", async () => {
  maybeSingle.mockRejectedValue(new Error("private details"));
  expect(await createGoodsReceipt(tenant, raw)).toEqual({ ok: false, reason: "failed" });
});
it("reads each document/summary with one tenant-filtered RPC", async () => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  expect(await getGoodsReceipt(tenant, PO)).toBeNull();
  expect(rpc).toHaveBeenLastCalledWith("get_goods_receipt", { p_organization_id: ORG, p_goods_receipt_id: PO });
  expect(await getPurchaseOrderReceivingSummary(tenant, PO)).toEqual([]);
  expect(rpc).toHaveBeenLastCalledWith("get_purchase_order_receiving_summary", { p_organization_id: ORG, p_purchase_order_id: PO });
  expect(from).not.toHaveBeenCalled();
});
it("does not read malformed IDs", async () => {
  expect(await getGoodsReceipt(tenant, "bad")).toBeNull();
  expect(await getPurchaseOrderReceivingSummary(tenant, "bad")).toEqual([]);
  expect(rpc).not.toHaveBeenCalled();
});
