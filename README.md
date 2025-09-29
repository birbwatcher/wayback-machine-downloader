# Wayback Machine Downloader JS

![Web Achive Website Downloader](assets/webarchive-downloader.jpg)

A script written in **Node.js** for downloading websites from [Web Archive](https://web.archive.org/).  

Intended for use by:
- **Webmasters** — to restore their lost or hacked projects  
- **OSINT researchers** — for local work with resources that no longer exist  

This webarchive website downloader has an interactive interface, supports downloading with either original links preserved or rewritten into relative ones (for local usage).  

---

## Table of Contents

- [Features of Web Archive Website Downloader](#features-of-web-archive-website-downloader)  
  - [Special Features](#special-features)  
- [Requirements](#requirements)  
- [Installation](#installation)  
- [Run](#run)  
- [Example](#example)  
- [Common Issues](#common-issues)  
- [(Important) Download responsibly](#important-download-responsibly)  
- [Contributing](#contributing)  

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

```bash
git clone https://github.com/birbwatcher/wayback-machine-downloader.git
```
go to inner folder "wayback-machine-downloader"
```bash
cd wayback-machine-downloader
```
```bash
# Install dependencies
npm install
```

---

## Run

```bash
node downloader.js
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

---

## (Important) Download responsibly

Please note that downloading third-party websites may violate copyright laws.  
Use this tool responsibly and make sure not to break the law.  

---

## Contributing

Pull requests are welcome!  
For major changes, please open an issue first to discuss what you would like to change.  

1. Fork the project  
2. Create your feature branch (`git checkout -b feature/fooBar`)  
3. Commit your changes (`git commit -am 'Add some fooBar'`)  
4. Push to the branch (`git push origin feature/fooBar`)  
5. Create a new Pull Request  
