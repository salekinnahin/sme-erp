/** Synthetic local UI fixtures. Never connected to Supabase or included by application routes. */
export const FIXTURE_ID = "a1000000-0000-4000-8000-000000000001";
export const FIXTURE_PRODUCT_ID = "a1000000-0000-4000-8000-000000000002";
export const FIXTURE_TENANT = {
  user: { id: FIXTURE_ID, email: "owner@northstar.example" },
  organization: { id: FIXTURE_ID, name: "Northstar Trading", currency: "BDT", timezone: "Asia/Dhaka" },
  role: "owner" as "owner" | "manager" | "employee",
};
export const FIXTURE_CONTACT = {
  id: FIXTURE_ID, name: "Eastern Supply Co.", companyName: "Eastern Supply Co.", phone: "+880 1700 000000",
  email: "orders@eastern.example", address: "24 Commerce Road\nDhaka, Bangladesh", taxNumber: "TIN-1234",
  notes: "Preferred business contact.", status: "active" as const, createdAt: "2026-11-06T06:00:00Z", updatedAt: "2026-11-06T06:00:00Z",
};
export const FIXTURE_PRODUCT = {
  id: FIXTURE_PRODUCT_ID, name: "Office desk", sku: "DSK-101", productType: "inventory" as const,
  categoryId: null, categoryName: "Office furniture", unit: "pcs" as const, description: "Oak finish, 120 cm",
  purchasePrice: "12000.00", sellingPrice: "15000.00", reorderLevel: "5.000", status: "active" as const,
  createdAt: "2026-11-06T06:00:00Z", updatedAt: "2026-11-06T06:00:00Z",
};
export const FIXTURE_LINE = {
  id: "a1000000-0000-4000-8000-000000000003", productId: FIXTURE_PRODUCT_ID, productName: FIXTURE_PRODUCT.name,
  sku: FIXTURE_PRODUCT.sku, description: FIXTURE_PRODUCT.description, unit: "pcs", quantity: "3.000",
  unitPrice: "12000.00", discountAmount: "1000.00", taxRate: "5.00", taxAmount: "1750.00", lineTotal: "36750.00", sortOrder: 1,
};
const common = {
  id: FIXTURE_ID, customerId: FIXTURE_ID, customerName: "Eastern Supply Co.", customerCompanyName: "Eastern Supply Co.",
  customerPhone: FIXTURE_CONTACT.phone, customerEmail: FIXTURE_CONTACT.email, customerAddress: FIXTURE_CONTACT.address,
  customerTaxNumber: FIXTURE_CONTACT.taxNumber, notes: "Delivery during business hours. Please call ahead.",
  subtotal: "36000.00", discountTotal: "1000.00", taxTotal: "1750.00", grandTotal: "36750.00",
  status: "draft" as const, createdAt: "2026-11-06T06:00:00Z", updatedAt: "2026-11-06T06:00:00Z", items: [FIXTURE_LINE],
};
export const FIXTURE_QUOTATION = { ...common, quotationNumber: "QT-000128", quotationDate: "2026-11-06", expiryDate: "2026-11-30" };
export const FIXTURE_SALES_ORDER = { ...common, salesOrderNumber: "SO-000128", orderDate: "2026-11-06", expectedDeliveryDate: "2026-11-15", sourceQuotationId: null, sourceQuotationNumber: null };
export const FIXTURE_INVOICE = { ...common, invoiceNumber: "INV-000128", invoiceDate: "2026-11-06", dueDate: "2026-11-30", sourceSalesOrderId: null, sourceSalesOrderNumber: null, amountPaid: "0.00", amountDue: "36750.00" };
export const FIXTURE_PURCHASE_ORDER = { ...common, purchaseOrderNumber: "PO-000128", vendorId: FIXTURE_ID, vendorName: FIXTURE_CONTACT.name, vendorCompanyName: FIXTURE_CONTACT.companyName, vendorPhone: FIXTURE_CONTACT.phone, vendorEmail: FIXTURE_CONTACT.email, vendorAddress: FIXTURE_CONTACT.address, vendorTaxNumber: FIXTURE_CONTACT.taxNumber, orderDate: "2026-11-06", expectedDeliveryDate: "2026-11-15" };
export const FIXTURE_BRANDING = { name: FIXTURE_TENANT.organization.name, address: "18 Business Avenue\nDhaka, Bangladesh", email: "hello@northstar.example", phone: "+880 1800 000000", taxNumber: "TIN-5678", logoUrl: null, logoUpdatedAt: null };
export const FIXTURE_GOODS_RECEIPT_ROW = {
  id: "a1000000-0000-4000-8000-000000000004", goodsReceiptNumber: "GR-000042", purchaseOrderId: FIXTURE_ID, purchaseOrderNumber: "PO-000128",
  vendorName: FIXTURE_CONTACT.name, vendorCompanyName: "Eastern Supply Holdings", receivedDate: "2026-11-07", itemCount: 3,
  receivedByName: "Rahim Uddin", createdAt: "2026-11-07T06:00:00Z",
};
