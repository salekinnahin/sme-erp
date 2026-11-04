import { beforeEach, describe, expect, it, vi } from "vitest";

// -----------------------------------------------------------------------------
// In-memory stand-in for the Supabase query builder. It applies only the
// filters the code under test adds (no RLS), so a missing organization_id
// filter would show up as a cross-tenant leak in these tests.
// -----------------------------------------------------------------------------

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = { product_categories: [], products: [] };
const writes: { table: string; op: string }[] = [];

// A thenable: `await query` resolves to { data, error } like supabase-js.
class Query {
  private filters: [string, unknown][] = [];
  private orders: string[] = [];
  private max = Infinity;
  private patch: Row | null = null;

  constructor(private table: string) {}

  select() {
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }
  order(column: string) {
    this.orders.push(column);
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  update(patch: Row) {
    this.patch = patch;
    return this;
  }
  insert(row: Row) {
    writes.push({ table: this.table, op: "insert" });
    db[this.table].push({ id: crypto.randomUUID(), ...row });
    return this;
  }

  private rows(): Row[] {
    let rows = db[this.table].filter((r) => this.filters.every(([c, v]) => r[c] === v));
    for (const column of [...this.orders].reverse())
      rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])));
    rows = rows.slice(0, this.max);
    if (this.patch) {
      writes.push({ table: this.table, op: "update" });
      for (const r of rows) Object.assign(r, this.patch);
    }
    return rows;
  }
  async maybeSingle() {
    return { data: this.rows()[0] ?? null, error: null };
  }
  async single() {
    return { data: this.rows().at(-1) ?? null, error: null };
  }
  then<T>(resolve: (value: { data: unknown; error: null }) => T) {
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve);
  }
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (table: string) => new Query(table) }),
}));

const { createCategory, getCategory, listCategoryOptions, renameCategory, selectableCategories } =
  await import("./categories");
const { updateProduct } = await import("./products");
const { validateProductInput } = await import("./validation");

// -----------------------------------------------------------------------------

const ORG_A = "aaaaaaaa-0000-4000-8000-0000000000aa";
const ORG_B = "bbbbbbbb-0000-4000-8000-0000000000bb";
const CURRENT = "cccccccc-0000-4000-8000-000000000001"; // "Zz Current", sorts last
const OTHER_INACTIVE = "cccccccc-0000-4000-8000-000000000002";
const B_CATEGORY = "dddddddd-0000-4000-8000-000000000001";
const PRODUCT = "eeeeeeee-0000-4000-8000-000000000001";

const owner = { organization: { id: ORG_A, name: "A", currency: "BDT", timezone: "UTC" }, role: "owner" as const };
const employee = { ...owner, role: "employee" as const };

function category(id: string, name: string, status: string, org = ORG_A): Row {
  return { id, organization_id: org, name, status };
}

beforeEach(() => {
  writes.length = 0;
  // 1,000 active categories fill the capped list; the current category sorts
  // after them, so it is outside the first page.
  db.product_categories = Array.from({ length: 1000 }, (_, i) =>
    category(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, `Cat ${String(i).padStart(4, "0")}`, "active"),
  );
  db.product_categories.push(
    category(OTHER_INACTIVE, "Aa Old", "inactive"),
    category(CURRENT, "Zz Current", "active"),
    category(B_CATEGORY, "Zz Other Tenant", "active", ORG_B),
  );
  db.products = [
    {
      id: PRODUCT,
      organization_id: ORG_A,
      name: "Laptop",
      sku: "SKU-001",
      category_id: CURRENT,
      product_type: "inventory",
      unit: "pcs",
      description: null,
      purchase_price: null,
      selling_price: null,
      reorder_level: "0",
    },
  ];
});

function setCurrentStatus(status: string) {
  db.product_categories.find((c) => c.id === CURRENT)!.status = status;
}

describe("listCategoryOptions", () => {
  it("includes the current category when it is outside the first 1,000 rows", async () => {
    const options = await listCategoryOptions(owner, CURRENT);
    expect(options.map((c) => c.id)).toContain(CURRENT);
    // Without the direct fetch it would be missing:
    expect((await listCategoryOptions(owner, null)).map((c) => c.id)).not.toContain(CURRENT);
  });

  it("keeps an inactive current category but no other inactive ones", async () => {
    setCurrentStatus("inactive");
    const ids = (await listCategoryOptions(owner, CURRENT)).map((c) => c.id);
    expect(ids).toContain(CURRENT);
    expect(ids).not.toContain(OTHER_INACTIVE);
  });

  it("never loads another organization's category", async () => {
    expect(await getCategory(owner, B_CATEGORY)).toBeNull();
    const ids = (await listCategoryOptions(owner, B_CATEGORY)).map((c) => c.id);
    expect(ids).not.toContain(B_CATEGORY);
  });
});

describe("selectableCategories", () => {
  it("adds the current category once, even if inactive", () => {
    const active = { id: "1", name: "A", status: "active" as const };
    const old = { id: "2", name: "B", status: "inactive" as const };
    expect(selectableCategories([active, old], null)).toEqual([active]);
    expect(selectableCategories([active, old], old)).toEqual([active, old]);
    expect(selectableCategories([active], old)).toEqual([old, active]);
  });
});

describe("editing a product keeps its category", () => {
  async function saveUnrelatedEdit(role: typeof owner | typeof employee) {
    const options = await listCategoryOptions(role, CURRENT);
    // The edit form's initial category value is the product's category, and
    // it must be one of the select's options to be submitted unchanged.
    expect(options.some((c) => c.id === CURRENT)).toBe(true);
    const parsed = validateProductInput({
      name: "Laptop",
      sku: "SKU-001",
      productType: "inventory",
      categoryId: CURRENT,
      unit: "pcs",
      description: "Only the description changed",
      purchasePrice: "",
      sellingPrice: "",
      reorderLevel: "",
    });
    if (!parsed.ok) throw new Error("invalid fixture");
    return updateProduct(role, PRODUCT, parsed.value);
  }

  it.each([
    ["active", owner],
    ["inactive", owner],
    ["inactive", employee],
  ] as const)("an unrelated edit keeps a %s current category (%o)", async (status, role) => {
    setCurrentStatus(status);
    expect(await saveUnrelatedEdit(role)).toEqual({ ok: true, productId: PRODUCT });
    const product = db.products[0];
    expect(product.category_id).toBe(CURRENT);
    expect(product.description).toBe("Only the description changed");
  });

  it("does not allow newly assigning another inactive category", async () => {
    const parsed = validateProductInput({
      name: "Laptop",
      sku: "SKU-001",
      productType: "inventory",
      categoryId: OTHER_INACTIVE,
      unit: "pcs",
      description: "",
      purchasePrice: "",
      sellingPrice: "",
      reorderLevel: "",
    });
    if (!parsed.ok) throw new Error("invalid fixture");
    expect(await updateProduct(owner, PRODUCT, parsed.value)).toEqual({
      ok: false,
      reason: "invalid_category",
    });
    expect(db.products[0].category_id).toBe(CURRENT);
  });
});

describe("category writes", () => {
  it("rejects an employee creating or renaming a category without a database write", async () => {
    expect(await createCategory(employee, "New")).toEqual({ ok: false, reason: "forbidden" });
    expect(await renameCategory(employee, CURRENT, "Renamed")).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(writes).toEqual([]);
  });

  it("lets an owner create and rename", async () => {
    expect((await createCategory(owner, "New")).ok).toBe(true);
    expect(await renameCategory(owner, CURRENT, "Renamed")).toEqual({
      ok: true,
      categoryId: CURRENT,
    });
  });
});
