import { describe, expect, it } from "vitest";
import { UNCATEGORIZED } from "@/data/categories.mock";
import {
  EMPTY_GUID,
  apiProductToProduct,
  buildOrderPayload,
  cartLineToApiProduct,
  createId,
  deliveryAddressToLines,
  orderStatusForPayment,
  productSlugFor,
  productToApiProduct,
} from "@/lib/api/adapters";
import { ApiOrderStatus } from "@/types/api";
import type { ApiProduct } from "@/types/api";
import type { CartLine, DeliveryAddress } from "@/types/domain";

const apiProduct: ApiProduct = {
  id: "00000000-0000-4000-8000-000000000007",
  productName: "Test Product",
  productDescription: "A thing that exists.",
  productPrice: 2500,
  productQuantity: 6,
};

const address: DeliveryAddress = {
  fullName: "Fuad Faruk",
  phone: "01700000000",
  email: "fuad@example.com",
  street: "12 Ring Road",
  area: "Mohammadpur",
  city: "Dhaka",
  postcode: "1207",
};

const cartLine: CartLine = {
  productId: apiProduct.id,
  slug: "test-product-00000007",
  name: "Test Product",
  brand: "Unbranded",
  unitPrice: 2500,
  image: UNCATEGORIZED.image,
  quantity: 2,
  stock: 6,
};

describe("productSlugFor", () => {
  it("derives a slug from the name and the id tail", () => {
    expect(productSlugFor(apiProduct)).toBe("test-product-00000007");
  });

  it("keeps slugs distinct for same-named products", () => {
    const other: ApiProduct = { ...apiProduct, id: "00000000-0000-4000-8000-000000000008" };
    expect(productSlugFor(other)).not.toBe(productSlugFor(apiProduct));
  });
});

describe("apiProductToProduct", () => {
  it("maps the fields the API actually has", () => {
    const product = apiProductToProduct(apiProduct);
    expect(product.id).toBe(apiProduct.id);
    expect(product.name).toBe("Test Product");
    expect(product.description).toBe("A thing that exists.");
    expect(product.price).toBe(2500);
    expect(product.stock).toBe(6);
  });

  it("synthesises the fields the API does not have", () => {
    const product = apiProductToProduct(apiProduct);
    expect(product.brand).toBe("Unbranded");
    expect(product.categorySlug).toBe(UNCATEGORIZED.slug);
    expect(product.images).toEqual([UNCATEGORIZED.image]);
    expect(product.specs).toEqual([]);
    expect(product.compareAtPrice).toBeUndefined();
  });
});

describe("productToApiProduct", () => {
  it("sends only what the entity can accept", () => {
    const product = apiProductToProduct(apiProduct);
    const wire = productToApiProduct(product);

    expect(Object.keys(wire).sort()).toEqual(
      [
        "id",
        "productDescription",
        "productName",
        "productPrice",
        "productQuantity",
      ].sort(),
    );
  });
});

describe("cartLineToApiProduct", () => {
  it("uses the cart quantity, not the stock level", () => {
    const wire = cartLineToApiProduct(cartLine);
    expect(wire.productQuantity).toBe(2);
    expect(wire.productPrice).toBe(2500);
    expect(wire.productDescription).toBe("");
  });
});

describe("deliveryAddressToLines", () => {
  it("flattens the address into ordered lines", () => {
    expect(deliveryAddressToLines(address)).toEqual([
      "Fuad Faruk",
      "01700000000",
      "12 Ring Road",
      "Mohammadpur",
      "Dhaka - 1207",
    ]);
  });

  it("appends a delivery note when present", () => {
    expect(
      deliveryAddressToLines({ ...address, notes: "Call before delivery" }),
    ).toContain("Call before delivery");
  });

  it("drops blank optional fields", () => {
    const lines = deliveryAddressToLines({
      ...address,
      postcode: undefined,
      notes: "   ",
    });
    expect(lines).toEqual([
      "Fuad Faruk",
      "01700000000",
      "12 Ring Road",
      "Mohammadpur",
      "Dhaka",
    ]);
  });
});

describe("orderStatusForPayment", () => {
  it("leaves cash on delivery pending", () => {
    expect(orderStatusForPayment("cod")).toBe(ApiOrderStatus.Pending);
  });

  it("marks wallet payments as paid", () => {
    expect(orderStatusForPayment("bkash")).toBe(ApiOrderStatus.Paid);
    expect(orderStatusForPayment("nagad")).toBe(ApiOrderStatus.Paid);
  });

  it("matches the enum values on the server", () => {
    expect(ApiOrderStatus.Pending).toBe(0);
    expect(ApiOrderStatus.Paid).toBe(1);
    expect(ApiOrderStatus.Shipped).toBe(2);
    expect(ApiOrderStatus.Cancelled).toBe(3);
  });
});

describe("buildOrderPayload", () => {
  const orderDate = new Date("2026-01-02T03:04:05.000Z");

  const payload = buildOrderPayload({
    lines: [cartLine],
    address,
    paymentMethod: "cod",
    id: "11111111-1111-4111-8111-111111111111",
    orderDate,
  });

  it("builds a body the current endpoint can accept", () => {
    expect(payload).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      userId: EMPTY_GUID,
      user: {
        id: EMPTY_GUID,
        name: "Fuad Faruk",
        email: "fuad@example.com",
      },
      productIds: cartLine.productId,
      products: [cartLineToApiProduct(cartLine)],
      orderDate: orderDate.toISOString(),
      address: deliveryAddressToLines(address),
      orderStatus: ApiOrderStatus.Pending,
    });
  });

  it("uses Guid.Empty for a guest, since there are no accounts yet", () => {
    expect(payload.userId).toBe(EMPTY_GUID);
    expect(payload.user.id).toBe(EMPTY_GUID);
  });

  it("accepts a user id when accounts exist", () => {
    const withUser = buildOrderPayload({
      lines: [cartLine],
      address,
      paymentMethod: "bkash",
      userId: "22222222-2222-4222-8222-222222222222",
    });
    expect(withUser.userId).toBe("22222222-2222-4222-8222-222222222222");
    expect(withUser.orderStatus).toBe(ApiOrderStatus.Paid);
  });

  it("falls back to Guid.Empty for productIds when the cart is empty", () => {
    const empty = buildOrderPayload({
      lines: [],
      address,
      paymentMethod: "cod",
    });
    expect(empty.productIds).toBe(EMPTY_GUID);
    expect(empty.products).toEqual([]);
  });
});

describe("createId", () => {
  it("produces a UUID-shaped identifier", () => {
    expect(createId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("does not repeat", () => {
    expect(createId()).not.toBe(createId());
  });
});
