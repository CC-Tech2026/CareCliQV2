const fs = require("node:fs");
const path = require("node:path");

const frontendPath = path.join(
  process.cwd(),
  "artifacts",
  "frontend",
  "src",
  "pages",
  "my-client-detail.tsx",
);
const backendPath = path.join(
  process.cwd(),
  "backend",
  "app",
  "services",
  "supported_languages.py",
);

const frontend = fs.readFileSync(frontendPath, "utf8");
const backend = fs.readFileSync(backendPath, "utf8");

const expectedLabels = [
  "Auto detect",
  "English",
  "Hindi",
  "Tagalog",
  "Nepali",
  "Arabic",
  "Swahili",
  "Mandarin",
  "Vietnamese",
  "Punjabi",
];
const expectedCodes = ["en", "hi", "tl", "ne", "ar", "sw", "zh-CN", "vi", "pa"];
const removedLabels = [
  "Spanish",
  "French",
  "Chinese",
  "Portuguese",
  "German",
  "Italian",
  "Japanese",
  "Korean",
  "Urdu",
  "Persian",
  "Russian",
  "Ukrainian",
  "Dutch",
  "Turkish",
  "Indonesian",
  "Malay",
  "Thai",
  "Polish",
  "Romanian",
  "Greek",
];

for (const label of expectedLabels) {
  if (!frontend.includes(`label: "${label}"`)) {
    throw new Error(`Missing frontend language label: ${label}`);
  }
}

for (const label of removedLabels) {
  if (frontend.includes(`label: "${label}"`)) {
    throw new Error(`Unexpected frontend language label remains: ${label}`);
  }
}

for (const code of expectedCodes) {
  if (!backend.includes(`"${code}"`)) {
    throw new Error(`Missing backend language code: ${code}`);
  }
}

console.log("Translation language registry matches CareScribe screenshot.");
