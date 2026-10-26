"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { slugify } from "@/lib/recipes/format";

const BUCKET = "recipe-images";
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/**
 * Image URL + alt text inputs with direct upload to Supabase Storage. The
 * upload runs in the browser with the admin's session; Storage RLS only lets
 * admins write to the bucket.
 */
export function ImageField({
  label,
  name,
  altName,
  initialUrl,
  initialAlt,
  folder,
  hint,
}: {
  label: string;
  name: string;
  altName: string;
  initialUrl: string | null;
  initialAlt: string | null;
  folder: string;
  hint?: string;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [alt, setAlt] = useState(initialAlt ?? "");
  const [status, setStatus] = useState<{ tone: "idle" | "busy" | "error"; message: string }>({ tone: "idle", message: "" });

  async function upload(file: File) {
    if (!TYPES.includes(file.type)) return setStatus({ tone: "error", message: "Use a JPEG, PNG, WebP or AVIF image." });
    if (file.size > MAX_BYTES) return setStatus({ tone: "error", message: "Images must be 10 MB or smaller." });
    setStatus({ tone: "busy", message: "Uploading…" });
    try {
      const supabase = createBrowserSupabase();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const base = slugify(file.name.replace(/\.[^.]+$/, "")) || "image";
      const path = `${folder}/${Date.now()}-${base}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      setUrl(data.publicUrl);
      setStatus({ tone: "idle", message: "Uploaded. Save the form to keep it." });
    } catch (err) {
      setStatus({ tone: "error", message: err instanceof Error ? err.message : "Upload failed." });
    }
  }

  return (
    <div className="space-y-3">
      <p className="field-label">{label}</p>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-xl border border-line bg-cream-deep sm:w-40">
          {url ? (
            // Admin preview of an arbitrary URL; next/image would require a configured host.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={alt || "Preview"} className="h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-xs text-ink-faint">No image</span>
          )}
        </div>
        <div className="flex-1 space-y-2">
          <input type="url" name={name} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… or upload a file" className="field-input text-sm" aria-label={`${label} URL`} />
          <input type="text" name={altName} value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Describe the photo for screen readers and search" className="field-input text-sm" aria-label={`${label} alt text`} maxLength={250} />
          <label className="btn btn-secondary cursor-pointer px-4 py-2 text-sm">
            Upload image
            <input type="file" accept={TYPES.join(",")} className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          {status.message && <p className={`text-xs ${status.tone === "error" ? "text-danger" : "text-ink-soft"}`}>{status.message}</p>}
          {hint && <p className="field-hint">{hint}</p>}
        </div>
      </div>
    </div>
  );
}
