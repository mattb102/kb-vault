import { readFile, writeFile } from "fs/promises";
import matter from "gray-matter";
import { frontmatterIndex } from "../src/core/frontmatter.js";
import { config } from "../src/core/config.js";
import { today } from "../src/core/utils.js";

/**
 * Extract only the filled-in subsections from markdown content.
 * Strips the top-level H1, and only keeps H2+ sections that have actual content.
 */
function extractFilledSections(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let currentHeader = "";
  let currentBody: string[] = [];

  function flush() {
    const body = currentBody.join("\n").trim();
    if (body.length > 0 && currentHeader) {
      // Demote headers: H2 -> H3, H3 -> H4, etc.
      result.push(`${currentHeader}\n${body}`);
    }
    currentBody = [];
  }

  for (const line of lines) {
    // Skip H1 headers entirely
    if (/^#\s+/.test(line)) continue;

    const headerMatch = line.match(/^(#{2,6})\s+(.+)/);
    if (headerMatch) {
      flush();
      currentHeader = line;
    } else {
      currentBody.push(line);
    }
  }
  flush();

  return result.join("\n\n");
}

async function main() {
  console.log("Generating core identity document...");
  await frontmatterIndex.rebuild();

  const sections: string[] = [];

  // Read all core files
  const coreFiles = frontmatterIndex.find({ type: "core" });
  for (const file of coreFiles) {
    const raw = await readFile(file.path, "utf-8");
    const { content } = matter(raw);
    const topic = file.frontmatter.topic as string;
    const extracted = extractFilledSections(content);
    if (extracted.length > 0) {
      sections.push(`## ${topic.charAt(0).toUpperCase() + topic.slice(1)}\n${extracted}`);
    }
  }

  // Read health overview
  const health = frontmatterIndex.findOne({ type: "health-overview" });
  if (health) {
    const raw = await readFile(health.path, "utf-8");
    const { content } = matter(raw);
    const extracted = extractFilledSections(content);
    if (extracted.length > 0) {
      sections.push(`## Health\n${extracted}`);
    }
  }

  // Read work overview
  const work = frontmatterIndex.findOne({ type: "work-overview" });
  if (work) {
    const raw = await readFile(work.path, "utf-8");
    const { content } = matter(raw);
    const extracted = extractFilledSections(content);
    if (extracted.length > 0) {
      sections.push(`## Work\n${extracted}`);
    }
  }

  // Read interest overviews
  const interests = frontmatterIndex.find({ type: "interest-overview" });
  if (interests.length > 0) {
    const interestSections: string[] = [];
    for (const interest of interests) {
      const raw = await readFile(interest.path, "utf-8");
      const { content } = matter(raw);
      const name = interest.frontmatter.interest as string;
      const extracted = extractFilledSections(content);
      if (extracted.length > 0) {
        interestSections.push(`### ${name.charAt(0).toUpperCase() + name.slice(1)}\n${extracted}`);
      }
    }
    if (interestSections.length > 0) {
      sections.push(`## Interests\n${interestSections.join("\n\n")}`);
    }
  }

  // Assemble the document
  const identityContent = sections.length > 0
    ? sections.join("\n\n")
    : "No content yet. Start filling out your Core/ files!";

  const fm = {
    type: "core-identity",
    tags: ["core", "identity"],
    generated: true,
    created: today(),
    updated: today(),
  };

  const output = matter.stringify(
    `\n# Core Identity Summary\n\nAuto-generated from vault contents on ${today()}.\n\n${identityContent}\n`,
    fm
  );

  // Find existing core-identity file or use default path
  const existing = frontmatterIndex.findOne({ type: "core-identity" });
  const targetPath = existing?.path || `${config.vaultPath}/Core/core-identity.md`;

  await writeFile(targetPath, output);
  console.log(`Written to: ${targetPath}`);
  console.log(`Sections: ${sections.length}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
