const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

config.resolver.unstable_enableSymlinks = true;

const scaledText = path.resolve(projectRoot, "lib/rn-scaled-text.tsx");
const scaledTextInput = path.resolve(projectRoot, "lib/rn-scaled-text-input.tsx");

function normalize(moduleName) {
  return String(moduleName).replace(/\\/g, "/");
}

function isFromScaledWrapper(originModulePath) {
  const origin = normalize(originModulePath || "");
  return (
    origin === normalize(scaledText) ||
    origin === normalize(scaledTextInput) ||
    origin.endsWith("/lib/rn-scaled-text.tsx") ||
    origin.endsWith("/lib/rn-scaled-text-input.tsx")
  );
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const name = normalize(moduleName);

  if (!isFromScaledWrapper(context.originModulePath)) {
    // RN 0.81 Text/TextInput are plain components — wrap via Metro so preferences apply.
    if (/\/Libraries\/Text\/Text$/.test(name) || name === "./Libraries/Text/Text") {
      return { filePath: scaledText, type: "sourceFile" };
    }
    if (
      /\/Libraries\/Components\/TextInput\/TextInput$/.test(name) ||
      name === "./Libraries/Components/TextInput/TextInput"
    ) {
      return { filePath: scaledTextInput, type: "sourceFile" };
    }
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
