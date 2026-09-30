import type { PaymentMethod, Product } from "@/types/domain";

/**
 * Mock catalog.
 *
 * This is the only source of product data in the frontend today: there is no
 * product endpoint on the backend and `ApplicationDbContext` has no
 * `DbSet<Product>`, so nothing can be fetched even if we wanted to.
 *
 * Prices are whole BDT taka and VAT-inclusive, matching the `int`
 * `Product.ProductPrice` field. Stock mirrors `Product.ProductQuantity`.
 * `brand`, `categorySlug`, `images`, `specs`, `compareAtPrice` and `featured`
 * have no backend equivalent yet — see the README gap list.
 */

/**
 * Deterministic synthetic identifiers, in the shape of a UUIDv4. Sequential
 * rather than random so the mock, and any test that references it, is stable.
 */
let idCounter = 0;
const nextId = (): string =>
  `00000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}`;

/** Every product gets the same two checked-in placeholders for its category. */
const placeholderImages = (categorySlug: string): string[] => [
  `/placeholders/${categorySlug}.svg`,
  `/placeholders/${categorySlug}-detail.svg`,
];

type ProductSeed = Omit<Product, "id" | "images">;

const seeds: ProductSeed[] = [
  {
    slug: "samsung-galaxy-s24-ultra-12-256",
    name: "Galaxy S24 Ultra 12/256GB",
    brand: "Samsung",
    categorySlug: "smartphones",
    description:
      "Titanium-framed flagship with a built-in S Pen and a 200MP main camera. Ships with 12GB RAM and 256GB of storage.",
    price: 189999,
    compareAtPrice: 199999,
    stock: 3,
    featured: true,
    specs: [
      { label: "Display", value: "6.8\" QHD+ Dynamic AMOLED 2X, 120Hz" },
      { label: "Chipset", value: "Snapdragon 8 Gen 3 for Galaxy" },
      { label: "Rear camera", value: "200MP + 50MP + 12MP + 10MP" },
      { label: "Battery", value: "5000mAh, 45W wired" },
      { label: "Warranty", value: "1 year official warranty" },
    ],
  },
  {
    slug: "apple-iphone-15-128",
    name: "iPhone 15 128GB",
    brand: "Apple",
    categorySlug: "smartphones",
    description:
      "USB-C iPhone with the A16 Bionic chip, Dynamic Island and a 48MP main camera.",
    price: 152500,
    stock: 4,
    featured: true,
    specs: [
      { label: "Display", value: "6.1\" Super Retina XDR" },
      { label: "Chipset", value: "A16 Bionic" },
      { label: "Rear camera", value: "48MP + 12MP ultrawide" },
      { label: "Battery", value: "Up to 20 hours video playback" },
      { label: "Warranty", value: "1 year official warranty" },
    ],
  },
  {
    slug: "xiaomi-redmi-note-13-pro-8-256",
    name: "Redmi Note 13 Pro 8/256GB",
    brand: "Xiaomi",
    categorySlug: "smartphones",
    description:
      "Mid-range value pick with a 200MP camera, 120Hz AMOLED panel and 67W fast charging.",
    price: 33999,
    compareAtPrice: 36999,
    stock: 24,
    featured: true,
    specs: [
      { label: "Display", value: "6.67\" 1.5K AMOLED, 120Hz" },
      { label: "Chipset", value: "Snapdragon 7s Gen 2" },
      { label: "Rear camera", value: "200MP + 8MP + 2MP" },
      { label: "Battery", value: "5100mAh, 67W wired" },
      { label: "Warranty", value: "1 year official warranty" },
    ],
  },
  {
    slug: "realme-12-pro-plus-8-256",
    name: "realme 12 Pro+ 8/256GB",
    brand: "Realme",
    categorySlug: "smartphones",
    description:
      "Periscope telephoto zoom at a mid-range price, with a curved AMOLED display.",
    price: 42999,
    stock: 15,
    specs: [
      { label: "Display", value: "6.7\" curved AMOLED, 120Hz" },
      { label: "Chipset", value: "Snapdragon 7s Gen 2" },
      { label: "Rear camera", value: "50MP + 64MP periscope + 8MP" },
      { label: "Battery", value: "5000mAh, 67W SuperVOOC" },
      { label: "Warranty", value: "1 year official warranty" },
    ],
  },
  {
    slug: "oneplus-nord-ce-4-8-128",
    name: "OnePlus Nord CE 4 8/128GB",
    brand: "OnePlus",
    categorySlug: "smartphones",
    description:
      "Clean software and 100W charging. Expandable storage via microSD.",
    price: 38990,
    stock: 9,
    specs: [
      { label: "Display", value: "6.7\" AMOLED, 120Hz" },
      { label: "Chipset", value: "Snapdragon 7 Gen 3" },
      { label: "Rear camera", value: "50MP + 8MP" },
      { label: "Battery", value: "5500mAh, 100W wired" },
      { label: "Warranty", value: "1 year official warranty" },
    ],
  },

  {
    slug: "apple-macbook-air-m3-13-8-256",
    name: "MacBook Air M3 13\" 8/256GB",
    brand: "Apple",
    categorySlug: "laptops",
    description:
      "Fanless 13-inch Air with the M3 chip. Around 18 hours of battery in a 1.24kg body.",
    price: 179000,
    stock: 0,
    featured: true,
    specs: [
      { label: "Display", value: "13.6\" Liquid Retina, 500 nits" },
      { label: "Chipset", value: "Apple M3, 8-core CPU / 10-core GPU" },
      { label: "Memory", value: "8GB unified memory" },
      { label: "Storage", value: "256GB SSD" },
      { label: "Warranty", value: "1 year official warranty" },
    ],
  },
  {
    slug: "asus-vivobook-15-i5-12450h-8-512",
    name: "VivoBook 15 i5-12450H 8/512GB",
    brand: "Asus",
    categorySlug: "laptops",
    description:
      "15.6-inch everyday laptop with a backlit keyboard, fingerprint reader and full-size number pad.",
    price: 76500,
    stock: 11,
    specs: [
      { label: "Display", value: "15.6\" FHD IPS, 60Hz" },
      { label: "Processor", value: "Intel Core i5-12450H" },
      { label: "Memory", value: "8GB DDR4 (1 slot free)" },
      { label: "Storage", value: "512GB NVMe SSD" },
      { label: "Warranty", value: "2 years official warranty" },
    ],
  },
  {
    slug: "lenovo-ideapad-slim-3-ryzen-5-7530u-8-512",
    name: "IdeaPad Slim 3 Ryzen 5 7530U 8/512GB",
    brand: "Lenovo",
    categorySlug: "laptops",
    description:
      "Slim 15-inch machine for study and office work, with fast charging over USB-C.",
    price: 68900,
    stock: 7,
    specs: [
      { label: "Display", value: "15.6\" FHD TN, 60Hz" },
      { label: "Processor", value: "AMD Ryzen 5 7530U" },
      { label: "Memory", value: "8GB DDR4" },
      { label: "Storage", value: "512GB NVMe SSD" },
      { label: "Warranty", value: "2 years official warranty" },
    ],
  },
  {
    slug: "hp-pavilion-15-i7-1355u-16-512",
    name: "Pavilion 15 i7-1355U 16/512GB",
    brand: "HP",
    categorySlug: "laptops",
    description:
      "Aluminium-bodied 15-inch laptop with 16GB of memory and a 100% sRGB display option.",
    price: 134900,
    stock: 5,
    specs: [
      { label: "Display", value: "15.6\" FHD IPS, 250 nits" },
      { label: "Processor", value: "Intel Core i7-1355U" },
      { label: "Memory", value: "16GB DDR4 dual channel" },
      { label: "Storage", value: "512GB NVMe SSD" },
      { label: "Warranty", value: "2 years official warranty" },
    ],
  },

  {
    slug: "sony-wh-1000xm5",
    name: "WH-1000XM5 Wireless Headphones",
    brand: "Sony",
    categorySlug: "audio",
    description:
      "Over-ear noise cancelling headphones with eight microphones and 30 hours of battery.",
    price: 42500,
    compareAtPrice: 45900,
    stock: 8,
    featured: true,
    specs: [
      { label: "Type", value: "Over-ear, closed back" },
      { label: "Noise cancelling", value: "Yes, adaptive" },
      { label: "Battery", value: "30 hours with ANC on" },
      { label: "Codecs", value: "SBC, AAC, LDAC" },
    ],
  },
  {
    slug: "samsung-galaxy-buds-fe",
    name: "Galaxy Buds FE",
    brand: "Samsung",
    categorySlug: "audio",
    description:
      "True wireless earbuds with active noise cancelling and a soft wing-tip fit.",
    price: 9999,
    stock: 30,
    specs: [
      { label: "Type", value: "In-ear, true wireless" },
      { label: "Noise cancelling", value: "Yes, with ambient mode" },
      { label: "Battery", value: "6 hours, 21 hours with case" },
      { label: "Water resistance", value: "IPX2" },
    ],
  },
  {
    slug: "apple-airpods-pro-2-usb-c",
    name: "AirPods Pro 2 (USB-C)",
    brand: "Apple",
    categorySlug: "audio",
    description:
      "Active noise cancelling earbuds with a USB-C charging case and adaptive audio.",
    price: 28900,
    stock: 6,
    specs: [
      { label: "Type", value: "In-ear, true wireless" },
      { label: "Noise cancelling", value: "Yes, adaptive transparency" },
      { label: "Battery", value: "6 hours, 30 hours with case" },
      { label: "Water resistance", value: "IP54" },
    ],
  },
  {
    slug: "jbl-tune-770nc",
    name: "Tune 770NC Headphones",
    brand: "JBL",
    categorySlug: "audio",
    description:
      "Foldable on-ear headphones with active noise cancelling and 70 hours of playback.",
    price: 12990,
    stock: 18,
    specs: [
      { label: "Type", value: "Over-ear, closed back" },
      { label: "Noise cancelling", value: "Yes" },
      { label: "Battery", value: "70 hours with ANC off" },
      { label: "Folding", value: "Yes, flat-folding" },
    ],
  },
  {
    slug: "anker-soundcore-life-q30",
    name: "Soundcore Life Q30",
    brand: "Anker",
    categorySlug: "audio",
    description:
      "Budget noise cancelling over-ears with three EQ modes and a hard travel case.",
    price: 6990,
    stock: 22,
    specs: [
      { label: "Type", value: "Over-ear, closed back" },
      { label: "Noise cancelling", value: "Yes, hybrid" },
      { label: "Battery", value: "40 hours with ANC on" },
      { label: "Codecs", value: "SBC, AAC" },
    ],
  },

  {
    slug: "amd-ryzen-5-7600",
    name: "Ryzen 5 7600 Desktop Processor",
    brand: "AMD",
    categorySlug: "components",
    description:
      "Six-core AM5 processor with integrated graphics and a bundled cooler.",
    price: 26500,
    stock: 12,
    featured: true,
    specs: [
      { label: "Cores / threads", value: "6 / 12" },
      { label: "Base / boost", value: "3.8GHz / 5.1GHz" },
      { label: "Socket", value: "AM5" },
      { label: "TDP", value: "65W" },
      { label: "Cooler", value: "Wraith Stealth included" },
    ],
  },
  {
    slug: "intel-core-i5-13400f",
    name: "Core i5-13400F Processor",
    brand: "Intel",
    categorySlug: "components",
    description:
      "Ten-core LGA1700 processor for gaming builds. Requires a discrete graphics card.",
    price: 24900,
    stock: 10,
    specs: [
      { label: "Cores / threads", value: "10 / 16" },
      { label: "Base / boost", value: "2.5GHz / 4.6GHz" },
      { label: "Socket", value: "LGA1700" },
      { label: "TDP", value: "65W" },
      { label: "Graphics", value: "None (F suffix)" },
    ],
  },
  {
    slug: "asus-dual-rtx-4060-oc-8gb",
    name: "Dual GeForce RTX 4060 OC 8GB",
    brand: "Asus",
    categorySlug: "components",
    description:
      "Dual-fan 1080p graphics card with DLSS 3 support and a compact two-slot design.",
    price: 44900,
    stock: 4,
    specs: [
      { label: "Memory", value: "8GB GDDR6" },
      { label: "Interface", value: "PCIe 4.0 x8" },
      { label: "Power", value: "1x 8-pin, 550W PSU recommended" },
      { label: "Outputs", value: "3x DisplayPort 1.4a, 1x HDMI 2.1" },
    ],
  },
  {
    slug: "corsair-vengeance-16gb-ddr5-5600",
    name: "Vengeance 16GB DDR5 5600MHz",
    brand: "Corsair",
    categorySlug: "components",
    description:
      "Single 16GB DDR5 module with a low-profile heatspreader. Ideal for compact builds.",
    price: 8900,
    stock: 25,
    specs: [
      { label: "Capacity", value: "16GB (1 x 16GB)" },
      { label: "Speed", value: "5600MHz" },
      { label: "Type", value: "DDR5 UDIMM" },
      { label: "Latency", value: "CL36" },
    ],
  },
  {
    slug: "corsair-cx650-650w-bronze",
    name: "CX650 650W 80+ Bronze",
    brand: "Corsair",
    categorySlug: "components",
    description:
      "Non-modular ATX power supply with a 120mm fan and 80 Plus Bronze efficiency.",
    price: 7500,
    stock: 14,
    specs: [
      { label: "Wattage", value: "650W" },
      { label: "Efficiency", value: "80 Plus Bronze" },
      { label: "Modular", value: "No" },
      { label: "Warranty", value: "5 years" },
    ],
  },

  {
    slug: "samsung-980-pro-1tb-nvme",
    name: "980 Pro 1TB NVMe SSD",
    brand: "Samsung",
    categorySlug: "storage",
    description:
      "PCIe 4.0 NVMe drive rated up to 7000MB/s sequential read, with a five-year warranty.",
    price: 14500,
    compareAtPrice: 15900,
    stock: 16,
    specs: [
      { label: "Capacity", value: "1TB" },
      { label: "Interface", value: "PCIe 4.0 x4 NVMe" },
      { label: "Read / write", value: "7000MB/s / 5000MB/s" },
      { label: "Form factor", value: "M.2 2280" },
      { label: "Warranty", value: "5 years" },
    ],
  },
  {
    slug: "wd-blue-sn580-500gb-nvme",
    name: "WD Blue SN580 500GB NVMe SSD",
    brand: "WD",
    categorySlug: "storage",
    description:
      "Power-efficient PCIe 4.0 drive that runs cool and is a solid boot drive upgrade.",
    price: 6800,
    stock: 20,
    specs: [
      { label: "Capacity", value: "500GB" },
      { label: "Interface", value: "PCIe 4.0 x4 NVMe" },
      { label: "Read / write", value: "4000MB/s / 3600MB/s" },
      { label: "Form factor", value: "M.2 2280" },
      { label: "Warranty", value: "5 years" },
    ],
  },
  {
    slug: "seagate-barracuda-2tb-hdd",
    name: "BarraCuda 2TB Hard Drive",
    brand: "Seagate",
    categorySlug: "storage",
    description:
      "7200RPM 3.5-inch desktop drive for bulk storage and backup.",
    price: 8900,
    stock: 13,
    specs: [
      { label: "Capacity", value: "2TB" },
      { label: "Interface", value: "SATA 6Gb/s" },
      { label: "Speed", value: "7200 RPM" },
      { label: "Cache", value: "256MB" },
      { label: "Warranty", value: "2 years" },
    ],
  },
  {
    slug: "samsung-portable-ssd-t7-1tb",
    name: "Portable SSD T7 1TB",
    brand: "Samsung",
    categorySlug: "storage",
    description:
      "Pocket-sized USB 3.2 external SSD with hardware encryption and a shock-resistant shell.",
    price: 12500,
    stock: 9,
    specs: [
      { label: "Capacity", value: "1TB" },
      { label: "Interface", value: "USB 3.2 Gen 2 (10Gbps)" },
      { label: "Read / write", value: "1050MB/s / 1000MB/s" },
      { label: "Encryption", value: "AES 256-bit hardware" },
    ],
  },

  {
    slug: "anker-powercore-20000-22-5w",
    name: "PowerCore 20000mAh 22.5W",
    brand: "Anker",
    categorySlug: "accessories",
    description:
      "High-capacity power bank with USB-C PD output that can charge a phone roughly four times.",
    price: 3490,
    stock: 40,
    specs: [
      { label: "Capacity", value: "20000mAh" },
      { label: "Output", value: "22.5W max, USB-C PD + 2x USB-A" },
      { label: "Recharge", value: "USB-C, about 6 hours" },
      { label: "Weight", value: "434g" },
    ],
  },
  {
    slug: "ugreen-usb-c-to-usb-c-100w-2m",
    name: "USB-C to USB-C Cable 100W 2m",
    brand: "UGREEN",
    categorySlug: "accessories",
    description:
      "Braided 100W charging and 480Mbps data cable with a lifetime-bend nylon jacket.",
    price: 890,
    stock: 0,
    specs: [
      { label: "Length", value: "2 metres" },
      { label: "Power", value: "100W (20V / 5A)" },
      { label: "Data", value: "480Mbps" },
      { label: "Jacket", value: "Braided nylon" },
    ],
  },
  {
    slug: "logitech-m650-wireless-mouse",
    name: "M650 Ergonomic Wireless Mouse",
    brand: "Logitech",
    categorySlug: "accessories",
    description:
      "Silent-click wireless mouse with a sculpted shape and 24-month battery life.",
    price: 4200,
    stock: 17,
    featured: true,
    specs: [
      { label: "Connection", value: "Bluetooth LE or Logi Bolt USB receiver" },
      { label: "Sensor", value: "400–4000 DPI" },
      { label: "Battery", value: "24 months (1x AA)" },
      { label: "Buttons", value: "5, silent switches" },
    ],
  },
  {
    slug: "logitech-k380-multi-device-keyboard",
    name: "K380 Multi-Device Keyboard",
    brand: "Logitech",
    categorySlug: "accessories",
    description:
      "Compact Bluetooth keyboard that pairs with three devices and switches between them.",
    price: 3900,
    stock: 21,
    specs: [
      { label: "Connection", value: "Bluetooth, up to 3 devices" },
      { label: "Layout", value: "Compact, no number pad" },
      { label: "Battery", value: "24 months (2x AAA)" },
      { label: "Compatibility", value: "Windows, macOS, Android, iOS" },
    ],
  },
  {
    slug: "baseus-gan-65w-3-port-charger",
    name: "GaN 65W 3-Port Charger",
    brand: "Baseus",
    categorySlug: "accessories",
    description:
      "Compact gallium-nitride charger that can power a laptop and two phones at once.",
    price: 2990,
    stock: 35,
    specs: [
      { label: "Output", value: "65W total, 2x USB-C + 1x USB-A" },
      { label: "Technology", value: "GaN II" },
      { label: "Plug", value: "Foldable, UK 3-pin" },
      { label: "Protocols", value: "PD 3.0, QC 4.0" },
    ],
  },

  {
    slug: "apple-watch-se-2-40mm",
    name: "Watch SE 2 40mm GPS",
    brand: "Apple",
    categorySlug: "wearables",
    description:
      "Aluminium smartwatch with crash and fall detection, sleep tracking and watchOS.",
    price: 32500,
    stock: 7,
    specs: [
      { label: "Display", value: "40mm Retina LTPO OLED" },
      { label: "Chipset", value: "Apple S8" },
      { label: "Battery", value: "Up to 18 hours" },
      { label: "Water resistance", value: "50 metres" },
      { label: "Warranty", value: "1 year official warranty" },
    ],
  },
  {
    slug: "samsung-galaxy-fit-3",
    name: "Galaxy Fit 3",
    brand: "Samsung",
    categorySlug: "wearables",
    description:
      "Lightweight fitness tracker with a bright AMOLED screen and 13-day battery.",
    price: 6499,
    stock: 26,
    specs: [
      { label: "Display", value: "1.6\" AMOLED" },
      { label: "Battery", value: "Up to 13 days" },
      { label: "Sensors", value: "Heart rate, SpO2, sleep" },
      { label: "Water resistance", value: "5ATM + IP68" },
    ],
  },
  {
    slug: "xiaomi-mi-band-8",
    name: "Mi Band 8",
    brand: "Xiaomi",
    categorySlug: "wearables",
    description:
      "Budget band with a 60Hz AMOLED screen, 150 workout modes and quick-release straps.",
    price: 4500,
    stock: 32,
    specs: [
      { label: "Display", value: "1.62\" AMOLED, 60Hz" },
      { label: "Battery", value: "Up to 16 days" },
      { label: "Sensors", value: "Heart rate, SpO2, sleep" },
      { label: "Water resistance", value: "5ATM" },
    ],
  },
  {
    slug: "huawei-watch-gt-4-46mm",
    name: "Watch GT 4 46mm",
    brand: "Huawei",
    categorySlug: "wearables",
    description:
      "Stainless-steel smartwatch with dual-band GPS and a two-week battery.",
    price: 24500,
    stock: 5,
    specs: [
      { label: "Display", value: "1.43\" AMOLED" },
      { label: "Battery", value: "Up to 14 days typical use" },
      { label: "Positioning", value: "Dual-band five-system GPS" },
      { label: "Water resistance", value: "5ATM" },
    ],
  },

  {
    slug: "tp-link-archer-ax23-ax1800",
    name: "Archer AX23 AX1800 Router",
    brand: "TP-Link",
    categorySlug: "networking",
    description:
      "Dual-band WiFi 6 router with four antennas, OneMesh support and easy app setup.",
    price: 5900,
    stock: 23,
    specs: [
      { label: "Standard", value: "WiFi 6 (802.11ax)" },
      { label: "Speed", value: "1800Mbps (1201 + 574)" },
      { label: "Ports", value: "1x gigabit WAN, 4x gigabit LAN" },
      { label: "Antennas", value: "4 fixed high-gain" },
    ],
  },
  {
    slug: "tp-link-deco-x50-2-pack",
    name: "Deco X50 AX3000 Mesh (2-pack)",
    brand: "TP-Link",
    categorySlug: "networking",
    description:
      "Two-unit mesh system covering roughly 420 square metres with seamless roaming.",
    price: 18900,
    compareAtPrice: 20500,
    stock: 8,
    specs: [
      { label: "Standard", value: "WiFi 6 (802.11ax)" },
      { label: "Speed", value: "3000Mbps" },
      { label: "Coverage", value: "Up to 420 m² (2 units)" },
      { label: "Ports", value: "3x gigabit per unit" },
    ],
  },
  {
    slug: "tp-link-8-port-gigabit-switch",
    name: "8-Port Gigabit Desktop Switch",
    brand: "TP-Link",
    categorySlug: "networking",
    description:
      "Unmanaged metal switch with plug-and-play setup and energy-efficient ports.",
    price: 2450,
    stock: 19,
    specs: [
      { label: "Ports", value: "8x 10/100/1000Mbps" },
      { label: "Management", value: "Unmanaged" },
      { label: "Housing", value: "Metal, fanless" },
      { label: "Power", value: "External adapter" },
    ],
  },
  {
    slug: "tp-link-usb-wifi-adapter-ac1300",
    name: "USB WiFi Adapter AC1300",
    brand: "TP-Link",
    categorySlug: "networking",
    description:
      "Dual-band USB 3.0 adapter that upgrades a desktop to 5GHz WiFi.",
    price: 1650,
    stock: 28,
    specs: [
      { label: "Standard", value: "WiFi 5 (802.11ac)" },
      { label: "Speed", value: "1300Mbps (867 + 400)" },
      { label: "Interface", value: "USB 3.0" },
      { label: "Antenna", value: "High-gain external" },
    ],
  },
];

export const MOCK_PRODUCTS: Product[] = seeds.map((seed) => ({
  ...seed,
  id: nextId(),
  images: placeholderImages(seed.categorySlug),
}));

/**
 * Payment options the checkout will present. Mock data only for now — the cart
 * drawer does not create orders yet, and there is no payment endpoint.
 *
 * These map onto your `OrderStatus` enum: cash on delivery stays `Pending`,
 * while bKash and Nagad would be `Paid` once confirmed.
 */
export const PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: "cod",
    name: "Cash on delivery",
    description: "Pay the courier in cash when your order arrives.",
  },
  {
    id: "bkash",
    name: "bKash",
    description: "Send payment to our bKash merchant number.",
  },
  {
    id: "nagad",
    name: "Nagad",
    description: "Send payment to our Nagad merchant number.",
  },
];
