const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin that patches the generated iOS Podfile with two CI fixes:
 *
 * 1. ExpoModulesJSI xcframework build fix
 *    The "Build ExpoModulesJSI xcframework" script phase always re-runs on CI
 *    because its hash includes PODS_ROOT (which differs on every fresh runner)
 *    and TOOLCHAIN_VERSION. The nested xcodebuild call uses `env -i` and needs
 *    DEVELOPER_DIR + node on PATH. We patch the script phase in post_install
 *    to export these before delegating to the original script.
 *
 * 2. Swift 6 strict concurrency suppression for pod targets
 *    Xcode 16+ defaults to Swift 6 strict concurrency checking.
 *    react-native-firebase and other pods are not yet Swift 6 compliant.
 */
const withPodfileJSIWorkaround = (config) => {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const file = path.join(config.modRequest.platformProjectRoot, "Podfile");

      if (!fs.existsSync(file)) {
        return config;
      }

      let contents = fs.readFileSync(file, "utf8");

      const swiftMarker =
        "# Fix Swift 6 strict concurrency errors on Xcode 16+";
      const jsiMarker = "# Patch ExpoModulesJSI xcframework build phase";

      if (contents.includes(swiftMarker) && contents.includes(jsiMarker)) {
        return config;
      }

      const hookCode = `

    ${swiftMarker}
    # react-native-firebase and other pods are not yet Swift 6 compliant.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['SWIFT_VERSION'] = '5.10'
        config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
      end
    end

    ${jsiMarker}
    # The build phase uses env -i for a clean environment; we need to ensure
    # DEVELOPER_DIR and node are accessible so generate-modulemap.sh works.
    installer.pods_project.targets.each do |target|
      next unless target.name == 'ExpoModulesJSI'
      target.build_phases.each do |phase|
        next unless phase.respond_to?(:name)
        next unless phase.name == '[CP-User] Build ExpoModulesJSI xcframework'
        phase.shell_script = [
          'export DEVELOPER_DIR="$(xcode-select -p)"',
          'export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"',
          phase.shell_script,
        ].join("\\n")
      end
    end
`;

      // Inject right before the closing `end` of the `post_install` block.
      // The generated Podfile always ends the post_install with:
      //   \n  end\nend\n
      contents = contents.replace(
        /(\n  end\nend\n?)$/,
        `${hookCode}\n  end\nend\n`,
      );

      fs.writeFileSync(file, contents, "utf8");
      return config;
    },
  ]);
};

module.exports = withPodfileJSIWorkaround;
