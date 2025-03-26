#!/usr/bin/env node

const prompts = require("prompts");
const fs = require("fs-extra");
const execa = require("execa");
const path = require("path");
const { argv } = require("process");

// Constants
const GITHUB_REPO = "https://github.com/asadkomidev/turbo-convex-starter.git";
const DEFAULT_APP_NAME = "my-tcn-app";
const CONVEX_CLOUD_DOMAIN = ".convex.cloud";
const CONVEX_SITE_DOMAIN = ".convex.site";

// CLI Options
const isDryRun = argv.includes("--dry-run");
const isDebug = argv.includes("--debug");

// Debug logger
const debug = (...args) => isDebug && console.log("[Debug]", ...args);

// Error handler
const handleError = (error, step) => {
  console.error(`\n❌ Error during ${step}:`, error.message);
  if (isDebug) {
    console.error("\nStack trace:", error.stack);
  }
  process.exit(1);
};

(async () => {
  console.log("\n🚀 Welcome to the Convex TCN Starter Kit Setup!");
  if (isDryRun) {
    console.log("📝 Running in dry-run mode: no changes will be made.");
  }

  try {
    // Step 1: Prompt for project name
    const { projectName } = await prompts({
      type: "text",
      name: "projectName",
      message: "What's the name of your project?",
      initial: DEFAULT_APP_NAME,
      validate: (value) =>
        /^[a-z0-9-]+$/.test(value) ||
        "Use lowercase letters, numbers, and hyphens only",
    });

    const targetDir = path.join(process.cwd(), projectName);

    // Step 2: Clone the starter kit
    console.log("\n📦 Cloning the starter kit...");
    if (!isDryRun) {
      await execa("git", ["clone", GITHUB_REPO, projectName]);
      process.chdir(targetDir);
      await execa("rm", ["-rf", ".git"]); // Remove Git history
      debug("Removed .git directory");
    } else {
      console.log(`[Dry Run] Would clone into ${targetDir}`);
    }

    // Step 3: Install dependencies with pnpm
    console.log("\n📥 Installing dependencies with pnpm...");
    if (!isDryRun) {
      await execa("pnpm", ["install"], { stdio: "inherit" });
    } else {
      console.log("[Dry Run] Would run: pnpm install");
    }

    // Step 4: Initialize Convex first to get deployment
    let convexUrl = "";
    if (!isDryRun) {
      console.log("\n🔧 Initializing Convex...");
      await execa("npx", ["convex", "dev", "--once", "--configure=new"], {
        stdio: "inherit",
        cwd: path.join(targetDir, "packages/backend"),
      });

      // Get the URL after initialization
      try {
        const { stdout } = await execa(
          "npx",
          ["convex", "env", "get", "CONVEX_URL"],
          {
            cwd: path.join(targetDir, "packages/backend"),
          }
        );
        convexUrl = stdout.trim();
        debug("Got Convex URL:", convexUrl);
      } catch (error) {
        handleError(error, "getting Convex URL");
      }
    } else {
      convexUrl = "https://dry-run-example.convex.cloud"; // Mock for dry run
      console.log("[Dry Run] Would initialize Convex and fetch URL");
    }

    // Step 5: Load and process setup-config.json
    const configPath = path.join(targetDir, "setup-config.json");
    if (!fs.existsSync(configPath)) {
      throw new Error("setup-config.json not found in the starter kit!");
    }
    const config = require(configPath);
    debug("Loaded config from:", configPath);

    // Step 6: Set up environment variables with the real Convex URL
    console.log("\n⚙️ Setting up configuration...");
    await setupEnvironment(config, convexUrl);

    // Step 7: Final validation
    if (!isDryRun) {
      console.log("\n✅ Validating configuration...");
      await execa("npx", ["convex", "dev", "--once"], {
        stdio: "inherit",
        cwd: path.join(targetDir, "packages/backend"),
      });

      // Step 8: Set up Convex auth
      console.log("\n🔐 Setting up Convex authentication...");
      await execa("npx", ["@convex-dev/auth"], {
        stdio: "inherit",
        cwd: path.join(targetDir, "packages/backend"),
      });
    }

    console.log(
      `\n✨ Setup complete! Run \`cd ${projectName} && pnpm run dev\` to start.\n`
    );
  } catch (error) {
    handleError(error, "setup");
  }
})();

