const fs = require("fs");
const path = require("path");

const TAG_REGEX = /tag\s*:\s*\[\s*(['"`]@[\w-]+['"`](?:\s*,\s*['"`]@[\w-]+['"`])*)\s*\]/g;

/**
 * Recursively collect all files from a directory
 */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : fullPath;
  });
}

const rootDir = path.resolve(__dirname, "../tests");
const testFiles = walk(rootDir).filter(f => f.endsWith(".ts") || f.endsWith(".js"));
const tags = new Set();

for (const file of testFiles) {
  const content = fs.readFileSync(file, "utf-8");
  let match;

  while ((match = TAG_REGEX.exec(content))) {
    const tagGroup = match[1];
    const tagArray = tagGroup.match(/@[\w-]+/g);
    tagArray?.forEach(tag => tags.add(tag));
  }
}

let result = {
  tags: [...tags]  // convert Set to Array for JSON compatibility
};

console.log(JSON.stringify(result, null, 2));
