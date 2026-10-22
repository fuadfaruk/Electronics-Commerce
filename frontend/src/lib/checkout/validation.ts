import type { PlaceOrderRequest } from "@/types/api";

export const DISTRICTS = "Bagerhat,Bandarban,Barguna,Barishal,Bhola,Bogura,Brahmanbaria,Chandpur,Chattogram,Chuadanga,Cox's Bazar,Cumilla,Dhaka,Dinajpur,Faridpur,Feni,Gaibandha,Gazipur,Gopalganj,Habiganj,Jamalpur,Jashore,Jhalokathi,Jhenaidah,Joypurhat,Khagrachhari,Khulna,Kishoreganj,Kurigram,Kushtia,Lakshmipur,Lalmonirhat,Madaripur,Magura,Manikganj,Meherpur,Moulvibazar,Munshiganj,Mymensingh,Naogaon,Narail,Narayanganj,Narsingdi,Natore,Netrokona,Nilphamari,Noakhali,Pabna,Panchagarh,Patuakhali,Pirojpur,Rajbari,Rajshahi,Rangamati,Rangpur,Satkhira,Shariatpur,Sherpur,Sirajganj,Sunamganj,Sylhet,Tangail,Thakurgaon,Chapainawabganj".split(",").sort();

export function checkoutPayload(data: FormData, quoteId: string, accountEmail?: string): { payload?: PlaceOrderRequest; error?: string } {
  const field = (key: string) => String(data.get(key) ?? "").trim();
  const name = field("name");
  const email = accountEmail ?? field("email");
  const phone = field("phone").replace(/[ ()-]/g, "");
  const street = field("street"), area = field("area"), city = field("city"), district = field("district");
  const postcode = field("postcode"), notes = field("notes");
  if (name.length < 2 || name.length > 100 || /[\u0000-\u001f]/.test(name)) return { error: "Enter a full name between 2 and 100 characters." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "Enter a valid contact email. It is required for private order access." };
  if (!/^(?:\+?88)?01[3-9][0-9]{8}$/.test(phone)) return { error: "Enter a Bangladesh mobile number, such as 01712345678." };
  if (street.length < 5 || street.length > 300 || area.length < 2 || area.length > 100 || city.length < 2 || city.length > 100 || !DISTRICTS.includes(district)) return { error: "Enter the street, area, city and a Bangladesh district." };
  if (postcode && !/^[0-9]{4}$/.test(postcode)) return { error: "Postcode must contain four digits, or be left blank." };
  if (notes.length > 500 || [street, area, city, district, postcode, notes].some((v) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))) return { error: "Remove invalid characters and keep delivery notes within 500 characters." };
  return {
    payload: {
      quoteId, contact: { name, email, phone }, deliveryAddress: { street, area, city, district, ...(postcode ? { postcode } : {}) },
      ...(notes ? { notes } : {}),
    },
  };
}

export function strongPassword(value: string): boolean {
  return value.length >= 10 && value.length <= 128 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value);
}
