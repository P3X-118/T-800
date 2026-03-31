# Repo Stats

<p align="center">
  <img src="https://flagcdn.com/us.svg" alt="English" width="24" height="16"> English ·
  <a href="readme/README-CN.md"><img src="https://flagcdn.com/cn.svg" alt="中文" width="24" height="16"> 中文</a> ·
  <a href="readme/README-JA.md"><img src="https://flagcdn.com/jp.svg" alt="日本語" width="24" height="16"> 日本語</a> ·
  <a href="readme/README-KO.md"><img src="https://flagcdn.com/kr.svg" alt="한국어" width="24" height="16"> 한국어</a> ·
  <a href="readme/README-FR.md"><img src="https://flagcdn.com/fr.svg" alt="Français" width="24" height="16"> Français</a> ·
  <a href="readme/README-DE.md"><img src="https://flagcdn.com/de.svg" alt="Deutsch" width="24" height="16"> Deutsch</a> ·
  <a href="readme/README-ES.md"><img src="https://flagcdn.com/es.svg" alt="Español" width="24" height="16"> Español</a> ·
  <a href="readme/README-PT.md"><img src="https://flagcdn.com/br.svg" alt="Português" width="24" height="16"> Português</a> ·
  <a href="readme/README-RU.md"><img src="https://flagcdn.com/ru.svg" alt="Русский" width="24" height="16"> Русский</a> ·
  <a href="readme/README-AR.md"><img src="https://flagcdn.com/sa.svg" alt="العربية" width="24" height="16"> العربية</a> ·
  <a href="readme/README-HI.md"><img src="https://flagcdn.com/in.svg" alt="हिन्दी" width="24" height="16"> हिन्दी</a> ·
  <a href="readme/README-TR.md"><img src="https://flagcdn.com/tr.svg" alt="Türkçe" width="24" height="16"> Türkçe</a> ·
  <a href="readme/README-VI.md"><img src="https://flagcdn.com/vn.svg" alt="Tiếng Việt" width="24" height="16"> Tiếng Việt</a> ·
  <a href="readme/README-IT.md"><img src="https://flagcdn.com/it.svg" alt="Italiano" width="24" height="16"> Italiano</a>
</p>

