// Mock calendar data for booking assistant

export interface TimeSlot {
  date: string;
  time: string;
  available: boolean;
  service?: string;
}

export interface Booking {
  bookingId: string;
  date: string;
  time: string;
  service: string;
  customerName: string;
  customerPhone?: string;
  createdAt: string;
}

// Services with durations (in 30-min slot units)
const SERVICES: Record<string, { duration: number; price: string }> = {
  Haircut: { duration: 1, price: "$35" },
  Color: { duration: 3, price: "$80" },
  Highlights: { duration: 4, price: "$120" },
  Blowout: { duration: 1, price: "$25" },
  Trim: { duration: 1, price: "$20" },
};

// Business hours (30-min slots)
const OPEN_HOUR = 9;
const CLOSE_HOUR = 17;
const CLOSED_DAYS = [0]; // Sunday = 0

// In-memory bookings
let bookingCounter = 1000;
const bookings = new Map<string, Booking>();

// Pre-seed some bookings for realism
function seedBookings() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split("T")[0];

  addBooking(dateStr, "10:00", "Haircut", "Maria Garcia", "+1-555-0101");
  addBooking(dateStr, "11:00", "Color", "James Wilson", "+1-555-0102");
  addBooking(dateStr, "14:00", "Highlights", "Sofia Chen");
}

function addBooking(date: string, time: string, service: string, name: string, phone?: string): Booking {
  const booking: Booking = {
    bookingId: `BK-${++bookingCounter}`,
    date,
    time,
    service,
    customerName: name,
    customerPhone: phone,
    createdAt: new Date().toISOString(),
  };
  bookings.set(booking.bookingId, booking);
  return booking;
}

// -- Public API --

export function listAvailableSlots(date: string, service?: string): TimeSlot[] | { error: string } {
  const d = new Date(date + "T00:00:00");
  if (isNaN(d.getTime())) return { error: "Invalid date format. Use YYYY-MM-DD." };
  if (CLOSED_DAYS.includes(d.getDay())) return { error: `We are closed on ${d.toLocaleDateString("en-US", { weekday: "long" })}s.` };

  const slots: TimeSlot[] = [];
  const bookedTimes = new Set<string>();

  // Mark booked times
  for (const b of bookings.values()) {
    if (b.date === date) {
      const svc = SERVICES[b.service];
      const [h, m] = b.time.split(":").map(Number);
      const slotsNeeded = svc?.duration ?? 1;
      for (let i = 0; i < slotsNeeded; i++) {
        const slotMin = h * 60 + m + i * 30;
        bookedTimes.add(`${Math.floor(slotMin / 60).toString().padStart(2, "0")}:${(slotMin % 60).toString().padStart(2, "0")}`);
      }
    }
  }

  // Generate available slots
  for (let hour = OPEN_HOUR; hour < CLOSE_HOUR; hour++) {
    for (const min of [0, 30]) {
      const time = `${hour.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
      const available = !bookedTimes.has(time);
      if (service) {
        if (available) slots.push({ date, time, available, service });
      } else {
        slots.push({ date, time, available });
      }
    }
  }

  if (service && SERVICES[service]) {
    return slots.length > 0
      ? slots
      : [{ date, time: "", available: false, service: `No slots available for ${service}` }];
  }

  return slots;
}

export function createBooking(
  date: string,
  time: string,
  service: string,
  customerName: string,
  customerPhone?: string,
): Booking | { error: string } {
  if (!SERVICES[service]) {
    return { error: `Unknown service "${service}". Available: ${Object.keys(SERVICES).join(", ")}` };
  }

  // Check availability
  const slots = listAvailableSlots(date);
  if ("error" in slots) return slots;

  const slot = slots.find((s) => s.time === time);
  if (!slot || !slot.available) {
    return { error: `Time slot ${time} on ${date} is not available.` };
  }

  const booking = addBooking(date, time, service, customerName, customerPhone);
  return booking;
}

export function cancelBooking(bookingId: string): { success: boolean; message: string } {
  const booking = bookings.get(bookingId.toUpperCase());
  if (!booking) return { success: false, message: `Booking ${bookingId} not found.` };

  bookings.delete(bookingId.toUpperCase());
  return { success: true, message: `Booking ${booking.bookingId} cancelled (${booking.service} on ${booking.date} at ${booking.time}).` };
}

export function getServices(): Record<string, { duration: number; price: string }> {
  return SERVICES;
}

// Initialize seed data
seedBookings();
