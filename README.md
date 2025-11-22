# GoldShore Monorepo Root

This directory contains the root configuration for the GoldShore monorepo.

## Directory Structure

-   `/apps`: Contains the source code for all GoldShore applications (e.g., `api-worker`, `web`, `admin`). Each application is a self-contained project.
-   `/packages`: Contains shared libraries and utilities used across multiple applications.
-   `/.github/workflows`: Contains the CI/CD pipelines for deploying the applications.

## Root Cloudflare Pages Project: `goldshore-dashboard`

This repository's root is linked to a **Cloudflare Pages** project named `goldshore-dashboard`.

-   **Purpose:** This project serves as a simple, static diagnostics and status dashboard. It is a repurposed, undeletable artifact from a previous project structure.
-   **Source:** The content for the dashboard is located in the `/dist` directory.
-   **Configuration:** The build settings for this Pages project are defined in the `wrangler.toml` file at the root of this repository.

**Important:** This Pages project is **NOT** the canonical API. The authoritative API is the Cloudflare Worker named `goldshore-api`, which is managed and deployed from the `/apps/api-worker` directory.