async function setupEnvironment(config, initialConvexUrl) {
  console.log(config.introMessage);

  const envData = { convex: {}, web: {}, app: {} };
  let convexUrl = initialConvexUrl;
  let convexSiteUrl = initialConvexUrl.replace(
    CONVEX_CLOUD_DOMAIN,
    CONVEX_SITE_DOMAIN
  );

  // Store values for template replacements
  let templateValues = {
    convexUrl,
    convexSiteUrl,
  };

  for (const step of config.steps) {
    console.log(`\n${step.title}: ${step.description}`);
    if (step.instructions) {
      if (Array.isArray(step.instructions)) {
        step.instructions.forEach((instruction) => {
          const processedInstruction = replaceTemplateValues(
            instruction,
            templateValues
          );
          console.log(processedInstruction);
        });
      } else {
        const processedInstruction = replaceTemplateValues(
          step.instructions,
          templateValues
        );
        console.log(processedInstruction);
      }
    }

    for (const variable of step.variables) {
      const {
        name,
        projects,
        details,
        defaultValue,
        required,
        info,
        template,
      } = variable;

      let initialValue = defaultValue || "";
      if (template) {
        initialValue = replaceTemplateValues(template, templateValues);
      }

      const response = await prompts({
        type: "text",
        name: "value",
        message: `Enter ${name}${required ? "" : ""}:`,
        initial: initialValue,
      });

      const value = response.value;

      // Update template values if this is the Convex URL
      if (name === "NEXT_PUBLIC_CONVEX_URL") {
        convexUrl = value;
        convexSiteUrl = value.replace(CONVEX_CLOUD_DOMAIN, CONVEX_SITE_DOMAIN);
        templateValues = {
          convexUrl,
          convexSiteUrl,
        };
        debug("Updated template values with new Convex URL");
      }

      // Store in appropriate data structure
      projects.forEach((projectId) => {
        if (projectId === "convex") {
          envData.convex[name] = value;
        } else if (projectId === "web") {
          envData.web[name] = value;
        }
      });

      if (info) {
        info.forEach((line) => {
          const processedInfo = replaceTemplateValues(line, {
            ...templateValues,
            [name]: value,
          });
          console.log(`Info: ${processedInfo}`);
        });
      }
    }

    if (step.additionalInstructions) {
      step.additionalInstructions.forEach((instr) => {
        const processedInstruction = replaceTemplateValues(
          instr,
          templateValues
        );
        console.log(`Note: ${processedInstruction}`);
      });
    }

    if (step.required === false && step.requiredMessage) {
      console.log(`Note: ${step.requiredMessage}`);
    }
  }

  // Write environment variables
  for (const project of config.projects) {
    try {
      if (project.envFile) {
        const envPath = path.join(process.cwd(), project.envFile);
        const envContent = Object.entries(envData[project.id])
          .map(([key, value]) => `${key}=${value}`)
          .join("\n");
        if (!isDryRun) {
          await fs.ensureFile(envPath);
          await fs.writeFile(envPath, envContent);
          console.log(`📝 Wrote ${envPath}`);
          debug("Wrote env file:", envPath);
        } else {
          console.log(`[Dry Run] Would write to ${envPath}:\n${envContent}`);
        }
      } else if (project.id === "convex") {
        for (const [name, value] of Object.entries(envData.convex)) {
          if (!isDryRun) {
            await execa("npx", ["convex", "env", "set", name, value], {
              stdio: "inherit",
              cwd: path.join(process.cwd(), "packages/backend"),
            });
            debug("Set Convex env:", name);
          } else {
            console.log(`[Dry Run] Would set Convex env ${name}=${value}`);
          }
        }
      }
    } catch (error) {
      console.error(`❌ Error writing env for ${project.id}:`, error.message);
      if (isDebug) {
        console.error("\nStack trace:", error.stack);
      }
    }
  }
}

// Helper function to replace template values in strings
function replaceTemplateValues(str, values) {
  let result = str;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
  }
  return result;
}
