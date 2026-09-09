// Shared by every "attach a photo/video" flow that submits files as
// base64 JSON rather than multipart (bug reports from Settings and from
// the admin Report Bug panel) — keeps one implementation instead of two
// copies drifting apart.
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}
