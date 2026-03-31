cask "t800" do
  version "2.0.0-00"
  sha256 "2e381ac504093bfa72d16ee20043640724394729b2ca0e6b26c9eac19aeb6d08"

  url "https://github.com/P3X-118/T-800/releases/download/release-#{version}-tag/t800_macos_universal_dmg.dmg"
  name "T-800"
  desc "Web-based server management platform with SSH terminal, tunneling, and file editing"
  homepage "https://github.com/P3X-118/T-800"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "T-800.app"

  zap trash: [
    "~/Library/Application Support/t800",
    "~/Library/Caches/ai.sgc.t800",
    "~/Library/Caches/ai.sgc.t800.ShipIt",
    "~/Library/Preferences/ai.sgc.t800.plist",
    "~/Library/Saved Application State/ai.sgc.t800.savedState",
  ]
end
