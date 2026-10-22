import { json, currentUser, sameOrigin } from "../lib/shared.mjs";
import { listRequests } from "../lib/requests.mjs";
import { mlsListings } from "../lib/listings.mjs";
import { currentWeek } from "../lib/settings.mjs";
import { linkHome } from "../lib/actions.mjs";
import {
  cleanHome, newHomeId, getHome, saveHome, removeHome, listHomes, photoType, savePhoto, deletePhoto, MAX_PHOTOS, MAX_PHOTO_BYTES,
} from "../lib/homes.mjs";

// Admins add homes that aren't on the MLS yet, edit them, manage their photos, and link each one to
// its MLS listing once it's there. POST /api/admin/homes { action, ... }:
//   create  { addr, city, zip, price, bd, ba, sf }   -> { home }
//   update  { id, ...any of those fields }            -> { home }
//   photo   { id, data }   add a JPEG or PNG (data URL or base64)  -> { home }
//   cover   { id, photo }  make that photo the cover  -> { home }
//   unphoto { id, photo }  remove a photo             -> { home }
//   link    { id, mls }    link to its MLS listing; settings and requests move over -> { moved, enterByHand }
//   remove  { id }         delete a home that has no pending or approved requests
export default async (req) => {
  if (req.method !== "POST" || !sameOrigin(req)) return json(405, { error: "method_not_allowed" });
  const user = await currentUser(req);
  if (!user) return json(401, { error: "signed_out" });
  if (!user.admin) return json(403, { error: "admin_only", message: "Only administrators can add or change homes." });
  const b = await req.json().catch(() => null);
  if (!b) return json(400, { error: "invalid_request" });

  if (b.action === "create") {
    const { fields, error } = cleanHome(b);
    if (error) return json(400, { error: "invalid_home", message: error });
    const home = { id: newHomeId(), ...fields, photos: [], createdAt: Date.now(), createdBy: user.email, linkedMls: null };
    await saveHome(home);
    return json(200, { home });
  }

  const home = await getHome(String(b.id || ""));
  if (!home) return json(404, { error: "not_found" });
  if (home.linkedMls) return json(409, { error: "linked", message: `This home is already linked to MLS# ${home.linkedMls}.` });

  if (b.action === "update") {
    const { fields, error } = cleanHome(b, { partial: true });
    if (error) return json(400, { error: "invalid_home", message: error });
    Object.assign(home, fields, { updatedAt: Date.now() });
    await saveHome(home);
    return json(200, { home });
  }
  if (b.action === "photo") {
    if (home.photos.length >= MAX_PHOTOS) return json(400, { error: "too_many_photos", message: `A home can have up to ${MAX_PHOTOS} photos.` });
    const buf = Buffer.from(String(b.data || "").replace(/^data:[^,]*,/, ""), "base64");
    const type = photoType(buf);
    if (!buf.length || buf.length > MAX_PHOTO_BYTES || !type) return json(400, { error: "invalid_photo", message: "Use a JPEG or PNG photo under 3 MB." });
    home.photos.push(await savePhoto(home.id, buf, type));
    await saveHome(home);
    return json(200, { home });
  }
  if (b.action === "cover" || b.action === "unphoto") {
    if (!home.photos.includes(b.photo)) return json(404, { error: "no_photo" });
    home.photos = home.photos.filter((p) => p !== b.photo);
    if (b.action === "cover") home.photos.unshift(b.photo);
    else await deletePhoto(home.id, b.photo).catch(() => {});
    await saveHome(home);
    return json(200, { home });
  }
  if (b.action === "link") {
    const target = (await mlsListings(await currentWeek())).find((l) => l.mls === String(b.mls || ""));
    if (!target) return json(400, { error: "unknown_mls", message: "Pick one of the team's MLS listings." });
    const other = (await listHomes()).find((h) => h.linkedMls === target.mls);
    if (other) return json(409, { error: "already_linked", message: `MLS# ${target.mls} is already linked to ${other.addr}.` });
    const { status, ...body } = await linkHome(home, target.mls, user);
    return json(status, body);
  }
  if (b.action === "remove") {
    const live = (await listRequests()).filter((r) => r.mls === home.id && (r.status === "pending" || r.status === "approved"));
    if (live.length) return json(409, { error: "has_requests", message: "This home has pending or approved open houses. Cancel or decline them first, or link the home to its MLS listing." });
    await Promise.all(home.photos.map((p) => deletePhoto(home.id, p).catch(() => {})));
    await removeHome(home.id);
    return json(200, { ok: true });
  }
  return json(400, { error: "invalid_action" });
};
export const config = { path: "/api/admin/homes" };
