import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  requireTenant: vi.fn(), createInvoice: vi.fn(), updateInvoiceDraft: vi.fn(),
  createInvoiceFromSalesOrder: vi.fn(), setInvoiceStatus: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/tenancy/context", () => ({ requireTenant: mock.requireTenant }));
vi.mock("@/lib/invoices/invoices", () => ({
  createInvoice: mock.createInvoice, updateInvoiceDraft: mock.updateInvoiceDraft,
  createInvoiceFromSalesOrder: mock.createInvoiceFromSalesOrder, setInvoiceStatus: mock.setInvoiceStatus,
}));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  unstable_rethrow: () => {},
}));
vi.mock("@/lib/invoices/option-search", () => ({
  searchInvoiceCustomers: vi.fn(), searchInvoiceProducts: vi.fn(),
}));
import {
  createInvoiceAction, updateInvoiceAction, convertSalesOrderAction, setInvoiceStatusAction,
} from "@/app/invoices/actions";

const CUSTOMER = "dddddddd-0000-4000-8000-000000000004";
const PRODUCT = "bbbbbbbb-0000-4000-8000-000000000002";
const ID = "cccccccc-0000-4000-8000-000000000003";
const LINE = "eeeeeeee-0000-4000-8000-000000000005";
const tenant = { organization: { id: "session-org", timezone: "Asia/Dhaka" }, role: "employee" };
function form() {
  const data = new FormData();
  data.set("customerId", CUSTOMER);
  data.set("invoiceDate", "2026-11-06");
  data.set("dueDate", "2026-11-07");
  data.set("items", JSON.stringify([{ key: "a", lineId: LINE, productId: PRODUCT, quantity: "2.5", unitPrice: "100", discountAmount: "10", taxRate: "15", description: "Custom" }]));
  for (const key of ["organization_id", "status", "amount_paid", "amount_due", "grand_total", "source_sales_order_id"])
    data.set(key, "FORGED");
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.requireTenant.mockResolvedValue(tenant);
  mock.createInvoice.mockResolvedValue({ ok: true, invoiceId: ID });
  mock.updateInvoiceDraft.mockResolvedValue({ ok: true, invoiceId: ID });
  mock.createInvoiceFromSalesOrder.mockResolvedValue({ ok: true, invoiceId: ID });
  mock.setInvoiceStatus.mockResolvedValue({ ok: true, invoiceId: ID });
});

describe("invoice Server Actions", () => {
  it("uses the session tenant and an allowlist, preserves edit IDs, redirects to saved data", async () => {
    await expect(updateInvoiceAction(ID, {}, form())).rejects.toThrow(`redirect:/invoices/${ID}`);
    expect(mock.updateInvoiceDraft).toHaveBeenCalledWith(tenant, ID, {
      customerId: CUSTOMER, invoiceDate: "2026-11-06", dueDate: "2026-11-07", notes: null,
      items: [{ lineId: LINE, productId: PRODUCT, quantity: "2.5", unitPrice: "100", discountAmount: "10", taxRate: "15", description: "Custom" }],
    });
    expect(mock.revalidate).toHaveBeenCalledWith("/invoices");
  });
  it("validates before writing and returns keyed errors without losing entered values", async () => {
    const data = form(); data.set("dueDate", "2026-11-05");
    expect(await createInvoiceAction({}, data)).toMatchObject({ fieldErrors: { dueDate: expect.stringContaining("before") } });
    expect(mock.createInvoice).not.toHaveBeenCalled();
    data.set("items", "{}");
    expect(await createInvoiceAction({}, data)).toHaveProperty("error");
  });
  it("fails closed when tenant lookup fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mock.requireTenant.mockRejectedValue(new Error("private database details"));
    const result = await createInvoiceAction({}, form());
    expect(result.error).toBeTruthy(); expect(result.error).not.toContain("private");
    expect(mock.createInvoice).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("converts using the bound source ID and dates only; refreshes source and destination", async () => {
    await expect(convertSalesOrderAction(ID, {}, form())).rejects.toThrow(`redirect:/invoices/${ID}`);
    expect(mock.createInvoiceFromSalesOrder).toHaveBeenCalledWith(tenant, {
      salesOrderId: ID, invoiceDate: "2026-11-06", dueDate: "2026-11-07",
    });
    expect(mock.revalidate).toHaveBeenCalledWith(`/sales-orders/${ID}`);
    expect(mock.revalidate).toHaveBeenCalledWith("/invoices");
  });
  it("refreshes a source converted concurrently and maps its failure safely", async () => {
    mock.createInvoiceFromSalesOrder.mockResolvedValue({ ok: false, reason: "already_invoiced" });
    expect(await convertSalesOrderAction(ID, {}, form())).toMatchObject({ error: expect.stringContaining("already has an invoice") });
    expect(mock.revalidate).toHaveBeenCalledWith(`/sales-orders/${ID}`);
  });
  it.each(["partially_paid", "paid", "draft", "bogus"])("rejects forged user status %s", async status => {
    const data = form(); data.set("invoiceId", ID); data.set("status", status);
    expect(await setInvoiceStatusAction({}, data)).toHaveProperty("error");
    expect(mock.setInvoiceStatus).not.toHaveBeenCalled();
  });
  it("revalidates stale status pages and delegates role enforcement to the domain", async () => {
    mock.setInvoiceStatus.mockResolvedValue({ ok: false, reason: "invalid_transition" });
    const data = form(); data.set("invoiceId", ID); data.set("status", "issued");
    expect(await setInvoiceStatusAction({}, data)).toMatchObject({ error: expect.stringContaining("latest status") });
    expect(mock.setInvoiceStatus).toHaveBeenCalledWith(tenant, ID, "issued");
    expect(mock.revalidate).toHaveBeenCalledWith(`/invoices/${ID}`);
  });
});
