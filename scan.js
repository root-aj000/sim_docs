import { glob } from "glob";
import fs from "fs-extra";

const files = await glob("apps/**/*.{ts,js}", { ignore: ["node_modules/**"] });
await fs.writeJson("files.json", files, { spaces: 2 });
console.log(`Found ${files.length} files.`);
