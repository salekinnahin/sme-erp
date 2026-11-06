import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  requireTenant: vi.fn(), createPurchaseOrder: vi.fn(), updatePurchaseOrderDraft: vi.fn(),
  setPurchaseOrderStatus: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/tenancy/context", () => ({ requireTenant: mock.requireTenant }));
vi.mock("@/lib/purchase-orders/purchase-orders", () => ({
  createPurchaseOrder: mock.createPurchaseOrder, updatePurchaseOrderDraft: mock.updatePurchaseOrderDraft,
  setPurchaseOrderStatus: mock.setPurchaseOrderStatus,
}));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  unstable_rethrow: () => {},
}));
vi.mock("@/lib/purchase-orders/option-search", () => ({
  searchPurchaseOrderVendors: vi.fn(), searchPurchaseOrderProducts: vi.fn(),
}));
import {
  createPurchaseOrderAction, setPurchaseOrderStatusAction, updatePurchaseOrderAction,
} from "@/app/purchase-orders/actions";

const VENDOR = "dddddddd-0000-4000-8000-000000000004";
const PRODUCT = "bbbbbbbb-0000-4000-8000-000000000002";
const ID = "cccccccc-0000-4000-8000-000000000003";
const LINE = "eeeeeeee-0000-4000-8000-000000000005";
const tenant = { organization: { id: "session-org", timezone: "Asia/Dhaka" }, role: "employee" };
function form() {
  const data = new FormData();
  data.set("vendorId", VENDOR);
  data.set("orderDate", "2026-11-06");
  data.set("expectedDeliveryDate", "2026-11-07");
  data.set("items", JSON.stringify([{ key: "a", lineId: LINE, productId: PRODUCT, quantity: "2.5", unitPrice: "", discountAmount: "10", taxRate: "15", description: "Custom", selling_price: "999" }]));
  for (const key of ["organization_id", "status", "grand_total", "purchase_order_number", "created_by", "vendor_name"])
    data.set(key, "FORGED");
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.requireTenant.mockResolvedValue(tenant);
  mock.createPurchaseOrder.mockResolvedValue({ ok: true, purchaseOrderId: ID });
  mock.updatePurchaseOrderDraft.mockResolvedValue({ ok: true, purchaseOrderId: ID });
  mock.setPurchaseOrderStatus.mockResolvedValue({ ok: true, purchaseOrderId: ID });
});

describe("purchase order Server Actions", () => {
  it("uses the session tenant and an allowlist, keeps edit line IDs, redirects to the saved order", async () => {
    await expect(updatePurchaseOrderAction(ID, {}, form())).rejects.toThrow(`redirect:/purchase-orders/${ID}`);
    expect(mock.updatePurchaseOrderDraft).toHaveBeenCalledWith(tenant, ID, {
      vendorId: VENDOR, orderDate: "2026-11-06", expectedDeliveryDate: "2026-11-07", notes: null,
      items: [{ lineId: LINE, productId: PRODUCT, quantity: "2.5", unitPrice: null, discountAmount: "10", taxRate: "15", description: "Custom" }],
    });
    expect(mock.revalidate).toHaveBeenCalledWith("/purchase-orders");
  });

  it("creates with the session tenant and redirects to the new order", async () => {
    const data = form();
    data.set("items", JSON.stringify([{ key: "a", productId: PRODUCT, quantity: "1", unitPrice: "", discountAmount: "", taxRate: "" }]));
    await expect(createPurchaseOrderAction({}, data)).rejects.toThrow(`redirect:/purchase-orders/${ID}`);
    expect(mock.createPurchaseOrder.mock.calls[0][0]).toBe(tenant);
    expect(mock.createPurchaseOrder.mock.calls[0][1].items[0].lineId).toBeNull();
  });

  it("validates before writing and returns keyed errors", async () => {
    const data = form(); data.set("expectedDeliveryDate", "2026-11-05");
    expect(await createPurchaseOrderAction({}, data)).toMatchObject({ fieldErrors: { expectedDeliveryDate: expect.stringContaining("before") } });
    data.set("expectedDeliveryDate", ""); data.set("items", JSON.stringify([{ key: "k1", productId: PRODUCT, quantity: "0", unitPrice: "1.001" }]));
    expect(await createPurchaseOrderAction({}, data)).toMatchObject({ itemErrors: { k1: expect.any(Object) } });
    expect(mock.createPurchaseOrder).not.toHaveBeenCalled();
    data.set("items", "{}");
    expect(await createPurchaseOrderAction({}, data)).toHaveProperty("error");
  });

  it("maps a missing purchase price to its line and a stale non-draft edit to a refreshed safe message", async () => {
    mock.createPurchaseOrder.mockResolvedValue({ ok: false, reason: "invalid", itemErrors: [{ unitPrice: "Enter a unit price. This product has no purchase price." }] });
    expect(await createPurchaseOrderAction({}, form())).toMatchObject({ itemErrors: { a: { unitPrice: expect.stringContaining("no purchase price") } } });
    mock.updatePurchaseOrderDraft.mockResolvedValue({ ok: false, reason: "not_draft" });
    expect(await updatePurchaseOrderAction(ID, {}, form())).toEqual({ error: expect.stringContaining("no longer a draft") });
    expect(mock.revalidate).toHaveBeenCalledWith(`/purchase-orders/${ID}`);
  });

  it("fails closed when tenant lookup fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mock.requireTenant.mockRejectedValue(new Error("private database details"));
    const result = await createPurchaseOrderAction({}, form());
    expect(result.error).toBeTruthy(); expect(result.error).not.toContain("private");
    expect(mock.createPurchaseOrder).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it.each(["partially_received", "received", "draft", "bogus", ""])("rejects forged user status %s", async (status) => {
    const data = form(); data.set("purchaseOrderId", ID); data.set("status", status);
    expect(await setPurchaseOrderStatusAction({}, data)).toHaveProperty("error");
    expect(mock.setPurchaseOrderStatus).not.toHaveBeenCalled();
  });

  it("revalidates stale status pages and delegates role enforcement to the domain", async () => {
    mock.setPurchaseOrderStatus.mockResolvedValue({ ok: false, reason: "invalid_transition" });
    const data = form(); data.set("purchaseOrderId", ID); data.set("status", "cancelled");
    expect(await setPurchaseOrderStatusAction({}, data)).toMatchObject({ error: expect.stringContaining("latest status") });
    expect(mock.setPurchaseOrderStatus).toHaveBeenCalledWith(tenant, ID, "cancelled");
    expect(mock.revalidate).toHaveBeenCalledWith(`/purchase-orders/${ID}`);
    mock.setPurchaseOrderStatus.mockResolvedValue({ ok: false, reason: "forbidden" });
    expect(await setPurchaseOrderStatusAction({}, data)).toEqual({ error: "You don't have permission to do that." });
  });

  it("succeeds with no error and refreshes list and detail", async () => {
    const data = form(); data.set("purchaseOrderId", ID); data.set("status", "ordered");
    expect(await setPurchaseOrderStatusAction({}, data)).toEqual({});
    expect(mock.revalidate).toHaveBeenCalledWith("/purchase-orders");
    expect(mock.revalidate).toHaveBeenCalledWith(`/purchase-orders/${ID}`);
  });
});
