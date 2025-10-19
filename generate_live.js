import fs from "fs-extra";
import { glob } from "glob";
import { Project } from "ts-morph";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const MODEL = "gemma-3-27b";
const STRUCTURE_FILE = "structure.json";
const PROGRESS_FILE = "progress.json";
const MAX_REQUESTS_PER_DAY = Number(process.env.DAILY_LIMIT || 200);

const API_KEYS = process.env.GOOGLE_API_KEYS?.split(",").map(k => k.trim()) || [];
if (!API_KEYS.length) {
  console.error("❌ No GOOGLE_API_KEYS found in .env");
  process.exit(1);
}

let apiIndex = 0;
let API_KEY = API_KEYS[apiIndex];
function rotateApiKey() {
  apiIndex++;
  if (apiIndex < API_KEYS.length) {
    API_KEY = API_KEYS[apiIndex];
    console.log(`🔄 Switched to API key #${apiIndex + 1}`);
  } else {
    console.log("⏸️ All API keys used for today.");
    process.exit(0);
  }
}

// Load or initialize progress
let progress = { completed: [], count: 0, date: new Date().toISOString().slice(0,10) };
if (await fs.pathExists(PROGRESS_FILE)) {
  progress = await fs.readJson(PROGRESS_FILE);
}
// Reset daily count
const today = new Date().toISOString().slice(0,10);
if (progress.date !== today) {
  progress.date = today;
  progress.count = 0;
  await fs.writeJson(PROGRESS_FILE, progress, { spaces: 2 });
}

console.log(`📅 Today: ${today}`);
console.log(`📈 Completed files: ${progress.completed.length}`);
console.log(`⚙️ Requests used today: ${progress.count}`);

// Step 1: Find all TypeScript files
const files = await glob("apps/**/*.ts", { ignore: ["node_modules/**"] });
console.log(`🔍 Found ${files.length} files in apps/`);

// Step 2: Parse structure
const project = new Project();
project.addSourceFilesAtPaths(files);
const structure = [];
for (const file of project.getSourceFiles()) {
  structure.push({
    filePath: file.getFilePath(),
    functions: file.getFunctions().map(f => f.getName()),
    classes: file.getClasses().map(c => c.getName()),
    imports: file.getImportDeclarations().map(i => i.getModuleSpecifierValue()),
  });
}
await fs.writeJson(STRUCTURE_FILE, structure, { spaces: 2 });
await fs.ensureDir("docs");

// Step 3: Generate docs using Gemma 3
let processed = 0;

for (const f of structure) {
  const filePath = f.filePath;
  if (progress.completed.includes(filePath)) continue;
  if (progress.count >= MAX_REQUESTS_PER_DAY) {
    console.log("🛑 Daily request limit reached. Stopping.");
    break;
  }

  const code = await fs.readFile(filePath, "utf8");
  const prompt = `
You are a TypeScript expert and technical writer. Explain this code:
- Purpose
- Simplify complex logic
- Explain each line
Code:
${code}
`;

  try {
    const response = await fetch(`https://us-central1-aiplatform.googleapis.com/v1/projects/${process.env.GCP_PROJECT}/locations/us-central1/publishers/google/models/${MODEL}:predict`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        instances: [{ content: prompt }]
      })
    });

    if (response.status === 429) {
      console.warn("⚠️ Rate limit hit, switching API key...");
      rotateApiKey();
      continue;
    }

    const data = await response.json();
    if (!data.predictions?.length) {
      console.warn("⚠️ No output, skipping file.");
      continue;
    }

    const text = data.predictions[0].content;

    const relativePath = filePath.replace(/^apps[\\/]/, "");
    const docPath = `docs/${relativePath}.md`;
    await fs.ensureDir(fs.dirname(docPath));
    await fs.writeFile(docPath, text);

    progress.completed.push(filePath);
    progress.count += 1;
    processed++;

    console.log(`✅ Documented (${progress.count}/${MAX_REQUESTS_PER_DAY}): ${filePath}`);
    await fs.writeJson(PROGRESS_FILE, progress, { spaces: 2 });

  } catch (err) {
    console.error("❌ Error on:", filePath, err.message);
  }
}

console.log(`🎉 Done! Documented ${processed} files.`);
