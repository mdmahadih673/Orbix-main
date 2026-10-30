# Implementation Plan: Wallpaper Carousel Performance & Scaling

## Overview
Scale the Orbix wallpaper carousel to handle collections of thousands of pictures smoothly. We implement direct non-recursive folder scanning, an 800x450 Retina thumbnail resolution, a persistent disk cache in `%LOCALAPPDATA%\Orbix\wallpaper_cache`, carousel track window virtualization (rendering 17 cards around the active item), and a windowed priority thumbnail queue.

---

## Tasks

### Task 1: Backend Non-Recursive Direct Folder Scanning
- **Location**: `src-tauri/src/wallpaper.rs`
- **Details**:
  - Update `collect_images_from_dir` to read only the immediate directory entries.
  - Stop recursing into child directories. When the user selects a folder, only pictures directly inside that folder are returned.
- **Verification**:
  - `cargo check --locked` succeeds.
  - Unit tests in `wallpaper.rs` pass.

### Task 2: Backend 800x450 Thumbnail Resolution & Persistent Disk Cache
- **Location**: `src-tauri/src/wallpaper.rs`
- **Details**:
  - Set thumbnail generation size to `800x450`.
  - Implement cache directory helper resolving to `%LOCALAPPDATA%\Orbix\wallpaper_cache`.
  - Implement cache key calculation based on file path, size, and modified time.
  - If cached JPEG exists on disk, read and return base64 string directly (<1ms).
  - If cache miss, decode, downscale, write to disk cache, and return base64 string.
  - Retain `WALLPAPER_CACHE` in-memory map for fast process-lifetime reuse.
- **Verification**:
  - `cargo check --locked` succeeds.
  - Test verifying cache directory creation and thumbnail generation.

### Task 3: Frontend Carousel Track Virtualization (17 Cards)
- **Location**: `src/components/wallpaper/WallpaperView.tsx`
- **Details**:
  - Define `BUFFER_SIZE = 8` (`activeIndex - 8` to `activeIndex + 8`, total 17 cards).
  - Compute `startIndex = Math.max(0, activeIndex - BUFFER_SIZE)` and `endIndex = Math.min(wallpapers.length, activeIndex + BUFFER_SIZE + 1)`.
  - Render left spacer (`startIndex * 102px`) and right spacer (`(wallpapers.length - endIndex) * 102px`).
  - Map only `visibleWallpapers = wallpapers.slice(startIndex, endIndex)` into the DOM.
  - Ensure card index resolution (`startIndex + sliceIndex`) correctly sets `activeIndex` on click and handles current active wallpaper badge.
- **Verification**:
  - `bun run build` succeeds without type errors.
  - DOM contains at most 17 card elements regardless of list length.

### Task 4: Frontend Priority Queue & Batched Thumbnail Loading
- **Location**: `src/components/wallpaper/WallpaperView.tsx`
- **Details**:
  - Remove the uncontrolled `list.forEach` full-folder preload.
  - Load thumbnails dynamically for items within the active window:
    - Tier 1: `activeIndex` and immediate neighbors (`±2`).
    - Tier 2: Remaining visible window cards (`startIndex` to `endIndex`).
  - Discard or skip requests for cards that have scrolled out of the visible window.
  - Batch thumbnail updates to prevent thousands of rapid React re-renders.
- **Verification**:
  - Scrolling through wallpapers smoothly requests thumbnails on demand.
  - `bun run build` passes.

### Task 5: Final Validation & Release Build
- **Details**:
  - Run `bun test` and `cargo test --locked`.
  - Run `bun run build`.
  - Build optimized release executable: `cargo build --release --locked`.
  - Launch release binary and confirm butter-smooth scrolling across large wallpaper folders.
