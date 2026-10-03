// Sample listings and this weekend's schedule. `access` (gate/lockbox/alarm codes) never leaves the
// server except inside the Confirmed and Reminder emails. Replace with Repliers data later.
export const WEEK = {
  days: {
    sat: { label: "Saturday", date: "Oct 10", iso: "2026-10-10" },
    sun: { label: "Sunday", date: "Oct 11", iso: "2026-10-11" },
  },
  closes: "2026-10-09T17:00:00-05:00", // Friday 5:00 PM CT
  closesLabel: "Friday, Oct 9 at 5:00 PM",
  firstHour: 9,
  lastHour: 19,
};

export const LISTINGS = [
  { mls: "21297798", lat: 32.978088, lng: -97.18720096, addr: "2006 Nighthawk Court", city: "Westlake", zip: "76262", price: 5950000, dom: 50, bd: 4, ba: 6, sf: 6331,
    img: "ntreismls/IMG-21297798_0.jpg", days: ["sat", "sun"],
    instr: ["Gated community. Check in with the guard and give the property address.", "The sellers' dog will be off site during open house hours.", "Shoe covers are in the front hall closet. Ask visitors to use them."],
    access: "Guard gate: show your license. Lockbox: Supra on the front door." },
  { mls: "21372196", lat: 32.908375, lng: -97.157547, addr: "6900 Rockingham Court", city: "Colleyville", zip: "76034", price: 4350000, dom: 13, bd: 6, ba: 9, sf: 10026,
    img: "ntreismls/IMG-21372196_4446441738281566696.jpg", days: ["sat", "sun"],
    instr: ["Park on Rockingham Court, not in the motor court.", "Pool and courtyard lights are on the panel by the back door.", "The wine room stays locked. Do not show it."],
    access: "Lockbox: Supra on the side gate. Alarm code: 4417 (sample)." },
  { mls: "21332907", lat: 32.983337, lng: -97.18004802, addr: "69 Cortes Drive", city: "Westlake", zip: "76262", price: 1297000, dom: 32, bd: 3, ba: 4, sf: 2038,
    img: "ntreismls/IMG-21332907_4446676996495488826.jpg", days: ["sun"],
    instr: ["Park in the visitor spaces along Cortes Drive.", "Start visitors on the third floor and work down."],
    access: "Entrada gate code: 2417# (sample). Lockbox on the front door." },
  { mls: "21346883", lat: 32.929991, lng: -97.193693, addr: "441 Watermere Drive", city: "Southlake", zip: "76092", price: 629000, dom: 28, bd: 2, ba: 3, sf: 2109,
    img: "ntreismls/IMG-21346883_4444455829925220134.jpg", days: ["sat", "sun"],
    instr: ["Check in at the front desk in the main lobby.", "Use guest parking. The unit is on the second floor."],
    access: "Front desk will release the key on your ID. No lockbox." },
];

export const findListing = (mls) => LISTINGS.find((l) => l.mls === mls);

// Everything the browser may see: no access details.
export const publicListing = ({ access, ...rest }) => rest;
