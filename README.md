# Wayback Machine Downloader JS

![Web Achive Website Downloader](assets/webarchive-downloader.jpg)

A script written in **Node.js** for downloading websites from [Web Archive](https://web.archive.org/).  

Intended for use by:
- **Webmasters** — to restore their lost or hacked projects  
- **OSINT researchers** — for local work with resources that no longer exist  

This webarchive website downloader has an interactive interface, supports downloading with either original links preserved or rewritten into relative ones (for local usage).  

If this project helped you, consider giving it a ⭐  
Got ideas or suggestions? Feel free to open an issue!

---

## Table of Contents

- 📁[Features of Web Archive Website Downloader](#features-of-web-archive-website-downloader)  
  - 📄[Special Features](#special-features)  
- 📁[Requirements](#requirements)  
- 📁[Installation](#installation)  
- 📁[Run](#run)
- 📁[Run in Docker](#-run-in-docker-no-nodejs-installation-required)    
- 📁[Example](#example)  
- 📁[Common Issues](#common-issues)  
- 📁[(Important) Download responsibly](#important-download-responsibly)    

---

## Features of Web Archive Website Downloader

1. Download entire websites or individual pages from the archive, including HTML, images, scripts, styles, and other assets.  
2. Rewrite internal links for correct local browsing.  
3. Multithreading support.  
4. Save results into a chosen folder while keeping the original structure.  
5. Ability to download external assets (e.g., images or scripts from a CDN).  

#### Special Features

- The script fixes parameterized file names such as `main.css?ver=1.2` into `main.css` for proper local work.  

---

## Requirements

- Node.js version 18.x or higher  

---

## Installation

# Installation

1. Download the project in one of the following ways:  
   - **Git instruction:**  
     ```bash
     git clone https://github.com/birbwatcher/wayback-machine-downloader.git
     ```  
   - **ZIP archive instruction:**  
     Download .zip and extract it.  

2. Go to the **inner `wayback-machine-downloader` folder**, where the `package.json` file is located:  
   - If you cloned with Git:  
     ```bash
     cd wayback-machine-downloader/wayback-machine-downloader
     ```  
   - If you extracted the .zip:  
     ```bash
     cd wayback-machine-downloader-main/wayback-machine-downloader
     ```  

   ⚠️ Important: run commands from this folder (the one containing `package.json`).  

3. Install dependencies:  
   ```bash
   npm install
   ```  

---

## Run

```bash
node index.js
```

After launching, an interactive menu will appear with the following questions:

- base URL (e.g., https://example.com)  
- date range (from/to)  
- number of threads  
- link rewriting mode (keep as-is or convert to relative)  
- whether to remove `rel=canonical` from the downloaded site  
- whether to download external assets  
- directory for saving the files  

---

# 🐳 Run in Docker (no Node.js installation required)

You can also run the Wayback Machine Downloader inside a Docker container.  
This allows you to use the tool without installing Node.js manually.

### Go to the project directory
Open your terminal and navigate to the folder **where the Dockerfile is located**.  
For example, if you cloned the repository:

```bash
cd wayback-machine-downloader
```

### Build the image
```bash
docker build -t wayback-machine-downloader .
```

### Run interactively
```bash
docker run -it -v $(pwd)/websites:/app/websites wayback-machine-downloader
```
### Explanation:
- `-it` — enables interactive input/output for the terminal (so you can answer questions).  
- `-v $(pwd)/websites:/app/websites` — mounts the local `websites` folder so downloaded sites are saved on your machine.  

After running, the same interactive menu will appear as with the standard Node.js run.  
All archived websites will be saved locally in the `./websites` directory.

---

## Example

```bash
node downloader.js
```

Dialog example:  

```bash
Enter base URL to archive (e.g., https://example.com): https://example.com
From timestamp (YYYYMMDDhhmmss) or leave blank: 20200101000000
To timestamp (YYYYMMDDhhmmss) or leave blank: 20201231235959
Rewrite links? (yes=relative / no=as-is, default no): yes
Canonical: "keep" (default) or "remove": keep
How many download threads? (default 3): 5
Only exact URL (no wildcard /*)? (yes/no, default no): no
Target directory (leave blank for default websites/<host>/): 
Download external assets? (yes/no, default no): no
```

After this, the archive download will begin.  

---

## Common Issues

#### Script downloads only the homepage
**Answer:** try specifying the base URL with `/*` at the end.  
For example: `https://example.com/*`, or try downloading a different time range.  

#### Website restored with broken layout, but it looks fine on Web Archive

1. You may have restored the website with absolute links.  
   This means it will only work correctly on its original domain and not when opened locally.

2. Some **styles or assets might be hosted on another domain**, for example on a CDN.  
   In this case, make sure to select "rewrite links" and "download external assets" during setup.  
   The script will then also fetch resources from external domains.п

3. The website might rely on **JavaScript frameworks** (like Angular or React) for rendering.  
   In such cases, downloading will be more difficult and can take considerably longer.

---

## (Important) Download responsibly

Please note that downloading third-party websites may violate copyright laws.  
Use this tool responsibly and make sure not to break the law.  

---