![GitHub Repo stars](https://img.shields.io/github/stars/P3X-118/T-800?style=flat&label=Stars)
![GitHub forks](https://img.shields.io/github/forks/P3X-118/T-800?style=flat&label=Forks)
![GitHub Release](https://img.shields.io/github/v/release/P3X-118/T-800?style=flat&label=Release)
<a href="https://discord.gg/jVQGdvHDrf"><img alt="Discord" src="https://img.shields.io/discord/1347374268253470720"></a>

<p align="center">
  <img src="./repo-images/RepoOfTheDay.png" alt="Repo of the Day Achievement" style="width: 300px; height: auto;">
  <br>
  <small style="color: #666;">Achieved on September 1st, 2025</small>
</p>

<br />
<p align="center">
  <a href="https://github.com/P3X-118/T-800">
    <img alt="T-800 Banner" src=./repo-images/HeaderImage.png style="width: auto; height: auto;">  </a>
</p>

If you would like, you can support the project here!\
[![GitHub Sponsor](https://img.shields.io/badge/Sponsor-LukeGus-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/sponsors/LukeGus)

# Overview

<p align="center">
  <a href="https://github.com/P3X-118/T-800">
    <img alt="T-800 Banner" src=./public/icon.svg style="width: 250px; height: 250px;">  </a>
</p>

T-800 is an open-source, forever-free, self-hosted all-in-one server management platform. It provides a multi-platform
solution for managing your servers and infrastructure through a single, intuitive interface. T-800 offers SSH terminal
access, remote desktop control (RDP, VNC, Telnet), SSH tunneling capabilities, remote SSH file management, and many other tools. T-800 is the perfect
free and self-hosted alternative to Termius available for all platforms.

# Features

- **SSH Terminal Access** - Full-featured terminal with split-screen support (up to 4 panels) with a browser-like tab system. Includes support for customizing the terminal including common terminal themes, fonts, and other components.
- **Remote Desktop Access** - RDP, VNC, and Telnet support over the browser with complete customization and split screening
- **SSH Tunnel Management** - Create and manage SSH tunnels with automatic reconnection and health monitoring and support for -l or -r connections
- **Remote File Manager** - Manage files directly on remote servers with support for viewing and editing code, images, audio, and video. Upload, download, rename, delete, and move files seamlessly with sudo support.
- **Docker Management** - Start, stop, pause, remove containers. View container stats. Control container using docker exec terminal. It was not made to replace Portainer or Dockge but rather to simply manage your containers compared to creating them.
- **SSH Host Manager** - Save, organize, and manage your SSH connections with tags and folders, and easily save reusable login info while being able to automate the deployment of SSH keys
- **Server Stats** - View CPU, memory, and disk usage along with network, uptime, system information, firewall, port monitor, on most Linux based servers
- **Dashboard** - View server information at a glance on your dashboard
- **RBAC** - Create roles and share hosts across users/roles
- **User Authentication** - Secure user management with admin controls and OIDC (with access control) and 2FA (TOTP) support. View active user sessions across all platforms and revoke permissions. Link your OIDC/Local accounts together.
- **Database Encryption** - Backend stored as encrypted SQLite database files. View [docs](https://t-800.i.sgc.ai/security) for more.
- **Data Export/Import** - Export and import SSH hosts, credentials, and file manager data
- **Automatic SSL Setup** - Built-in SSL certificate generation and management with HTTPS redirects
- **Modern UI** - Clean desktop/mobile-friendly interface built with React, Tailwind CSS, and Shadcn. Choose between dark or light mode based UI. Use URL routes to open any connection in full-screen.
- **Languages** - Built-in support ~30 languages (managed by [Crowdin](https://t-800.i.sgc.ai/translations))
- **Platform Support** - Available as a web app, desktop application (Windows, Linux, and macOS, can be run standalone without T-800 backend), PWA, and dedicated mobile/tablet app for iOS and Android.
- **SSH Tools** - Create reusable command snippets that execute with a single click. Run one command simultaneously across multiple open terminals.
- **Command History** - Auto-complete and view previously ran SSH commands
- **Quick Connect** - Connect to a server without having to save the connection data
- **Command Palette** - Double tap left shift to quickly access SSH connections with your keyboard
- **SSH Feature Rich** - Supports jump hosts, Warpgate, TOTP based connections, SOCKS5, host key verification, password autofill, [OPKSSH](https://github.com/openpubkey/opkssh), etc.
- **Network Graph** - Customize your Dashboard to visualize your homelab based off your SSH connections with status support
- **Persistent Tabs** - SSH sessions and tabs stay open across devices/refreshes if enabled in user profile

# Planned Features

See [Projects](https://github.com/orgs/P3X-118/projects/2) for all planned features. If you are looking to contribute, see [Contributing](https://github.com/P3X-118/T-800/blob/main/CONTRIBUTING.md).

# Installation

Supported Devices:

- Website (any modern browser on any platform like Chrome, Safari, and Firefox) (includes PWA support)
- Windows (x64/ia32)
  - Portable
  - MSI Installer
  - Chocolatey Package Manager
- Linux (x64/ia32)
  - Portable
  - AUR
  - AppImage
  - Deb
  - Flatpak
- macOS (x64/ia32 on v12.0+)
  - Apple App Store
  - DMG
  - Homebrew
- iOS/iPadOS (v15.1+)
  - Apple App Store
  - IPA
- Android (v7.0+)
  - Google Play Store
  - APK

Visit the T-800 [Docs](https://t-800.i.sgc.ai/install) for more information on how to install T-800 on all platforms. Otherwise, view
a sample Docker Compose file here (you can omit guacd and the network if you don't plan on using remote desktop features):

```yaml
services:
  t-800:
    image: docker.io/legitservices/t-800:latest
    container_name: t-800
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - t800-data:/app/data
    environment:
      PORT: "8080"
    depends_on:
      - guacd
    networks:
      - t800-net

  guacd:
    image: guacamole/guacd:latest
    container_name: guacd
    restart: unless-stopped
    ports:
      - "4822:4822"
    networks:
      - t800-net

volumes:
  t800-data:
    driver: local

networks:
  t800-net:
    driver: bridge
```

# Sponsors

<p align="left">
  <a href="https://www.digitalocean.com/">
    <img src="https://opensource.nyc3.cdn.digitaloceanspaces.com/attribution/assets/SVG/DO_Logo_horizontal_blue.svg" height="50" alt="DigitalOcean">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://crowdin.com/">
    <img src="https://support.crowdin.com/assets/logos/core-logo/svg/crowdin-core-logo-cDark.svg" height="50" alt="Crowdin">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.blacksmith.sh/">
    <img src="https://cdn.prod.website-files.com/681bfb0c9a4601bc6e288ec4/683ca9e2c5186757092611b8_e8cb22127df4da0811c4120a523722d2_logo-backsmith-wordmark-light.svg" height="50" alt="Blacksmith">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.cloudflare.com/">
    <img src="https://sirv.sirv.com/website/screenshots/cloudflare/cloudflare-logo.png?w=300" height="50" alt="Crowdflare">
  </a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://tailscale.com/">
    <img src="https://drive.google.com/uc?export=view&id=1lIxkJuX6M23bW-2FElhT0rQieTrzaVSL" height="50" alt="TailScale">
  </a>
</p>

# Support

If you need help or want to request a feature with T-800, visit the [Issues](https://github.com/P3X-118/T-800/issues) page, log in, and press `New Issue`.
Please be as detailed as possible in your issue, preferably written in English. You can also join the [Discord](https://discord.gg/jVQGdvHDrf) server and visit the support
channel, however, response times may be longer.

# Screenshots

[![YouTube](./repo-images/YouTube.jpg)](https://www.youtube.com/@T-800SSH/videos)

<p align="center">
  <img src="./repo-images/Image 1.png" width="400" alt="T-800 Demo 1"/>
  <img src="./repo-images/Image 2.png" width="400" alt="T-800 Demo 2"/>
</p>

<p align="center">
  <img src="./repo-images/Image 3.png" width="400" alt="T-800 Demo 3"/>
  <img src="./repo-images/Image 4.png" width="400" alt="T-800 Demo 4"/>
</p>

<p align="center">
  <img src="./repo-images/Image 5.png" width="400" alt="T-800 Demo 5"/>
  <img src="./repo-images/Image 6.png" width="400" alt="T-800 Demo 6"/>
</p>

<p align="center">
  <img src="./repo-images/Image 7.png" width="400" alt="T-800 Demo 7"/>
  <img src="./repo-images/Image 8.png" width="400" alt="T-800 Demo 8"/>
</p>

<p align="center">
  <img src="./repo-images/Image 9.png" width="400" alt="T-800 Demo 9"/>
  <img src="./repo-images/Image 10.png" width="400" alt="T-800 Demo 10"/>
</p>

<p align="center">
  <img src="./repo-images/Image 11.png" width="400" alt="T-800 Demo 11"/>
  <img src="./repo-images/Image 12.png" width="400" alt="T-800 Demo 12"/>
</p>

Some videos and images may be out of date or may not perfectly showcase features.

# License

Distributed under the Apache License Version 2.0. See LICENSE for more information.
