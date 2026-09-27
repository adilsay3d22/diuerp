// Uploaded files: Vercel Blob when a store is connected (BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID with Vercel OIDC), otherwise data/uploads on local disk.
// The returned key goes in files.path; "blob:" marks a Vercel Blob pathname.
import { put, get } from "@vercel/blob";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

// A private store by default; set BLOB_ACCESS=public if your store was created as public (names are still unguessable
// and downloads still go through /files/[id], which checks who may open each file).
const access = process.env.BLOB_ACCESS === "public" ? "public" : "private";

export async function storeFile(data: ArrayBuffer, contentType: string) {
  const name = `uploads/${randomBytes(16).toString("hex")}`;
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
    const b = await put(name, Buffer.from(data), { access, contentType: contentType || undefined, addRandomSuffix: false });
    return `blob:${b.pathname}`;
  }
  mkdirSync("data/uploads", { recursive: true });
  writeFileSync(`data/${name}`, Buffer.from(data));
  return `data/${name}`;
}

// File body for the download route, or null when it is gone.
export async function loadFile(key: string): Promise<BodyInit | null> {
  if (key.startsWith("blob:")) {
    const r = await get(key.slice(5), { access });
    return r && r.statusCode === 200 ? r.stream : null;
  }
  return existsSync(key) ? readFileSync(key) : null;
}
