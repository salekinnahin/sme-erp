/** Database checks active membership independently. No edit/delete permission. */
export function canGoodsReceipt(role: unknown, action: "view" | "create" | "edit" | "delete"): boolean {
  return (action === "view" || action === "create") && ["owner", "manager", "employee"].includes(String(role));
}
