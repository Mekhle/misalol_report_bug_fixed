import "server-only";

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const LOCAL_STORAGE_DIR = process.env.MISA_LOCAL_STORAGE_DIR || "/tmp/misa_uploads";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for R2 uploads.`);
  return value;
}

let client: S3Client | undefined;

function r2() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: required("R2_ENDPOINT"),
      credentials: { accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") },
    });
  }
  return client;
}

export function isR2Configured() {
  return Boolean(
    process.env.R2_ENDPOINT &&
    process.env.R2_BUCKET &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_PUBLIC_BASE_URL
  );
}

export function r2Enabled() {
  return true;
}

export function r2PublicUrl(key: string) {
  if (isR2Configured()) {
    return `${required("R2_PUBLIC_BASE_URL").replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  return `/api/v1/profile/uploads/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function uploadToR2(key: string, body: Uint8Array, contentType: string) {
  if (isR2Configured()) {
    await r2().send(new PutObjectCommand({
      Bucket: required("R2_BUCKET"),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }));
    return r2PublicUrl(key);
  }
  const target = resolve(join(LOCAL_STORAGE_DIR, key));
  await fs.mkdir(dirname(target), { recursive: true });
  await fs.writeFile(target, Buffer.from(body));
  await fs.writeFile(`${target}.meta`, contentType, "utf-8");
  return r2PublicUrl(key);
}

export async function deleteFromR2(key: string) {
  if (isR2Configured()) {
    await r2().send(new DeleteObjectCommand({
      Bucket: required("R2_BUCKET"),
      Key: key,
    })).catch(() => {});
    return;
  }
  const target = resolve(join(LOCAL_STORAGE_DIR, key));
  await fs.unlink(target).catch(() => {});
  await fs.unlink(`${target}.meta`).catch(() => {});
}
