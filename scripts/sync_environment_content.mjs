import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const environments = ["staging", "draft"];

async function readJson(file) {
  return JSON.parse(await readFile(path.join(root, file), "utf8"));
}

async function writeJson(file, data) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), `${JSON.stringify(data, null, 2)}\n`);
}

function withEnvPrefix(env, file) {
  return `${env}/${file}`.replace(/\/+/g, "/");
}

async function syncEnvironment(env) {
  const manifest = await readJson("manifest.json");
  const envManifest = {
    ...manifest,
    environment: env,
    domains: [],
  };

  await rm(path.join(root, env, "domains"), { recursive: true, force: true });
  await rm(path.join(root, env, "topics"), { recursive: true, force: true });

  for (const domainEntry of manifest.domains) {
    const domain = await readJson(domainEntry.entry);
    const envDomainPath = withEnvPrefix(env, domainEntry.entry);
    const envDomain = {
      ...domain,
      categories: domain.categories.map((category) => ({
        ...category,
        topics: category.topics.map((topicPath) => withEnvPrefix(env, topicPath)),
      })),
    };

    envManifest.domains.push({
      ...domainEntry,
      entry: envDomainPath,
    });

    await writeJson(envDomainPath, envDomain);

    for (const category of domain.categories) {
      for (const topicPath of category.topics) {
        const topic = await readJson(topicPath);
        topic.status = env;
        await writeJson(withEnvPrefix(env, topicPath), topic);
      }
    }
  }

  const manifestName = env === "staging" ? "staging-manifest.json" : "draft-manifest.json";
  await writeJson(manifestName, envManifest);
  console.log(`Synced ${envManifest.topicCount} ${env} topics.`);
}

for (const env of environments) {
  await syncEnvironment(env);
}
