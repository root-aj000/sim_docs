import { Project } from "ts-morph";
import fs from "fs-extra";

const project = new Project();
project.addSourceFilesAtPaths("apps/**/*.{ts,tsx,js,jsx}");

const docs = [];

for (const file of project.getSourceFiles()) {
  const fileInfo = {
    filePath: file.getFilePath(),
    functions: file.getFunctions().map(f => f.getName()),
    classes: file.getClasses().map(c => c.getName()),
    exports: file.getExportedDeclarations().keys(),
    imports: file.getImportDeclarations().map(i => i.getModuleSpecifierValue()),
  };
  docs.push(fileInfo);
}

await fs.writeJson("structure.json", docs, { spaces: 2 });
console.log(`Documented ${docs.length} files.`);
