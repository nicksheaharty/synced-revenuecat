const fs = require("fs");
const path = require("path");

// 1. Patch react-native's generatePackageSwift.js path.join bug
const reactNativeTargetFile = path.resolve(
  __dirname,
  "../node_modules/react-native/scripts/codegen/generate-artifacts-executor/generatePackageSwift.js",
);

if (fs.existsSync(reactNativeTargetFile)) {
  let content = fs.readFileSync(reactNativeTargetFile, "utf8");
  const targetStr = "const fullOutputPath = path.join(projectRoot, outputDir);";
  const replacementStr =
    "const fullOutputPath = path.resolve(projectRoot, outputDir);";

  if (content.includes(targetStr)) {
    content = content.replace(targetStr, replacementStr);
    fs.writeFileSync(reactNativeTargetFile, content, "utf8");
    console.log(
      "[Patch] Successfully patched react-native generatePackageSwift.js path.join bug!",
    );
  } else if (content.includes(replacementStr)) {
    console.log(
      "[Patch] react-native generatePackageSwift.js is already patched.",
    );
  } else {
    console.warn(
      "[Patch] Warning: Could not find target pattern in generatePackageSwift.js",
    );
  }
} else {
  console.warn(
    "[Patch] Warning: generatePackageSwift.js not found at " +
      reactNativeTargetFile,
  );
}

// 2. Patch expo-modules-jsi's Package.swift swift-tools-version compat bug
const expoJsiTargetFile = path.resolve(
  __dirname,
  "../node_modules/expo-modules-jsi/apple/Package.swift",
);

if (fs.existsSync(expoJsiTargetFile)) {
  let content = fs.readFileSync(expoJsiTargetFile, "utf8");

  // Detect Swift version
  let swiftVersion = 6.2; // default to 6.2
  try {
    const { execSync } = require("child_process");
    const versionOutput = execSync("swift --version", { encoding: "utf8" });
    const match = versionOutput.match(/Apple Swift version (\d+\.\d+)/);
    if (match && match[1]) {
      swiftVersion = parseFloat(match[1]);
    }
  } catch (e) {
    console.warn(
      "[Patch] Warning: Failed to detect Swift version, defaulting to 6.2",
      e,
    );
  }

  console.log(`[Patch] Detected Swift version: ${swiftVersion}`);

  if (swiftVersion < 6.2) {
    // Downgrade to 6.1 if compiler is old
    const targetStr = "// swift-tools-version: 6.2";
    const replacementStr = "// swift-tools-version: 6.1";
    if (content.includes(targetStr)) {
      content = content.replace(targetStr, replacementStr);
      fs.writeFileSync(expoJsiTargetFile, content, "utf8");
      console.log(
        "[Patch] Successfully patched expo-modules-jsi Package.swift tools-version from 6.2 to 6.1!",
      );
    } else if (content.includes(replacementStr)) {
      console.log(
        "[Patch] expo-modules-jsi Package.swift tools-version is already 6.1 (downgraded for compatibility).",
      );
    }
  } else {
    // Keep or restore to 6.2 if compiler supports it
    const targetStr = "// swift-tools-version: 6.1";
    const replacementStr = "// swift-tools-version: 6.2";
    if (content.includes(targetStr)) {
      content = content.replace(targetStr, replacementStr);
      fs.writeFileSync(expoJsiTargetFile, content, "utf8");
      console.log(
        "[Patch] Restored/kept expo-modules-jsi Package.swift tools-version to 6.2.",
      );
    } else if (content.includes(replacementStr)) {
      console.log(
        "[Patch] expo-modules-jsi Package.swift tools-version is already 6.2.",
      );
    }
  }
} else {
  console.warn(
    "[Patch] Warning: expo-modules-jsi Package.swift not found at " +
      expoJsiTargetFile,
  );
}

// 3. Recursively patch expo-modules-jsi Swift files for weak let & trailing comma errors
function patchSwiftFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      patchSwiftFiles(fullPath);
    } else if (file.endsWith(".swift")) {
      let content = fs.readFileSync(fullPath, "utf8");
      let changed = false;

      // Replace 'weak let' (or bare 'weak var') with 'nonisolated(unsafe) weak var'
      if (content.includes("weak let")) {
        content = content.replace(
          /\bweak let\b/g,
          "nonisolated(unsafe) weak var",
        );
        changed = true;
      } else if (
        content.includes("weak var") &&
        !content.includes("nonisolated(unsafe)")
      ) {
        content = content.replace(
          /\bweak var\b/g,
          "nonisolated(unsafe) weak var",
        );
        changed = true;
      }

      // Special patch for JavaScriptRuntime.swift trailing comma
      if (file === "JavaScriptRuntime.swift") {
        const targetComma = "_ arguments: consuming JavaScriptValuesBuffer,";
        const replacementComma =
          "_ arguments: consuming JavaScriptValuesBuffer";
        if (content.includes(targetComma)) {
          content = content.replace(targetComma, replacementComma);
          changed = true;
        }
      }

      if (changed) {
        fs.writeFileSync(fullPath, content, "utf8");
        console.log(`[Patch] Patched Swift file: ${file}`);
      }
    }
  }
}

const sourcesDir = path.resolve(
  __dirname,
  "../node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI",
);
console.log("[Patch] Patching Swift files in " + sourcesDir);
patchSwiftFiles(sourcesDir);
